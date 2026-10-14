// Server-only helpers for the unified outlet stock ledger (outlet_stock_ledger).
//
// One ledger per outlet is the single source of truth for sellable stock. Every inflow
// (supply receipt, stock transfer, positive adjustment/count, return restock) is a positive
// `quantity`; every outflow (sale, wastage, negative adjustment/count, transfer out) is negative.
// Availability is ALWAYS the sum of movement quantities, never `balance_after`
// (balance_after is only a convenience snapshot written at insert time).
//
// Callers MUST hold the `pos_outlets` row lock (SELECT ... FOR UPDATE) for the outlet inside the
// same transaction before reading availability and posting movements, so concurrent writers serialize.
import { and, eq, sql } from 'drizzle-orm'
import { db } from './index.js'
import { stockLots } from './schema.js'
import { outletStockLedger } from './pos-schema.js'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type Allocation = { lotId: string | null; quantity: number }

const EPS = 0.000001
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export const stockOutflowTypes = ['Sale', 'Wastage', 'TransferOut'] as const

/** Net movement quantity per stock lot (null lot = stock not tied to a lot), oldest lot first. */
export async function lotBuckets(tx: Tx, outletId: string, product: string): Promise<Allocation[]> {
  const rows = await tx.select({
    lotId: outletStockLedger.stockLotId,
    quantity: sql<string>`coalesce(sum(${outletStockLedger.quantity}), 0)`,
    lotCreatedAt: sql<Date | null>`min(${stockLots.createdAt})`,
  }).from(outletStockLedger)
    .leftJoin(stockLots, eq(stockLots.id, outletStockLedger.stockLotId))
    .where(and(eq(outletStockLedger.outletId, outletId), eq(outletStockLedger.product, product)))
    .groupBy(outletStockLedger.stockLotId)
  return rows
    .map(r => ({ lotId: r.lotId, quantity: num(r.quantity), at: r.lotCreatedAt ? new Date(r.lotCreatedAt).getTime() : Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.at - b.at)
    .map(({ lotId, quantity }) => ({ lotId, quantity }))
}

/** Total available quantity for the product at the outlet: the sum of all movement quantities. */
export async function outletBalance(tx: Tx, outletId: string, product: string): Promise<number> {
  const [row] = await tx.select({ total: sql<string>`coalesce(sum(${outletStockLedger.quantity}), 0)` }).from(outletStockLedger)
    .where(and(eq(outletStockLedger.outletId, outletId), eq(outletStockLedger.product, product)))
  return num(row?.total)
}

/**
 * FIFO allocation of an outflow across lots (oldest lot first, un-lotted stock last).
 * Legacy rows may leave a negative bucket (e.g. an old sale posted without a lot while the credit
 * carried one); that deficit is absorbed by the oldest positive buckets so the allocatable total
 * always equals the true ledger balance.
 * Throws "Insufficient outlet stock ..." when the request exceeds what is available.
 */
export async function allocateFifo(tx: Tx, outletId: string, product: string, quantity: number): Promise<Allocation[]> {
  const buckets = await lotBuckets(tx, outletId, product)
  let deficit = buckets.filter(b => b.quantity < 0).reduce((a, b) => a - b.quantity, 0)
  const out: Allocation[] = []
  let remaining = quantity
  let available = 0
  for (const b of buckets) {
    if (b.quantity <= EPS) continue
    let usable = b.quantity
    if (deficit > EPS) { const absorbed = Math.min(deficit, usable); usable -= absorbed; deficit -= absorbed }
    available += usable
    if (usable <= EPS || remaining <= EPS) continue
    const take = Math.min(usable, remaining)
    out.push({ lotId: b.lotId, quantity: take })
    remaining -= take
  }
  if (remaining > EPS) throw new Error(`Insufficient outlet stock for ${product}. Available: ${Math.round(available * 1000) / 1000}; requested: ${quantity}.`)
  return out
}

export type MovementInput = {
  outletId: string
  product: string
  stockLotId?: string | null
  movementType: string
  /** Signed: positive credits the outlet, negative debits it. */
  quantity: number
  referenceType?: string | null
  referenceId?: string | null
  supplyRequestId?: string | null
  purchaseOrderId?: string | null
  goodsReceiptId?: string | null
  transferGroupId?: string | null
  reason?: string | null
  createdBy: string
}

/** Appends one movement row; balance_after is derived from the summed ledger at insert time. */
export async function postMovement(tx: Tx, m: MovementInput) {
  const balance = await outletBalance(tx, m.outletId, m.product)
  const [row] = await tx.insert(outletStockLedger).values({
    outletId: m.outletId, product: m.product, stockLotId: m.stockLotId ?? null,
    movementType: m.movementType, quantity: String(m.quantity),
    referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null,
    supplyRequestId: m.supplyRequestId ?? null, purchaseOrderId: m.purchaseOrderId ?? null,
    goodsReceiptId: m.goodsReceiptId ?? null, transferGroupId: m.transferGroupId ?? null,
    reason: m.reason ?? null,
    balanceAfter: String(balance + m.quantity), createdBy: m.createdBy,
  }).returning()
  return row
}

/** Debits the outlet FIFO and posts one negative movement per lot allocation. */
export async function debitFifo(tx: Tx, base: Omit<MovementInput, 'quantity' | 'stockLotId'> & { quantity: number }) {
  const allocations = await allocateFifo(tx, base.outletId, base.product, Math.abs(base.quantity))
  const rows = []
  for (const a of allocations) rows.push(await postMovement(tx, { ...base, stockLotId: a.lotId, quantity: -a.quantity }))
  return { allocations, rows }
}
