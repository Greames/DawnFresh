import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { franchiseDailyCloses } from './schema.js'
import { customerReceivables, outletStockLedger, posOutlets, posPayments, posReturns, posSaleItems, posSales, posShifts, receivablePayments } from './pos-schema.js'
import { Rejection } from './tx.js'
import type { Tx } from './tx.js'
import { supplyTotals } from './settlement.js'
import { businessDateOf, businessDayRange, businessPeriodRange } from '../src/lib/business.js'

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

/**
 * Serializes a franchise's business day. Sales, returns, wastage, counts, adjustments, collections and shift opens
 * take the shared lock; closing or reopening the day takes the exclusive one, so a sale can never slip in beside a
 * sign-off. Always the first lock a request takes (before shift, balance or lot rows).
 */
export async function lockBusinessDay(tx: Tx, franchiseId: string | null, date: string, mode: 'shared' | 'exclusive') {
  if (!franchiseId) return
  const key = `day:${franchiseId}:${date}`
  if (mode === 'shared') await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${key}))`)
  else await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

/** Takes the shared day lock for today's IST business date and refuses when the franchise has closed it. Company-direct (null) is never closed. */
export async function guardBusinessDay(tx: Tx, franchiseId: string | null) {
  if (!franchiseId) return
  const date = businessDateOf(new Date())
  await lockBusinessDay(tx, franchiseId, date, 'shared')
  const [close] = await tx.select({ status: franchiseDailyCloses.status }).from(franchiseDailyCloses)
    .where(and(eq(franchiseDailyCloses.franchiseId, franchiseId), eq(franchiseDailyCloses.businessDate, date)))
  if (close?.status === 'Closed') throw new Rejection(409, `The business day ${date} is closed for this franchise. Company staff can reopen it with a reason.`)
}

export type MethodTotals = { Cash: number; UPI: number; Card: number }
export type WindowFigures = {
  sales: { count: number; subtotal: number; discount: number; tax: number; total: number }
  returns: { count: number; amount: number; amountExTax: number; costValue: number; uncostedQuantity: number }
  creditSales: number
  collections: { posSales: MethodTotals; receivables: MethodTotals; total: MethodTotals; refunds: MethodTotals }
  cogs: { soldCost: number; uncostedQuantity: number }
  wastage: { quantity: number; value: number; uncostedMovements: number }
  stockVariance: { quantity: number; value: number; uncostedMovements: number }
  supply: { received: number; returned: number; uncostedMovements: number }
}

const zeroMethods = (): MethodTotals => ({ Cash: 0, UPI: 0, Card: 0 })

/**
 * Everything the daily close and the KPIs derive from ledgers for one franchise over [start, end), never from client
 * numbers. Each figure's date is the IST business date of its own timestamp (sold_at, created_at, received_at).
 */
export async function windowFigures(tx: Tx, franchiseId: string, from: string, to: string): Promise<WindowFigures> {
  const { start, end } = businessPeriodRange(from, to)
  const inOutlet = eq(posOutlets.franchiseId, franchiseId)

  const [sales] = await tx.select({
    count: sql<string>`count(*)`, subtotal: sql<string>`coalesce(sum(${posSales.subtotal}), 0)`, discount: sql<string>`coalesce(sum(${posSales.discount}), 0)`,
    tax: sql<string>`coalesce(sum(${posSales.tax}), 0)`, total: sql<string>`coalesce(sum(${posSales.total}), 0)`,
  }).from(posSales).innerJoin(posOutlets, eq(posSales.outletId, posOutlets.id)).where(and(inOutlet, gte(posSales.soldAt, start), lt(posSales.soldAt, end)))

  const [returns] = await tx.select({
    count: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${posReturns.amount}), 0)`,
    exTax: sql<string>`coalesce(sum(${posReturns.quantity} * ${posSaleItems.unitPrice} - ${posSaleItems.discount} * ${posReturns.quantity} / ${posSaleItems.quantity}), 0)`,
    cost: sql<string>`coalesce(sum(${posReturns.quantity} * ${posSaleItems.unitCost}), 0)`,
    uncosted: sql<string>`coalesce(sum(${posReturns.quantity}) filter (where ${posSaleItems.unitCost} is null), 0)`,
  }).from(posReturns).innerJoin(posSaleItems, eq(posReturns.itemId, posSaleItems.id)).innerJoin(posSales, eq(posReturns.saleId, posSales.id))
    .innerJoin(posOutlets, eq(posSales.outletId, posOutlets.id)).where(and(inOutlet, gte(posReturns.createdAt, start), lt(posReturns.createdAt, end)))

  const [soldCost] = await tx.select({
    cost: sql<string>`coalesce(sum(${posSaleItems.quantity} * ${posSaleItems.unitCost}), 0)`,
    uncosted: sql<string>`coalesce(sum(${posSaleItems.quantity}) filter (where ${posSaleItems.unitCost} is null), 0)`,
  }).from(posSaleItems).innerJoin(posSales, eq(posSaleItems.saleId, posSales.id)).innerJoin(posOutlets, eq(posSales.outletId, posOutlets.id))
    .where(and(inOutlet, gte(posSales.soldAt, start), lt(posSales.soldAt, end)))

  const payments = await tx.select({ method: posPayments.method, positive: sql<string>`coalesce(sum(case when ${posPayments.amount} > 0 then ${posPayments.amount} else 0 end), 0)`, negative: sql<string>`coalesce(sum(case when ${posPayments.amount} < 0 then -${posPayments.amount} else 0 end), 0)` })
    .from(posPayments).innerJoin(posSales, eq(posPayments.saleId, posSales.id)).innerJoin(posOutlets, eq(posSales.outletId, posOutlets.id))
    .where(and(inOutlet, gte(posPayments.receivedAt, start), lt(posPayments.receivedAt, end))).groupBy(posPayments.method)
  const posSalesByMethod = zeroMethods(), refunds = zeroMethods()
  let creditSales = 0
  for (const p of payments) {
    if (p.method === 'Credit') creditSales = r2(creditSales + num(p.positive))
    else if (p.method in posSalesByMethod) { posSalesByMethod[p.method as keyof MethodTotals] = r2(num(p.positive)); refunds[p.method as keyof MethodTotals] = r2(num(p.negative)) }
  }
  const receivableRows = await tx.select({ method: receivablePayments.method, amount: sql<string>`coalesce(sum(${receivablePayments.amount}), 0)` }).from(receivablePayments)
    .where(and(eq(receivablePayments.franchiseId, franchiseId), gte(receivablePayments.receivedAt, start), lt(receivablePayments.receivedAt, end))).groupBy(receivablePayments.method)
  const receivables = zeroMethods()
  for (const r of receivableRows) if (r.method in receivables) receivables[r.method as keyof MethodTotals] = r2(num(r.amount))
  const total = zeroMethods()
  for (const m of ['Cash', 'UPI', 'Card'] as const) total[m] = r2(posSalesByMethod[m] + receivables[m])

  const ledgerWhere = (type: string) => and(eq(outletStockLedger.franchiseId, franchiseId), eq(outletStockLedger.movementType, type), gte(outletStockLedger.createdAt, start), lt(outletStockLedger.createdAt, end))
  const [wastage] = await tx.select({
    quantity: sql<string>`coalesce(sum(-${outletStockLedger.quantity}), 0)`, value: sql<string>`coalesce(sum(-${outletStockLedger.quantity} * ${outletStockLedger.unitCost}), 0)`,
    uncosted: sql<string>`count(*) filter (where ${outletStockLedger.unitCost} is null)`,
  }).from(outletStockLedger).where(ledgerWhere('Wastage'))
  const [variance] = await tx.select({
    quantity: sql<string>`coalesce(sum(${outletStockLedger.quantity}), 0)`, value: sql<string>`coalesce(sum(${outletStockLedger.quantity} * ${outletStockLedger.unitCost}), 0)`,
    uncosted: sql<string>`count(*) filter (where ${outletStockLedger.unitCost} is null)`,
  }).from(outletStockLedger).where(ledgerWhere('Count'))
  const supply = await supplyTotals(tx, franchiseId, from, to)

  return {
    sales: { count: Number(sales.count), subtotal: r2(num(sales.subtotal)), discount: r2(num(sales.discount)), tax: r2(num(sales.tax)), total: r2(num(sales.total)) },
    returns: { count: Number(returns.count), amount: r2(num(returns.amount)), amountExTax: r2(num(returns.exTax)), costValue: r2(num(returns.cost)), uncostedQuantity: r3(num(returns.uncosted)) },
    creditSales,
    collections: { posSales: posSalesByMethod, receivables, total, refunds },
    cogs: { soldCost: r2(num(soldCost.cost)), uncostedQuantity: r3(num(soldCost.uncosted)) },
    wastage: { quantity: r3(num(wastage.quantity)), value: r2(num(wastage.value)), uncostedMovements: Number(wastage.uncosted) },
    stockVariance: { quantity: r3(num(variance.quantity)), value: r2(num(variance.value)), uncostedMovements: Number(variance.uncosted) },
    supply: { received: supply.supplyValue, returned: supply.returnsValue, uncostedMovements: supply.uncostedMovements },
  }
}

