import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { db, pool } from './helpers/test-db.js'
import { call, createFranchise, createUser, resetDatabase, seedPrices } from './helpers/harness.js'
import type { Actor } from './helpers/harness.js'
import { auditEvents, customers, franchiseDailyCloses, invoiceRecords, records, settlementAdjustments, settlementPayments, settlementRecords, stockLots } from '../db/schema.js'
import { pricingConfigs } from '../db/pricing-schema.js'
import { customerReceivables, outletStockLedger, posOutlets, posSales, posShifts, receivablePayments } from '../db/pos-schema.js'
import pos from '../netlify/functions/pos.mts'
import procurement from '../netlify/functions/procurement.mts'
import operations from '../netlify/functions/operations.mts'
import fulfillment from '../netlify/functions/fulfillment.mts'
import settlements from '../netlify/functions/settlements.mts'
import dailyClose from '../netlify/functions/daily-close.mts'
import kpi from '../netlify/functions/kpi.mts'
import { businessDateOf, businessDayRange, businessPeriodRange, isBusinessDate } from '../src/lib/business.js'

let supplierId: string
let admin: Actor, staff: Actor, fa: Actor, fb: Actor
let franchiseA: { id: string }, franchiseB: { id: string }
let codeSeq = 0

before(async () => {
  await resetDatabase()
  await seedPrices()
  admin = await createUser('admin', 'admin@w3.local')
  staff = await createUser('staff', 'staff@w3.local')
  franchiseA = await createFranchise('Franchise A', 'a@w3.local')
  franchiseB = await createFranchise('Franchise B', 'b@w3.local')
  fa = await createUser('franchisee', 'fa@w3.local', { franchiseId: franchiseA.id })
  fb = await createUser('franchisee', 'fb@w3.local', { franchiseId: franchiseB.id })
  supplierId = (await call(procurement, staff, { action: 'create-supplier', data: { name: 'Farm Co' } })).json.id
  // Mutton: customers pay 200 per kg with 5% tax.
  await db.update(pricingConfigs).set({ customerPricePerKg: '200', taxRatePct: '5' }).where(eq(pricingConfigs.product, 'Mutton'))
})

after(async () => { await pool.end() })

const newOutlet = async (actor: Actor, franchiseId: string | null) => {
  const res = await call(pos, actor, { action: 'create-outlet', data: { code: `W3-${++codeSeq}`, name: `Outlet ${codeSeq}`, franchiseId } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json as { id: string; franchiseId: string | null }
}
const openShift = async (actor: Actor, outletId: string, openingCash = 0) => {
  const res = await call(pos, actor, { action: 'open-shift', data: { outletId, openingCash } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json as { id: string }
}
/** Company staff put stock into an outlet; a franchise outlet's lot takes the company price in force (60 per kg). */
const stockOutlet = async (outletId: string, product: string, quantity: number) => {
  await db.insert(stockLots).values({ product, quantity: String(quantity), unit: 'kg', batchCode: `C-${++codeSeq}`, status: 'Available' })
  const res = await call(pos, staff, { action: 'transfer-stock', data: { outletId, product, quantity } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
}
const newCustomer = async (franchiseId: string | null) => (await db.insert(customers).values({ franchiseId, name: `Customer ${++codeSeq}` }).returning())[0]
const sale = (actor: Actor, outletId: string, shiftId: string, items: any[], extra: Record<string, unknown> = {}) =>
  call(pos, actor, { action: 'record-sale', data: { outletId, shiftId, items, ...extra } })

describe('POS price, tax and cost come from the server (#11)', () => {
  it('uses the company price list and ignores the client; a different client price, tax or any discount is rejected', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 20)
    await stockOutlet(outlet.id, 'Mutton', 10)
    const shift = await openShift(fa, outlet.id)

    const plain = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 2 }])
    assert.equal(plain.status, 201, JSON.stringify(plain.json))
    assert.equal(Number(plain.json.sale.total), 200)
    assert.equal(Number(plain.json.items[0].unitPrice), 100)
    assert.equal(Number(plain.json.items[0].unitCost), 60, 'cost carried by the lot: the company price at transfer')

    const echoed = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 1, unitPrice: 100 }])
    assert.equal(echoed.status, 201, 'echoing the right price is harmless')

    for (const bad of [{ unitPrice: 1 }, { unitPrice: 0 }, { unitPrice: 99.5 }, { tax: 5 }, { discount: 10 }, { discount: -5 }, { discount: 'x' }]) {
      const res = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 1, ...bad }])
      assert.equal(res.status, 400, JSON.stringify([bad, res.json]))
    }
    // Only the two good sales exist.
    assert.equal((await db.select().from(posSales).where(eq(posSales.outletId, outlet.id))).length, 2)

    // Tax is computed from the company-set rate: 2 kg x 200 = 400, 5% = 20.
    const taxed = await sale(fa, outlet.id, shift.id, [{ product: 'Mutton', quantity: 2 }], { payments: [{ method: 'UPI', amount: 420 }] })
    assert.equal(taxed.status, 201, JSON.stringify(taxed.json))
    assert.equal(Number(taxed.json.sale.subtotal), 400)
    assert.equal(Number(taxed.json.sale.tax), 20)
    assert.equal(Number(taxed.json.sale.total), 420)
    assert.equal(Number(taxed.json.invoice.tax), 20)
    assert.equal((await sale(fa, outlet.id, shift.id, [{ product: 'Mutton', quantity: 1, tax: 3 }])).status, 400, 'a client tax that differs is rejected')
    const open = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 1 }], { payments: [{ method: 'UPI' }] })
    assert.equal(open.status, 201, 'one payment without an amount covers the server total')
    assert.equal(Number(open.json.invoice.paid), 100)
    // A wrong payment total is reported against the server total.
    const short = await sale(fa, outlet.id, shift.id, [{ product: 'Mutton', quantity: 1 }], { payments: [{ method: 'Cash', amount: 200 }] })
    assert.equal(short.status, 400)
    assert.match(short.json.error, /210\.00/)
  })

  it('a franchise-specific price beats the company-wide one for that franchise only', async () => {
    await db.insert(pricingConfigs).values({ product: 'Fish', supplierName: 'Farm Co', supplierPricePerKg: '40', standardYieldPct: '70', companyPricePerKg: '70', customerPricePerKg: '150', franchiseId: franchiseB.id, effectiveFrom: new Date('2021-01-01T00:00:00Z'), status: 'Active' })
    const a = await newOutlet(fa, franchiseA.id), b = await newOutlet(fb, franchiseB.id)
    await stockOutlet(a.id, 'Fish', 5); await stockOutlet(b.id, 'Fish', 5)
    const sa = await openShift(fa, a.id), sb = await openShift(fb, b.id)
    const ra = await sale(fa, a.id, sa.id, [{ product: 'Fish', quantity: 1 }])
    const rb = await sale(fb, b.id, sb.id, [{ product: 'Fish', quantity: 1 }])
    assert.equal(Number(ra.json.sale.total), 100)
    assert.equal(Number(rb.json.sale.total), 150)
    assert.equal(Number(ra.json.items[0].unitCost), 60)
    assert.equal(Number(rb.json.items[0].unitCost), 70, 'franchise B stock carries the franchise-specific company price')
  })

  it('refuses a sale with a clear 422 when no active customer price exists (nothing is written)', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Eggs', 5)
    await stockOutlet(outlet.id, 'Prawns', 5)
    const shift = await openShift(fa, outlet.id)
    await db.update(pricingConfigs).set({ status: 'Archived' }).where(eq(pricingConfigs.product, 'Eggs'))
    await db.update(pricingConfigs).set({ customerPricePerKg: null }).where(eq(pricingConfigs.product, 'Prawns'))
    const before = (await db.select().from(posSales)).length
    const eggs = await sale(fa, outlet.id, shift.id, [{ product: 'Eggs', quantity: 1 }])
    assert.equal(eggs.status, 422)
    assert.match(eggs.json.error, /No active customer price.*Eggs/)
    const prawns = await sale(fa, outlet.id, shift.id, [{ product: 'Prawns', quantity: 1, unitPrice: 100 }])
    assert.equal(prawns.status, 422, 'a company price alone is not a customer price, and a client price does not fill the gap')
    assert.equal((await db.select().from(posSales)).length, before)
    await db.update(pricingConfigs).set({ status: 'Active' }).where(eq(pricingConfigs.product, 'Eggs'))
    await db.update(pricingConfigs).set({ customerPricePerKg: '100' }).where(eq(pricingConfigs.product, 'Prawns'))
  })
})

