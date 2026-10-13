import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { db, pool } from './helpers/test-db.js'
import { call, createFranchise, createUser, resetDatabase, seedPrices } from './helpers/harness.js'
import type { Actor } from './helpers/harness.js'
import { auditEvents, customers, invoiceRecords, stockLots } from '../db/schema.js'
import { pricingConfigs } from '../db/pricing-schema.js'
import { customerReceivables, posSales, posShifts, receivablePayments } from '../db/pos-schema.js'
import pos from '../netlify/functions/pos.mts'

let staff: Actor, fa: Actor, fb: Actor
let franchiseA: { id: string }, franchiseB: { id: string }
let codeSeq = 0

before(async () => {
  await resetDatabase()
  await seedPrices()
  staff = await createUser('staff', 'staff@w3.local')
  franchiseA = await createFranchise('Franchise A', 'a@w3.local')
  franchiseB = await createFranchise('Franchise B', 'b@w3.local')
  fa = await createUser('franchisee', 'fa@w3.local', { franchiseId: franchiseA.id })
  fb = await createUser('franchisee', 'fb@w3.local', { franchiseId: franchiseB.id })
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
