import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { eq, and } from 'drizzle-orm'
import { db, pool } from './helpers/test-db.js'
import { call, createFranchise, createUser, resetDatabase, seedPrices } from './helpers/harness.js'
import type { Actor } from './helpers/harness.js'
import { auditEvents, customers, customerOrders, qcChecks, stockLots } from '../db/schema.js'
import { posReconciliations, posShifts, posOutlets } from '../db/pos-schema.js'
import { goodsReceipts, supplierInvoices } from '../db/procurement-schema.js'
import { resolvePermissions } from '../src/lib/business.js'
import pos from '../netlify/functions/pos.mts'
import procurement from '../netlify/functions/procurement.mts'
import pricing from '../netlify/functions/pricing.mts'
import fulfillment from '../netlify/functions/fulfillment.mts'
import operations from '../netlify/functions/operations.mts'

let admin: Actor, staff: Actor, fa: Actor, fb: Actor
let franchiseA: { id: string }, franchiseB: { id: string }
let outletA: any, shiftA: any

const sale = (extra: Record<string, unknown> = {}) => ({
  outletId: outletA.id, shiftId: shiftA.id,
  items: [{ product: 'Chicken', quantity: 2, unitPrice: 100 }], payments: [{ method: 'Cash', amount: 200 }], ...extra,
})

before(async () => {
  await resetDatabase()
  await seedPrices()
  admin = await createUser('admin', 'admin@test.local')
  staff = await createUser('staff', 'staff@test.local')
  franchiseA = await createFranchise('Franchise A', 'a@test.local')
  franchiseB = await createFranchise('Franchise B', 'b@test.local')
  // Same stored permissions franchises.mts used to write before the pos module: outlets none, no pos key.
  const stored = { orders: 'edit', leads: 'edit', supply: 'edit', inventory: 'view', sourcing: 'none', outlets: 'none', franchises: 'none' }
  fa = await createUser('franchisee', 'fa@test.local', { franchiseId: franchiseA.id, permissions: stored })
  fb = await createUser('franchisee', 'fb@test.local', { franchiseId: franchiseB.id, permissions: stored })
  await db.insert(stockLots).values({ product: 'Chicken', quantity: '100', unit: 'kg', batchCode: 'T-1', status: 'Available' })
})

after(async () => { await pool.end() })

describe('permissions (#9)', () => {
  it('franchisee gets pos edit by default even with outlets none; staff inherits legacy outlets level', () => {
    assert.equal(resolvePermissions('franchisee', { outlets: 'none' }).pos, 'edit')
    assert.equal(resolvePermissions('franchisee', { outlets: 'none' }).outlets, 'none')
    assert.equal(resolvePermissions('staff', { outlets: 'view' }).pos, 'view')
    assert.equal(resolvePermissions('staff', { outlets: 'view', pos: 'edit' }).pos, 'edit')
    assert.equal(resolvePermissions('staff', {}).pos, 'edit')
    assert.equal(resolvePermissions('franchisee', { pos: 'none' }).pos, 'none')
  })
  it('a franchisee with pos none is rejected', async () => {
    const blocked = await createUser('franchisee', 'nopos@test.local', { franchiseId: franchiseA.id, permissions: { pos: 'none' } })
    assert.equal((await call(pos, blocked)).status, 403)
  })
})