describe('credit sales and customer receivables (#11)', () => {
  it('a credit sale makes a receivable and an unpaid invoice; partial payments reduce it; overpayment is refused', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 30)
    const shift = await openShift(fa, outlet.id, 100)
    const customer = await newCustomer(franchiseA.id)

    assert.equal((await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 10 }], { payments: [{ method: 'Credit', amount: 1000 }] })).status, 400, 'credit needs a customer')
    const res = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 10 }], { customerId: customer.id, payments: [{ method: 'Cash', amount: 400 }, { method: 'Credit', amount: 600 }] })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    const rec = res.json.receivable
    assert.equal(Number(rec.originalAmount), 600)
    assert.equal(rec.status, 'Open')
    assert.equal(rec.franchiseId, franchiseA.id)
    assert.equal(res.json.invoice.status, 'Partially Paid')
    assert.equal(Number(res.json.invoice.paid), 400)

    const pay = (actor: Actor, amount: number, key?: string, method = 'Cash') =>
      call(pos, actor, { action: 'collect-receivable', idempotencyKey: key, data: { receivableId: rec.id, shiftId: shift.id, amount, method } })
    assert.equal((await pay(fb, 10)).status, 404, 'another franchise cannot see or collect it')
    assert.equal((await pay(fa, 0)).status, 400)
    const first = await pay(fa, 250, 'rp-1')
    assert.equal(first.status, 201, JSON.stringify(first.json))
    assert.equal(first.json.receivable.status, 'Partially Paid')
    assert.equal(first.json.balance, 350)
    const replay = await pay(fa, 250, 'rp-1')
    assert.equal(replay.status, 201); assert.equal(replay.json.replayed, true)
    assert.equal((await db.select().from(receivablePayments).where(eq(receivablePayments.receivableId, rec.id))).length, 1, 'a replay does not pay twice')
    assert.equal((await pay(fa, 350.01)).status, 409, 'overpayment')
    const last = await pay(fa, 350, 'rp-2', 'UPI')
    assert.equal(last.json.receivable.status, 'Paid')
    assert.equal((await pay(fa, 0.01)).status, 409, 'nothing is left to pay')
    const [invoice] = await db.select().from(invoiceRecords).where(eq(invoiceRecords.posSaleId, res.json.sale.id))
    assert.equal(invoice.status, 'Paid'); assert.equal(Number(invoice.paid), 1000)
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'receivable_payment'))
    assert.ok(audits.length >= 2)

    // The shift's expected cash counts the cash collected against the receivable (opening 100 + 400 cash sale + 250 collected), not UPI.
    const closed = await call(pos, fa, { action: 'close-shift', data: { shiftId: shift.id, countedCash: 750 } })
    assert.equal(closed.status, 201, JSON.stringify(closed.json))
    assert.equal(Number(closed.json.expectedCash), 750)
    assert.equal(Number(closed.json.cashCollected), 650)
    assert.equal(Number(closed.json.upiCollected), 350)
    assert.equal(Number(closed.json.creditSales), 600)
    assert.equal(Number(closed.json.variance), 0)
  })

  it('concurrent payments cannot overpay a receivable', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 10)
    const shift = await openShift(fa, outlet.id)
    const customer = await newCustomer(franchiseA.id)
    const res = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 4 }], { customerId: customer.id, payments: [{ method: 'Credit', amount: 400 }] })
    assert.equal(res.json.invoice.status, 'Issued')
    const rec = res.json.receivable
    const results = await Promise.all([300, 300, 300].map(amount => call(pos, fa, { action: 'collect-receivable', data: { receivableId: rec.id, shiftId: shift.id, amount, method: 'Cash' } })))
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409, 409])
    const [row] = await db.select().from(customerReceivables).where(eq(customerReceivables.id, rec.id))
    assert.equal(Number(row.paidAmount), 300)
  })

  it('a return on a credit sale cancels what is owed before any money is refunded', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    await stockOutlet(outlet.id, 'Chicken', 10)
    const shift = await openShift(fa, outlet.id)
    const customer = await newCustomer(franchiseA.id)
    const res = await sale(fa, outlet.id, shift.id, [{ product: 'Chicken', quantity: 10 }], { customerId: customer.id, payments: [{ method: 'Cash', amount: 300 }, { method: 'Credit', amount: 700 }] })
    const item = res.json.items[0]
    const back = await call(pos, fa, { action: 'return-sale', data: { saleId: res.json.sale.id, itemId: item.id, quantity: 8 } })
    assert.equal(back.status, 201, JSON.stringify(back.json))
    assert.equal(back.json.refundAmount, 800)
    assert.equal(back.json.creditCancelled, 700)
    assert.equal(back.json.cashRefund, 100)
    const [row] = await db.select().from(customerReceivables).where(eq(customerReceivables.id, res.json.receivable.id))
    assert.equal(Number(row.returnedAmount), 700); assert.equal(row.status, 'Paid')
  })
})

