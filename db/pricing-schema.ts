import { pgTable, text, uuid, timestamp, numeric, integer, jsonb, index } from 'drizzle-orm/pg-core'
import { appUsers, customerOrders, franchises } from './schema.js'

export const pricingConfigs = pgTable('pricing_configs', {
  id: uuid().defaultRandom().primaryKey(),
  product: text().notNull(),
  processingType: text('processing_type').notNull().default('Standard'),
  supplierName: text('supplier_name').notNull(),
  supplierPricePerKg: numeric('supplier_price_per_kg', { precision: 14, scale: 4 }).notNull(),
  standardYieldPct: numeric('standard_yield_pct', { precision: 7, scale: 3 }).notNull(),
  logisticsCostPerKg: numeric('logistics_cost_per_kg', { precision: 14, scale: 4 }).notNull().default('0'),
  otherCostPerKg: numeric('other_cost_per_kg', { precision: 14, scale: 4 }).notNull().default('0'),
  companyPricePerKg: numeric('company_price_per_kg', { precision: 14, scale: 4 }).notNull(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  version: integer().notNull().default(1),
  status: text().notNull().default('Draft'),
  notes: text(),
  createdBy: uuid('created_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('pricing_configs_lookup_idx').on(table.product, table.processingType, table.status, table.effectiveFrom),
  index('pricing_configs_franchise_idx').on(table.franchiseId),
])

export const pricingScenarios = pgTable('pricing_scenarios', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  product: text().notNull(),
  processingType: text('processing_type').notNull().default('Standard'),
  supplierName: text('supplier_name').notNull(),
  liveWeightKg: numeric('live_weight_kg', { precision: 14, scale: 3 }).notNull(),
  supplierPricePerKg: numeric('supplier_price_per_kg', { precision: 14, scale: 4 }).notNull(),
  standardYieldPct: numeric('standard_yield_pct', { precision: 7, scale: 3 }).notNull(),
  logisticsCostPerKg: numeric('logistics_cost_per_kg', { precision: 14, scale: 4 }).notNull().default('0'),
  otherCostPerKg: numeric('other_cost_per_kg', { precision: 14, scale: 4 }).notNull().default('0'),
  companyPricePerKg: numeric('company_price_per_kg', { precision: 14, scale: 4 }).notNull(),
  billableWeightKg: numeric('billable_weight_kg', { precision: 14, scale: 3 }).notNull(),
  supplierCost: numeric('supplier_cost', { precision: 16, scale: 4 }).notNull(),
  landedCost: numeric('landed_cost', { precision: 16, scale: 4 }).notNull(),
  franchiseValue: numeric('franchise_value', { precision: 16, scale: 4 }).notNull(),
  grossMargin: numeric('gross_margin', { precision: 16, scale: 4 }).notNull(),
  grossMarginPct: numeric('gross_margin_pct', { precision: 8, scale: 3 }).notNull(),
  actualOutputKg: numeric('actual_output_kg', { precision: 14, scale: 3 }),
  actualYieldPct: numeric('actual_yield_pct', { precision: 7, scale: 3 }),
  yieldVariancePct: numeric('yield_variance_pct', { precision: 8, scale: 3 }),
  createdBy: uuid('created_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('pricing_scenarios_product_idx').on(table.product, table.createdAt),
])

export const orderPricingSnapshots = pgTable('order_pricing_snapshots', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().unique().references(() => customerOrders.id, { onDelete: 'cascade' }),
  pricingConfigId: uuid('pricing_config_id').references(() => pricingConfigs.id),
  liveWeightKg: numeric('live_weight_kg', { precision: 14, scale: 3 }).notNull(),
  billableWeightKg: numeric('billable_weight_kg', { precision: 14, scale: 3 }).notNull(),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('order_pricing_snapshots_config_idx').on(table.pricingConfigId),
])
