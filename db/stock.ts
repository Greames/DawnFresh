import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { stockLots } from './schema.js'
import { outletStockLedger, posOutlets, stockBalances } from './pos-schema.js'
import { Rejection } from './tx.js'
import type { Tx } from './tx.js'

/**
 * The unified stock model.
 *
 * - Company stock lives in stock_lots with franchise_id and pos_outlet_id both null. It has no ledger of its own.
 * - Everything held by an outlet (company-direct or franchise) is a lot with pos_outlet_id set, and every change to
 *   it is a row in outlet_stock_ledger. A franchise's stock is the sum of its outlets.
 * - stock_balances has one row per outlet and product. Locking that row (SELECT ... FOR UPDATE) serializes every
 *   movement for the pair, so a balance is read and written under the lock and two sales can never both spend the
 *   same stock. Lot rows are locked after the balance row, always in that order, so locks cannot deadlock.
 * - Invariant, asserted in tests: balance = sum of the outlet's lots for the product = last ledger balance_after
 *   = sum of signed ledger quantities.
 */

export const PRODUCTS = ['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns']
export const EPS = 0.0005
export const r3 = (x: number) => Math.round(x * 1000) / 1000
export const r2 = (x: number) => Math.round(x * 100) / 100
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export type MovementType = 'SupplyIn' | 'TransferIn' | 'Return' | 'Sale' | 'Wastage' | 'Adjustment' | 'Count'
export type LotRow = typeof stockLots.$inferSelect
export type OutletRow = typeof posOutlets.$inferSelect

export type MovementRefs = {
  referenceType?: string | null
  referenceId?: string | null
  saleId?: string | null
  supplyRequestId?: string | null
  purchaseOrderId?: string | null
  goodsReceiptId?: string | null
  reason?: string | null
}

/** Creates the balance row if needed, then locks it and returns the quantity. */
export async function lockBalance(tx: Tx, outletId: string, product: string): Promise<number> {
  await tx.insert(stockBalances).values({ outletId, product }).onConflictDoNothing()
  const [row] = await tx.select().from(stockBalances)
    .where(and(eq(stockBalances.outletId, outletId), eq(stockBalances.product, product))).for('update')
  return num(row.quantity)
}

/**
 * Posts one signed movement to an outlet lot and the ledger. Locks the balance row, then the lot row; refuses to
 * take the balance or the lot below zero (the CHECK constraints are the second line of defence).
 */
export async function moveStock(tx: Tx, m: MovementRefs & {
  outletId: string
  franchiseId: string | null
  product: string
  lotId: string
  type: MovementType
  quantity: number
  actor: string
  blockExpired?: boolean
}) {
  const q = r3(m.quantity)
  const balance = await lockBalance(tx, m.outletId, m.product)
  const nextBalance = r3(balance + q)
  if (nextBalance < -EPS) throw new Rejection(409, `Insufficient outlet stock for ${m.product}.`)
  const [lot] = await tx.select().from(stockLots).where(eq(stockLots.id, m.lotId)).for('update')
  if (!lot || lot.posOutletId !== m.outletId || lot.product !== m.product) throw new Rejection(400, 'The stock lot does not belong to this outlet and product.')
  if (m.blockExpired && lot.expiryAt && lot.expiryAt.getTime() < Date.now()) throw new Rejection(409, `Stock lot ${lot.batchCode} has expired.`)
  const nextLot = r3(num(lot.quantity) + q)
  if (nextLot < -EPS) throw new Rejection(409, `Insufficient stock in lot ${lot.batchCode}.`)
  const lotQuantity = Math.max(0, nextLot)
  await tx.update(stockLots).set({ quantity: lotQuantity.toFixed(3), status: lotQuantity > EPS ? 'Available' : 'Depleted', updatedAt: new Date() }).where(eq(stockLots.id, lot.id))
  const stored = Math.max(0, nextBalance)
  await tx.update(stockBalances).set({ quantity: stored.toFixed(3), updatedAt: new Date() })
    .where(and(eq(stockBalances.outletId, m.outletId), eq(stockBalances.product, m.product)))
  const [row] = await tx.insert(outletStockLedger).values({
    outletId: m.outletId, franchiseId: m.franchiseId, product: m.product, stockLotId: lot.id, movementType: m.type,
    quantity: q.toFixed(3), balanceAfter: stored.toFixed(3), createdBy: m.actor,
    referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, saleId: m.saleId ?? null,
    supplyRequestId: m.supplyRequestId ?? null, purchaseOrderId: m.purchaseOrderId ?? null,
    goodsReceiptId: m.goodsReceiptId ?? null, reason: m.reason ?? null, unitCost: lot.unitCost,
  }).returning()
  return row
}

/** Creates an empty lot held by the outlet. Put stock into it with moveStock. */
export async function createOutletLot(tx: Tx, a: { outlet: OutletRow; product: string; unit?: string; batchCode: string; expiryAt?: Date | null; parentLotId?: string | null; unitCost?: string | null }) {
  const [lot] = await tx.insert(stockLots).values({
    product: a.product, quantity: '0', unit: a.unit || 'kg', stage: 'Finished stock', batchCode: a.batchCode,
    expiryAt: a.expiryAt ?? null, status: 'Depleted', franchiseId: a.outlet.franchiseId, posOutletId: a.outlet.id, parentLotId: a.parentLotId ?? null, unitCost: a.unitCost ?? null,
  }).returning()
  return lot
}

export type Allocation = { lot: LotRow; take: number }

/**
 * First-expiry-first-out allocation over the outlet's own lots for a product. Locks the balance row, then the
 * candidate lots. Expired lots are skipped when `skipExpired` is set (sales).
 */