describe('open-shift double open (#11 follow-up)', () => {
  it('concurrent opens leave exactly one open shift, and the index backs it up', async () => {
    const outlet = await newOutlet(fa, franchiseA.id)
    const results = await Promise.all(Array.from({ length: 6 }, () => call(pos, fa, { action: 'open-shift', data: { outletId: outlet.id, openingCash: 0 } })))
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409, 409, 409, 409, 409])
    assert.equal((await db.select().from(posShifts).where(and(eq(posShifts.outletId, outlet.id), eq(posShifts.status, 'Open')))).length, 1)
    await assert.rejects(pool.query(`INSERT INTO pos_shifts (outlet_id, cashier_id) VALUES ('${outlet.id}', '${fa.user.id}')`), /pos_shifts_one_open_per_outlet/)
    const open = results.find(r => r.status === 201)!.json
    assert.equal((await call(pos, fa, { action: 'close-shift', data: { shiftId: open.id, countedCash: 0 } })).status, 201)
    await openShift(fa, outlet.id) // a new shift can open after the close
  })
})

// ---- Supply chain helpers: request -> PO -> GRN -> transfer to a franchise outlet, priced at the company price. ----
const supplyChain = async (actor: Actor, quantity: number) => {
  const req = await call(operations, actor, { kind: 'supply', data: { name: 'x', status: 'Requested', product: 'Chicken', quantity, unit: 'kg', amount: 0, paid: 0 } })
  assert.equal(req.status, 201, JSON.stringify(req.json))
  const po = await call(procurement, staff, { action: 'create-po', data: { supplierId, product: 'Chicken', quantity, unitPrice: 50, supplyRequestId: req.json.id } })
  const grn = await call(procurement, staff, { action: 'receive-po', data: { purchaseOrderId: po.json.id, receivedQuantity: quantity, acceptedQuantity: quantity, rejectedQuantity: 0, qcStatus: 'Passed' } })
  assert.equal(grn.status, 201, JSON.stringify(grn.json))
  return { requestId: req.json.id as string, poId: po.json.id as string, grnId: grn.json.receipt.id as string }
}
const deliver = async (chain: { requestId: string; poId: string; grnId: string }, franchiseId: string, quantity: number, outletId?: string) => {
  const res = await call(procurement, staff, { action: 'transfer-to-franchise', data: { franchiseId, product: 'Chicken', quantity, supplyRequestId: chain.requestId, purchaseOrderId: chain.poId, goodsReceiptId: chain.grnId, outletId } })
  assert.equal(res.status, 201, JSON.stringify(res.json))
  return res.json.rows[0] as { stockLotId: string; unitCost: string }
}
const today = () => businessDateOf(new Date())
const shiftDay = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
const settle = (actor: Actor, data: Record<string, unknown>, idempotencyKey?: string) => call(settlements, actor, { action: 'create-settlement', idempotencyKey, data })
const settlePay = (actor: Actor, settlementId: string, amount: number, idempotencyKey?: string) => call(settlements, actor, { action: 'record-settlement-payment', idempotencyKey, data: { settlementId, amount, method: 'Bank' } })
const preview = (actor: Actor, franchiseId: string, from: string, to: string) => call(settlements, actor, undefined, 'GET', `?franchiseId=${franchiseId}&from=${from}&to=${to}`)