describe('POS flow for a franchisee (#6, #9)', () => {
  it('creates an outlet only for its own franchise', async () => {
    const own = await call(pos, fa, { action: 'create-outlet', data: { code: 'A1', name: 'Outlet A1', franchiseId: franchiseA.id } })
    assert.equal(own.status, 201)
    outletA = own.json
    const foreign = await call(pos, fa, { action: 'create-outlet', data: { code: 'X1', name: 'Foreign', franchiseId: franchiseB.id } })
    assert.equal(foreign.status, 400)
  })

  it('moves stock in, opens a shift and records a sale with the actor set', async () => {
    assert.equal((await call(pos, staff, { action: 'transfer-stock', data: { outletId: outletA.id, product: 'Chicken', quantity: 20 } })).status, 201)
    const open = await call(pos, fa, { action: 'open-shift', data: { outletId: outletA.id, openingCash: 500 } })
    assert.equal(open.status, 201)
    shiftA = open.json
    assert.equal(shiftA.cashierId, fa.user.id)
    const res = await call(pos, fa, { action: 'record-sale', data: sale() })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    assert.equal(res.json.sale.cashierId, fa.user.id)
    assert.equal(res.json.invoice.orderId, null)
    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'pos_sale'), eq(auditEvents.entityId, res.json.sale.id)))
    assert.equal(audit.length, 1)
    assert.equal(audit[0].actorUserId, fa.user.id)
    assert.equal(audit[0].franchiseId, franchiseA.id)
  })

  it('rejects a customer from another franchise and accepts its own', async () => {
    const [foreign] = await db.insert(customers).values({ name: 'B customer', franchiseId: franchiseB.id }).returning()
    const [own] = await db.insert(customers).values({ name: 'A customer', franchiseId: franchiseA.id }).returning()
    assert.equal((await call(pos, fa, { action: 'record-sale', data: sale({ customerId: foreign.id }) })).status, 400)
    assert.equal((await call(pos, fa, { action: 'record-sale', data: sale({ customerId: 'not-a-uuid' }) })).status, 400)
    assert.equal((await call(pos, fa, { action: 'record-sale', data: sale({ customerId: own.id }) })).status, 201)
  })

  it('closes the shift, writes one reconciliation and audits the actor', async () => {
    const res = await call(pos, fa, { action: 'close-shift', data: { shiftId: shiftA.id, countedCash: 900 } })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    assert.equal(Number(res.json.cashCollected), 400)
    assert.equal(Number(res.json.expectedCash), 900)
    assert.equal(Number(res.json.netSales), 400)
    assert.equal(res.json.closedBy, fa.user.id)
    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'pos_shift'), eq(auditEvents.entityId, shiftA.id)))
    assert.equal(audit[0].actorUserId, fa.user.id)
    assert.equal((await call(pos, fa, { action: 'close-shift', data: { shiftId: shiftA.id, countedCash: 900 } })).status, 404)
  })

  it('a concurrent double close creates a single reconciliation', async () => {
    const outlet = (await call(pos, fa, { action: 'create-outlet', data: { code: 'A2', name: 'Outlet A2', franchiseId: franchiseA.id } })).json
    const shift = (await call(pos, fa, { action: 'open-shift', data: { outletId: outlet.id } })).json
    const results = await Promise.all([1, 2, 3].map(() => call(pos, fa, { action: 'close-shift', data: { shiftId: shift.id, countedCash: 0 } })))
    assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => [r.status, r.json])))
    const recs = await db.select().from(posReconciliations).where(eq(posReconciliations.shiftId, shift.id))
    assert.equal(recs.length, 1)
  })
})

describe('cross-franchise isolation', () => {
  it('franchise B cannot read or write franchise A POS data', async () => {
    const [open] = await db.select().from(posShifts).where(eq(posShifts.outletId, outletA.id))
    const reads = await call(pos, fb)
    assert.equal(reads.status, 200)
    assert.deepEqual(reads.json.outlets, [])
    assert.deepEqual(reads.json.sales, [])
    assert.equal((await call(pos, fb, { action: 'open-shift', data: { outletId: outletA.id } })).status, 404)
    assert.equal((await call(pos, fb, { action: 'record-sale', data: sale() })).status, 400)
    assert.equal((await call(pos, fb, { action: 'transfer-stock', data: { outletId: outletA.id, product: 'Chicken', quantity: 1 } })).status, 403)
    assert.ok(open)
  })

  it('franchise B cannot close a shift of franchise A', async () => {
    const [outlet] = await db.select().from(posOutlets).where(eq(posOutlets.code, 'A1'))
    const shift = (await call(pos, fa, { action: 'open-shift', data: { outletId: outlet.id } })).json
    assert.equal((await call(pos, fb, { action: 'close-shift', data: { shiftId: shift.id, countedCash: 0 } })).status, 403)
    assert.equal((await call(pos, fa, { action: 'close-shift', data: { shiftId: shift.id, countedCash: 0 } })).status, 201)
  })

  it('unauthenticated and cross-site requests are rejected', async () => {
    assert.equal((await call(pos, null)).status, 401)
    const res = await pos(new Request('http://localhost/api/pos', { method: 'POST', headers: { origin: 'http://evil.example', cookie: fa.cookie }, body: '{}' }))
    assert.equal(res.status, 403)
  })
})

