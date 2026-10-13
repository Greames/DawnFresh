import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from './helpers/test-db.js'
import { call, createFranchise, createUser, resetDatabase, seedPrices } from './helpers/harness.js'
import type { Actor } from './helpers/harness.js'
import { auditEvents, customerOrders, customers, dispatchLoads, idempotencyKeys, invoiceRecords, paymentRecords, records, stockLots } from '../db/schema.js'
import { outletStockLedger, posReturns, posSales, stockBalances, stockCounts } from '../db/pos-schema.js'
import { franchiseStockLedger, purchaseOrders, supplierPayments } from '../db/procurement-schema.js'
import pos from '../netlify/functions/pos.mts'
import procurement from '../netlify/functions/procurement.mts'
import fulfillment from '../netlify/functions/fulfillment.mts'
import operations from '../netlify/functions/operations.mts'

let admin: Actor, staff: Actor, fa: Actor, fb: Actor
let franchiseA: { id: string }, franchiseB: { id: string }
let supplierId: string
let codeSeq = 0

before(async () => {
  await resetDatabase()
  await seedPrices()
  admin = await createUser('admin', 'admin@test.local')
  staff = await createUser('staff', 'staff@test.local')
  franchiseA = await createFranchise('Franchise A', 'a@test.local')
  franchiseB = await createFranchise('Franchise B', 'b@test.local')
  const stored = { orders: 'edit', leads: 'edit', supply: 'edit', inventory: 'view', sourcing: 'none', outlets: 'none', franchises: 'none' }
  fa = await createUser('franchisee', 'fa@test.local', { franchiseId: franchiseA.id, permissions: stored })
  fb = await createUser('franchisee', 'fb@test.local', { franchiseId: franchiseB.id, permissions: stored })
  const supplier = await call(procurement, staff, { action: 'create-supplier', data: { name: 'Farm Co' } })
  supplierId = supplier.json.id
})

after(async () => { await pool.end() })