describe('derived franchise settlement (#13)', () => {
  let outlet: { id: string }, shift: { id: string }, childLot: string, settlement: any
  let franchiseS: { id: string }, fsx: Actor
  before(async () => {
    franchiseS = await createFranchise('Franchise S', 's@w3.local')
    fsx = await createUser('franchisee', 'fs@w3.local', { franchiseId: franchiseS.id })
  })
  const to = today(), from = shiftDay(today(), -2)

  it('derives the amount from supply, returns and adjustments, and ignores any client figure', async () => {
    outlet = await newOutlet(fsx, franchiseS.id)
    shift = await openShift(fsx, outlet.id)
    const c1 = await supplyChain(fsx, 10), c2 = await supplyChain(fsx, 5)
    const row1 = await deliver(c1, franchiseS.id, 10, outlet.id)
    await deliver(c2, franchiseS.id, 5, outlet.id)
    childLot = row1.stockLotId
    assert.equal(Number(row1.unitCost), 60, 'the child lot carries the company price at transfer')

    // Return 2 kg of the first lot to the company: 2 x 60 = 120.
    assert.equal((await call(pos, fsx, { action: 'return-supply', data: { outletId: outlet.id, stockLotId: childLot, quantity: 2 } })).status, 400, 'a reason is mandatory')
    const back = await call(pos, fsx, { action: 'return-supply', idempotencyKey: 'rs-1', data: { outletId: outlet.id, stockLotId: childLot, quantity: 2, reason: 'Wrong cut' } })
    assert.equal(back.status, 201, JSON.stringify(back.json))
    assert.equal(back.json.value, 120)
    assert.equal((await call(pos, fsx, { action: 'return-supply', idempotencyKey: 'rs-1', data: { outletId: outlet.id, stockLotId: childLot, quantity: 2, reason: 'Wrong cut' } })).json.replayed, true)
    const [ledgerRow] = await db.select().from(outletStockLedger).where(eq(outletStockLedger.id, back.json.ledgerId))
    assert.equal(ledgerRow.movementType, 'SupplyReturn'); assert.equal(Number(ledgerRow.quantity), -2); assert.equal(Number(ledgerRow.unitCost), 60)
    const [parent] = await db.select().from(stockLots).where(eq(stockLots.id, back.json.companyLotId))
    assert.equal(Number(parent.quantity), 2, 'the company lot got the 2 kg back')
    assert.equal((await call(pos, fsx, { action: 'return-supply', data: { outletId: outlet.id, stockLotId: childLot, quantity: 99, reason: 'x' } })).status, 409, 'cannot return more than the lot holds')

    // Sales and credit at the franchise do not enter the settlement: preview before and after.
    const before = await preview(staff, franchiseS.id, from, to)
    assert.equal(before.status, 200, JSON.stringify(before.json))
    assert.equal(before.json.supplyValue, 900); assert.equal(before.json.returnsValue, 120)
    const customer = await newCustomer(franchiseS.id)
    const credit = await sale(fsx, outlet.id, shift.id, [{ product: 'Chicken', quantity: 6 }], { customerId: customer.id, payments: [{ method: 'Cash', amount: 200 }, { method: 'Credit', amount: 400 }] })
    assert.equal(credit.status, 201, JSON.stringify(credit.json))
    const collect = await call(pos, fsx, { action: 'collect-receivable', data: { receivableId: credit.json.receivable.id, shiftId: shift.id, amount: 150, method: 'Cash' } })
    assert.equal(collect.status, 201)
    const after = await preview(staff, franchiseS.id, from, to)
    assert.deepEqual(after.json, before.json, 'customer sales, credit and collections never change what the franchise owes the company')

    // Client-supplied money figures are ignored; only adjustments with reasons count: 900 - 120 + 50 - 20 = 810.
    const res = await settle(staff, { franchiseId: franchiseS.id, periodStart: from, periodEnd: to, supplyValue: 99999, amountDue: 1, grossSales: 5, collections: 5, adjustments: [{ amount: 50, reason: 'Freight' }, { amount: -20, reason: 'Damage credit' }] }, 'set-1')
    assert.equal(res.status, 201, JSON.stringify(res.json))
    settlement = res.json.settlement
    assert.equal(Number(settlement.supplyValue), 900); assert.equal(Number(settlement.returnsValue), 120)
    assert.equal(Number(settlement.adjustments), 30); assert.equal(Number(settlement.amountDue), 810)
    assert.equal(Number(settlement.grossSales), 0); assert.equal(Number(settlement.collections), 0)
    assert.equal(settlement.status, 'Open'); assert.equal(settlement.derived, true)
    assert.equal(settlement.periodStartDate, from); assert.equal(settlement.periodEndDate, to)
    assert.equal(res.json.adjustments.length, 2)
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'settlement_adjustment'))
    assert.equal(audits.length, 2); assert.ok(audits.every(a => a.actorUserId === staff.user.id && typeof (a.metadata as any).reason === 'string'))
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'franchise_settlement'), eq(auditEvents.entityId, settlement.id)))).length, 1)
  })

  it('replays by key, rejects a reused key for a different request, and refuses an overlapping period', async () => {
    const again = await settle(staff, { franchiseId: franchiseS.id, periodStart: from, periodEnd: to, supplyValue: 99999, amountDue: 1, grossSales: 5, collections: 5, adjustments: [{ amount: 50, reason: 'Freight' }, { amount: -20, reason: 'Damage credit' }] }, 'set-1')
    assert.equal(again.status, 201); assert.equal(again.json.replayed, true)
    assert.equal(again.json.settlement.id, settlement.id)
    assert.equal((await db.select().from(settlementRecords).where(eq(settlementRecords.franchiseId, franchiseS.id))).length, 1)
    assert.equal((await settle(staff, { franchiseId: franchiseS.id, periodStart: from, periodEnd: from }, 'set-1')).status, 409, 'same key, different request')

    assert.equal((await settle(staff, { franchiseId: franchiseS.id, periodStart: from, periodEnd: to })).status, 409, 'same period')
    assert.equal((await settle(staff, { franchiseId: franchiseS.id, periodStart: shiftDay(from, -5), periodEnd: from })).status, 409, 'overlaps the first day')
    assert.equal((await settle(staff, { franchiseId: franchiseS.id, periodStart: to, periodEnd: to })).status, 409, 'inside')
    // Concurrent overlapping creations: exactly one wins.
    const race = await Promise.all([0, 1, 2].map(() => settle(staff, { franchiseId: franchiseB.id, periodStart: from, periodEnd: to })))
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409, 409])
    // A non-overlapping earlier period is fine (no supply: nothing due, so it is Settled at once); franchise B's period never blocked A.
    const earlier = await settle(staff, { franchiseId: franchiseS.id, periodStart: shiftDay(from, -9), periodEnd: shiftDay(from, -3) })
    assert.equal(earlier.status, 201, JSON.stringify(earlier.json))
    assert.equal(earlier.json.settlement.status, 'Settled'); assert.ok(earlier.json.settlement.settledAt)
  })

  it('validates input and permissions', async () => {
    const bad = (data: Record<string, unknown>) => settle(staff, { franchiseId: franchiseS.id, periodStart: shiftDay(from, -40), periodEnd: shiftDay(from, -39), ...data })
    assert.equal((await bad({ adjustments: [{ amount: 10, reason: '  ' }] })).status, 400, 'reason is mandatory')
    assert.equal((await bad({ adjustments: [{ amount: 10 }] })).status, 400)
    assert.equal((await bad({ adjustments: [{ amount: 0, reason: 'x' }] })).status, 400)
    assert.equal((await bad({ adjustments: [{ amount: 'abc', reason: 'x' }] })).status, 400)
    assert.equal((await bad({ periodStart: '2026-13-01' })).status, 400)
    assert.equal((await bad({ periodEnd: shiftDay(shiftDay(from, -40), -1) })).status, 400, 'end before start')
    assert.equal((await bad({ periodStart: shiftDay(to, 1), periodEnd: shiftDay(to, 2) })).status, 400, 'future period')
    assert.equal((await bad({ adjustments: [{ amount: -50, reason: 'Credit' }] })).status, 409, 'a negative amount due is refused')
    assert.equal((await settle(fsx, { franchiseId: franchiseS.id, periodStart: from, periodEnd: to })).status, 403, 'franchisee cannot create')
    assert.equal((await settlePay(fsx, settlement.id, 1)).status, 403)
    assert.equal((await settle(staff, { franchiseId: '00000000-0000-0000-0000-000000000000', periodStart: from, periodEnd: to })).status, 400)
  })

  it('payments move Open to Partially Settled to Settled; overpayment is refused; replay and concurrency are safe', async () => {
    assert.equal((await settlePay(staff, settlement.id, 0)).status, 400)
    const p1 = await settlePay(staff, settlement.id, 300, 'sp-1')
    assert.equal(p1.status, 201, JSON.stringify(p1.json))
    assert.equal(p1.json.settlement.status, 'Partially Settled'); assert.equal(p1.json.settlement.settledAt, null)
    assert.equal(p1.json.settlement.outstanding, 510)
    assert.equal((await settlePay(staff, settlement.id, 300, 'sp-1')).json.replayed, true)
    assert.equal((await db.select().from(settlementPayments).where(eq(settlementPayments.settlementId, settlement.id))).length, 1)
    assert.equal((await settlePay(staff, settlement.id, 510.01)).status, 409, 'overpayment')
    // Two concurrent payments of 400 against 510 outstanding: only one fits.
    const race = await Promise.all([settlePay(staff, settlement.id, 400), settlePay(staff, settlement.id, 400)])
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409])
    const [mid] = await db.select().from(settlementRecords).where(eq(settlementRecords.id, settlement.id))
    assert.equal(Number(mid.paymentsTotal), 700); assert.equal(mid.status, 'Partially Settled')
    const last = await settlePay(staff, settlement.id, 110)
    assert.equal(last.json.settlement.status, 'Settled'); assert.ok(last.json.settlement.settledAt)
    assert.equal(last.json.settlement.outstanding, 0)
    assert.equal((await settlePay(staff, settlement.id, 0.01)).status, 409, 'nothing left to pay')
    assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'settlement_payment'))).length, 3)
    await assert.rejects(pool.query(`UPDATE settlement_records SET payments_total = amount_due + 1 WHERE id = '${settlement.id}'`), /settlement_records_payments_check/)
  })

  it('a franchisee sees only its own settlements and cannot preview another franchise', async () => {
    const own = await call(settlements, fsx, undefined, 'GET')
    assert.equal(own.status, 200)
    assert.ok(own.json.settlements.length >= 1 && own.json.settlements.every((r: any) => r.franchiseId === franchiseS.id))
    const theirs = await call(settlements, fb, undefined, 'GET')
    assert.ok(theirs.json.settlements.every((r: any) => r.franchiseId === franchiseB.id))
    assert.ok(!theirs.json.settlements.some((r: any) => r.id === settlement.id))
    assert.equal((await preview(fb, franchiseS.id, from, to)).status, 404)
    assert.equal((await preview(fsx, franchiseS.id, from, to)).status, 200)
  })

  it('refuses to settle supply that has no company price instead of guessing', async () => {
    const f = await createFranchise('Franchise C', 'c@w3.local')
    const o = await newOutlet(staff, f.id)
    await db.update(pricingConfigs).set({ status: 'Archived' }).where(eq(pricingConfigs.product, 'Eggs'))
    await stockOutlet(o.id, 'Eggs', 3)
    await db.update(pricingConfigs).set({ status: 'Active' }).where(eq(pricingConfigs.product, 'Eggs'))
    const res = await settle(staff, { franchiseId: f.id, periodStart: from, periodEnd: to })
    assert.equal(res.status, 409); assert.match(res.json.error, /no company price/)
  })

  it('retires the manual settlements record: new and edited rows are refused, old rows stay readable', async () => {
    const [legacy] = await db.insert(records).values({ kind: 'settlements', franchiseId: franchiseS.id, data: { name: 'Old', status: 'Open', settlementAmount: 100 } }).returning()
    const create = await call(operations, admin, { kind: 'settlements', franchiseId: franchiseS.id, data: { name: 'New', status: 'Open', settlementAmount: 5 } })
    assert.equal(create.status, 410)
    const edit = await call(operations, admin, { kind: 'settlements', id: legacy.id, data: { name: 'Old', status: 'Settled', settlementAmount: 100 } }, 'PATCH')
    assert.equal(edit.status, 410)
    const list = await call(operations, admin, undefined, 'GET')
    assert.ok(JSON.stringify(list.json).includes(legacy.id), 'the old row is still readable')
    assert.equal((await call(fulfillment, staff, { action: 'create-settlement', data: { franchiseId: franchiseS.id } })).status, 410)
    // A legacy settlement_records row is read-only for payments.
    const [old] = await db.insert(settlementRecords).values({ franchiseId: franchiseS.id, periodStart: new Date('2020-01-01'), periodEnd: new Date('2020-01-02'), amountDue: '100' }).returning()
    assert.equal((await settlePay(staff, old.id, 10)).status, 409)
    assert.equal((await db.select().from(settlementAdjustments)).length >= 2, true)
  })
})

