import { and, desc, eq, isNull, lte, or, gt, sql } from 'drizzle-orm'
import { pricingConfigs } from './pricing-schema.js'
import type { Tx } from './tx.js'

export type PriceRow = typeof pricingConfigs.$inferSelect

/**
 * Active, in-date price configurations for a product, best first: a franchise-specific configuration beats the
 * company-wide one, the Standard processing type beats others, then the newest effective date and version.
 */
export async function activeConfigs(tx: Tx, product: string, franchiseId: string | null, at: Date = new Date()): Promise<PriceRow[]> {
  return tx.select().from(pricingConfigs).where(and(
    eq(pricingConfigs.product, product), eq(pricingConfigs.status, 'Active'),
    franchiseId ? or(isNull(pricingConfigs.franchiseId), eq(pricingConfigs.franchiseId, franchiseId)) : isNull(pricingConfigs.franchiseId),
    lte(pricingConfigs.effectiveFrom, at), or(isNull(pricingConfigs.effectiveTo), gt(pricingConfigs.effectiveTo, at)),
  )).orderBy(sql`(${pricingConfigs.franchiseId} IS NULL)`, sql`(${pricingConfigs.processingType} <> 'Standard')`, desc(pricingConfigs.effectiveFrom), desc(pricingConfigs.version))
}

/** What the company charges the franchise per kg (supply value and stock cost), or null when no active price exists. */
export async function companyPrice(tx: Tx, product: string, franchiseId: string | null, at?: Date): Promise<number | null> {
  const [row] = await activeConfigs(tx, product, franchiseId, at)
  return row ? Number(row.companyPricePerKg) : null
}

/** The customer price per kg and tax rate the POS must use. Null when no active configuration carries a customer price. */
export async function customerPrice(tx: Tx, product: string, franchiseId: string | null, at?: Date): Promise<{ unitPrice: number; taxRatePct: number; configId: string } | null> {
  const row = (await activeConfigs(tx, product, franchiseId, at)).find(c => c.customerPricePerKg !== null)
  return row ? { unitPrice: Number(row.customerPricePerKg), taxRatePct: Number(row.taxRatePct), configId: row.id } : null
}