const newOutlet = async (actor: Actor, franchiseId: string | null) => {
  const res = await call(pos, actor, { action: 'create-outlet', data: { code: `W2-${++codeSeq}`, name: `Outlet ${codeSeq}`, franchiseId } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json as { id: string; franchiseId: string | null }
}
const openShift = async (actor: Actor, outletId: string) => {
  const res = await call(pos, actor, { action: 'open-shift', data: { outletId, openingCash: 0 } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json as { id: string }
}
const companyLot = async (product: string, quantity: number, extra: Record<string, unknown> = {}) => {
  const [lot] = await db.insert(stockLots).values({ product, quantity: String(quantity), unit: 'kg', batchCode: `C-${++codeSeq}`, status: 'Available', ...extra }).returning()
  return lot
}
/** Puts stock into an outlet the way company staff do: direct transfer from company lots. */
const stockOutlet = async (outletId: string, product: string, quantity: number) => {
  await companyLot(product, quantity)
  const res = await call(pos, staff, { action: 'transfer-stock', data: { outletId, product, quantity } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json.rows as any[]
}
const sell = (actor: Actor, outletId: string, shiftId: string, quantity: number, extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) =>
  call(pos, actor, { action: 'record-sale', data: { outletId, shiftId, items: [{ product: 'Chicken', quantity, unitPrice: 100, ...item }], payments: [{ method: 'Cash', amount: quantity * 100 }], ...extra } })

/** The model's invariant: balance = sum of the outlet's lots = last ledger balance_after = sum of signed ledger quantities. */
const assertInvariant = async (outletId: string, product: string) => {
  const [bal] = await db.select().from(stockBalances).where(and(eq(stockBalances.outletId, outletId), eq(stockBalances.product, product)))
  const lots = await db.select().from(stockLots).where(and(eq(stockLots.posOutletId, outletId), eq(stockLots.product, product)))
  const ledger = await db.select().from(outletStockLedger).where(and(eq(outletStockLedger.outletId, outletId), eq(outletStockLedger.product, product))).orderBy(outletStockLedger.seq)
  const balance = Number(bal?.quantity ?? 0)
  assert.equal(lots.reduce((a, l) => a + Number(l.quantity), 0), balance, 'sum of lots equals balance')
  assert.equal(ledger.reduce((a, l) => a + Number(l.quantity), 0), balance, 'sum of ledger equals balance')
  if (ledger.length) assert.equal(Number(ledger[ledger.length - 1].balanceAfter), balance, 'last balance_after equals balance')
  let running = 0
  for (const row of ledger) { running += Number(row.quantity); assert.equal(Number(row.balanceAfter), running, 'balance_after is the running total') }
  return balance
}

const supplyRequest = async (actor: Actor, quantity: number) => {
  const res = await call(operations, actor, { kind: 'supply', data: { name: 'x', status: 'Requested', product: 'Chicken', quantity, unit: 'kg', amount: 0, paid: 0 } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json.id as string
}
const supplyChain = async (actor: Actor, quantity: number, accepted = quantity) => {
  const requestId = await supplyRequest(actor, quantity)
  const po = await call(procurement, staff, { action: 'create-po', data: { supplierId, product: 'Chicken', quantity, unitPrice: 50, supplyRequestId: requestId } })
  assert.equal(po.status, 201, JSON.stringify(po.json))
  const grn = await call(procurement, staff, { action: 'receive-po', data: { purchaseOrderId: po.json.id, receivedQuantity: quantity, acceptedQuantity: accepted, rejectedQuantity: quantity - accepted, qcStatus: 'Passed' } })
  assert.equal(grn.status, 201, JSON.stringify(grn.json))
  return { requestId, poId: po.json.id as string, grnId: grn.json.receipt.id as string, lotId: grn.json.stockLot.id as string }
}
const transfer = (chain: { requestId: string; poId: string; grnId: string }, franchiseId: string, quantity: number, extra: Record<string, unknown> = {}) =>
  call(procurement, staff, { action: 'transfer-to-franchise', data: { franchiseId, product: 'Chicken', quantity, supplyRequestId: chain.requestId, purchaseOrderId: chain.poId, goodsReceiptId: chain.grnId, ...extra } })
const requestData = async (id: string) => (await db.select().from(records).where(eq(records.id, id)))[0].data as any

describe('end to end: supply, receipt, sale, return, wastage, adjustment, count (#10)', () => {
  let outlet: { id: string }, shift: { id: string }, chain: Awaited<ReturnType<typeof supplyChain>>, saleItem: any, saleId: string

  it('a partial delivery leaves the request open, the next completes it, and anything beyond the request is refused', async () => {
    outlet = await newOutlet(fa, franchiseA.id)
    chain = await supplyChain(fa, 10)

    // Franchise B's outlet cannot receive franchise A's supply.
    const other = await newOutlet(fb, franchiseB.id)
    assert.equal((await transfer(chain, franchiseA.id, 1, { outletId: other.id })).status, 400)

    const first = await transfer(chain, franchiseA.id, 6)
    assert.equal(first.status, 201, JSON.stringify(first.json))
    assert.equal(first.json.complete, false)
    assert.equal((await requestData(chain.requestId)).status, 'Dispatched')
    assert.equal((await requestData(chain.requestId)).deliveredQuantity, 6)

    assert.equal((await transfer(chain, franchiseA.id, 5)).status, 409, 'over the remaining request quantity')
    const second = await transfer(chain, franchiseA.id, 4)
    assert.equal(second.status, 201, JSON.stringify(second.json))
    assert.equal(second.json.complete, true)
    assert.equal((await requestData(chain.requestId)).status, 'Delivered')
    assert.equal((await transfer(chain, franchiseA.id, 1)).status, 409, 'already fully delivered')

    // The ledger carries every reference, the franchise owns child lots cut from the GRN lot, the company lot is spent.
    const rows = await db.select().from(outletStockLedger).where(eq(outletStockLedger.supplyRequestId, chain.requestId)).orderBy(outletStockLedger.seq)
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.movementType, 'SupplyIn')
      assert.equal(row.franchiseId, franchiseA.id)
      assert.equal(row.outletId, outlet.id)
      assert.equal(row.purchaseOrderId, chain.poId)
      assert.equal(row.goodsReceiptId, chain.grnId)
      const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, row.stockLotId!))
      assert.equal(lot.franchiseId, franchiseA.id)
      assert.equal(lot.posOutletId, outlet.id)
      assert.equal(lot.parentLotId, chain.lotId)
    }
    const [companySide] = await db.select().from(stockLots).where(eq(stockLots.id, chain.lotId))
    assert.equal(Number(companySide.quantity), 0)
    assert.equal(companySide.status, 'Depleted')
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 10)
    assert.equal((await db.select().from(franchiseStockLedger)).length, 0, 'the legacy franchise ledger is no longer written')
    const view = await call(procurement, staff)
    assert.equal(view.json.franchiseStock.filter((r: any) => r.supplyRequestId === chain.requestId).length, 2)
  })

  it('caps a transfer to what the goods receipt accepted', async () => {
    const outlet2 = await newOutlet(fa, franchiseA.id)
    const small = await supplyChain(fa, 10, 7)
    // Franchise A now has two active outlets, so the receiving outlet must be named.
    assert.equal((await transfer(small, franchiseA.id, 1)).status, 400)
    assert.equal((await transfer(small, franchiseA.id, 8, { outletId: outlet2.id })).status, 409)
    assert.equal((await transfer(small, franchiseA.id, 7, { outletId: outlet2.id })).status, 201)
    assert.equal((await requestData(small.requestId)).status, 'Dispatched', 'still 3 kg short of the request')
  })

  it('sells from outlet lots, first expiry first, and traces every line to a lot', async () => {
    shift = await openShift(fa, outlet.id)
    // Split the stock into an early-expiry lot and a late-expiry lot.
    const lots = await db.select().from(stockLots).where(eq(stockLots.posOutletId, outlet.id))
    await db.update(stockLots).set({ expiryAt: new Date(Date.now() + 2 * 864e5) }).where(eq(stockLots.id, lots[0].id))
    await db.update(stockLots).set({ expiryAt: new Date(Date.now() + 9 * 864e5) }).where(eq(stockLots.id, lots[1].id))
    // The first lot holds 6 kg: a 8 kg sale takes 6 from it and 2 from the other, as two sale lines.
    const res = await sell(fa, outlet.id, shift.id, 8, { allowNegativeStock: true })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    saleId = res.json.sale.id
    assert.equal(res.json.items.length, 2)
    assert.deepEqual(res.json.items.map((i: any) => [i.stockLotId, Number(i.quantity)]).sort(), [[lots[0].id, 6], [lots[1].id, 2]].sort())
    assert.equal(Number(res.json.sale.total), 800)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 2)
    const ledger = await db.select().from(outletStockLedger).where(eq(outletStockLedger.saleId, saleId))
    assert.equal(ledger.length, 2)
    assert.ok(ledger.every(l => l.movementType === 'Sale' && l.referenceType === 'POS_SALE' && l.referenceId === saleId && l.stockLotId))
    saleItem = res.json.items.find((i: any) => Number(i.quantity) === 2)
  })

  it('refuses to oversell and ignores the old allowNegativeStock flag', async () => {
    const res = await sell(fa, outlet.id, shift.id, 3, { allowNegativeStock: true })
    assert.equal(res.status, 409)
    assert.match(res.json.error, /Insufficient/)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 2)
  })

  it('a return can restock the goods or write them off', async () => {
    const restock = await call(pos, fa, { action: 'return-sale', data: { saleId, itemId: saleItem.id, quantity: 1, reason: 'Wrong cut' } })
    assert.equal(restock.status, 201, JSON.stringify(restock.json))
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 3)
    const waste = await call(pos, fa, { action: 'return-sale', data: { saleId, itemId: saleItem.id, quantity: 1, disposition: 'Wastage', reason: 'Warm on arrival' } })
    assert.equal(waste.status, 201, JSON.stringify(waste.json))
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 3, 'returned-and-discarded goods never reach the shelf')
    const types = (await db.select().from(outletStockLedger).where(eq(outletStockLedger.saleId, saleId)).orderBy(outletStockLedger.seq)).map(r => r.movementType)
    assert.deepEqual(types, ['Sale', 'Sale', 'Return', 'Return', 'Wastage'])
    assert.equal((await call(pos, fa, { action: 'return-sale', data: { saleId, itemId: saleItem.id, quantity: 1 } })).status, 400, 'nothing left to return')
    assert.equal((await call(pos, fa, { action: 'return-sale', data: { saleId, itemId: saleItem.id, quantity: 1, disposition: 'Burn' } })).status, 400)
    const returns = await db.select().from(posReturns).where(eq(posReturns.saleId, saleId))
    assert.deepEqual(returns.map(r => r.disposition).sort(), ['Restock', 'Wastage'])
  })

  it('wastage, adjustments and counts are ledger movements with reasons', async () => {
    assert.equal((await call(pos, fa, { action: 'record-wastage', data: { outletId: outlet.id, product: 'Chicken', quantity: 1 } })).status, 400, 'reason required')
    const waste = await call(pos, fa, { action: 'record-wastage', data: { outletId: outlet.id, product: 'Chicken', quantity: 1, reason: 'Spoiled' } })
    assert.equal(waste.status, 201, JSON.stringify(waste.json))
    assert.equal(waste.json.rows[0].movementType, 'Wastage')
    assert.equal(waste.json.rows[0].reason, 'Spoiled')
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 2)
    assert.equal((await call(pos, fa, { action: 'record-wastage', data: { outletId: outlet.id, product: 'Chicken', quantity: 50, reason: 'Too much' } })).status, 409)

    assert.equal((await call(pos, fa, { action: 'adjust-stock', data: { outletId: outlet.id, product: 'Chicken', quantityDelta: -1 } })).status, 400, 'reason required')
    assert.equal((await call(pos, fa, { action: 'adjust-stock', data: { outletId: outlet.id, product: 'Chicken', quantityDelta: 5, reason: 'Found stock' } })).status, 403, 'a franchise cannot add stock')
    assert.equal((await call(pos, fa, { action: 'adjust-stock', data: { outletId: outlet.id, product: 'Chicken', quantityDelta: -1, reason: 'Drip loss' } })).status, 201)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 1)
    const added = await call(pos, staff, { action: 'adjust-stock', data: { outletId: outlet.id, product: 'Chicken', quantityDelta: 4, reason: 'Opening correction', batchCode: 'ADJ-TEST' } })
    assert.equal(added.status, 201, JSON.stringify(added.json))
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 5)
    const [adjLot] = await db.select().from(stockLots).where(eq(stockLots.id, added.json.rows[0].stockLotId))
    assert.equal(adjLot.batchCode, 'ADJ-TEST')
    assert.equal(adjLot.posOutletId, outlet.id)

    // Count: 5 on the books, 3 on the shelf.
    assert.equal((await call(pos, fa, { action: 'count-stock', data: { outletId: outlet.id, product: 'Chicken', countedQuantity: 3 } })).status, 400, 'a variance needs a reason')
    const count = await call(pos, fa, { action: 'count-stock', data: { outletId: outlet.id, product: 'Chicken', countedQuantity: 3, reason: 'Weekly count' } })
    assert.equal(count.status, 201, JSON.stringify(count.json))
    assert.equal(Number(count.json.count.systemQuantity), 5)
    assert.equal(Number(count.json.count.variance), -2)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 3)
    const countRows = await db.select().from(outletStockLedger).where(eq(outletStockLedger.referenceId, count.json.count.id))
    assert.ok(countRows.every(r => r.movementType === 'Count' && r.reason === 'Weekly count'))
    assert.equal(countRows.reduce((a, r) => a + Number(r.quantity), 0), -2, 'the variance may be spread over several lots')
    // A matching count is recorded but moves nothing; a franchise cannot count itself up.
    const exact = await call(pos, fa, { action: 'count-stock', data: { outletId: outlet.id, product: 'Chicken', countedQuantity: 3 } })
    assert.equal(exact.status, 201)
    assert.equal(exact.json.ledgerId, null)
    assert.equal((await call(pos, fa, { action: 'count-stock', data: { outletId: outlet.id, product: 'Chicken', countedQuantity: 9, reason: 'Found more' } })).status, 403)
    const up = await call(pos, staff, { action: 'count-stock', data: { outletId: outlet.id, product: 'Chicken', countedQuantity: 4, reason: 'Recount' } })
    assert.equal(up.status, 201, JSON.stringify(up.json))
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 4)
    assert.equal((await db.select().from(stockCounts).where(eq(stockCounts.outletId, outlet.id))).length, 3)
    // Audit rows were written for each of these in the same transaction.
    const audits = await db.select({ type: auditEvents.entityType }).from(auditEvents).where(eq(auditEvents.franchiseId, franchiseA.id))
    for (const type of ['stock_wastage', 'stock_adjustment', 'stock_count', 'pos_return', 'franchise_stock_supply']) assert.ok(audits.some(a => a.type === type), type)
  })
})