describe('business date helper (IST, UTC+5:30)', () => {
  it('maps UTC instants to the IST calendar date around 18:30 UTC', () => {
    assert.equal(businessDateOf('2026-10-13T18:29:59.999Z'), '2026-10-13')
    assert.equal(businessDateOf('2026-10-13T18:30:00.000Z'), '2026-10-14')
    assert.equal(businessDateOf('2026-10-13T00:00:00.000Z'), '2026-10-13')
    assert.equal(businessDateOf('2026-12-31T18:30:00.000Z'), '2027-01-01', 'year boundary')
    assert.equal(businessDateOf('2028-02-28T18:30:00.000Z'), '2028-02-29', 'leap day')
    assert.throws(() => businessDateOf('not a date'))
  })
  it('bounds a business date with [18:30 UTC the day before, 18:30 UTC)', () => {
    const { start, end } = businessDayRange('2026-10-14')
    assert.equal(start.toISOString(), '2026-10-13T18:30:00.000Z'); assert.equal(end.toISOString(), '2026-10-14T18:30:00.000Z')
    assert.equal(businessPeriodRange('2026-10-14', '2026-10-15').end.toISOString(), '2026-10-15T18:30:00.000Z')
    assert.equal(businessDateOf(start), '2026-10-14'); assert.equal(businessDateOf(new Date(end.getTime() - 1)), '2026-10-14'); assert.equal(businessDateOf(end), '2026-10-15')
    assert.equal(isBusinessDate('2026-02-30'), false); assert.equal(isBusinessDate('2026-2-3'), false); assert.equal(isBusinessDate('2026-10-13'), true)
  })
})

