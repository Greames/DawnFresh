import type { Config } from '@netlify/functions'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, invoiceRecords, paymentRecords, stockLots } from '../../db/schema.js'
import { outletStockLedger, posOutlets, posPayments, posReconciliations, posReturns, posSaleItems, posSales, posShifts } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'

const products = ['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns']
const methods = ['Cash', 'UPI', 'Card', 'Credit']
const n = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d }
const s = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''
const scope = (access: Awaited<ReturnType<typeof resolveAccess>>, franchiseId?: string | null) =>
  access.role !== 'franchisee' || (!!franchiseId && access.franchise?.id === franchiseId)

const latestBalance = async (tx: any, outletId: string, product: string) => {
  const [last] = await tx.select().from(outletStockLedger)
    .where(and(eq(outletStockLedger.outletId, outletId), eq(outletStockLedger.product, product)))
    .orderBy(desc(outletStockLedger.createdAt)).limit(1)
  return n(last?.balanceAfter)
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'outlets', 'view')) return Response.json({ error: 'Outlet access is required.' }, { status: 403, headers })

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
      return Response.json({
        outlets: outlets.filter(x => visibleOutletIds.has(x.id)),
        shifts: shifts.filter(x => visibleOutletIds.has(x.outletId)),
        sales: sales.filter(x => visibleOutletIds.has(x.outletId)),
        payments: payments.filter(x => sales.some(y => y.id === x.saleId && visibleOutletIds.has(y.outletId))),
        ledger: ledger.filter(x => visibleOutletIds.has(x.outletId)),
        reconciliations: recs.filter(x => visibleOutletIds.has(x.outletId)),
      }, { headers })
    }

    if (!['POST', 'PATCH'].includes(req.method) || !sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = s(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.id

    if (action === 'create-outlet') {
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
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
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80)
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      if (!outlet || !scope(access, outlet.franchiseId) || outlet.status !== 'Active') return Response.json({ error: 'Active outlet not found.' }, { status: 404, headers })
      const [open] = await db.select().from(posShifts).where(and(eq(posShifts.outletId, outletId), eq(posShifts.status, 'Open')))
      if (open) return Response.json({ error: 'An open shift already exists for this outlet.' }, { status: 409, headers })
      const [row] = await db.insert(posShifts).values({ outletId, cashierId: actor, openingCash: String(Math.max(0, n(data.openingCash))) }).returning()
      return Response.json(row, { status: 201, headers })
    }

    if (action === 'record-sale') {
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
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
        for (const [product, requested] of requestedByProduct) {
          const balance = await latestBalance(tx, outletId, product)
          if (balance - requested < -0.000001 && data.allowNegativeStock !== true) throw new Error(`Insufficient outlet stock for ${product}.`)
        }

        const bill = s(data.billNumber, 80) || `POS-${Date.now()}`
        const [sale] = await tx.insert(posSales).values({
          outletId, shiftId, billNumber: bill, idempotencyKey,
          customerId: data.customerId ? s(data.customerId, 80) : null, cashierId: actor,
          subtotal: String(subtotal), discount: String(discount), tax: String(tax), total: String(total), status: 'Completed',
        }).returning()

        for (const item of items) {
          const product = s(item.product, 80), qty = n(item.quantity)
          await tx.insert(posSaleItems).values({
            saleId: sale.id, product, quantity: String(qty), unit: s(item.unit, 20) || 'kg',
            unitPrice: String(n(item.unitPrice)), discount: String(n(item.discount)), tax: String(n(item.tax)),
            total: String(Math.max(0, qty * n(item.unitPrice) - n(item.discount) + n(item.tax))),
            stockLotId: item.stockLotId ? s(item.stockLotId, 80) : null,
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

        for (const item of items) {
          const product = s(item.product, 80), qty = n(item.quantity)
          const balance = await latestBalance(tx as typeof db, outletId, product)
          await tx.insert(outletStockLedger).values({
            outletId, product, stockLotId: item.stockLotId ? s(item.stockLotId, 80) : null,
            movementType: 'Sale', quantity: String(-qty), referenceType: 'POS_SALE',
            referenceId: sale.id, balanceAfter: String(balance - qty), createdBy: actor,
          })
        }
        await tx.insert(auditEvents).values({
          actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'pos_sale', entityId: sale.id,
          action: 'completed', metadata: { outletId, billNumber: bill, total, invoiceId: invoice.id, idempotencyKey },
        })
        return { sale, invoice }
      })
      return Response.json(result, { status: 201, headers })
    }

    if (action === 'transfer-stock') {
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
      const outletId = s(data.outletId, 80), product = s(data.product, 80), qty = n(data.quantity)
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, outletId))
      if (!outlet || !scope(access, outlet.franchiseId) || !products.includes(product) || qty <= 0) return Response.json({ error: 'Valid outlet, product and quantity are required.' }, { status: 400, headers })

      const result = await db.transaction(async tx => {
        let remaining = qty
        const lots = await tx.select().from(stockLots)
          .where(and(eq(stockLots.product, product), eq(stockLots.stage, 'Finished stock'), eq(stockLots.status, 'Available')))
          .orderBy(asc(stockLots.createdAt))

        const allocations: Array<{ lotId: string; quantity: number }> = []
        for (const lot of lots) {
          const available = Math.max(0, n(lot.quantity))
          if (available <= 0) continue
          const take = Math.min(available, remaining)
          allocations.push({ lotId: lot.id, quantity: take })
          remaining -= take
          if (remaining <= 0.000001) break
        }
        if (remaining > 0.000001) throw new Error(`Insufficient company stock for ${product}.`)

        const rows = []
        for (const allocation of allocations) {
          const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, allocation.lotId))
          if (!lot || n(lot.quantity) < allocation.quantity) throw new Error(`Stock changed while transferring ${product}. Please retry.`)
          const newQty = n(lot.quantity) - allocation.quantity
          await tx.update(stockLots).set({ quantity: String(newQty), status: newQty > 0 ? 'Available' : 'Depleted', updatedAt: new Date() }).where(eq(stockLots.id, lot.id))
          const currentOutletBalance = await latestBalance(tx as typeof db, outletId, product)
          const [row] = await tx.insert(outletStockLedger).values({
            outletId, product, stockLotId: lot.id, movementType: 'TransferIn', quantity: String(allocation.quantity),
            referenceType: s(data.referenceType, 50) || 'STOCK_TRANSFER', referenceId: data.referenceId ? s(data.referenceId, 80) : null,
            balanceAfter: String(currentOutletBalance + allocation.quantity), createdBy: actor,
          }).returning()
          rows.push(row)
          await tx.insert(auditEvents).values({
            actorUserId: actor, franchiseId: outlet.franchiseId, entityType: 'stock_transfer', entityId: row.id,
            action: 'company_to_outlet', metadata: { outletId, product, stockLotId: lot.id, quantity: allocation.quantity },
          })
        }
        return rows
      })
      return Response.json({ rows: result }, { status: 201, headers })
    }

    if (action === 'return-sale') {
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
      const saleId = s(data.saleId, 80), itemId = s(data.itemId, 80), qty = n(data.quantity)
      const [sale] = await db.select().from(posSales).where(eq(posSales.id, saleId))
      const [item] = await db.select().from(posSaleItems).where(eq(posSaleItems.id, itemId))
      const [saleOutlet] = sale ? await db.select().from(posOutlets).where(eq(posOutlets.id, sale.outletId)) : []
      if (!sale || !item || item.saleId !== sale.id || !saleOutlet || !scope(access, saleOutlet.franchiseId)) return Response.json({ error: 'Sale not found or access denied.' }, { status: 404, headers })
      if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Return quantity must be greater than zero.' }, { status: 400, headers })
      const previous = await db.select().from(posReturns).where(eq(posReturns.itemId, itemId))
      const alreadyReturned = previous.reduce((a, r) => a + n(r.quantity), 0)
      if (alreadyReturned + qty > n(item.quantity) + 0.000001) return Response.json({ error: 'Return quantity exceeds the remaining sold quantity.' }, { status: 400, headers })
      const refundMethod = s(data.refundMethod, 30) || 'Cash'
      if (!methods.includes(refundMethod)) return Response.json({ error: 'Invalid refund method.' }, { status: 400, headers })
      const refundAmount = Math.max(0, qty * n(item.unitPrice) - (n(item.discount) * qty / Math.max(n(item.quantity), 1)) + (n(item.tax) * qty / Math.max(n(item.quantity), 1)))

      const result = await db.transaction(async tx => {
        const [ret] = await tx.insert(posReturns).values({
          saleId, itemId, quantity: String(qty), amount: String(refundAmount), reason: s(data.reason, 300) || null,
        }).returning()
        const balance = await latestBalance(tx as typeof db, sale.outletId, item.product)
        await tx.insert(outletStockLedger).values({
          outletId: sale.outletId, product: item.product, stockLotId: item.stockLotId,
          movementType: 'Return', quantity: String(qty), referenceType: 'POS_RETURN',
          referenceId: ret.id, balanceAfter: String(balance + qty), createdBy: actor,
        })
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
          action: 'created', metadata: { saleId, itemId, quantity: qty, refundAmount, refundMethod },
        })
        return { return: ret, refundAmount }
      })
      return Response.json(result, { status: 201, headers })
    }

    if (action === 'close-shift') {
      if (!allowed(access, 'outlets', 'edit')) return Response.json({ error: 'Outlet edit access is required.' }, { status: 403, headers })
      const shiftId = s(data.shiftId, 80)
      const [shift] = await db.select().from(posShifts).where(eq(posShifts.id, shiftId))
      if (!shift || shift.status !== 'Open') return Response.json({ error: 'Open shift not found.' }, { status: 404, headers })
      const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.id, shift.outletId))
      if (!outlet || !scope(access, outlet.franchiseId)) return Response.json({ error: 'Outlet access denied.' }, { status: 403, headers })
      const rows = await db.select().from(posPayments).innerJoin(posSales, eq(posPayments.saleId, posSales.id)).where(eq(posSales.shiftId, shiftId))
      const cash = rows.filter(r => r.posPayments.method === 'Cash').reduce((a, r) => a + n(r.posPayments.amount), 0)
      const upi = rows.filter(r => r.posPayments.method === 'UPI').reduce((a, r) => a + n(r.posPayments.amount), 0)
      const card = rows.filter(r => r.posPayments.method === 'Card').reduce((a, r) => a + n(r.posPayments.amount), 0)
      const credit = rows.filter(r => r.posPayments.method === 'Credit').reduce((a, r) => a + n(r.posPayments.amount), 0)
      const sales = await db.select().from(posSales).where(eq(posSales.shiftId, shiftId))
      const grossSales = sales.reduce((a, r) => a + n(r.subtotal) + n(r.tax), 0)
      const discounts = sales.reduce((a, r) => a + n(r.discount), 0)
      const tax = sales.reduce((a, r) => a + n(r.tax), 0)
      const returns = (await db.select().from(posReturns).where(eq(posReturns.saleId, sales[0]?.id || '00000000-0000-0000-0000-000000000000'))).reduce((a, r) => a + n(r.amount), 0)
      const allReturnRows = sales.length ? (await Promise.all(sales.map(x => db.select().from(posReturns).where(eq(posReturns.saleId, x.id)))).flat()) : []
      const returnTotal = allReturnRows.reduce((a, r) => a + n(r.amount), 0)
      const netSales = sales.reduce((a, r) => a + n(r.total), 0) - returnTotal
      const counted = n(data.countedCash)
      const expected = n(shift.openingCash) + cash
      const variance = counted - expected
      const rec = await db.transaction(async tx => {
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
          entityId: shiftId, action: 'closed', metadata: { expectedCash: expected, countedCash: counted, variance, netSales },
        })
        return row
      })
      return Response.json(rec, { status: 201, headers })
    }

    return Response.json({ error: 'Unknown POS action.' }, { status: 400, headers })
  } catch (e) {
    console.error(e)
    return Response.json({ error: e instanceof Error ? e.message : 'POS operation failed.' }, { status: 500, headers })
  }
}

export const config: Config = { path: '/api/pos' }