describe('fulfilment and operations audit actors (#6)', () => {
  let orderId: string, productionId: string
  it('operations audits the actor and fulfilment scopes by franchise', async () => {
    const lead = await call(operations, fa, { kind: 'leads', data: { name: 'Hotel A', status: 'Customer', phone: '9100000001', latitude: 14.7, longitude: 78.5 } })
    assert.equal(lead.status, 201, JSON.stringify(lead.json))
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'customer'))
    assert.ok(audit.length > 0 && audit.every(a => a.actorUserId === fa.user.id))

    const order = await call(operations, fa, { kind: 'orders', data: { name: 'Order A', status: 'Pending', product: 'Chicken', quantity: 5, unit: 'kg', amount: 500, paid: 0, date: '2026-10-13' } })
    assert.equal(order.status, 201, JSON.stringify(order.json))
    const [row] = await db.select().from(customerOrders).where(eq(customerOrders.franchiseId, franchiseA.id))
    orderId = row.id

    const prod = await call(fulfillment, fa, { action: 'create-production', data: { orderId } })
    assert.equal(prod.status, 201, JSON.stringify(prod.json))
    productionId = prod.json.id
    const prodAudit = await db.select().from(auditEvents).where(eq(auditEvents.entityId, productionId))
    assert.equal(prodAudit[0].actorUserId, fa.user.id)

    assert.equal((await call(fulfillment, fb, { action: 'create-production', data: { orderId } })).status, 404)
    assert.equal((await call(fulfillment, fb, { action: 'process-batch', data: { productionOrderId: productionId, inputQuantity: 5, outputQuantity: 4, wasteQuantity: 1, qcStatus: 'Passed' } })).status, 404)

    const batch = await call(fulfillment, fa, { action: 'process-batch', data: { productionOrderId: productionId, inputQuantity: 5, outputQuantity: 4, wasteQuantity: 1, qcStatus: 'Passed' } })
    assert.equal(batch.status, 201, JSON.stringify(batch.json))
    const [qc] = await db.select().from(qcChecks)
    assert.equal(qc.checkedBy, fa.user.id)
  })

  it('duplicate franchise settlement for the same period returns 409', async () => {
    const body = { action: 'create-settlement', data: { franchiseId: franchiseA.id, periodStart: '2026-10-01', periodEnd: '2026-10-07', grossSales: 100, collections: 40 } }
    assert.equal((await call(fulfillment, staff, body)).status, 201)
    assert.equal((await call(fulfillment, staff, body)).status, 409)
    assert.equal((await call(fulfillment, fa, body)).status, 403)
  })
})

describe('procurement guards and audit (#6, #9)', () => {
  let supplierId: string, supplyRequestId: string, poId: string

  it('staff runs the procurement flow and audit rows carry the actor', async () => {
    const supply = await call(operations, fa, { kind: 'supply', data: { name: 'ignored', status: 'Requested', product: 'Chicken', quantity: 10, unit: 'kg', amount: 0, paid: 0 } })
    assert.equal(supply.status, 201, JSON.stringify(supply.json))
    supplyRequestId = supply.json.id
    const supplier = await call(procurement, staff, { action: 'create-supplier', data: { name: 'Farm Co' } })
    assert.equal(supplier.status, 201)
    supplierId = supplier.json.id
    const po = await call(procurement, staff, { action: 'create-po', data: { supplierId, product: 'Chicken', quantity: 10, unitPrice: 50, supplyRequestId } })
    assert.equal(po.status, 201, JSON.stringify(po.json))
    poId = po.json.id
    const grn = await call(procurement, staff, { action: 'receive-po', data: { purchaseOrderId: poId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0, qcStatus: 'Passed' } })
    assert.equal(grn.status, 201, JSON.stringify(grn.json))
    const [receipt] = await db.select().from(goodsReceipts)
    assert.equal(receipt.receivedBy, staff.user.id)
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'goods_receipt'))
    assert.equal(audit[0].actorUserId, staff.user.id)
    const inv = await call(procurement, staff, { action: 'create-supplier-invoice', data: { supplierId, invoiceNumber: 'INV-1', total: 500 } })
    assert.equal(inv.status, 201)
    assert.equal((await call(procurement, staff, { action: 'pay-supplier', data: { supplierInvoiceId: inv.json.id, amount: 600 } })).status, 409)
    assert.equal((await call(procurement, staff, { action: 'pay-supplier', data: { supplierInvoiceId: inv.json.id, amount: 500 } })).status, 201)
  })

  it('franchisee gets 403 on every company-only procurement action', async () => {
    const attempts: [string, Record<string, unknown>][] = [
      ['create-supplier', { name: 'Mine' }],
      ['create-po', { supplierId, product: 'Chicken', quantity: 1, unitPrice: 1, supplyRequestId }],
      ['receive-po', { purchaseOrderId: poId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0, qcStatus: 'Passed' }],
      ['create-supplier-invoice', { supplierId, invoiceNumber: 'INV-FA', total: 1 }],
      ['pay-supplier', { supplierInvoiceId: poId, amount: 1 }],
      ['transfer-to-franchise', { franchiseId: franchiseA.id, product: 'Chicken', quantity: 1, supplyRequestId, purchaseOrderId: poId, goodsReceiptId: poId }],
    ]
    for (const [action, data] of attempts) {
      const withSourcing = await createUser('franchisee', `src-${action}@test.local`, { franchiseId: franchiseA.id, permissions: { sourcing: 'edit', supply: 'edit' } })
      const res = await call(procurement, withSourcing, { action, data })
      assert.equal(res.status, 403, `${action}: ${JSON.stringify(res.json)}`)
    }
    assert.equal((await db.select().from(supplierInvoices)).length, 1)
  })
})