describe('daily franchise close and HQ KPIs (#14)', () => {
  let fd: { id: string }, fe: { id: string }, fdUser: Actor, feUser: Actor
  let o1: { id: string }, o2: { id: string }, s1: { id: string }, s2: { id: string }
  const date = today()
  const closeDay = (actor: Actor, data: Record<string, unknown>, key?: string) => call(dailyClose, actor, { action: 'close-day', idempotencyKey: key, data: { businessDate: date, ...data } })
  const reopen = (actor: Actor, data: Record<string, unknown>) => call(dailyClose, actor, { action: 'reopen-day', data: { businessDate: date, ...data } })
  const kpiFor = (actor: Actor, query = '') => call(kpi, actor, undefined, 'GET', `?from=${date}&to=${date}${query}`)

  before(async () => {
    fd = await createFranchise('Franchise D', 'd@w3.local'); fe = await createFranchise('Franchise E', 'e@w3.local')
    fdUser = await createUser('franchisee', 'fd@w3.local', { franchiseId: fd.id })
    feUser = await createUser('franchisee', 'fe@w3.local', { franchiseId: fe.id })
  })

  it('closes the day only when every shift is closed, with totals equal to the hand-computed figures', async () => {
    o1 = await newOutlet(fdUser, fd.id); o2 = await newOutlet(fdUser, fd.id)
    await deliver(await supplyChain(fdUser, 20), fd.id, 20, o1.id)
    await deliver(await supplyChain(fdUser, 10), fd.id, 10, o2.id)
    s1 = await openShift(fdUser, o1.id, 100); s2 = await openShift(fdUser, o2.id, 50)
    const customer = await newCustomer(fd.id)
    const first = await sale(fdUser, o1.id, s1.id, [{ product: 'Chicken', quantity: 5 }])                      // cash 500
    await sale(fdUser, o1.id, s1.id, [{ product: 'Chicken', quantity: 4 }], { payments: [{ method: 'UPI' }] })   // upi 400
    const credit = await sale(fdUser, o1.id, s1.id, [{ product: 'Chicken', quantity: 3 }], { customerId: customer.id, payments: [{ method: 'Cash', amount: 100 }, { method: 'Credit', amount: 200 }] })
    await sale(fdUser, o2.id, s2.id, [{ product: 'Chicken', quantity: 2 }], { payments: [{ method: 'Card' }] }) // card 200
    assert.equal((await call(pos, fdUser, { action: 'return-sale', data: { saleId: first.json.sale.id, itemId: first.json.items[0].id, quantity: 1 } })).status, 201) // refund 100 cash
    assert.equal((await call(pos, fdUser, { action: 'collect-receivable', data: { receivableId: credit.json.receivable.id, shiftId: s1.id, amount: 150, method: 'Cash' } })).status, 201)
    assert.equal((await call(pos, fdUser, { action: 'record-wastage', data: { outletId: o1.id, product: 'Chicken', quantity: 1, reason: 'Spoiled' } })).status, 201)
    assert.equal((await call(pos, fdUser, { action: 'count-stock', data: { outletId: o2.id, product: 'Chicken', countedQuantity: 7.5, reason: 'Short' } })).status, 201)

    const refused = await closeDay(fdUser, {})
    assert.equal(refused.status, 409); assert.match(refused.json.error, /2 shift\(s\) are still open/)
    assert.equal((await call(pos, fdUser, { action: 'close-shift', data: { shiftId: s1.id, countedCash: 740 } })).status, 201)
    assert.equal((await closeDay(fdUser, {})).status, 409, 'one shift still open')
    assert.equal((await call(pos, fdUser, { action: 'close-shift', data: { shiftId: s2.id, countedCash: 50 } })).status, 201)

    const res = await closeDay(fdUser, { notes: 'ok' }, 'cd-1')
    assert.equal(res.status, 201, JSON.stringify(res.json))
    const t = res.json.totals
    assert.deepEqual([t.sales.count, t.sales.subtotal, t.sales.tax, t.sales.total], [4, 1400, 0, 1400])
    assert.deepEqual([t.returns.count, t.returns.amount], [1, 100])
    assert.equal(t.creditSales, 200)
    assert.deepEqual(t.collections.posSales, { Cash: 600, UPI: 400, Card: 200 })
    assert.deepEqual(t.collections.refunds, { Cash: 100, UPI: 0, Card: 0 })
    assert.deepEqual(t.collections.receivables, { Cash: 150, UPI: 0, Card: 0 })
    assert.deepEqual(t.collections.total, { Cash: 750, UPI: 400, Card: 200 })
    assert.deepEqual([t.cash.shifts, t.cash.expected, t.cash.counted, t.cash.variance], [2, 800, 790, -10])
    assert.deepEqual([Number(res.json.expectedCash), Number(res.json.countedCash), Number(res.json.cashVariance)], [800, 790, -10])
    assert.deepEqual([t.wastage.quantity, t.wastage.value], [1, 60])
    assert.deepEqual([t.stockVariance.quantity, t.stockVariance.value], [-0.5, -30])
    assert.deepEqual([t.supply.received, t.supply.returned], [1800, 0])
    assert.equal(res.json.status, 'Closed'); assert.equal(res.json.closedBy, fdUser.user.id)
    assert.equal((await closeDay(fdUser, { notes: 'ok' }, 'cd-1')).json.replayed, true)
    assert.equal((await closeDay(fdUser, {})).status, 409, 'already closed')
    assert.equal((await db.select().from(franchiseDailyCloses).where(eq(franchiseDailyCloses.franchiseId, fd.id))).length, 1)
    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'franchise_daily_close'), eq(auditEvents.entityId, res.json.id)))
    assert.deepEqual(audit.map(a => a.action), ['closed']); assert.equal(audit[0].actorUserId, fdUser.user.id)
  })

  it('refuses sales, returns, wastage, counts, adjustments, collections and shift opens once closed; reopening needs staff and a reason', async () => {
    const item = (await db.select().from(posSales).where(eq(posSales.outletId, o1.id)))[0]
    const blocked = async (action: string, data: Record<string, unknown>) => {
      const res = await call(pos, fdUser, { action, data })
      assert.equal(res.status, 409, `${action}: ${JSON.stringify(res.json)}`); assert.match(res.json.error, /closed for this franchise/)
    }
    await blocked('record-sale', { outletId: o1.id, shiftId: s1.id, items: [{ product: 'Chicken', quantity: 1 }] })
    await blocked('open-shift', { outletId: o1.id })
    const [saleItem] = await db.select().from((await import('../db/pos-schema.js')).posSaleItems).where(eq((await import('../db/pos-schema.js')).posSaleItems.saleId, item.id))
    await blocked('return-sale', { saleId: item.id, itemId: saleItem.id, quantity: 0.5 })
    await blocked('record-wastage', { outletId: o1.id, product: 'Chicken', quantity: 1, reason: 'x' })
    await blocked('adjust-stock', { outletId: o1.id, product: 'Chicken', quantityDelta: -1, reason: 'x' })
    await blocked('count-stock', { outletId: o1.id, product: 'Chicken', countedQuantity: 1, reason: 'x' })
    const [rec] = await db.select().from(customerReceivables).where(eq(customerReceivables.franchiseId, fd.id))
    await blocked('collect-receivable', { receivableId: rec.id, shiftId: s1.id, amount: 10 })
    // The same franchise's closed day does not stop another franchise, and a rejected request wrote nothing.
    const oe = await newOutlet(feUser, fe.id)
    await stockOutlet(oe.id, 'Chicken', 5)
    const se = await openShift(feUser, oe.id)
    assert.equal((await sale(feUser, oe.id, se.id, [{ product: 'Chicken', quantity: 1 }])).status, 201)
    assert.equal((await db.select().from(posSales).where(eq(posSales.outletId, o1.id))).length, 3)

    assert.equal((await reopen(fdUser, { franchiseId: fd.id, reason: 'x' })).status, 403, 'a franchisee cannot reopen')
    assert.equal((await reopen(staff, { franchiseId: fd.id })).status, 400, 'a reason is mandatory')
    assert.equal((await reopen(staff, { franchiseId: fd.id, reason: '   ' })).status, 400)
    assert.equal((await reopen(staff, { franchiseId: fe.id, reason: 'not closed' })).status, 409)
    const re = await reopen(staff, { franchiseId: fd.id, reason: 'Missed a late bill' })
    assert.equal(re.status, 200, JSON.stringify(re.json))
    assert.equal(re.json.status, 'Reopened'); assert.equal(re.json.reopenReason, 'Missed a late bill'); assert.equal(re.json.reopenedBy, staff.user.id); assert.equal(re.json.reopenCount, 1)
    const audit = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'franchise_daily_close'), eq(auditEvents.entityId, re.json.id)))
    const reopened = audit.find(a => a.action === 'reopened')!
    assert.equal(reopened.actorUserId, staff.user.id); assert.equal((reopened.metadata as any).reason, 'Missed a late bill')
    assert.equal((await reopen(staff, { franchiseId: fd.id, reason: 'again' })).status, 409, 'already open')

    // Selling works again; then the day is closed again with the new figures.
    const late = await sale(fdUser, o1.id, s1.id, [{ product: 'Chicken', quantity: 1 }])
    assert.equal(late.status, 400, 'shift 1 was closed, so a sale needs a new shift')
    const s3 = await openShift(fdUser, o1.id, 0)
    assert.equal((await sale(fdUser, o1.id, s3.id, [{ product: 'Chicken', quantity: 1 }])).status, 201)
    assert.equal((await closeDay(fdUser, {})).status, 409, 'the new shift is open')
    assert.equal((await call(pos, fdUser, { action: 'close-shift', data: { shiftId: s3.id, countedCash: 100 } })).status, 201)
    const again = await closeDay(staff, { franchiseId: fd.id })
    assert.equal(again.status, 201, JSON.stringify(again.json))
    assert.deepEqual([again.json.totals.sales.count, again.json.totals.sales.total], [5, 1500])
    assert.equal(again.json.closedBy, staff.user.id, 'company staff can sign off')
    assert.equal(again.json.id, re.json.id, 'one record per franchise and date')
    assert.deepEqual((await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, 'franchise_daily_close'), eq(auditEvents.entityId, re.json.id))).orderBy(auditEvents.createdAt)).map(a => a.action).sort(), ['closed', 'reclosed', 'reopened'])
  })

  it('validates the close request and keeps franchises apart', async () => {
    assert.equal((await closeDay(staff, { franchiseId: fd.id, businessDate: '2026-02-30' })).status, 400)
    assert.equal((await closeDay(staff, { franchiseId: fd.id, businessDate: shiftDay(date, 1) })).status, 400, 'future day')
    assert.equal((await closeDay(staff, {})).status, 400, 'staff must name the franchise')
    assert.equal((await closeDay(feUser, { franchiseId: fd.id })).status, 404, 'franchise E cannot close franchise D')
    const own = await call(dailyClose, feUser, undefined, 'GET')
    assert.equal(own.status, 200); assert.ok(own.json.closes.every((c: any) => c.franchiseId === fe.id))
    assert.equal((await call(dailyClose, feUser, undefined, 'GET', `?franchiseId=${fd.id}`)).status, 404)
    const all = await call(dailyClose, staff, undefined, 'GET')
    assert.ok(all.json.closes.some((c: any) => c.franchiseId === fd.id))
  })

  it('reports KPIs equal to the hand-computed figures and nothing from another franchise', async () => {
    // Day figures now: 5 sales (1500), 1 return (100), cost 6 kg + ... sold 15 kg x 60 = 900, returned 1 kg x 60.
    const res = await kpiFor(staff, `&franchiseId=${fd.id}`)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const k = res.json.franchises[0]
    assert.equal(res.json.franchises.length, 1); assert.equal(k.franchiseId, fd.id)
    assert.deepEqual([k.sales.count, k.sales.total, k.sales.returns, k.sales.net, k.sales.revenueExTax, k.sales.creditSales], [5, 1500, 100, 1400, 1400, 200])
    assert.equal(k.cogs, 840); assert.equal(k.cogsComplete, true)       // 15 kg x 60 - 1 kg x 60
    assert.equal(k.grossMargin, 560); assert.equal(k.grossMarginPct, 40)  // 1400 - 840
    assert.deepEqual([k.wastage.quantity, k.wastage.value], [1, 60])
    assert.deepEqual([k.stockVariance.quantity, k.stockVariance.value], [-0.5, -30])
    assert.deepEqual(k.collections.total, { Cash: 850, UPI: 400, Card: 200 }) // + the late 100 cash sale
    assert.deepEqual(k.customerReceivablesOutstanding, { count: 1, balance: 50 })
    assert.equal(k.deliveryCost, null)
    assert.equal(k.owesCompany.unbilledSupply, 1800); assert.equal(k.owesCompany.total, 1800); assert.equal(k.owesCompany.settlementsOutstanding, 0)

    // What the franchise owes the company: a settlement for today with one adjustment, then a payment.
    const set = await settle(staff, { franchiseId: fd.id, periodStart: date, periodEnd: date, adjustments: [{ amount: 100, reason: 'Late fee' }] })
    assert.equal(set.status, 201, JSON.stringify(set.json))
    assert.equal(Number(set.json.settlement.amountDue), 1900)
    assert.equal((await settlePay(staff, set.json.settlement.id, 500)).status, 201)
    const after = (await kpiFor(staff, `&franchiseId=${fd.id}`)).json.franchises[0]
    assert.deepEqual([after.owesCompany.settlementsOutstanding, after.owesCompany.unbilledSupply, after.owesCompany.total], [1400, 0, 1400])
    assert.equal(after.customerReceivablesOutstanding.balance, 50, 'customer receivables do not reduce what the franchise owes the company')

    // Staff see every franchise with totals; a franchisee sees only their own and no totals.
    const everyone = await kpiFor(staff)
    assert.ok(everyone.json.franchises.length >= 2 && everyone.json.franchises.some((f: any) => f.franchiseId === fd.id) && everyone.json.franchises.some((f: any) => f.franchiseId === fe.id))
    assert.ok(everyone.json.totals.salesTotal >= 1500)
    const fromE = await kpiFor(feUser)
    assert.deepEqual(fromE.json.franchises.map((f: any) => f.franchiseId), [fe.id]); assert.equal(fromE.json.totals, undefined)
    assert.equal(fromE.json.franchises[0].sales.total, 100, "E's own single 100 sale only")
    assert.equal((await kpiFor(feUser, `&franchiseId=${fd.id}`)).status, 404, 'franchise B cannot read franchise A')
    assert.ok(!JSON.stringify(fromE.json).includes(fd.id))
    assert.equal((await call(kpi, feUser, undefined, 'GET', '?from=2026-13-01&to=2026-13-02')).status, 400)
    assert.equal((await call(kpi, null, undefined, 'GET', `?from=${date}&to=${date}`)).status, 401)
  })

  it('assigns sales, shifts and supply to IST days exactly at 18:30 UTC', async () => {
    const f = await createFranchise('Franchise IST', 'ist@w3.local')
    const u = await createUser('staff', 'ist-staff@w3.local')
    const [outlet] = await db.insert(posOutlets).values({ franchiseId: f.id, code: 'IST-1', name: 'IST outlet' }).returning()
    const [shiftA] = await db.insert(posShifts).values({ outletId: outlet.id, cashierId: u.user.id, openedAt: new Date('2026-01-10T18:29:59.000Z'), status: 'Closed', expectedCash: '10', countedCash: '10' }).returning()
    const [shiftB] = await db.insert(posShifts).values({ outletId: outlet.id, cashierId: u.user.id, openedAt: new Date('2026-01-10T18:30:00.000Z'), status: 'Closed', expectedCash: '20', countedCash: '25' }).returning()
    await db.insert(posSales).values([
      { outletId: outlet.id, shiftId: shiftA.id, billNumber: 'IST-A', cashierId: u.user.id, subtotal: '100', total: '100', soldAt: new Date('2026-01-10T18:29:59.999Z') },
      { outletId: outlet.id, shiftId: shiftB.id, billNumber: 'IST-B', cashierId: u.user.id, subtotal: '300', total: '300', soldAt: new Date('2026-01-10T18:30:00.000Z') },
    ])
    const [lot] = await db.insert(stockLots).values({ product: 'Chicken', quantity: '0', unit: 'kg', batchCode: 'IST-LOT', status: 'Depleted', franchiseId: f.id, posOutletId: outlet.id, unitCost: '10' }).returning()
    await db.insert(outletStockLedger).values([
      { outletId: outlet.id, franchiseId: f.id, product: 'Chicken', stockLotId: lot.id, movementType: 'SupplyIn', quantity: '1', unitCost: '10', createdAt: new Date('2026-01-10T18:29:59.999Z') },
      { outletId: outlet.id, franchiseId: f.id, product: 'Chicken', stockLotId: lot.id, movementType: 'SupplyIn', quantity: '2', unitCost: '10', createdAt: new Date('2026-01-10T18:30:00.000Z') },
    ])
    const close = (businessDate: string) => call(dailyClose, u, { action: 'close-day', data: { franchiseId: f.id, businessDate } })
    const d10 = await close('2026-01-10'), d11 = await close('2026-01-11')
    assert.equal(d10.status, 201, JSON.stringify(d10.json)); assert.equal(d11.status, 201, JSON.stringify(d11.json))
    assert.deepEqual([d10.json.totals.sales.total, d10.json.totals.sales.count, d10.json.totals.cash.expected, d10.json.totals.supply.received], [100, 1, 10, 10], '18:29:59.999Z is still 10 Jan IST')
    assert.deepEqual([d11.json.totals.sales.total, d11.json.totals.sales.count, d11.json.totals.cash.expected, d11.json.totals.cash.variance, d11.json.totals.supply.received], [300, 1, 20, 5, 20], '18:30:00.000Z is 11 Jan IST')
    // A settlement over the two days takes both; over only 10 Jan it takes the first movement only.
    const single = await call(settlements, u, undefined, 'GET', `?franchiseId=${f.id}&from=2026-01-10&to=2026-01-10`)
    assert.equal(single.json.supplyValue, 10)
    const both = await call(settlements, u, undefined, 'GET', `?franchiseId=${f.id}&from=2026-01-10&to=2026-01-11`)
    assert.equal(both.json.supplyValue, 30)
  })
})