describe('stock scoping (#10)', () => {
  it('a franchisee cannot pull company stock; company staff can', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await companyLot('Mutton', 30)
    const pulled = await call(pos, fa, { action: 'transfer-stock', data: { outletId: outlet.id, product: 'Mutton', quantity: 5 } })
    assert.equal(pulled.status, 403)
    assert.equal(await assertInvariant(outlet.id, 'Mutton'), 0)
    assert.equal((await call(pos, staff, { action: 'transfer-stock', data: { outletId: outlet.id, product: 'Mutton', quantity: 5 } })).status, 201)
    assert.equal(await assertInvariant(outlet.id, 'Mutton'), 5)
  })

  it('company allocation never touches franchise-owned lots', async () => {
    const outlet = await newOutlet(fb, franchiseB.id)
    const company = await newOutlet(admin, null)
    // Franchise B owns 50 kg of Prawns (an outlet lot and a franchise-produced lot); the company has none.
    await stockOutlet(outlet.id, 'Prawns', 50)
    await db.insert(stockLots).values({ product: 'Prawns', quantity: '40', unit: 'kg', batchCode: 'FR-OWN', status: 'Available', franchiseId: franchiseB.id })
    const grab = await call(pos, staff, { action: 'transfer-stock', data: { outletId: company.id, product: 'Prawns', quantity: 10 } })
    assert.equal(grab.status, 409, 'there is no company stock left to allocate')
    const lots = await db.select().from(stockLots).where(and(eq(stockLots.product, 'Prawns'), eq(stockLots.franchiseId, franchiseB.id)))
    assert.deepEqual(lots.map(l => Number(l.quantity)).sort((a, b) => a - b), [40, 50])
  })

  it('another franchise cannot see or sell a lot it does not own', async () => {
    const outletA = await newOutlet(fa, franchiseA.id)
    const outletB = await newOutlet(fb, franchiseB.id)
    await stockOutlet(outletA.id, 'Chicken', 5)
    await stockOutlet(outletB.id, 'Chicken', 5)
    const [lotA] = await db.select().from(stockLots).where(eq(stockLots.posOutletId, outletA.id))
    const [lotB] = await db.select().from(stockLots).where(eq(stockLots.posOutletId, outletB.id))
    const shiftB = await openShift(fb, outletB.id)
    const shiftA = await openShift(fa, outletA.id)

    const seen = await call(pos, fb)
    assert.ok(seen.json.lots.some((l: any) => l.id === lotB.id))
    assert.ok(!seen.json.lots.some((l: any) => l.id === lotA.id), 'lot of franchise A is invisible to B')
    assert.ok(seen.json.balances.every((b: any) => b.outletId !== outletA.id))

    assert.equal((await sell(fb, outletB.id, shiftB.id, 1, {}, { stockLotId: lotA.id })).status, 400, 'B cannot sell A lot from its own outlet')
    assert.equal((await sell(fb, outletA.id, shiftA.id, 1)).status, 400, 'B cannot sell at A outlet')
    assert.equal((await sell(fa, outletA.id, shiftA.id, 1, {}, { stockLotId: lotB.id })).status, 400)
    const company = await companyLot('Chicken', 10)
    assert.equal((await sell(fa, outletA.id, shiftA.id, 1, {}, { stockLotId: company.id })).status, 400, 'a company lot is not outlet stock')
    const wrongProduct = await stockOutlet(outletA.id, 'Fish', 5)
    assert.equal((await sell(fa, outletA.id, shiftA.id, 1, {}, { stockLotId: wrongProduct[0].stockLotId })).status, 400, 'lot of another product')
    assert.equal((await call(pos, fb, { action: 'record-wastage', data: { outletId: outletA.id, product: 'Chicken', quantity: 1, reason: 'x' } })).status, 404)
    assert.equal(await assertInvariant(outletA.id, 'Chicken'), 5)
    assert.equal((await sell(fa, outletA.id, shiftA.id, 1, {}, { stockLotId: lotA.id })).status, 201)
  })
})

