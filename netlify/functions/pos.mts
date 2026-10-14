import type { Config } from '@netlify/functions'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, customers, invoiceRecords, paymentRecords, stockLots } from '../../db/schema.js'
import { outletStockLedger, posOutlets, posPayments, posReconciliations, posReturns, posSaleItems, posSales, posShifts } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { allocateFifo, debitFifo, lotBuckets, outletBalance, postMovement } from '../../db/outlet-stock.js'

const products = ['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns']
const methods = ['Cash', 'UPI', 'Card', 'Credit']
const n = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d }
const s = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''
const scope = (access: Awaited<ReturnType<typeof resolveAccess>>, franchiseId?: string | null) =>
  access.role !== 'franchisee' || (!!franchiseId && access.franchise?.id === franchiseId)

const EPS = 0.000001
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'pos', 'view')) return Response.json({ error: 'POS access is required.' }, { status: 403, headers })

    if (req.method === 'GET') {
      const [outlets, shifts, sales, payments, ledger, recs] = await Promise.all([
        db.select().from(posOutlets).orderBy(desc(posOutlets.createdAt)),
        db.select().from(posShifts).orderBy(desc(posShifts.openedAt)),
        db.select().from(posSales).orderBy(desc(posSales.soldAt)),
        db.select().from(posPayments).orderBy(desc(posPayments.receivedAt)),
        db.select().from(outletStockLedger).orderBy(desc(outletStockLedger.createdAt)),
        db.select().from(posReconciliations).orderBy(desc(posReconciliations.businessDate)),
      ])
      const visibleOutletIds = new Set(outlets.filter(x => scope(access, x.franchiseId)).map(x => x.id))
      // Available stock = sum of ledger movement quantities per outlet and product (never balance_after).
      const visibleLedger = ledger.filter(x => visibleOutletIds.has(x.outletId))
      const stockMap = new Map<string, { outletId: string; product: string; quantity: number }>()
      for (const row of visibleLedger) {
        const key = `${row.outletId}:${row.product}`
        const entry = stockMap.get(key) ?? { outletId: row.outletId, product: row.product, quantity: 0 }
        entry.quantity = Math.round((entry.quantity + n(row.quantity)) * 1000) / 1000
        stockMap.set(key, entry)
      }
      return Response.json({
        stock: [...stockMap.values()],
        outlets: outlets.filter(x => visibleOutletIds.has(x.id)),
        shifts: shifts.filter(x => visibleOutletIds.has(x.outletId)),
        sales: sales.filter(x => visibleOutletIds.has(x.outletId)),
        payments: payments.filter(x => sales.some(y => y.id === x.saleId && visibleOutletIds.has(y.outletId))),
        ledger: visibleLedger,
        reconciliations: recs.filter(x => visibleOutletIds.has(x.outletId)),
      }, { headers })
    }

    if (!['POST', 'PATCH'].includes(req.method) || !sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = s(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id

    if (action === 'create-outlet') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
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
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80)
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      if (!outlet || !scope(access, outlet.franchiseId) || outlet.status !== 'Active') return Response.json({ error: 'Active outlet not found.' }, { status: 404, headers })
      const [open] = await db.select().from(posShifts).where(and(eq(posShifts.outletId, outletId), eq(posShifts.status, 'Open')))
      if (open) return Response.json({ error: 'An open shift already exists for this outlet.' }, { status: 409, headers })
      const [row] = await db.insert(posShifts).values({ outletId, cashierId: actor, openingCash: String(Math.max(0, n(data.openingCash))) }).returning()
      return Response.json(row, { status: 201, headers })
    }

    if (action === 'record-sale') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80), shiftId = s(data.shiftId, 80)
      const items = Array.isArray(data.items) ? data.items : []
      const idempotencyKey = s(data.idempotencyKey, 120) || null
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId))
      if (!outlet || !shift || shift.outletId !== outletId || shift.status !== 'Open' || !scope(access, outlet.franchiseId)) return Response.json({ error: 'Open outlet shift is required.' }, { status: 400, headers })
      if (idempotencyKey) {
        const [existing] = await db.select().from(posSales).where(eq(posSales.idempotencyKey, idempotencyKey))
        if (existing) {
          if (existing.outletId !== outletId || !scope(access, outlet.franchiseId)) return Response.json({ error: 'Idempotency key is already used by another outlet.' }, { status: 409, headers })
          return Response.json({ sale: existing, replayed: true }, { headers })
        }
      }
      if (!items.length) return Response.json({ error: 'At least one sale item is required.' }, { status: 400, headers })
      const customerId = data.customerId ? s(data.customerId, 80) : null
      if (customerId) {
        const [customer] = await db.select({ franchiseId: customers.franchiseId }).from(customers).where(eq(customers.id, customerId))
        if (!customer || (customer.franchiseId ?? null) !== (outlet.franchiseId ?? null)) return Response.json({ error: 'Customer not found for this outlet.' }, { status: 400, headers })
      }

      const requestedByProduct = new Map<string, number>()
      for (const item of items) {
        const product = s(item.product, 80), qty = n(item.quantity)
        const unitPrice = n(item.unitPrice, Number.NaN)
        const itemDiscount = n(item.discount), itemTax = n(item.tax)
        if (!products.includes(product) || !Number.isFinite(qty) || qty <= 0 ||
            !Number.isFinite(unitPrice) || unitPrice < 0 ||
            !Number.isFinite(itemDiscount) || itemDiscount < 0 || itemDiscount > qty * unitPrice ||
            !Number.isFinite(itemTax) || itemTax < 0) {
          return Response.json({ error: 'Sale items require a valid product, positive quantity, non-negative price/tax, and a discount within the line value.' }, { status: 400, headers })
        }
        requestedByProduct.set(product, (requestedByProduct.get(product) || 0) + qty)
      }
      const subtotal = items.reduce((a: number, i: any) => a + n(i.quantity) * n(i.unitPrice), 0)
      const discount = items.reduce((a: number, i: any) => a + n(i.discount), 0)
      const tax = items.reduce((a: number, i: any) => a + n(i.tax), 0)
      const total = Math.max(0, subtotal - discount + tax)
      const payments = Array.isArray(data.payments) ? data.payments : [{ method: 'Cash', amount: total }]
      const paid = payments.reduce((a: number, p: any) => a + n(p.amount), 0)
      if (Math.abs(paid - total) > 0.01) return Response.json({ error: 'Payment total must equal sale total.' }, { status: 400, headers })
      for (const p of payments) {
        if (!methods.includes(s(p.method, 30)) || n(p.amount) <= 0) return Response.json({ error: 'Invalid payment.' }, { status: 400, headers })
      }

      const result = await db.transaction(async tx => {
        // Serialize stock-affecting writes for this outlet. Displayed browser stock is advisory only.
        const [lockedOutlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, outletId)).for('update')
        const [lockedShift] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('update')
        if (!lockedOutlet || !scope(access, lockedOutlet.franchiseId) || !lockedShift ||
            lockedShift.outletId !== outletId || lockedShift.status !== 'Open') {
          throw new Error('The outlet shift is no longer open. Refresh POS and try again.')
        }
        // Stock is allocated FIFO from the outlet ledger under the outlet lock. Client lot ids and any
        // allowNegativeStock flag are ignored entirely: the server alone decides which lots are sold.
        const allocationsByProduct = new Map<string, Array<{ lotId: string | null; quantity: number }>>()
        for (const [product, requested] of requestedByProduct) {
          const balance = await outletBalance(tx, outletId, product)
          if (balance - requested < -EPS) throw new Error(`Insufficient outlet stock for ${product}. Available: ${balance}; requested: ${requested}.`)
          allocationsByProduct.set(product, await allocateFifo(tx, outletId, product, requested))
        }

        const bill = s(data.billNumber, 80) || `POS-${Date.now()}`
        const [sale] = await tx.insert(posSales).values({
          outletId, shiftId, billNumber: bill, idempotencyKey,
          customerId, cashierId: actor,
          subtotal: String(subtotal), discount: String(discount), tax: String(tax), total: String(total), status: 'Completed',
        }).returning()

        // Pre-assign lots per line from the product allocation (consumed in line order) so each sale item records its primary lot.
        const lineLots: Array<Array<{ lotId: string | null; quantity: number }>> = []
        const cursors = new Map<string, Array<{ lotId: string | null; quantity: number }>>()
        for (const [product, list] of allocationsByProduct) cursors.set(product, list.map(x => ({ ...x })))
        for (const item of items) {
          const product = s(item.product, 80)
          let need = n(item.quantity)
          const mine: Array<{ lotId: string | null; quantity: number }> = []
          for (const slot of cursors.get(product) ?? []) {
            if (need <= EPS) break
            if (slot.quantity <= EPS) continue
            const take = Math.min(slot.quantity, need)
            slot.quantity -= take; need -= take
            mine.push({ lotId: slot.lotId, quantity: take })
          }
          lineLots.push(mine)
        }

        for (const [index, item] of items.entries()) {
          const product = s(item.product, 80), qty = n(item.quantity)
          await tx.insert(posSaleItems).values({
            saleId: sale.id, product, quantity: String(qty), unit: s(item.unit, 20) || 'kg',
            unitPrice: String(n(item.unitPrice)), discount: String(n(item.discount)), tax: String(n(item.tax)),
            total: String(Math.max(0, qty * n(item.unitPrice) - n(item.discount) + n(item.tax))),
            stockLotId: lineLots[index][0]?.lotId ?? null,
          })
        }

        for (const p of payments) {
          await tx.insert(posPayments).values({
            saleId: sale.id, method: s(p.method, 30), amount: String(n(p.amount)), reference: s(p.reference, 200) || null,
          })
        }

        const invoiceNumber = `POS-${bill}`
        const [invoice] = await tx.insert(invoiceRecords).values({
          orderId: null, posSaleId: sale.id, invoiceNumber, subtotal: String(subtotal), tax: String(tax),
          total: String(total), paid: String(paid), status: 'Paid', issuedAt: new Date(),
        }).returning()

        for (const p of payments) {
          await tx.insert(paymentRecords).values({
            orderId: null, invoiceId: invoice.id, posSaleId: sale.id, amount: String(n(p.amount)),
            method: s(p.method, 30), reference: s(p.reference, 200) || null,
          })
        }

        for (const [index, item] of items.entries()) {
          const product = s(item.product, 80)
          for (const part of lineLots[index]) {
            await postMovement(tx, {
              outletId, product, stockLotId: part.lotId, movementType: 'Sale', quantity: -part.quantity,
              referenceType: 'POS_SALE', referenceId: sale.id, createdBy: actor,
            })
          }
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'pos_sale', entityId: sale.id,
          action: 'completed', metadata: { outletId, billNumber: bill, total, invoiceId: invoice.id, idempotencyKey },
        })
        return { sale, invoice }
      })
      return Response.json(result, { status: 201, headers })
    }

    // Moves stock the outlet's own side already owns (company lots for company outlets, the franchise's own
    // processed lots for franchise outlets) onto the outlet ledger. Company stock NEVER reaches a franchise
    // outlet through this action; that only happens via procurement `transfer-to-franchise`, which is capped
    // to the approved supply request.
    if (action === 'transfer-stock') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80), product = s(data.product, 80), qty = n(data.quantity)
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      if (!outlet || !scope(access, outlet.franchiseId) || !products.includes(product) || !(qty > 0)) return Response.json({ error: 'Valid outlet, product and quantity are required.' }, { status: 400, headers })

      const result = await db.transaction(async tx => {
        const [lockedOutlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, outletId)).for('update')
        if (!lockedOutlet || !scope(access, lockedOutlet.franchiseId) || lockedOutlet.status !== 'Active') throw new Error('Outlet access changed. Refresh and retry.')
        let remaining = qty
        const owner = lockedOutlet.franchiseId ? eq(stockLots.franchiseId, lockedOutlet.franchiseId) : isNull(stockLots.franchiseId)
        const lots = await tx.select().from(stockLots)
          .where(and(owner, eq(stockLots.product, product), eq(stockLots.stage, 'Finished stock'), eq(stockLots.status, 'Available')))
          .orderBy(asc(stockLots.createdAt)).for('update')

        const rows = []
        for (const lot of lots) {
          if (remaining <= EPS) break
          const available = Math.max(0, n(lot.quantity))
          if (available <= 0) continue
          const take = Math.min(available, remaining)
          remaining -= take
          const newQty = available - take
          await tx.update(stockLots).set({ quantity: String(newQty), status: newQty > 0 ? 'Available' : 'Depleted', updatedAt: new Date() }).where(eq(stockLots.id, lot.id))
          const row = await postMovement(tx, {
            outletId, product, stockLotId: lot.id, movementType: 'TransferIn', quantity: take,
            referenceType: 'STOCK_TRANSFER', referenceId: lot.id, createdBy: actor,
          })
          rows.push(row)
          await tx.insert(auditEvents).values({
            actorUserId: actor, franchiseId: lockedOutlet.franchiseId, entityType: 'stock_transfer', entityId: row.id,
            action: lockedOutlet.franchiseId ? 'franchise_lot_to_outlet' : 'company_to_outlet', metadata: { outletId, product, stockLotId: lot.id, quantity: take },
          })
        }
        if (remaining > EPS) throw new Error(`Insufficient ${lockedOutlet.franchiseId ? 'franchise' : 'company'} stock for ${product}.`)
        return rows
      })
      return Response.json({ rows: result }, { status: 201, headers })
    }

    // Moves stock between two outlets of the same side (same franchise, or both company) as paired movements.
    if (action === 'transfer-between-outlets') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const fromId = s(data.fromOutletId, 80), toId = s(data.toOutletId, 80), product = s(data.product, 80), qty = n(data.quantity)
      const reason = s(data.reason, 300)
      if (!uuidRe.test(fromId) || !uuidRe.test(toId) || fromId === toId || !products.includes(product) || !(qty > 0)) return Response.json({ error: 'Two different outlets, a product and a positive quantity are required.' }, { status: 400, headers })
      const result = await db.transaction(async tx => {
        // Lock both outlets in a fixed order so opposite transfers cannot deadlock.
        const locked = await tx.select().from(posOutlets).where(inArray(posOutlets.id, [fromId, toId])).orderBy(asc(posOutlets.id)).for('update')
        const from = locked.find(x => x.id === fromId), to = locked.find(x => x.id === toId)
        if (!from || !to || from.status !== 'Active' || to.status !== 'Active' || !scope(access, from.franchiseId) || !scope(access, to.franchiseId) ||
            (from.franchiseId ?? null) !== (to.franchiseId ?? null)) throw new Error('Outlet access changed. Both outlets must be active and belong to the same franchise (or both to the company).')
        const transferGroupId = crypto.randomUUID()
        const { allocations } = await debitFifo(tx, {
          outletId: fromId, product, quantity: qty, movementType: 'TransferOut', referenceType: 'OUTLET_TRANSFER',
          referenceId: transferGroupId, transferGroupId, reason: reason || null, createdBy: actor,
        })
        for (const a of allocations) {
          await postMovement(tx, {
            outletId: toId, product, stockLotId: a.lotId, movementType: 'TransferIn', quantity: a.quantity, referenceType: 'OUTLET_TRANSFER',
            referenceId: transferGroupId, transferGroupId, reason: reason || null, createdBy: actor,
          })
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: from.franchiseId, entityType: 'outlet_stock_transfer', entityId: transferGroupId,
          action: 'transferred', metadata: { fromOutletId: fromId, toOutletId: toId, product, quantity: qty, lots: allocations, reason: reason || null },
        })
        return { transferGroupId, allocations }
      })
      return Response.json(result, { status: 201, headers })
    }

    // Wastage, adjustment and stock-count movements on the outlet ledger. A reason is mandatory.
    if (action === 'record-wastage' || action === 'adjust-stock' || action === 'count-stock') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80), product = s(data.product, 80), reason = s(data.reason, 300)
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      if (!outlet || !scope(access, outlet.franchiseId) || !products.includes(product)) return Response.json({ error: 'Valid outlet and product are required.' }, { status: 400, headers })
      if (!reason) return Response.json({ error: 'A reason is required for wastage, adjustments and stock counts.' }, { status: 400, headers })
      const qty = n(data.quantity, Number.NaN)
      const counted = n(data.countedQuantity, Number.NaN)
      if (action === 'record-wastage' && !(qty > 0)) return Response.json({ error: 'Wastage quantity must be greater than zero.' }, { status: 400, headers })
      if (action === 'adjust-stock' && (!Number.isFinite(qty) || Math.abs(qty) < EPS)) return Response.json({ error: 'Adjustment quantity must be a non-zero number (negative removes stock).' }, { status: 400, headers })
      if (action === 'count-stock' && (!Number.isFinite(counted) || counted < 0)) return Response.json({ error: 'Counted quantity must be zero or more.' }, { status: 400, headers })
      const lotId = data.stockLotId ? s(data.stockLotId, 80) : null
      if (lotId && !uuidRe.test(lotId)) return Response.json({ error: 'Invalid stock lot.' }, { status: 400, headers })

      const result = await db.transaction(async tx => {
        const [lockedOutlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, outletId)).for('update')
        if (!lockedOutlet || !scope(access, lockedOutlet.franchiseId) || lockedOutlet.status !== 'Active') throw new Error('Outlet access changed. Refresh and retry.')
        const movementType = action === 'record-wastage' ? 'Wastage' : action === 'adjust-stock' ? 'Adjustment' : 'Count'
        const referenceType = action === 'record-wastage' ? 'STOCK_WASTAGE' : action === 'adjust-stock' ? 'STOCK_ADJUSTMENT' : 'STOCK_COUNT'
        const refId = crypto.randomUUID()
        const systemQty = await outletBalance(tx, outletId, product)
        const delta = action === 'record-wastage' ? -qty : action === 'adjust-stock' ? qty : counted - systemQty
        const base = { outletId, product, movementType, referenceType, referenceId: refId, reason, createdBy: actor }
        const rows = []
        if (lotId) {
          // A specific lot must already sit on this outlet's ledger, or (for a credit) belong to this outlet's side.
          const bucket = (await lotBuckets(tx, outletId, product)).find(b => b.lotId === lotId)
          const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, lotId))
          const sideOk = !!lot && lot.product === product && (!!bucket || (lockedOutlet.franchiseId ? lot.franchiseId === lockedOutlet.franchiseId : lot.franchiseId == null))
          if (!sideOk) throw new Error('Stock lot does not belong to this outlet.')
          if (delta < 0 && (!bucket || bucket.quantity + delta < -EPS)) throw new Error(`Insufficient outlet stock in that lot. Available: ${bucket?.quantity ?? 0}; requested: ${-delta}.`)
          if (Math.abs(delta) > EPS) rows.push(await postMovement(tx, { ...base, stockLotId: lotId, quantity: delta }))
        } else if (delta < -EPS) {
          rows.push(...(await debitFifo(tx, { ...base, quantity: -delta })).rows)
        } else if (delta > EPS) {
          rows.push(await postMovement(tx, { ...base, stockLotId: null, quantity: delta }))
        }
        if (!rows.length) rows.push(await postMovement(tx, { ...base, stockLotId: null, quantity: 0 }))
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: lockedOutlet.franchiseId, entityType: 'outlet_stock_' + movementType.toLowerCase(), entityId: refId,
          action: 'recorded', metadata: { outletId, product, delta, systemQuantity: systemQty, countedQuantity: action === 'count-stock' ? counted : null, stockLotId: lotId, reason },
        })
        return { referenceId: refId, delta, systemQuantity: systemQty, rows }
      })
      return Response.json(result, { status: 201, headers })
    }

    if (action === 'return-sale') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const saleId = s(data.saleId, 80), itemId = s(data.itemId, 80), qty = n(data.quantity)
      const [sale] = await db.select().from(posSales).where(eq(posSales.id, saleId))
      const [item] = await db.select().from(posSaleItems).where(eq(posSaleItems.id, itemId))
      const [saleOutlet] = sale ? await db.select().from(posOutlets).where(eq(posOutlets.id, sale.outletId)) : []
      if (!sale || !item || item.saleId !== sale.id || !saleOutlet || !scope(access, saleOutlet.franchiseId)) return Response.json({ error: 'Sale not found or access denied.' }, { status: 404, headers })
      if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Return quantity must be greater than zero.' }, { status: 400, headers })
      const previous = await db.select().from(posReturns).where(eq(posReturns.itemId, itemId))
      const alreadyReturned = previous.reduce((a, r) => a + n(r.quantity), 0)
      if (alreadyReturned + qty > n(item.quantity) + 0.000001) return Response.json({ error: 'Return quantity exceeds the remaining sold quantity.' }, { status: 400, headers })
      // Returned goods are either put back on sale (Restock, default) or written off (Waste, e.g. spoiled/unsafe).
      const disposition = data.restock === false || s(data.disposition, 20) === 'Waste' ? 'Waste' : 'Restock'
      if (disposition === 'Waste' && !s(data.reason, 300)) return Response.json({ error: 'A reason is required when returned goods are written off as waste.' }, { status: 400, headers })
      const refundMethod = s(data.refundMethod, 30) || 'Cash'
      if (!methods.includes(refundMethod)) return Response.json({ error: 'Invalid refund method.' }, { status: 400, headers })
      const refundAmount = Math.max(0, qty * n(item.unitPrice) - (n(item.discount) * qty / Math.max(n(item.quantity), 1)) + (n(item.tax) * qty / Math.max(n(item.quantity), 1)))

      const result = await db.transaction(async tx => {
        // Serialize returns against sales and other returns for this outlet.
        const [lockedOutlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, sale.outletId)).for('update')
        const [lockedSale] = await tx.select().from(posSales).where(eq(posSales.id, saleId)).for('update')
        if (!lockedOutlet || !lockedSale || !scope(access, lockedOutlet.franchiseId)) throw new Error('Sale is no longer available for return.')
        const lockedReturns = await tx.select().from(posReturns).where(eq(posReturns.itemId, itemId))
        const lockedReturnedQty = lockedReturns.reduce((total, row) => total + n(row.quantity), 0)
        if (lockedReturnedQty + qty > n(item.quantity) + 0.000001) {
          throw new Error(`Return quantity exceeds the remaining sold quantity. Remaining: ${Math.max(0, n(item.quantity) - lockedReturnedQty)}.`)
        }
        const [ret] = await tx.insert(posReturns).values({
          saleId, itemId, quantity: String(qty), amount: String(refundAmount), reason: s(data.reason, 300) || null, disposition,
        }).returning()
        // Put the goods back on the lots they were sold from: sold per lot for this sale/product, less what earlier returns already credited.
        const soldRows = await tx.select().from(outletStockLedger).where(and(
          eq(outletStockLedger.outletId, sale.outletId), eq(outletStockLedger.product, item.product),
          eq(outletStockLedger.referenceType, 'POS_SALE'), eq(outletStockLedger.referenceId, saleId)))
        const saleReturns = await tx.select({ id: posReturns.id }).from(posReturns).where(eq(posReturns.saleId, saleId))
        const earlier = saleReturns.length ? await tx.select().from(outletStockLedger).where(and(
          eq(outletStockLedger.outletId, sale.outletId), eq(outletStockLedger.product, item.product),
          eq(outletStockLedger.movementType, 'Return'), inArray(outletStockLedger.referenceId, saleReturns.map(r => r.id)))) : []
        const room = new Map<string | null, number>()
        for (const r of soldRows) room.set(r.stockLotId, (room.get(r.stockLotId) ?? 0) - n(r.quantity))
        for (const r of earlier) room.set(r.stockLotId, (room.get(r.stockLotId) ?? 0) - n(r.quantity))
        let toPlace = qty
        const place: Array<{ lotId: string | null; quantity: number }> = []
        for (const [lotId, available] of room) {
          if (toPlace <= EPS) break
          if (available <= EPS) continue
          const take = Math.min(available, toPlace)
          place.push({ lotId, quantity: take }); toPlace -= take
        }
        if (toPlace > EPS) place.push({ lotId: item.stockLotId, quantity: toPlace })
        for (const part of place) {
          await postMovement(tx, { outletId: sale.outletId, product: item.product, stockLotId: part.lotId, movementType: 'Return', quantity: part.quantity, referenceType: 'POS_RETURN', referenceId: ret.id, reason: s(data.reason, 300) || null, createdBy: actor })
          if (disposition === 'Waste') {
            await postMovement(tx, { outletId: sale.outletId, product: item.product, stockLotId: part.lotId, movementType: 'Wastage', quantity: -part.quantity, referenceType: 'POS_RETURN_WASTE', referenceId: ret.id, reason: s(data.reason, 300), createdBy: actor })
          }
        }
        await tx.insert(posPayments).values({ saleId, method: refundMethod, amount: String(-refundAmount), reference: `RETURN:${ret.id}`, status: 'Reversed' })
        const [invoice] = await tx.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, saleId)).orderBy(desc(invoiceRecords.createdAt)).limit(1)
        if (invoice) {
          const paid = Math.max(0, n(invoice.paid) - refundAmount)
          await tx.update(invoiceRecords).set({ paid: String(paid), status: paid >= n(invoice.total) ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Issued', updatedAt: new Date() }).where(eq(invoiceRecords.id, invoice.id))
          await tx.insert(paymentRecords).values({
            orderId: null, invoiceId: invoice.id, posSaleId: saleId, amount: String(-refundAmount),
            method: 'Refund', reference: ret.id, status: 'Reversed',
          })
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: saleOutlet.franchiseId, entityType: 'pos_return', entityId: ret.id,
          action: 'created', metadata: { saleId, itemId, quantity: qty, refundAmount, refundMethod, disposition },
        })
        return { return: ret, refundAmount }
      })
      return Response.json(result, { status: 201, headers })
    }

    if (action === 'close-shift') {
      if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
      const shiftId = s(data.shiftId, 80)
      const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId))
      if (!shift || shift.status !== 'Open') return Response.json({ error: 'Open shift not found.' }, { status: 404, headers })
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, shift.outletId))
      if (!outlet || !scope(access, outlet.franchiseId)) return Response.json({ error: 'Outlet access denied.' }, { status: 403, headers })
      const rec = await db.transaction(async tx => {
        const [lockedOutlet] = await tx.select().from(posOutlets).where(eq(posOutlets.id, shift.outletId)).for('update')
        const [lockedShift] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('update')
        if (!lockedOutlet || !scope(access, lockedOutlet.franchiseId) || !lockedShift || lockedShift.status !== 'Open') {
          throw new Error('Shift is already closed or outlet access changed. Refresh POS.')
        }
        // Totals are computed after the outlet/shift locks so no sale or return can slip in between.
        const sales = await tx.select().from(posSales).where(eq(posSales.shiftId, shiftId))
        const saleIds = sales.map(x => x.id)
        const payments = saleIds.length
          ? await tx.select({ method: posPayments.method, amount: posPayments.amount, status: posPayments.status }).from(posPayments).where(inArray(posPayments.saleId, saleIds))
          : []
        const returnRows = saleIds.length ? await tx.select({ amount: posReturns.amount }).from(posReturns).where(inArray(posReturns.saleId, saleIds)) : []
        // Sale payments are positive 'Received' rows; refunds are negative 'Reversed' rows (see return-sale).
        const collected = (method: string) => payments.filter(p => p.method === method && p.status !== 'Reversed').reduce((a, p) => a + n(p.amount), 0)
        const refunded = (method: string) => payments.filter(p => p.method === method && p.status === 'Reversed').reduce((a, p) => a + Math.abs(n(p.amount)), 0)
        const cash = collected('Cash'), upi = collected('UPI'), card = collected('Card'), credit = collected('Credit')
        const grossSales = sales.reduce((a, r) => a + n(r.subtotal) + n(r.tax), 0)
        const discounts = sales.reduce((a, r) => a + n(r.discount), 0)
        const tax = sales.reduce((a, r) => a + n(r.tax), 0)
        const returnTotal = returnRows.reduce((a, r) => a + n(r.amount), 0)
        const netSales = sales.reduce((a, r) => a + n(r.total), 0) - returnTotal
        const counted = n(data.countedCash)
        // Cash in the drawer = opening float + cash taken - cash handed back for returns.
        const expected = n(shift.openingCash) + cash - refunded('Cash')
        const variance = counted - expected
        await tx.update(posShifts).set({
          status: 'Closed', closedAt: new Date(), expectedCash: String(expected),
          countedCash: String(counted), cashVariance: String(variance),
        }).where(eq(posShifts.id, shiftId))
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
          entityId: shiftId, action: 'closed', metadata: { expectedCash: expected, countedCash: counted, variance, netSales, returns: returnTotal },
        })
        return row
      })
      return Response.json(rec, { status: 201, headers })
    }

    return Response.json({ error: 'Unknown POS action.' }, { status: 400, headers })
  } catch (e) {
    console.error(e)
    const message = e instanceof Error ? e.message : 'POS operation failed.'
    const status = /insufficient .*stock|does not belong|stock changed|shift is no longer open|already closed|return quantity exceeds|outlet access changed/i.test(message) ? 409 : 500
    return Response.json({ error: message }, { status, headers })
  }
}

export const config: Config = { path: '/api/pos' }