describe('pricing guards (#9)', () => {
  const config = (extra: Record<string, unknown> = {}) => ({ action: 'create-config', product: 'Chicken', supplierName: 'Farm', liveWeightKg: 1, supplierPricePerKg: 100, standardYieldPct: 70, logisticsCostPerKg: 1, otherCostPerKg: 1, companyPricePerKg: 200, effectiveFrom: '2026-10-01', ...extra })

  it('franchisees are blocked from every pricing action', async () => {
    for (const body of [undefined, config(), { action: 'activate-config', id: '1' }, { action: 'snapshot-order', orderId: '1', pricingConfigId: '1', liveWeightKg: 1 }]) {
      assert.equal((await call(pricing, fa, body)).status, 403)
    }
  })

  it('validates franchiseId and scopes snapshot-order to the order franchise', async () => {
    assert.equal((await call(pricing, admin, config({ franchiseId: '11111111-1111-1111-1111-111111111111' }))).status, 400)
    assert.equal((await call(pricing, admin, config({ franchiseId: 'nope' }))).status, 400)
    const forB = await call(pricing, admin, config({ franchiseId: franchiseB.id }))
    assert.equal(forB.status, 200, JSON.stringify(forB.json))
    const company = await call(pricing, admin, config())
    assert.equal(company.status, 200)
    const [order] = await db.select().from(customerOrders).where(eq(customerOrders.franchiseId, franchiseA.id))
    const snap = (pricingConfigId: string) => call(pricing, admin, { action: 'snapshot-order', orderId: order.id, pricingConfigId, liveWeightKg: 10 })
    assert.equal((await snap(forB.json.config.id)).status, 409)
    assert.equal((await snap(company.json.config.id)).status, 200)
    assert.equal((await snap('bad')).status, 404)
  })

  it('rejects an invalid actualOutputKg instead of writing null', async () => {
    const base = { action: 'calculate', liveWeightKg: 10, supplierPricePerKg: 100, standardYieldPct: 70, logisticsCostPerKg: 1, otherCostPerKg: 1, companyPricePerKg: 200 }
    assert.equal((await call(pricing, admin, { ...base, actualOutputKg: -3 })).status, 400)
    assert.equal((await call(pricing, admin, { ...base, actualOutputKg: 6 })).status, 200)
  })
})

describe('database constraints (#8)', () => {
  const rejects = async (sqlText: string, code: string) => {
    await assert.rejects(pool.query(sqlText), (e: any) => e.code === code)
  }
  it('enforces one settlement per franchise and period, one reconciliation per shift', async () => {
    await rejects(`INSERT INTO settlement_records (franchise_id, period_start, period_end) VALUES ('${franchiseA.id}', '2026-10-01', '2026-10-07')`, '23505')
    const [rec] = await db.select().from(posReconciliations)
    await rejects(`INSERT INTO pos_reconciliations (outlet_id, shift_id, business_date) VALUES ('${rec.outletId}', '${rec.shiftId}', now())`, '23505')
  })
  it('enforces non-negative stock ledger balances, receipt quantities and paid <= total', async () => {
    await rejects(`INSERT INTO franchise_stock_ledger (franchise_id, product, movement_type, quantity, balance_after) VALUES ('${franchiseA.id}', 'Chicken', 'SupplyIn', 1, -1)`, '23514')
    const [grn] = await db.select().from(goodsReceipts)
    await rejects(`INSERT INTO goods_receipts (purchase_order_id, received_quantity, accepted_quantity, unit, batch_code) VALUES ('${grn.purchaseOrderId}', 1, 2, 'kg', 'X')`, '23514')
    const [inv] = await db.select().from(supplierInvoices)
    await rejects(`UPDATE supplier_invoices SET paid = total + 1 WHERE id = '${inv.id}'`, '23514')
  })
  it('allows invoices without an order (POS)', async () => {
    await pool.query(`INSERT INTO invoice_records (invoice_number) VALUES ('NO-ORDER-1')`)
  })
})