export async function allocateOutletLots(tx: Tx, outletId: string, product: string, quantity: number, opts: { skipExpired?: boolean } = {}): Promise<Allocation[]> {
  const balance = await lockBalance(tx, outletId, product)
  if (r3(balance - quantity) < -EPS) throw new Rejection(409, `Insufficient outlet stock for ${product}.`)
  const lots = await tx.select().from(stockLots)
    .where(and(eq(stockLots.posOutletId, outletId), eq(stockLots.product, product), gt(stockLots.quantity, '0')))
    .orderBy(sql`${stockLots.expiryAt} ASC NULLS LAST`, asc(stockLots.createdAt), asc(stockLots.id)).for('update')
  let remaining = r3(quantity)
  const out: Allocation[] = []
  for (const lot of lots) {
    if (opts.skipExpired && lot.expiryAt && lot.expiryAt.getTime() < Date.now()) continue
    const take = Math.min(num(lot.quantity), remaining)
    if (take <= EPS) continue
    out.push({ lot, take: r3(take) })
    remaining = r3(remaining - take)
    if (remaining <= EPS) break
  }
  if (remaining > EPS) throw new Rejection(409, `Insufficient ${opts.skipExpired ? 'unexpired ' : ''}outlet stock for ${product}.`)
  return out
}

/**
 * Locks company lots (no franchise, no outlet) for a product, oldest first. Franchise-owned and outlet-held lots
 * are never candidates, which is what keeps one franchise's stock out of company allocation.
 */
export async function lockCompanyLots(tx: Tx, product: string, onlyLotId?: string) {
  const conditions = [isNull(stockLots.franchiseId), isNull(stockLots.posOutletId), eq(stockLots.product, product), eq(stockLots.stage, 'Finished stock'), eq(stockLots.status, 'Available'), gt(stockLots.quantity, '0')]
  if (onlyLotId) conditions.push(eq(stockLots.id, onlyLotId))
  return tx.select().from(stockLots).where(and(...conditions)).orderBy(asc(stockLots.createdAt), asc(stockLots.id)).for('update')
}

/**
 * Moves `take` from a locked company lot into the outlet: decrements the company lot, cuts a child lot held by the
 * outlet (same batch and expiry, parent_lot_id pointing at the company lot) and posts the inbound movement.
 */
export async function receiveFromCompanyLot(tx: Tx, a: MovementRefs & { companyLot: LotRow; take: number; outlet: OutletRow; type: 'SupplyIn' | 'TransferIn'; actor: string; unitCost?: string | null }) {
  const remaining = r3(num(a.companyLot.quantity) - a.take)
  if (remaining < -EPS) throw new Rejection(409, 'Stock changed while transferring. Please retry.')
  await tx.update(stockLots).set({ quantity: Math.max(0, remaining).toFixed(3), status: remaining > EPS ? 'Available' : 'Depleted', updatedAt: new Date() }).where(eq(stockLots.id, a.companyLot.id))
  const child = await createOutletLot(tx, { outlet: a.outlet, product: a.companyLot.product, unit: a.companyLot.unit, batchCode: a.companyLot.batchCode, expiryAt: a.companyLot.expiryAt, parentLotId: a.companyLot.id, unitCost: a.unitCost ?? null })
  const ledger = await moveStock(tx, { ...a, outletId: a.outlet.id, franchiseId: a.outlet.franchiseId, product: a.companyLot.product, lotId: child.id, quantity: a.take })
  return { ledger, lot: child }
}

export type Removed = { ledgerId: string; lotId: string; quantity: number; unitCost: string | null }

/**
 * Takes `quantity` (positive) out of an outlet: from the named lot, or first-expiry-first-out across the outlet's
 * lots when none is named. One ledger row per lot touched.
 */
export async function removeStock(tx: Tx, a: MovementRefs & {
  outlet: OutletRow
  product: string
  quantity: number
  lotId?: string | null
  type: 'Sale' | 'Wastage' | 'Adjustment' | 'Count'
  actor: string
  skipExpired?: boolean
}): Promise<Removed[]> {
  const base = { ...a, outletId: a.outlet.id, franchiseId: a.outlet.franchiseId, blockExpired: !!a.skipExpired }
  const parts = a.lotId
    ? [{ lotId: a.lotId, take: r3(a.quantity) }]
    : (await allocateOutletLots(tx, a.outlet.id, a.product, a.quantity, { skipExpired: a.skipExpired })).map(x => ({ lotId: x.lot.id, take: x.take }))
  const out: Removed[] = []
  for (const part of parts) {
    const row = await moveStock(tx, { ...base, lotId: part.lotId, quantity: -part.take })
    out.push({ ledgerId: row.id, lotId: part.lotId, quantity: part.take, unitCost: row.unitCost })
  }
  return out
}

/** Adds stock to the named lot, or to a new lot (batch code given or generated) when none is named. */
export async function addStock(tx: Tx, a: MovementRefs & {
  outlet: OutletRow
  product: string
  quantity: number
  lotId?: string | null
  type: 'Return' | 'Adjustment' | 'Count'
  actor: string
  newLotPrefix: string
  batchCode?: string | null
  expiryAt?: Date | null
  unitCost?: string | null
}) {
  let lotId = a.lotId
  if (!lotId) {
    const lot = await createOutletLot(tx, { outlet: a.outlet, product: a.product, batchCode: a.batchCode || `${a.newLotPrefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, expiryAt: a.expiryAt, unitCost: a.unitCost })
    lotId = lot.id
  }
  return moveStock(tx, { ...a, outletId: a.outlet.id, franchiseId: a.outlet.franchiseId, lotId, quantity: r3(a.quantity) })
}