describe('concurrency (#10, #12)', () => {
  it('concurrent sales cannot oversell', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 5)
    const shift = await openShift(fa, outlet.id)
    const results = await Promise.all(Array.from({ length: 10 }, () => sell(fa, outlet.id, shift.id, 1)))
    assert.equal(results.filter(r => r.status === 201).length, 5, JSON.stringify(results.map(r => r.status)))
    assert.equal(results.filter(r => r.status === 409).length, 5)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 0)
    assert.equal((await db.select().from(posSales).where(eq(posSales.outletId, outlet.id))).length, 5)
  })

  it('concurrent sales pinned to one lot cannot oversell it, and bill numbers never collide', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 3)
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.posOutletId, outlet.id))
    const shift = await openShift(fa, outlet.id)
    const results = await Promise.all(Array.from({ length: 8 }, () => sell(fa, outlet.id, shift.id, 1, {}, { stockLotId: lot.id })))
    assert.equal(results.filter(r => r.status === 201).length, 3)
    assert.ok(results.every(r => r.status === 201 || r.status === 409), JSON.stringify(results.map(r => r.status)))
    const bills = new Set(results.filter(r => r.status === 201).map(r => r.json.sale.billNumber))
    assert.equal(bills.size, 3)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 0)
  })

  it('concurrent transfers cannot allocate the same company stock twice', async () => {
    const outlet = await newOutlet(admin, null)
    await companyLot('Eggs', 10)
    const before = Number((await db.select({ q: sql<string>`coalesce(sum(quantity), 0)` }).from(stockLots).where(and(eq(stockLots.product, 'Eggs'), sql`franchise_id is null and pos_outlet_id is null`)))[0].q)
    const results = await Promise.all(Array.from({ length: 6 }, () => call(pos, staff, { action: 'transfer-stock', data: { outletId: outlet.id, product: 'Eggs', quantity: 3 } })))
    const ok = results.filter(r => r.status === 201).length
    assert.equal(ok, Math.floor(before / 3))
    assert.ok(results.every(r => r.status === 201 || r.status === 409))
    const after = Number((await db.select({ q: sql<string>`coalesce(sum(quantity), 0)` }).from(stockLots).where(and(eq(stockLots.product, 'Eggs'), sql`franchise_id is null and pos_outlet_id is null`)))[0].q)
    assert.equal(after, before - ok * 3)
    assert.equal(await assertInvariant(outlet.id, 'Eggs'), ok * 3)
  })

  it('concurrent supply transfers cannot exceed the request', async () => {
    const outlet = await newOutlet(fb, franchiseB.id)
    const chain = await supplyChain(fb, 10)
    const results = await Promise.all(Array.from({ length: 4 }, () => transfer(chain, franchiseB.id, 4, { outletId: outlet.id })))
    assert.equal(results.filter(r => r.status === 201).length, 2, JSON.stringify(results.map(r => [r.status, r.json?.error])))
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 8)
    assert.equal((await requestData(chain.requestId)).deliveredQuantity, 8)
  })

  it('concurrent returns cannot return more than was sold', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 5)
    const shift = await openShift(fa, outlet.id)
    const sale = (await sell(fa, outlet.id, shift.id, 2)).json
    const results = await Promise.all([1, 2, 3].map(() => call(pos, fa, { action: 'return-sale', data: { saleId: sale.sale.id, itemId: sale.items[0].id, quantity: 2 } })))
    assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => [r.status, r.json])))
    const returned = (await db.select().from(posReturns).where(eq(posReturns.saleId, sale.sale.id))).reduce((a, r) => a + Number(r.quantity), 0)
    assert.equal(returned, 2)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 5)
    const [invoice] = await db.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, sale.sale.id))
    assert.equal(Number(invoice.paid), 0)
  })

  it('concurrent payments cannot overpay an invoice', async () => {
    const order = await call(operations, fa, { kind: 'orders', data: { name: 'Pay order', status: 'Pending', product: 'Chicken', quantity: 5, unit: 'kg', amount: 500, paid: 0, date: '2026-10-13' } })
    assert.equal(order.status, 201, JSON.stringify(order.json))
    const [row] = await db.select().from(customerOrders).where(eq(customerOrders.legacyRecordId, order.json.id))
    const results = await Promise.all([1, 2, 3].map(() => call(fulfillment, fa, { action: 'record-payment', data: { orderId: row.id, amount: 300, method: 'UPI' } })))
    assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => [r.status, r.json])))
    assert.equal(results.filter(r => r.status === 409).length, 2)
    const [invoice] = await db.select().from(invoiceRecords).where(eq(invoiceRecords.orderId, row.id))
    assert.equal(Number(invoice.paid), 300)
    assert.equal((await db.select().from(paymentRecords).where(eq(paymentRecords.orderId, row.id))).length, 1)
    assert.equal((await call(fulfillment, fa, { action: 'record-payment', data: { orderId: row.id, amount: 200 } })).status, 201)
    assert.equal((await call(fulfillment, fa, { action: 'record-payment', data: { orderId: row.id, amount: 1 } })).status, 409)
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'payment'))
    assert.equal(audit.length, 2)
  })

  it('a second scan of one package onto a route fails once the first lands', async () => {
    const lead = await call(operations, fa, { kind: 'orders', data: { name: 'Route order', status: 'Pending', product: 'Chicken', quantity: 2, unit: 'kg', amount: 200, paid: 0, date: '2026-10-13' } })
    const [order] = await db.select().from(customerOrders).where(eq(customerOrders.legacyRecordId, lead.json.id))
    const route = await call(fulfillment, fa, { action: 'create-route', data: { franchiseId: franchiseA.id } })
    assert.equal(route.status, 201, JSON.stringify(route.json))
    assert.equal((await call(fulfillment, fa, { action: 'add-stop', data: { routeId: route.json.id, orderId: order.id } })).status, 201)
    const pkg = await call(fulfillment, fa, { action: 'create-package', data: { orderId: order.id, quantity: 2 } })
    assert.equal(pkg.status, 201, JSON.stringify(pkg.json))
    const results = await Promise.all([1, 2, 3].map(() => call(fulfillment, fa, { action: 'scan-load', data: { routeId: route.json.id, packageId: pkg.json.package.id } })))
    assert.equal(results.filter(r => r.status === 201).length, 1, JSON.stringify(results.map(r => [r.status, r.json])))
    assert.equal(results.filter(r => r.status === 409).length, 2)
    assert.equal((await db.select().from(dispatchLoads).where(eq(dispatchLoads.routeId, route.json.id))).length, 1)
  })
})

