import type { Config } from '@netlify/functions'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, franchises, records, stockLots } from '../../db/schema.js'
import { franchiseStockLedger, goodsReceipts, purchaseOrders, supplierInvoices, supplierPayments, suppliers } from '../../db/procurement-schema.js'
import { outletStockLedger, posOutlets } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { Rejection, failure, idempotencyKeyOf, respond, transact } from '../../db/tx.js'
import type { Tx } from '../../db/tx.js'
import { EPS, PRODUCTS, lockCompanyLots, r2, r3, receiveFromCompanyLot } from '../../db/stock.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const txt = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''
const uid = (v: unknown) => { const x = txt(v, 80); return uuidPattern.test(x) ? x : '' }

/** Quantity already moved for a supply request or goods receipt, from the unified ledger and the frozen legacy one. */
async function transferred(tx: Tx, by: 'supply_request_id' | 'goods_receipt_id', id: string) {
  const unified = await tx.select({ total: sql<string>`coalesce(sum(${outletStockLedger.quantity}), 0)` }).from(outletStockLedger)
    .where(and(eq(by === 'supply_request_id' ? outletStockLedger.supplyRequestId : outletStockLedger.goodsReceiptId, id), eq(outletStockLedger.movementType, 'SupplyIn')))
  const legacy = await tx.select({ total: sql<string>`coalesce(sum(${franchiseStockLedger.quantity}), 0)` }).from(franchiseStockLedger)
    .where(and(eq(by === 'supply_request_id' ? franchiseStockLedger.supplyRequestId : franchiseStockLedger.goodsReceiptId, id), eq(franchiseStockLedger.movementType, 'SupplyIn')))
  return r3(num(unified[0]?.total) + num(legacy[0]?.total))
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'sourcing', 'view') && !allowed(access, 'supply', 'view')) return Response.json({ error: 'Procurement or supply access is required.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const [supplierRows, poRows, receiptRows, invoiceRows, paymentRows, stockRows, legacyRows] = await Promise.all([
        db.select().from(suppliers).orderBy(desc(suppliers.createdAt)),
        db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)),
        db.select().from(goodsReceipts).orderBy(desc(goodsReceipts.receivedAt)),
        db.select().from(supplierInvoices).orderBy(desc(supplierInvoices.issuedAt)),
        db.select().from(supplierPayments).orderBy(desc(supplierPayments.paidAt)),
        db.select().from(outletStockLedger).orderBy(desc(outletStockLedger.createdAt), desc(outletStockLedger.seq)),
        db.select().from(franchiseStockLedger).orderBy(desc(franchiseStockLedger.createdAt)),
      ])
      // franchiseStock: the unified ledger rows that belong to a franchise, then the frozen pre-unification rows (legacy: true).
      const franchiseStock = [...stockRows.filter(row => row.franchiseId), ...legacyRows.map(row => ({ ...row, legacy: true }))]
      if (access.role === 'franchisee') return Response.json({ suppliers: [], purchaseOrders: [], goodsReceipts: [], supplierInvoices: [], supplierPayments: [], franchiseStock: franchiseStock.filter(row => row.franchiseId === access.franchise?.id) }, { headers })
      return Response.json({ suppliers: supplierRows, purchaseOrders: poRows, goodsReceipts: receiptRows, supplierInvoices: invoiceRows, supplierPayments: paymentRows, franchiseStock }, { headers })
    }
    if (!sameOrigin(req) || !['POST', 'PATCH'].includes(req.method)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = txt(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id
    const companyOnly = () => access.role === 'franchisee' ? Response.json({ error: 'This procurement action is controlled by the company.' }, { status: 403, headers }) : null
    const sourcingEdit = () => allowed(access, 'sourcing', 'edit') ? null : Response.json({ error: 'Sourcing edit access is required.' }, { status: 403, headers })
    const key = idempotencyKeyOf(req, body)
    const run = (fn: (tx: Tx) => Promise<{ status: number; body: unknown }>) => transact({ actor, action, key, payload: data }, fn)

    if (action === 'create-supplier') {
      const denied = companyOnly() ?? sourcingEdit(); if (denied) return denied
      if (!txt(data.name, 180)) return Response.json({ error: 'Supplier name is required.' }, { status: 400, headers })
      const [row] = await db.insert(suppliers).values({ name: txt(data.name, 180), phone: txt(data.phone, 30) || null, email: txt(data.email, 180) || null, status: txt(data.status, 30) || 'Active' }).returning()
      return Response.json(row, { status: 201, headers })
    }

    if (action === 'create-po') {
      const denied = companyOnly() ?? sourcingEdit(); if (denied) return denied
      const supplierId = uid(data.supplierId), product = txt(data.product, 80), quantity = num(data.quantity), unit = txt(data.unit, 30) || 'kg', unitPrice = num(data.unitPrice), supplyRequestId = uid(data.supplyRequestId)
      if (!supplierId || !PRODUCTS.includes(product) || quantity <= 0 || unitPrice < 0 || !supplyRequestId) return Response.json({ error: 'Supplier, product, quantity, price and Supply Request ID are required.' }, { status: 400, headers })
      const expectedAt = data.expectedAt ? new Date(String(data.expectedAt)) : undefined
      if (expectedAt && Number.isNaN(expectedAt.getTime())) return Response.json({ error: 'Expected date is invalid.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId))
        if (!supplier) throw new Rejection(400, 'Supplier, product, quantity, price and Supply Request ID are required.')
        // The request row is the lock: two POs for one request queue here and the second sees the first.
        const [request] = await tx.select().from(records).where(eq(records.id, supplyRequestId)).for('update')
        if (!request || request.kind !== 'supply' || !request.franchiseId) throw new Rejection(400, 'Valid franchise supply request is required.')
        if (request.data.product !== product) throw new Rejection(400, 'PO product must match the franchise supply request.')
        if (request.data.status === 'Cancelled' || request.data.status === 'Delivered') throw new Rejection(409, 'This supply request is already delivered or cancelled.')
        const [live] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.supplyRequestId, supplyRequestId), ne(purchaseOrders.status, 'Cancelled')))
        if (live) throw new Rejection(409, 'This supply request already has a purchase order.')
        const total = r2(quantity * unitPrice)
        const [row] = await tx.insert(purchaseOrders).values({ supplyRequestId, supplierId, product, quantity: String(quantity), unit, unitPrice: String(unitPrice), total: String(total), status: 'Ordered', expectedAt }).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: request.franchiseId, entityType: 'purchase_order', entityId: row.id, action: 'created', metadata: { supplierId, product, quantity, total, supplyRequestId, idempotencyKey: key } })
        await tx.update(records).set({ data: { ...request.data, status: 'Confirmed', purchaseOrderId: row.id } }).where(eq(records.id, supplyRequestId))
        return { status: 201, body: row }
      })
      return respond(done, headers)
    }

    if (action === 'receive-po') {
      const denied = companyOnly() ?? sourcingEdit(); if (denied) return denied
      const purchaseOrderId = uid(data.purchaseOrderId), received = num(data.receivedQuantity), accepted = num(data.acceptedQuantity), rejected = num(data.rejectedQuantity), qc = txt(data.qcStatus, 30) || 'Pending'
      if (!purchaseOrderId || received <= 0 || accepted < 0 || rejected < 0 || accepted + rejected > received || !['Pending', 'Passed', 'Failed'].includes(qc)) return Response.json({ error: 'Receipt quantities or QC status are invalid.' }, { status: 400, headers })
      if (qc === 'Passed' && accepted <= 0) return Response.json({ error: 'A passed receipt must have accepted quantity.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId)).for('update')
        if (!po) throw new Rejection(400, 'Receipt quantities or QC status are invalid.')
        if (po.status === 'Received') throw new Rejection(409, 'This purchase order has already been fully received.')
        const prior = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId, purchaseOrderId))
        const alreadyReceived = prior.reduce((sum, row) => sum + num(row.receivedQuantity), 0)
        if (alreadyReceived + received > num(po.quantity) + EPS) throw new Rejection(409, 'Receipt quantity exceeds the remaining purchase order quantity.')
        const [receipt] = await tx.insert(goodsReceipts).values({ purchaseOrderId, receivedQuantity: String(received), acceptedQuantity: String(accepted), rejectedQuantity: String(rejected), unit: po.unit, qcStatus: qc, batchCode: txt(data.batchCode, 100) || `GRN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, receivedBy: actor }).returning()
        let lot = null
        if (qc === 'Passed' && accepted > 0) {
          ;[lot] = await tx.insert(stockLots).values({ product: po.product, quantity: String(accepted), unit: po.unit, stage: 'Finished stock', batchCode: receipt.batchCode, status: 'Available' }).returning()
        }
        await tx.update(purchaseOrders).set({ status: alreadyReceived + received + EPS >= num(po.quantity) ? 'Received' : 'Partially Received' }).where(eq(purchaseOrders.id, po.id))
        await tx.insert(auditEvents).values({ actorUserId: actor, entityType: 'goods_receipt', entityId: receipt.id, action: 'received', metadata: { purchaseOrderId, accepted, rejected, qcStatus: qc, stockLotId: lot?.id || null, supplyRequestId: po.supplyRequestId || null, idempotencyKey: key } })
        if (lot) await tx.update(goodsReceipts).set({ stockLotId: lot.id }).where(eq(goodsReceipts.id, receipt.id))
        return { status: 201, body: { receipt: lot ? { ...receipt, stockLotId: lot.id } : receipt, stockLot: lot } }
      })
      return respond(done, headers)
    }

    if (action === 'create-supplier-invoice') {
      const denied = companyOnly() ?? sourcingEdit(); if (denied) return denied
      const supplierId = uid(data.supplierId), total = num(data.total, Number.NaN), invoiceNumber = txt(data.invoiceNumber, 100)
      const purchaseOrderId = data.purchaseOrderId ? uid(data.purchaseOrderId) : null
      if (!supplierId || !Number.isFinite(total) || total < 0 || !invoiceNumber || (data.purchaseOrderId && !purchaseOrderId)) return Response.json({ error: 'Supplier, invoice number and a valid non-negative total are required.' }, { status: 400, headers })
      const dueAt = data.dueAt ? new Date(String(data.dueAt)) : undefined
      if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: 'Supplier invoice due date is invalid.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId))
        if (!supplier) throw new Rejection(404, 'Supplier not found.')
        if (purchaseOrderId) {
          const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId))
          if (!po || po.supplierId !== supplierId) throw new Rejection(400, 'Purchase order must belong to the selected supplier.')
        }
        const [row] = await tx.insert(supplierInvoices).values({ supplierId, purchaseOrderId, invoiceNumber, total: String(r2(total)), paid: '0', status: 'Issued', dueAt }).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, entityType: 'supplier_invoice', entityId: row.id, action: 'created', metadata: { supplierId, purchaseOrderId, invoiceNumber, total, idempotencyKey: key } })
        return { status: 201, body: row }
      })
      return respond(done, headers)
    }

    if (action === 'pay-supplier') {
      const denied = companyOnly() ?? sourcingEdit(); if (denied) return denied
      const invoiceId = uid(data.supplierInvoiceId), amount = num(data.amount, Number.NaN), method = txt(data.method, 40) || 'Bank'
      if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400, headers })
      if (!invoiceId) return Response.json({ error: 'Supplier invoice not found or payment exceeds the remaining balance.' }, { status: 409, headers })
      const done = await run(async tx => {
        const [invoice] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId)).for('update')
        if (!invoice || r2(num(invoice.paid) + amount) > num(invoice.total) + 0.0001) throw new Rejection(409, 'Supplier invoice not found or payment exceeds the remaining balance.')
        const [payment] = await tx.insert(supplierPayments).values({ supplierInvoiceId: invoiceId, amount: String(r2(amount)), method, reference: txt(data.reference, 200) || null }).returning()
        const paid = r2(num(invoice.paid) + amount), total = num(invoice.total)
        const [updated] = await tx.update(supplierInvoices).set({ paid: String(paid), status: paid >= total ? 'Paid' : 'Partially Paid' }).where(eq(supplierInvoices.id, invoiceId)).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, entityType: 'supplier_payment', entityId: payment.id, action: 'paid', metadata: { supplierInvoiceId: invoiceId, amount, method, paidAfter: paid, idempotencyKey: key } })
        return { status: 201, body: { payment, invoice: updated } }
      })
      return respond(done, headers)
    }

    if (action === 'transfer-to-franchise') {
      if (access.role === 'franchisee' || !allowed(access, 'supply', 'edit')) return Response.json({ error: 'Only authorized company staff can transfer company stock to a franchise.' }, { status: 403, headers })
      const franchiseId = uid(data.franchiseId), product = txt(data.product, 80), quantity = r3(num(data.quantity)), supplyRequestId = uid(data.supplyRequestId), purchaseOrderId = uid(data.purchaseOrderId), goodsReceiptId = uid(data.goodsReceiptId)
      const requestedOutletId = data.outletId ? uid(data.outletId) : null
      if (!franchiseId || !PRODUCTS.includes(product) || quantity <= 0 || !supplyRequestId || !purchaseOrderId || !goodsReceiptId || (data.outletId && !requestedOutletId)) return Response.json({ error: 'Franchise, product, quantity, Supply Request ID, Purchase Order ID and GRN ID are required.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [franchise] = await tx.select().from(franchises).where(eq(franchises.id, franchiseId))
        if (!franchise) throw new Rejection(400, 'Franchise not found.')
        // The supply request row is the lock for the whole delivery: concurrent transfers queue here and re-read what was delivered.
        const [request] = await tx.select().from(records).where(eq(records.id, supplyRequestId)).for('update')
        if (!request || request.kind !== 'supply' || request.franchiseId !== franchiseId) throw new Rejection(400, 'Supply request does not belong to this franchise.')
        const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, purchaseOrderId))
        if (!po || po.supplyRequestId !== supplyRequestId) throw new Rejection(400, 'Purchase Order is not linked to this Supply Request.')
        if (po.product !== product) throw new Rejection(400, 'The supplied product must match the Purchase Order product.')
        const [grn] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, goodsReceiptId))
        if (!grn || grn.purchaseOrderId !== purchaseOrderId || grn.qcStatus !== 'Passed' || !grn.stockLotId) throw new Rejection(400, 'A passed GRN with a finished-stock lot linked to this Purchase Order is required.')
        if (request.data.status === 'Delivered' || request.data.status === 'Cancelled') throw new Rejection(409, 'Supply request was already delivered or is no longer eligible for transfer.')
        if (request.data.status !== 'Confirmed' && request.data.status !== 'Dispatched') throw new Rejection(400, 'Supply Request must be Confirmed or Dispatched before franchise receipt.')

        // The receiving outlet: the one named, else the franchise's only active outlet.
        const outlets = await tx.select().from(posOutlets).where(and(eq(posOutlets.franchiseId, franchiseId), eq(posOutlets.status, 'Active')))
        const outlet = requestedOutletId ? outlets.find(o => o.id === requestedOutletId) : outlets.length === 1 ? outlets[0] : undefined
        if (requestedOutletId && !outlet) throw new Rejection(400, 'The receiving outlet must be an active outlet of this franchise.')
        if (!outlet) throw new Rejection(outlets.length ? 400 : 409, outlets.length ? 'This franchise has several outlets. Choose the receiving outletId.' : 'This franchise has no active POS outlet to receive stock. Create the outlet first.')

        // Cap: what was requested less what already arrived, and what this receipt accepted less what already left it.
        const requested = num(request.data.quantity)
        const deliveredSoFar = await transferred(tx, 'supply_request_id', supplyRequestId)
        const remainingOnRequest = r3(requested - deliveredSoFar)
        if (quantity > remainingOnRequest + EPS) throw new Rejection(409, `Only ${remainingOnRequest} ${request.data.unit || 'kg'} remain to be delivered on this supply request.`)
        const remainingOnReceipt = r3(num(grn.acceptedQuantity) - await transferred(tx, 'goods_receipt_id', goodsReceiptId))
        if (quantity > remainingOnReceipt + EPS) throw new Rejection(409, `Only ${remainingOnReceipt} ${grn.unit} of this goods receipt remain to be transferred.`)

        const lots = await lockCompanyLots(tx, product, grn.stockLotId)
        const lot = lots[0]
        if (!lot || num(lot.quantity) + EPS < quantity) throw new Rejection(409, `Insufficient company stock for ${product}.`)
        const { ledger, lot: franchiseLot } = await receiveFromCompanyLot(tx, {
          companyLot: lot, take: quantity, outlet, type: 'SupplyIn', actor,
          referenceType: 'FRANCHISE_SUPPLY', referenceId: supplyRequestId, supplyRequestId, purchaseOrderId, goodsReceiptId,
        })
        const delivered = r3(deliveredSoFar + quantity)
        const complete = r3(requested - delivered) <= EPS
        await tx.update(records).set({ data: { ...request.data, status: complete ? 'Delivered' : 'Dispatched', deliveredQuantity: delivered, purchaseOrderId, goodsReceiptId, outletId: outlet.id, receivedAt: new Date().toISOString() } }).where(eq(records.id, supplyRequestId))
        await tx.insert(records).values({ kind: 'stock_movements', franchiseId, data: { name: `${product} received from company`, status: 'Posted', date: new Date().toISOString().slice(0, 10), product, quantity, unit: request.data.unit || 'kg', reference: supplyRequestId, fromStage: 'Finished stock', toStage: 'Franchise stock', movementType: 'SupplyIn', supplyRequestId, purchaseOrderId, goodsReceiptId } })
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'franchise_stock_supply', entityId: ledger.id, action: 'received', metadata: { product, quantity, franchiseId, outletId: outlet.id, supplyRequestId, purchaseOrderId, goodsReceiptId, companyLotId: lot.id, franchiseLotId: franchiseLot.id, delivered, complete, idempotencyKey: key } })
        return { status: 201, body: { rows: [{ ...ledger, sourceStockLotId: lot.id }], delivered, remaining: r3(requested - delivered), complete } }
      })
      return respond(done, headers)
    }

    return Response.json({ error: 'Unknown procurement action.' }, { status: 400, headers })
  } catch (e) {
    return failure(e, headers, 'Procurement operation failed.')
  }
}
export const config: Config = { path: '/api/procurement' }
