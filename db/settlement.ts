import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { outletStockLedger } from './pos-schema.js'
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