describe('idempotency (#12)', () => {
  it('replays a sale with the same key without a second sale, ledger row or invoice', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 10)
    const shift = await openShift(fa, outlet.id)
    const first = await sell(fa, outlet.id, shift.id, 2, { idempotencyKey: 'sale-key-1' })
    assert.equal(first.status, 201, JSON.stringify(first.json))
    const second = await sell(fa, outlet.id, shift.id, 2, { idempotencyKey: 'sale-key-1' })
    assert.equal(second.status, 201)
    assert.equal(second.json.replayed, true)
    assert.equal(second.json.sale.id, first.json.sale.id)
    assert.equal((await db.select().from(posSales).where(eq(posSales.outletId, outlet.id))).length, 1)
    assert.equal((await db.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, first.json.sale.id))).length, 1)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 8)
    // The header works too, and the same key with another payload is refused, not silently replayed.
    const headerRes = await pos(new Request('http://localhost/api/pos', { method: 'POST', headers: { origin: 'http://localhost', cookie: fa.cookie, 'content-type': 'application/json', 'idempotency-key': 'sale-key-hdr' }, body: JSON.stringify({ action: 'record-sale', data: { outletId: outlet.id, shiftId: shift.id, items: [{ product: 'Chicken', quantity: 1, unitPrice: 100 }], payments: [{ method: 'Cash', amount: 100 }] } }) }))
    const again = await pos(new Request('http://localhost/api/pos', { method: 'POST', headers: { origin: 'http://localhost', cookie: fa.cookie, 'content-type': 'application/json', 'idempotency-key': 'sale-key-hdr' }, body: JSON.stringify({ action: 'record-sale', data: { outletId: outlet.id, shiftId: shift.id, items: [{ product: 'Chicken', quantity: 1, unitPrice: 100 }], payments: [{ method: 'Cash', amount: 100 }] } }) }))
    assert.equal(headerRes.status, 201)
    assert.equal(again.headers.get('idempotent-replayed'), 'true')
    assert.equal((await again.json()).sale.id, (await headerRes.json()).sale.id)
    const clash = await sell(fa, outlet.id, shift.id, 3, { idempotencyKey: 'sale-key-1' })
    assert.equal(clash.status, 409)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 7)
    assert.equal((await call(pos, fa, { action: 'record-sale', data: { outletId: outlet.id, shiftId: shift.id, idempotencyKey: 'x'.repeat(200), items: [{ product: 'Chicken', quantity: 1, unitPrice: 1 }] } })).status, 400)
  })

  it('concurrent retries of one sale create exactly one sale and none fails with a 500', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 10)
    const shift = await openShift(fa, outlet.id)
    const results = await Promise.all(Array.from({ length: 6 }, () => sell(fa, outlet.id, shift.id, 2, { idempotencyKey: 'race-key' })))
    assert.ok(results.every(r => r.status === 201), JSON.stringify(results.map(r => [r.status, r.json?.error])))
    assert.equal(new Set(results.map(r => r.json.sale.id)).size, 1)
    assert.equal(results.filter(r => r.json.replayed).length, 5)
    assert.equal((await db.select().from(posSales).where(eq(posSales.outletId, outlet.id))).length, 1)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 8)
  })

  it('a rejected request does not burn its key', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    const shift = await openShift(fa, outlet.id)
    assert.equal((await sell(fa, outlet.id, shift.id, 1, { idempotencyKey: 'retry-after-fail' })).status, 409, 'no stock yet')
    await stockOutlet(outlet.id, 'Chicken', 2)
    const ok = await sell(fa, outlet.id, shift.id, 1, { idempotencyKey: 'retry-after-fail' })
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    assert.equal(ok.json.replayed, undefined)
  })

  it('return-sale, record-payment, create-invoice, create-settlement and close-shift replay by key', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 5)
    const shift = await openShift(fa, outlet.id)
    const sale = (await sell(fa, outlet.id, shift.id, 2)).json
    const ret = { action: 'return-sale', idempotencyKey: 'ret-1', data: { saleId: sale.sale.id, itemId: sale.items[0].id, quantity: 1 } }
    const r1 = await call(pos, fa, ret), r2 = await call(pos, fa, ret)
    assert.equal(r1.status, 201)
    assert.equal(r2.json.return.id, r1.json.return.id)
    assert.equal((await db.select().from(posReturns).where(eq(posReturns.saleId, sale.sale.id))).length, 1)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 4)

    const order = await call(operations, fa, { kind: 'orders', data: { name: 'Idem order', status: 'Pending', product: 'Chicken', quantity: 5, unit: 'kg', amount: 500, paid: 0, date: '2026-10-13' } })
    const [row] = await db.select().from(customerOrders).where(eq(customerOrders.legacyRecordId, order.json.id))
    const pay = { action: 'record-payment', idempotencyKey: 'pay-1', data: { orderId: row.id, amount: 100 } }
    const p1 = await call(fulfillment, fa, pay), p2 = await call(fulfillment, fa, pay)
    assert.equal(p1.status, 201)
    assert.equal(p2.json.id, p1.json.id)
    assert.equal((await db.select().from(paymentRecords).where(eq(paymentRecords.orderId, row.id))).length, 1)

    const inv = { action: 'create-invoice', idempotencyKey: 'inv-1', data: { orderId: row.id, total: 50, paid: 0, invoiceNumber: 'IDEM-INV' } }
    const i1 = await call(fulfillment, fa, inv), i2 = await call(fulfillment, fa, inv)
    assert.equal(i1.status, 201, JSON.stringify(i1.json))
    assert.equal(i2.json.id, i1.json.id)
    assert.equal((await call(fulfillment, fa, { action: 'create-invoice', data: { orderId: row.id, total: 50, paid: 60 } })).status, 400, 'paid above total is refused')

    const settle = { action: 'create-settlement', idempotencyKey: 'set-1', data: { franchiseId: franchiseB.id, periodStart: '2026-09-01', periodEnd: '2026-09-07', grossSales: 100, collections: 40 } }
    const s1 = await call(fulfillment, staff, settle), s2 = await call(fulfillment, staff, settle)
    assert.equal(s1.status, 201, JSON.stringify(s1.json))
    assert.equal(s2.status, 201)
    assert.equal(s2.json.id, s1.json.id)

    const close = { action: 'close-shift', idempotencyKey: 'close-1', data: { shiftId: shift.id, countedCash: 100 } }
    const c1 = await call(pos, fa, close), c2 = await call(pos, fa, close)
    assert.equal(c1.status, 201, JSON.stringify(c1.json))
    assert.equal(c2.status, 201)
    assert.equal(c2.json.id, c1.json.id)
    assert.equal((await call(pos, fa, { action: 'close-shift', data: { shiftId: shift.id, countedCash: 100 } })).status, 404)
  })

  it('procurement writes replay by key and a supply request gets only one live purchase order', async () => {
    const requestId = await supplyRequest(fa, 10)
    const po = { action: 'create-po', idempotencyKey: 'po-1', data: { supplierId, product: 'Chicken', quantity: 10, unitPrice: 50, supplyRequestId: requestId } }
    const [a, b] = await Promise.all([call(procurement, staff, po), call(procurement, staff, po)])
    assert.equal(a.status, 201, JSON.stringify(a.json))
    assert.equal(b.status, 201)
    assert.equal(a.json.id, b.json.id)
    assert.equal((await db.select().from(purchaseOrders).where(eq(purchaseOrders.supplyRequestId, requestId))).length, 1)
    const second = await call(procurement, staff, { action: 'create-po', data: { supplierId, product: 'Chicken', quantity: 10, unitPrice: 55, supplyRequestId: requestId } })
    assert.equal(second.status, 409)
    const concurrent = await Promise.all([1, 2, 3].map(() => call(procurement, staff, { action: 'create-po', data: { supplierId, product: 'Chicken', quantity: 10, unitPrice: 55, supplyRequestId: requestId } })))
    assert.ok(concurrent.every(r => r.status === 409))

    const invoice = { action: 'create-supplier-invoice', idempotencyKey: 'sinv-1', data: { supplierId, invoiceNumber: 'W2-INV-1', total: 500 } }
    const i1 = await call(procurement, staff, invoice), i2 = await call(procurement, staff, invoice)
    assert.equal(i1.status, 201, JSON.stringify(i1.json))
    assert.equal(i2.json.id, i1.json.id)
    const pay = { action: 'pay-supplier', idempotencyKey: 'spay-1', data: { supplierInvoiceId: i1.json.id, amount: 200 } }
    const [p1, p2, p3] = await Promise.all([call(procurement, staff, pay), call(procurement, staff, pay), call(procurement, staff, pay)])
    assert.deepEqual([p1.status, p2.status, p3.status], [201, 201, 201])
    assert.equal(new Set([p1.json.payment.id, p2.json.payment.id, p3.json.payment.id]).size, 1)
    assert.equal((await db.select().from(supplierPayments).where(eq(supplierPayments.supplierInvoiceId, i1.json.id))).length, 1)
    assert.equal(Number(p1.json.invoice.paid), 200)
    // Without a key a repeat is a new payment (still bounded by the invoice), and overpayment stays refused.
    assert.equal((await call(procurement, staff, { action: 'pay-supplier', data: { supplierInvoiceId: i1.json.id, amount: 400 } })).status, 409)
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'supplier_payment'))
    assert.ok(audit.length >= 1)
    const [stored] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, 'spay-1'))
    assert.equal(stored.action, 'pay-supplier')
    assert.equal(stored.responseStatus, 201)
  })
})

