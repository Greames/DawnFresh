import type { Config } from '@netlify/functions'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, customers, invoiceRecords, paymentRecords, stockLots } from '../../db/schema.js'
import { customerReceivables, outletStockLedger, posOutlets, posPayments, posReconciliations, posReturns, posSaleItems, posSales, posShifts, receivablePayments, stockBalances, stockCounts } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import type { Access } from '../../db/access.js'
import { Rejection, failure, idempotencyKeyOf, respond, transact } from '../../db/tx.js'
import type { Tx } from '../../db/tx.js'
import { guardBusinessDay } from '../../db/daily-close.js'
import { companyPrice, customerPrice } from '../../db/pricing.js'
import { EPS, PRODUCTS, addStock, lockBalance, lockCompanyLots, moveStock, r2, r3, receiveFromCompanyLot, removeStock } from '../../db/stock.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const methods = ['Cash', 'UPI', 'Card', 'Credit']
const n = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d }
const s = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''
const uid = (v: unknown) => { const x = s(v, 80); return uuidPattern.test(x) ? x : null }
const scope = (access: Access, franchiseId?: string | null) =>
  access.role !== 'franchisee' || (!!franchiseId && access.franchise?.id === franchiseId)

async function loadOutlet(tx: Tx, access: Access, outletId: string | null) {
  const [outlet] = outletId ? await tx.select().from(posOutlets).where(eq(posOutlets.id, outletId)) : []
  if (!outlet || !scope(access, outlet.franchiseId)) throw new Rejection(404, 'Outlet not found.')
  return outlet
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'pos', 'view')) return Response.json({ error: 'POS access is required.' }, { status: 403, headers })

    if (req.method === 'GET') {
      const [outlets, shifts, sales, payments, ledger, recs, lots, balances, receivables, receivableRows] = await Promise.all([
        db.select().from(posOutlets).orderBy(desc(posOutlets.createdAt)),
        db.select().from(posShifts).orderBy(desc(posShifts.openedAt)),
        db.select().from(posSales).orderBy(desc(posSales.soldAt)),
        db.select().from(posPayments).orderBy(desc(posPayments.receivedAt)),
        db.select().from(outletStockLedger).orderBy(desc(outletStockLedger.createdAt), desc(outletStockLedger.seq)),
        db.select().from(posReconciliations).orderBy(desc(posReconciliations.businessDate)),
        db.select().from(stockLots).orderBy(desc(stockLots.createdAt)),
        db.select().from(stockBalances),
        db.select().from(customerReceivables).orderBy(desc(customerReceivables.createdAt)),
        db.select().from(receivablePayments).orderBy(desc(receivablePayments.receivedAt)),
      ])
      const visibleOutletIds = new Set(outlets.filter(x => scope(access, x.franchiseId)).map(x => x.id))
      const visibleSaleIds = new Set(sales.filter(x => visibleOutletIds.has(x.outletId)).map(x => x.id))
      return Response.json({
        outlets: outlets.filter(x => visibleOutletIds.has(x.id)),
        shifts: shifts.filter(x => visibleOutletIds.has(x.outletId)),
        sales: sales.filter(x => visibleOutletIds.has(x.outletId)),
        payments: payments.filter(x => visibleSaleIds.has(x.saleId)),
        ledger: ledger.filter(x => visibleOutletIds.has(x.outletId)),
        reconciliations: recs.filter(x => visibleOutletIds.has(x.outletId)),
        lots: lots.filter(x => !!x.posOutletId && visibleOutletIds.has(x.posOutletId)),
        balances: balances.filter(x => visibleOutletIds.has(x.outletId)),
        receivables: receivables.filter(x => scope(access, x.franchiseId)),
        receivablePayments: receivableRows.filter(x => scope(access, x.franchiseId)),
      }, { headers })
    }

    if (!['POST', 'PATCH'].includes(req.method) || !sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = s(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id
    const editOnly = () => allowed(access, 'pos', 'edit') ? null : Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
    const key = idempotencyKeyOf(req, body)
    const run = (fn: (tx: Tx) => Promise<{ status: number; body: unknown }>) => transact({ actor, action, key, payload: data }, fn)

    if (action === 'create-outlet') {
      const denied = editOnly(); if (denied) return denied
      const franchiseId = data.franchiseId ? s(data.franchiseId, 80) : null
      if (!scope(access, franchiseId) || !s(data.code, 50) || !s(data.name, 150)) return Response.json({ error: 'Outlet code and name are required.' }, { status: 400, headers })
      const [row] = await db.insert(posOutlets).values({
        franchiseId, code: s(data.code, 50).toUpperCase(), name: s(data.name, 150),
        address: s(data.address, 500) || null, status: s(data.status, 30) || 'Active',
        openingTime: s(data.openingTime, 20) || null, closingTime: s(data.closingTime, 20) || null,
      }).returning()
      return Response.json(row, { status: 201, headers })
    }

    if (action === 'open-shift') {
      const denied = editOnly(); if (denied) return denied
      const outletId = s(data.outletId, 80)
      const [outlet] = uuidPattern.test(outletId) ? await db.select().from(posOutlets).where(eq(posOutlets.id, outletId)) : []
      if (!outlet || !scope(access, outlet.franchiseId) || outlet.status !== 'Active') return Response.json({ error: 'Active outlet not found.' }, { status: 404, headers })
      const openingCash = String(Math.max(0, n(data.openingCash)))
      try {
        // One open shift per outlet: checked under a per-outlet lock inside the transaction, and backed by a partial unique index.
        const row = await db.transaction(async tx => {
          await guardBusinessDay(tx, outlet.franchiseId)
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'open-shift:' + outletId}))`)
          const [open] = await tx.select({ id: posShifts.id }).from(posShifts).where(and(eq(posShifts.outletId, outletId), eq(posShifts.status, 'Open')))
          if (open) throw new Rejection(409, 'An open shift already exists for this outlet.')
          const [created] = await tx.insert(posShifts).values({ outletId, cashierId: actor, openingCash }).returning()
          await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'pos_shift', entityId: created.id, action: 'opened', metadata: { outletId, openingCash: Number(openingCash) } })
          return created
        })
        return Response.json(row, { status: 201, headers })
      } catch (e) {
        if ((e as { cause?: { code?: string } })?.cause?.code === '23505' || (e as { code?: string })?.code === '23505') return Response.json({ error: 'An open shift already exists for this outlet.' }, { status: 409, headers })
        throw e
      }
    }

    if (action === 'record-sale') {
      const denied = editOnly(); if (denied) return denied
      const outletId = s(data.outletId, 80), shiftId = s(data.shiftId, 80)
      const items = Array.isArray(data.items) ? data.items : []
      if (!items.length) return Response.json({ error: 'At least one sale item is required.' }, { status: 400, headers })
      if (items.length > 100) return Response.json({ error: 'A sale can have at most 100 lines.' }, { status: 400, headers })
      for (const item of items) {
        const product = s(item?.product, 80), qty = n(item?.quantity)
        if (!PRODUCTS.includes(product) || !Number.isFinite(qty) || qty <= 0) {
          return Response.json({ error: 'Sale items require a valid product and a positive quantity.' }, { status: 400, headers })
        }
        // Prices, tax and discounts come from the company price list on the server. A client may echo the price it
        // saw, but any value that differs is rejected; discounts are not offered.
        if (n(item?.discount) !== 0 || (item?.discount !== undefined && item?.discount !== null && !Number.isFinite(Number(item.discount)))) return Response.json({ error: 'Discounts are not allowed at the POS.' }, { status: 400, headers })
        if (item.stockLotId && !uid(item.stockLotId)) return Response.json({ error: 'Invalid stock lot.' }, { status: 400, headers })
      }
      const payments = Array.isArray(data.payments) ? data.payments : null
      // A single payment may leave out its amount: it then covers the server-computed total.
      const singleOpen = payments?.length === 1 && (payments[0]?.amount === undefined || payments[0]?.amount === null)
      for (const p of payments ?? []) {
        if (!methods.includes(s(p?.method, 30)) || (!singleOpen && !(n(p?.amount) > 0))) return Response.json({ error: 'Invalid payment.' }, { status: 400, headers })
      }
      const customerId = data.customerId ? s(data.customerId, 80) : null

      const done = await run(async tx => {
        const outlet = await loadOutlet(tx, access, uid(outletId)).catch(() => { throw new Rejection(400, 'Open outlet shift is required.') })
        await guardBusinessDay(tx, outlet.franchiseId)
        // A shared lock on the shift lets sales run side by side while close-shift (which takes the exclusive lock) waits for them.
        const [shift] = uid(shiftId) ? await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('share') : []
        if (!shift || shift.outletId !== outlet.id || shift.status !== 'Open') throw new Rejection(400, 'Open outlet shift is required.')
        if (customerId) {
          const [customer] = uuidPattern.test(customerId) ? await tx.select().from(customers).where(eq(customers.id, customerId)) : []
          if (!customer || (customer.franchiseId ?? null) !== (outlet.franchiseId ?? null)) throw new Rejection(400, 'Customer not found for this outlet.')
        }

        // Server-side price and tax per product (franchise-specific configuration first). No price, no sale.
        const prices = new Map<string, { unitPrice: number; taxRatePct: number }>()
        for (const product of new Set<string>(items.map((i: any) => s(i.product, 80)))) {
          const found = await customerPrice(tx, product, outlet.franchiseId)
          if (!found) throw new Rejection(422, `No active customer price is configured for ${product}. Ask the company to set one.`)
          prices.set(product, found)
        }
        const lines = items.map((item: any) => {
          const product = s(item.product, 80), qty = r3(n(item.quantity)), price = prices.get(product)!
          const subtotal = r2(qty * price.unitPrice), tax = r2(subtotal * price.taxRatePct / 100)
          if (item.unitPrice !== undefined && item.unitPrice !== null && !(Math.abs(Number(item.unitPrice) - price.unitPrice) <= 0.004)) throw new Rejection(400, `The unit price for ${product} is set by the company (${price.unitPrice.toFixed(2)} per kg). A different price was supplied.`)
          if (item.tax !== undefined && item.tax !== null && !(Math.abs(Number(item.tax) - tax) <= 0.004)) throw new Rejection(400, `The tax for ${product} is computed by the server (${tax.toFixed(2)}). A different amount was supplied.`)
          return { item, product, qty, unitPrice: price.unitPrice, subtotal, tax }
        })
        const subtotal = r2(lines.reduce((a: number, l: any) => a + l.subtotal, 0))
        const tax = r2(lines.reduce((a: number, l: any) => a + l.tax, 0))
        const total = r2(subtotal + tax)
        const tendered = singleOpen ? [{ ...payments![0], amount: total }] : payments ?? [{ method: 'Cash', amount: total }]
        const paidSum = tendered.reduce((a: number, p: any) => a + n(p?.amount), 0)
        if (Math.abs(paidSum - total) > 0.01) throw new Rejection(400, `Payment total must equal the sale total of ${total.toFixed(2)}.`)
        const credit = r2(tendered.filter((p: any) => s(p.method, 30) === 'Credit').reduce((a: number, p: any) => a + n(p.amount), 0))
        if (credit > 0 && !customerId) throw new Rejection(400, 'A credit sale needs a customer.')

        const saleId = crypto.randomUUID()
        const bill = s(data.billNumber, 80) || `POS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${saleId.slice(0, 8).toUpperCase()}`
        const [duplicate] = await tx.select({ id: posSales.id }).from(posSales).where(eq(posSales.billNumber, bill))
        if (duplicate) throw new Rejection(409, 'This bill number is already used.')
        const [sale] = await tx.insert(posSales).values({
          id: saleId, outletId: outlet.id, shiftId, billNumber: bill, customerId, cashierId: actor,
          subtotal: String(subtotal), discount: '0', tax: String(tax), total: String(total), status: 'Completed',
        }).returning()

        // Stock first, in product order so concurrent multi-product sales take their balance locks in one order.
        const order = lines.map((line: any, index: number) => ({ line, index })).sort((a: any, b: any) => a.line.product.localeCompare(b.line.product) || a.index - b.index)
        const saleItems: (typeof posSaleItems.$inferInsert)[] = []
        for (const { line } of order) {
          const pieces = await removeStock(tx, { outlet, product: line.product, quantity: line.qty, lotId: line.item.stockLotId ? uid(line.item.stockLotId) : null, type: 'Sale', actor, referenceType: 'POS_SALE', referenceId: sale.id, saleId: sale.id, skipExpired: true })
          // A line the caller did not pin to a lot may be filled from several lots: one sale line per lot, line value and tax split pro rata.
          let usedSubtotal = 0, usedTax = 0
          pieces.forEach((part, i) => {
            const last = i === pieces.length - 1
            const pieceSubtotal = last ? r2(line.subtotal - usedSubtotal) : r2(part.quantity * line.unitPrice)
            const pieceTax = last ? r2(line.tax - usedTax) : r2(line.tax * part.quantity / line.qty)
            usedSubtotal = r2(usedSubtotal + pieceSubtotal); usedTax = r2(usedTax + pieceTax)
            saleItems.push({
              saleId: sale.id, product: line.product, quantity: part.quantity.toFixed(3), unit: s(line.item.unit, 20) || 'kg', unitPrice: line.unitPrice.toFixed(2),
              discount: '0', tax: String(pieceTax), total: String(r2(pieceSubtotal + pieceTax)), unitCost: part.unitCost, stockLotId: part.lotId,
            })
          })
        }
        const insertedItems = await tx.insert(posSaleItems).values(saleItems).returning()

        await tx.insert(posPayments).values(tendered.map((p: any) => ({ saleId: sale.id, method: s(p.method, 30), amount: String(r2(n(p.amount))), reference: s(p.reference, 200) || null })))
        // A credit sale is not a Paid invoice: only what was tendered now counts as paid, the rest is a receivable.
        const paidNow = r2(total - credit)
        const [invoice] = await tx.insert(invoiceRecords).values({
          orderId: null, posSaleId: sale.id, invoiceNumber: `POS-${bill}`, subtotal: String(subtotal), tax: String(tax),
          total: String(total), paid: String(paidNow), status: credit === 0 ? 'Paid' : paidNow > 0 ? 'Partially Paid' : 'Issued', issuedAt: new Date(),
        }).returning()
        const nonCredit = tendered.filter((p: any) => s(p.method, 30) !== 'Credit')
        if (nonCredit.length) {
          await tx.insert(paymentRecords).values(nonCredit.map((p: any) => ({
            orderId: null, invoiceId: invoice.id, posSaleId: sale.id, amount: String(r2(n(p.amount))), method: s(p.method, 30), reference: s(p.reference, 200) || null,
          })))
        }
        let receivable: typeof customerReceivables.$inferSelect | null = null
        if (credit > 0) {
          ;[receivable] = await tx.insert(customerReceivables).values({ saleId: sale.id, outletId: outlet.id, franchiseId: outlet.franchiseId, customerId: customerId!, originalAmount: String(credit), status: 'Open' }).returning()
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'pos_sale', entityId: sale.id,
          action: 'completed', metadata: { outletId: outlet.id, billNumber: bill, total, tax, creditAmount: credit, receivableId: receivable?.id ?? null, invoiceId: invoice.id, idempotencyKey: key },
        })
        return { status: 201, body: { sale, invoice, items: insertedItems, receivable } }
      })
      return respond(done, headers)
    }

    if (action === 'collect-receivable') {
      const denied = editOnly(); if (denied) return denied
      const receivableId = uid(data.receivableId), shiftId = uid(data.shiftId), amount = n(data.amount, Number.NaN), method = s(data.method, 30) || 'Cash'
      if (!receivableId) return Response.json({ error: 'Receivable not found.' }, { status: 404, headers })
      if (!shiftId) return Response.json({ error: 'An open shift is required to take a payment.' }, { status: 400, headers })
      if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400, headers })
      if (!['Cash', 'UPI', 'Card'].includes(method)) return Response.json({ error: 'A receivable is paid by Cash, UPI or Card.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [peek] = await tx.select().from(customerReceivables).where(eq(customerReceivables.id, receivableId))
        if (!peek || !scope(access, peek.franchiseId)) throw new Rejection(404, 'Receivable not found.')
        await guardBusinessDay(tx, peek.franchiseId)
        const [shift] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('share')
        const [shiftOutlet] = shift ? await tx.select().from(posOutlets).where(eq(posOutlets.id, shift.outletId)) : []
        if (!shift || shift.status !== 'Open' || !shiftOutlet || (shiftOutlet.franchiseId ?? null) !== (peek.franchiseId ?? null)) throw new Rejection(400, 'An open shift of this franchise is required to take a payment.')
        // The receivable row is the lock for its open balance: concurrent payments queue here and re-read it.
        const [rec] = await tx.select().from(customerReceivables).where(eq(customerReceivables.id, receivableId)).for('update')
        const open = r2(n(rec.originalAmount) - n(rec.returnedAmount) - n(rec.paidAmount))
        if (r2(amount) > open + 0.0001) throw new Rejection(409, `The payment exceeds the open balance of ${open.toFixed(2)}.`)
        const [payment] = await tx.insert(receivablePayments).values({ receivableId, outletId: shift.outletId, franchiseId: rec.franchiseId, shiftId, amount: String(r2(amount)), method, reference: s(data.reference, 200) || null, receivedBy: actor }).returning()
        const paid = r2(n(rec.paidAmount) + amount), remaining = r2(open - amount)
        const [updated] = await tx.update(customerReceivables).set({ paidAmount: String(paid), status: remaining <= 0.0001 ? 'Paid' : 'Partially Paid', updatedAt: new Date() }).where(eq(customerReceivables.id, receivableId)).returning()
        const [invoice] = await tx.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, rec.saleId)).orderBy(desc(invoiceRecords.createdAt)).limit(1).for('update')
        if (invoice) {
          const invoicePaid = Math.min(n(invoice.total), r2(n(invoice.paid) + amount))
          await tx.update(invoiceRecords).set({ paid: String(invoicePaid), status: remaining <= 0.0001 ? 'Paid' : 'Partially Paid', updatedAt: new Date() }).where(eq(invoiceRecords.id, invoice.id))
          await tx.insert(paymentRecords).values({ orderId: null, invoiceId: invoice.id, posSaleId: rec.saleId, amount: String(r2(amount)), method, reference: payment.id })
        }
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: rec.franchiseId, entityType: 'receivable_payment', entityId: payment.id, action: 'collected', metadata: { receivableId, saleId: rec.saleId, amount, method, shiftId, balanceAfter: remaining, idempotencyKey: key } })
        return { status: 201, body: { receivable: updated, payment, balance: remaining } }
      })
      return respond(done, headers)
    }

    if (action === 'transfer-stock') {
      // Company stock reaches a franchise only through a supply request (transfer-to-franchise). This direct
      // move is for company staff.
      if (access.role === 'franchisee') return Response.json({ error: 'Franchise accounts cannot pull company stock. Raise a supply request instead.' }, { status: 403, headers })
      const denied = editOnly(); if (denied) return denied
      const outletId = uid(data.outletId), product = s(data.product, 80), qty = n(data.quantity)
      if (!outletId || !PRODUCTS.includes(product) || !(qty > 0)) return Response.json({ error: 'Valid outlet, product and quantity are required.' }, { status: 400, headers })
      if (data.referenceId && !uid(data.referenceId)) return Response.json({ error: 'referenceId must be a UUID.' }, { status: 400, headers })
      const done = await run(async tx => {
        const outlet = await loadOutlet(tx, access, outletId).catch(() => { throw new Rejection(400, 'Valid outlet, product and quantity are required.') })
        const price = await companyPrice(tx, product, outlet.franchiseId)
        const lots = await lockCompanyLots(tx, product)
        let remaining = r3(qty)
        const rows = []
        for (const lot of lots) {
          const take = Math.min(n(lot.quantity), remaining)
          if (take <= EPS) continue
          const { ledger } = await receiveFromCompanyLot(tx, {
            companyLot: lot, take: r3(take), outlet, type: 'TransferIn', actor, unitCost: price === null ? null : price.toFixed(4),
            referenceType: s(data.referenceType, 50) || 'STOCK_TRANSFER', referenceId: uid(data.referenceId),
          })
          rows.push(ledger)
          await tx.insert(auditEvents).values({
            actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'stock_transfer', entityId: ledger.id,
            action: 'company_to_outlet', metadata: { outletId, product, stockLotId: lot.id, quantity: take, idempotencyKey: key },
          })
          remaining = r3(remaining - take)
          if (remaining <= EPS) break
        }
        if (remaining > EPS) throw new Rejection(409, `Insufficient company stock for ${product}.`)
        return { status: 201, body: { rows } }
      })
      return respond(done, headers)
    }

    if (action === 'return-sale') {
      const denied = editOnly(); if (denied) return denied
      const saleId = uid(data.saleId), itemId = uid(data.itemId), qty = n(data.quantity)
      if (!saleId || !itemId) return Response.json({ error: 'Sale not found or access denied.' }, { status: 404, headers })
      if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Return quantity must be greater than zero.' }, { status: 400, headers })
      const refundMethod = s(data.refundMethod, 30) || 'Cash'
      if (!methods.includes(refundMethod)) return Response.json({ error: 'Invalid refund method.' }, { status: 400, headers })
      const dispositionRaw = s(data.disposition, 20).toLowerCase() || 'restock'
      if (!['restock', 'wastage'].includes(dispositionRaw)) return Response.json({ error: 'disposition must be Restock or Wastage.' }, { status: 400, headers })
      const disposition = dispositionRaw === 'wastage' ? 'Wastage' : 'Restock'
      const reason = s(data.reason, 300) || null

      const done = await run(async tx => {
        const [peekSale] = await tx.select().from(posSales).where(eq(posSales.id, saleId))
        const [peekOutlet] = peekSale ? await tx.select().from(posOutlets).where(eq(posOutlets.id, peekSale.outletId)) : []
        if (peekOutlet && scope(access, peekOutlet.franchiseId)) await guardBusinessDay(tx, peekOutlet.franchiseId)
        // The item row is the lock for its remaining quantity: concurrent returns queue here and re-read the total.
        const [item] = await tx.select().from(posSaleItems).where(eq(posSaleItems.id, itemId)).for('update')
        const [sale] = await tx.select().from(posSales).where(eq(posSales.id, saleId))
        const [saleOutlet] = sale ? await tx.select().from(posOutlets).where(eq(posOutlets.id, sale.outletId)) : []
        if (!sale || !item || item.saleId !== sale.id || !saleOutlet || !scope(access, saleOutlet.franchiseId)) throw new Rejection(404, 'Sale not found or access denied.')
        const previous = await tx.select().from(posReturns).where(eq(posReturns.itemId, itemId))
        const alreadyReturned = previous.reduce((a, r) => a + n(r.quantity), 0)
        if (alreadyReturned + qty > n(item.quantity) + EPS) throw new Rejection(400, 'Return quantity exceeds the remaining sold quantity.')
        const itemQty = Math.max(n(item.quantity), 0.001)
        const refundAmount = r2(Math.max(0, qty * n(item.unitPrice) - n(item.discount) * qty / itemQty + n(item.tax) * qty / itemQty))

        const [ret] = await tx.insert(posReturns).values({ saleId, itemId, quantity: String(r3(qty)), amount: String(refundAmount), reason, disposition }).returning()
        // Goods go back to the lot they were sold from when it is still this outlet's lot, else into a new return lot.
        let lotId: string | null = null
        if (item.stockLotId) {
          const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, item.stockLotId))
          if (lot && lot.posOutletId === sale.outletId) lotId = lot.id
        }
        const refs = { referenceType: 'POS_RETURN', referenceId: ret.id, saleId, reason }
        const restocked = await addStock(tx, { outlet: saleOutlet, product: item.product, quantity: qty, lotId, type: 'Return', actor, newLotPrefix: 'RET', unitCost: item.unitCost, ...refs })
        if (disposition === 'Wastage') {
          await moveStock(tx, { outletId: sale.outletId, franchiseId: saleOutlet.franchiseId, product: item.product, lotId: restocked.stockLotId!, type: 'Wastage', quantity: -qty, actor, ...refs, reason: `Returned goods discarded${reason ? `: ${reason}` : ''}` })
        }
        // On a credit sale the refund first cancels what the customer still owes; only the rest goes back as money.
        let cashRefund = refundAmount, creditCancelled = 0
        const [receivable] = await tx.select().from(customerReceivables).where(eq(customerReceivables.saleId, saleId)).for('update')
        if (receivable) {
          const open = r2(n(receivable.originalAmount) - n(receivable.returnedAmount) - n(receivable.paidAmount))
          creditCancelled = Math.min(open, refundAmount)
          cashRefund = r2(refundAmount - creditCancelled)
          if (creditCancelled > 0) {
            const stillOpen = r2(open - creditCancelled)
            await tx.update(customerReceivables).set({ returnedAmount: String(r2(n(receivable.returnedAmount) + creditCancelled)), status: stillOpen <= 0.0001 ? 'Paid' : n(receivable.paidAmount) > 0 || n(receivable.returnedAmount) + creditCancelled > 0 ? 'Partially Paid' : 'Open', updatedAt: new Date() }).where(eq(customerReceivables.id, receivable.id))
          }
        }
        if (cashRefund > 0) await tx.insert(posPayments).values({ saleId, method: refundMethod, amount: String(-cashRefund), reference: `RETURN:${ret.id}`, status: 'Reversed' })
        const [invoice] = await tx.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, saleId)).orderBy(desc(invoiceRecords.createdAt)).limit(1).for('update')
        if (invoice && cashRefund > 0) {
          const paid = r2(Math.max(0, n(invoice.paid) - cashRefund))
          await tx.update(invoiceRecords).set({ paid: String(paid), status: paid >= n(invoice.total) ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Issued', updatedAt: new Date() }).where(eq(invoiceRecords.id, invoice.id))
          await tx.insert(paymentRecords).values({ orderId: null, invoiceId: invoice.id, posSaleId: saleId, amount: String(-cashRefund), method: 'Refund', reference: ret.id, status: 'Reversed' })
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: saleOutlet.franchiseId, entityType: 'pos_return', entityId: ret.id,
          action: 'created', metadata: { saleId, itemId, quantity: qty, refundAmount, cashRefund, creditCancelled, refundMethod, disposition, stockLotId: restocked.stockLotId, idempotencyKey: key },
        })
        return { status: 201, body: { return: ret, refundAmount, cashRefund, creditCancelled } }
      })
      return respond(done, headers)
    }

    if (action === 'return-supply') {
      // Company-supplied stock goes back to the company lot it came from. The value is quantity x the lot's carried company price,
      // so the franchise's settlement is reduced by exactly what it was billed for those goods.
      const denied = editOnly(); if (denied) return denied
      const outletId = uid(data.outletId), lotId = uid(data.stockLotId), qty = n(data.quantity), reason = s(data.reason, 300)
      if (!outletId || !lotId) return Response.json({ error: 'A valid outlet and stock lot are required.' }, { status: 400, headers })
      if (!(qty > 0) || !reason) return Response.json({ error: 'A supply return needs a positive quantity and a reason.' }, { status: 400, headers })
      const done = await run(async tx => {
        const outlet = await loadOutlet(tx, access, outletId)
        if (!outlet.franchiseId) throw new Rejection(400, 'Only franchise outlets return supplied stock to the company.')
        const [peek] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId))
        if (!peek || peek.posOutletId !== outlet.id || !peek.parentLotId) throw new Rejection(400, 'Only a lot supplied by the company can be returned to it.')
        if (peek.unitCost === null) throw new Rejection(409, 'This lot has no recorded company price, so the return cannot be valued.')
        // Lock order: outlet balance, outlet lot (inside removeStock), then the company lot.
        const [removed] = await removeStock(tx, { outlet, product: peek.product, quantity: qty, lotId, type: 'SupplyReturn', actor, referenceType: 'SUPPLY_RETURN', reason })
        const [parent] = await tx.select().from(stockLots).where(eq(stockLots.id, peek.parentLotId)).for('update')
        if (!parent) throw new Rejection(409, 'The company lot this stock came from no longer exists.')
        await tx.update(stockLots).set({ quantity: r3(n(parent.quantity) + qty).toFixed(3), status: 'Available', updatedAt: new Date() }).where(eq(stockLots.id, parent.id))
        const value = r2(qty * n(removed.unitCost))
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'supply_return', entityId: removed.ledgerId, action: 'recorded', metadata: { outletId, product: peek.product, quantity: qty, stockLotId: lotId, companyLotId: parent.id, unitCost: n(removed.unitCost), value, reason, idempotencyKey: key } })
        return { status: 201, body: { ledgerId: removed.ledgerId, product: peek.product, quantity: qty, unitCost: n(removed.unitCost), value, companyLotId: parent.id } }
      })
      return respond(done, headers)
    }

    if (action === 'record-wastage' || action === 'adjust-stock' || action === 'count-stock') {
      const denied = editOnly(); if (denied) return denied
      const outletId = uid(data.outletId), product = s(data.product, 80), lotId = data.stockLotId ? uid(data.stockLotId) : null
      const reason = s(data.reason, 300)
      if (!outletId || !PRODUCTS.includes(product) || (data.stockLotId && !lotId)) return Response.json({ error: 'A valid outlet, product and stock lot are required.' }, { status: 400, headers })
      const expiryAt = data.expiryAt ? new Date(String(data.expiryAt)) : null
      if (expiryAt && Number.isNaN(expiryAt.getTime())) return Response.json({ error: 'Expiry date is invalid.' }, { status: 400, headers })
      const batchCode = s(data.batchCode, 100) || null

      if (action === 'record-wastage') {
        const qty = n(data.quantity)
        if (!(qty > 0) || !reason) return Response.json({ error: 'Wastage needs a positive quantity and a reason.' }, { status: 400, headers })
        const done = await run(async tx => {
          const outlet = await loadOutlet(tx, access, outletId)
          await guardBusinessDay(tx, outlet.franchiseId)
          const removed = await removeStock(tx, { outlet, product, quantity: qty, lotId, type: 'Wastage', actor, referenceType: 'WASTAGE', reason })
          await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'stock_wastage', entityId: removed[0].ledgerId, action: 'recorded', metadata: { outletId, product, quantity: qty, reason, lots: removed.map(r => r.lotId), idempotencyKey: key } })
          return { status: 201, body: { rows: await tx.select().from(outletStockLedger).where(inArray(outletStockLedger.id, removed.map(r => r.ledgerId))).orderBy(outletStockLedger.seq) } }
        })
        return respond(done, headers)
      }

      if (action === 'adjust-stock') {
        const delta = n(data.quantityDelta)
        if (!delta || !reason) return Response.json({ error: 'An adjustment needs a non-zero quantityDelta and a reason.' }, { status: 400, headers })
        // Adding stock creates inventory, so franchise accounts may only write stock down; company staff add it.
        if (delta > 0 && access.role === 'franchisee') return Response.json({ error: 'Franchise accounts can only reduce stock. Ask the company to add stock.' }, { status: 403, headers })
        const done = await run(async tx => {
          const outlet = await loadOutlet(tx, access, outletId)
          await guardBusinessDay(tx, outlet.franchiseId)
          const refs = { referenceType: 'ADJUSTMENT', reason }
          const ids = delta < 0
            ? (await removeStock(tx, { outlet, product, quantity: -delta, lotId, type: 'Adjustment', actor, ...refs })).map(r => r.ledgerId)
            : [(await addStock(tx, { outlet, product, quantity: delta, lotId, type: 'Adjustment', actor, newLotPrefix: 'ADJ', batchCode, expiryAt, ...refs })).id]
          await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'stock_adjustment', entityId: ids[0], action: 'recorded', metadata: { outletId, product, quantityDelta: delta, reason, idempotencyKey: key } })
          return { status: 201, body: { rows: await tx.select().from(outletStockLedger).where(inArray(outletStockLedger.id, ids)).orderBy(outletStockLedger.seq) } }
        })
        return respond(done, headers)
      }

      const counted = Number(data.countedQuantity)
      if (!Number.isFinite(counted) || counted < 0) return Response.json({ error: 'countedQuantity must be zero or more.' }, { status: 400, headers })
      const done = await run(async tx => {
        const outlet = await loadOutlet(tx, access, outletId)
        await guardBusinessDay(tx, outlet.franchiseId)
        const balance = await lockBalance(tx, outletId, product)
        let system = balance
        if (lotId) {
          const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId)).for('update')
          if (!lot || lot.posOutletId !== outletId || lot.product !== product) throw new Rejection(400, 'The stock lot does not belong to this outlet and product.')
          system = n(lot.quantity)
        }
        const variance = r3(counted - system)
        if (Math.abs(variance) > EPS && !reason) throw new Rejection(400, 'A count with a variance needs a reason.')
        if (variance > EPS && access.role === 'franchisee') throw new Rejection(403, 'A count above the recorded stock must be approved by the company.')
        const [count] = await tx.insert(stockCounts).values({ outletId, franchiseId: outlet.franchiseId, product, stockLotId: lotId, systemQuantity: system.toFixed(3), countedQuantity: r3(counted).toFixed(3), variance: variance.toFixed(3), reason: reason || null, countedBy: actor }).returning()
        const refs = { referenceType: 'STOCK_COUNT', referenceId: count.id, reason: reason || null }
        let ledgerId: string | null = null
        if (variance < -EPS) ledgerId = (await removeStock(tx, { outlet, product, quantity: -variance, lotId, type: 'Count', actor, ...refs }))[0].ledgerId
        else if (variance > EPS) ledgerId = (await addStock(tx, { outlet, product, quantity: variance, lotId, type: 'Count', actor, newLotPrefix: 'CNT', batchCode, expiryAt, ...refs })).id
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'stock_count', entityId: count.id, action: 'recorded', metadata: { outletId, product, system, counted, variance, reason: reason || null, idempotencyKey: key } })
        return { status: 201, body: { count, ledgerId } }
      })
      return respond(done, headers)
    }

    if (action === 'close-shift') {
      const denied = editOnly(); if (denied) return denied
      const shiftId = uid(data.shiftId)
      if (!shiftId) return Response.json({ error: 'Open shift not found.' }, { status: 404, headers })
      const counted = n(data.countedCash)
      const done = await run(async tx => {
        // Exclusive lock: waits for sales still in flight (shared lock) and makes a second closer see Closed.
        const [shift] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('update')
        if (!shift || shift.status !== 'Open') throw new Rejection(404, 'Open shift not found.')
        const [outlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, shift.outletId))
        if (!outlet || !scope(access, outlet.franchiseId)) throw new Rejection(403, 'Outlet access denied.')
        const rows = await tx.select().from(posPayments).innerJoin(posSales, eq(posPayments.saleId, posSales.id)).where(eq(posSales.shiftId, shiftId))
        const byMethod = (m: string) => rows.filter(r => r.pos_payments.method === m).reduce((a, r) => a + n(r.pos_payments.amount), 0)
        // Money taken in this shift against earlier credit sales counts as collected cash / UPI / card, so it is in the expected cash.
        const collected = await tx.select().from(receivablePayments).where(eq(receivablePayments.shiftId, shiftId))
        const fromReceivables = (m: string) => collected.filter(r => r.method === m).reduce((a, r) => a + n(r.amount), 0)
        const cash = byMethod('Cash') + fromReceivables('Cash'), upi = byMethod('UPI') + fromReceivables('UPI'), card = byMethod('Card') + fromReceivables('Card'), credit = byMethod('Credit')
        const sales = await tx.select().from(posSales).where(eq(posSales.shiftId, shiftId))
        const grossSales = sales.reduce((a, r) => a + n(r.subtotal) + n(r.tax), 0)
        const discounts = sales.reduce((a, r) => a + n(r.discount), 0)
        const tax = sales.reduce((a, r) => a + n(r.tax), 0)
        const allReturnRows = (await Promise.all(sales.map(x => tx.select().from(posReturns).where(eq(posReturns.saleId, x.id))))).flat()
        const returnTotal = allReturnRows.reduce((a, r) => a + n(r.amount), 0)
        const netSales = sales.reduce((a, r) => a + n(r.total), 0) - returnTotal
        const expected = n(shift.openingCash) + cash
        const variance = counted - expected
        await tx.update(posShifts).set({ status: 'Closed', closedAt: new Date(), expectedCash: String(expected), countedCash: String(counted), cashVariance: String(variance) }).where(eq(posShifts.id, shiftId))
        const [row] = await tx.insert(posReconciliations).values({
          outletId: shift.outletId, shiftId, businessDate: new Date(), grossSales: String(grossSales),
          returns: String(returnTotal), discounts: String(discounts), tax: String(tax), netSales: String(netSales),
          cashCollected: String(cash), upiCollected: String(upi), cardCollected: String(card),
          creditSales: String(credit), expectedCash: String(expected), countedCash: String(counted),
          variance: String(variance), status: Math.abs(variance) < 0.01 ? 'Closed' : 'Exception',
          closedBy: actor, closedAt: new Date(),
        }).returning()
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'pos_shift',
          entityId: shiftId, action: 'closed', metadata: { expectedCash: expected, countedCash: counted, variance, netSales, idempotencyKey: key },
        })
        return { status: 201, body: row }
      })
      return respond(done, headers)
    }

    return Response.json({ error: 'Unknown POS action.' }, { status: 400, headers })
  } catch (e) {
    return failure(e, headers, 'POS operation failed.')
  }
}

export const config: Config = { path: '/api/pos' }