/** Cash for the shifts opened on the IST business date: expected (opening + cash taken - cash refunded + cash collected on receivables) versus counted at shift close. */
export async function cashForDay(tx: Tx, franchiseId: string, date: string) {
  const { start, end } = businessDayRange(date)
  const rows = await tx.select({ expected: sql<string>`coalesce(sum(${posShifts.expectedCash}), 0)`, counted: sql<string>`coalesce(sum(${posShifts.countedCash}), 0)`, shifts: sql<string>`count(*)` })
    .from(posShifts).innerJoin(posOutlets, eq(posShifts.outletId, posOutlets.id)).where(and(eq(posOutlets.franchiseId, franchiseId), gte(posShifts.openedAt, start), lt(posShifts.openedAt, end)))
  const expected = r2(num(rows[0].expected)), counted = r2(num(rows[0].counted))
  return { shifts: Number(rows[0].shifts), expected, counted, variance: r2(counted - expected) }
}

/** Open (unclosed) shifts of the franchise's outlets, of any date: the daily close refuses while one exists. */
export async function openShiftsOf(tx: Tx, franchiseId: string) {
  return tx.select({ id: posShifts.id, outletId: posShifts.outletId }).from(posShifts).innerJoin(posOutlets, eq(posShifts.outletId, posOutlets.id))
    .where(and(eq(posOutlets.franchiseId, franchiseId), eq(posShifts.status, 'Open')))
}

/** Customer receivables still open for a franchise, as at the time of the query. */
export async function openReceivables(tx: Tx, franchiseId: string) {
  const [row] = await tx.select({ count: sql<string>`count(*)`, balance: sql<string>`coalesce(sum(${customerReceivables.originalAmount} - ${customerReceivables.returnedAmount} - ${customerReceivables.paidAmount}), 0)` })
    .from(customerReceivables).where(and(eq(customerReceivables.franchiseId, franchiseId), sql`${customerReceivables.status} <> 'Paid'`))
  return { count: Number(row.count), balance: r2(num(row.balance)) }
}