describe('transactions roll back completely (#12)', () => {
  it('a failure midway through the order projection leaves no partial rows and no leaked cause', async () => {
    await pool.query(`INSERT INTO invoice_records (invoice_number) VALUES ('CLASH-1')`)
    const count = async () => ({
      records: (await db.select().from(records)).length,
      customers: (await db.select().from(customers)).length,
      orders: (await db.select().from(customerOrders)).length,
      audits: (await db.select().from(auditEvents)).length,
    })
    const before = await count()
    const res = await call(operations, fa, { kind: 'orders', data: { name: 'Doomed order', phone: '9199999999', status: 'Pending', product: 'Chicken', quantity: 1, unit: 'kg', amount: 100, paid: 0, date: '2026-10-13', invoiceNumber: 'CLASH-1' } })
    assert.equal(res.status, 503)
    assert.equal(JSON.stringify(res.json).includes('invoice'), false, 'no SQL or constraint detail reaches the client')
    assert.deepEqual(await count(), before)
  })

  it('a sale that fails on stock leaves no sale, payment, invoice or audit row', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 1)
    await stockOutlet(outlet.id, 'Mutton', 1)
    const shift = await openShift(fa, outlet.id)
    const sales = (await db.select().from(posSales)).length, invoices = (await db.select().from(invoiceRecords)).length, payments = (await db.select().from(paymentRecords)).length
    const res = await call(pos, fa, { action: 'record-sale', data: { outletId: outlet.id, shiftId: shift.id, items: [{ product: 'Chicken', quantity: 1 }, { product: 'Mutton', quantity: 5 }], payments: [{ method: 'Cash', amount: 600 }] } })
    assert.equal(res.status, 409)
    assert.equal((await db.select().from(posSales)).length, sales)
    assert.equal((await db.select().from(invoiceRecords)).length, invoices)
    assert.equal((await db.select().from(paymentRecords)).length, payments)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 1, 'the Chicken line that fitted was rolled back too')
    assert.equal(await assertInvariant(outlet.id, 'Mutton'), 1)
  })

  it('an unexpected database error is logged server side and answered generically', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    const shift = await openShift(fa, outlet.id)
    await stockOutlet(outlet.id, 'Chicken', 2)
    await pool.query(`INSERT INTO pos_sales (outlet_id, shift_id, bill_number, cashier_id) VALUES ('${outlet.id}', '${shift.id}', 'FIXED-BILL', '${fa.user.id}')`)
    const res = await sell(fa, outlet.id, shift.id, 1, { billNumber: 'FIXED-BILL' })
    assert.equal(res.status, 409)
    assert.doesNotMatch(JSON.stringify(res.json), /violates|constraint|pos_sales/)
    assert.equal(await assertInvariant(outlet.id, 'Chicken'), 2)
  })
})

