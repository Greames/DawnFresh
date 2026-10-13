import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { outletStockLedger } from './pos-schema.js'
import { settlementRecords } from './schema.js'
import { businessPeriodRange } from '../src/lib/business.js'
import type { Tx } from './tx.js'

export type SupplyTotals = { supplyValue: number; returnsValue: number; supplyMovements: number; returnMovements: number; uncostedMovements: number }

const SUPPLY_IN = ['SupplyIn', 'TransferIn']
const SUPPLY_MOVES = [...SUPPLY_IN, 'SupplyReturn']

/**
 * Supply value for a franchise over inclusive IST business dates, straight from the stock ledger:
 *   supply value  = sum(quantity x unit_cost) over SupplyIn and TransferIn rows (company stock received by the franchise's outlets)
 *   returns value = sum(-quantity x unit_cost) over SupplyReturn rows (stock sent back to the company)
 * unit_cost is the company price carried by the lot when it was cut from company stock. Rows without a cost are
 * counted, never valued at a guess; callers must refuse to settle while any exist.
 */
export async function supplyTotals(tx: Tx, franchiseId: string, from: string, to: string): Promise<SupplyTotals> {
  const { start, end } = businessPeriodRange(from, to)
  const [row] = await tx.select({
    supplyValue: sql<string>`coalesce(sum(case when ${outletStockLedger.movementType} in ('SupplyIn', 'TransferIn') then ${outletStockLedger.quantity} * ${outletStockLedger.unitCost} else 0 end), 0)`,
    returnsValue: sql<string>`coalesce(sum(case when ${outletStockLedger.movementType} = 'SupplyReturn' then -${outletStockLedger.quantity} * ${outletStockLedger.unitCost} else 0 end), 0)`,
    supplyMovements: sql<string>`count(*) filter (where ${outletStockLedger.movementType} in ('SupplyIn', 'TransferIn'))`,
    returnMovements: sql<string>`count(*) filter (where ${outletStockLedger.movementType} = 'SupplyReturn')`,
    uncostedMovements: sql<string>`count(*) filter (where ${outletStockLedger.unitCost} is null)`,
  }).from(outletStockLedger).where(and(
    eq(outletStockLedger.franchiseId, franchiseId), inArray(outletStockLedger.movementType, SUPPLY_MOVES),
    gte(outletStockLedger.createdAt, start), lt(outletStockLedger.createdAt, end),
  ))
  const money = (v: string) => Math.round(Number(v) * 100) / 100
  return { supplyValue: money(row.supplyValue), returnsValue: money(row.returnsValue), supplyMovements: Number(row.supplyMovements), returnMovements: Number(row.returnMovements), uncostedMovements: Number(row.uncostedMovements) }
}

/**
 * What a franchise owes the company right now, from ledgers only:
 *   outstanding on derived settlements that are not Settled (amount due - payments)
 * + net value of supply movements (received - returned) that no settlement period covers yet.
 * The franchise's own customer receivables are deliberately absent. Uncosted movements are counted, not valued.
 */
export async function owedToCompany(tx: Tx, franchiseId: string) {
  const [open] = await tx.select({ outstanding: sql<string>`coalesce(sum(${settlementRecords.amountDue} - ${settlementRecords.paymentsTotal}), 0)`, count: sql<string>`count(*)` })
    .from(settlementRecords).where(and(eq(settlementRecords.franchiseId, franchiseId), eq(settlementRecords.derived, true), sql`${settlementRecords.status} <> 'Settled'`))
  const [unsettled] = await tx.select({
    received: sql<string>`coalesce(sum(case when ${outletStockLedger.movementType} in ('SupplyIn', 'TransferIn') then ${outletStockLedger.quantity} * ${outletStockLedger.unitCost} else 0 end), 0)`,
    returned: sql<string>`coalesce(sum(case when ${outletStockLedger.movementType} = 'SupplyReturn' then -${outletStockLedger.quantity} * ${outletStockLedger.unitCost} else 0 end), 0)`,
    uncosted: sql<string>`count(*) filter (where ${outletStockLedger.unitCost} is null)`,
  }).from(outletStockLedger).where(and(
    eq(outletStockLedger.franchiseId, franchiseId), inArray(outletStockLedger.movementType, SUPPLY_MOVES),
    sql`not exists (select 1 from ${settlementRecords} s where s.franchise_id = ${outletStockLedger.franchiseId} and (${outletStockLedger.createdAt} at time zone 'Asia/Kolkata')::date between s.period_start_date and s.period_end_date)`,
  ))
  const r2 = (v: string) => Math.round(Number(v) * 100) / 100
  const settlementsOutstanding = r2(open.outstanding), unbilledSupply = Math.round((r2(unsettled.received) - r2(unsettled.returned)) * 100) / 100
  return { settlementsOutstanding, openSettlements: Number(open.count), unbilledSupply, unbilledUncostedMovements: Number(unsettled.uncosted), total: Math.round((settlementsOutstanding + unbilledSupply) * 100) / 100 }
}