describe('schema guarantees (#10)', () => {
  const rejects = async (statement: string, code = '23514') => { await assert.rejects(pool.query(statement), (e: any) => e.code === code, statement) }
  it('money and quantity columns are numeric', async () => {
    const { rows } = await pool.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'text' AND (column_name IN ('quantity','total','paid','subtotal','tax','amount','unit_price','line_total','gross_sales','collections','adjustments','amount_due','requested_quantity','input_quantity','output_quantity','waste_quantity'))`)
    assert.deepEqual(rows, [])
  })
  it('refuses negative stock and paid above total at the database', async () => {
    await rejects(`INSERT INTO stock_lots (product, quantity, unit, batch_code) VALUES ('Chicken', -1, 'kg', 'NEG')`)
    const [lot] = await db.select().from(stockLots).where(sql`pos_outlet_id is not null`).limit(1)
    await rejects(`UPDATE stock_lots SET quantity = -0.5 WHERE id = '${lot.id}'`)
    await rejects(`UPDATE stock_balances SET quantity = -1 WHERE outlet_id = '${lot.posOutletId}' AND product = '${lot.product}'`)
    const [invoice] = await db.select().from(invoiceRecords).limit(1)
    await rejects(`UPDATE invoice_records SET paid = total + 1 WHERE id = '${invoice.id}'`)
    const [ledger] = await db.select().from(outletStockLedger).limit(1)
    await rejects(`INSERT INTO outlet_stock_ledger (outlet_id, product, movement_type, quantity, balance_after) VALUES ('${ledger.outletId}', 'Chicken', 'Sale', -1, -1)`)
    await rejects(`INSERT INTO outlet_stock_ledger (outlet_id, product, movement_type, quantity, balance_after) VALUES ('${ledger.outletId}', 'Chicken', 'Sale', 1, 1)`)
    await rejects(`INSERT INTO outlet_stock_ledger (outlet_id, product, movement_type, quantity, balance_after) VALUES ('${ledger.outletId}', 'Chicken', 'Teleport', 1, 1)`)
  })
})
