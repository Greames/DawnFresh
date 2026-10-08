import { pgTable, text, uuid, timestamp, integer, numeric, index } from 'drizzle-orm/pg-core'
import { franchises, appUsers, customers, stockLots } from './schema.js'

export const posOutlets = pgTable('pos_outlets', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  legacyOutletId: uuid('legacy_outlet_id').references(() => (undefined as never)),
  code: text().notNull().unique(),
  name: text().notNull(),
  status: text().notNull().default('Active'),
  address: text(),
  openingTime: text('opening_time'),
  closingTime: text('closing_time'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('pos_outlets_franchise_idx').on(table.franchiseId)])

export const posShifts = pgTable('pos_shifts', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  cashierId: uuid('cashier_id').notNull().references(() => appUsers.id),
  openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  openingCash: numeric('opening_cash', { precision: 16, scale: 2 }).notNull().default('0'),
  expectedCash: numeric('expected_cash', { precision: 16, scale: 2 }).notNull().default('0'),
  countedCash: numeric('counted_cash', { precision: 16, scale: 2 }),
  cashVariance: numeric('cash_variance', { precision: 16, scale: 2 }),
  status: text().notNull().default('Open'),
}, table => [index('pos_shifts_outlet_status_idx').on(table.outletId, table.status)])

export const posSales = pgTable('pos_sales', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  shiftId: uuid('shift_id').notNull().references(() => posShifts.id),
  billNumber: text('bill_number').notNull().unique(),
  customerId: uuid('customer_id').references(() => customers.id),
  cashierId: uuid('cashier_id').notNull().references(() => appUsers.id),
  subtotal: numeric('subtotal', { precision: 16, scale: 2 }).notNull().default('0'),
  discount: numeric('discount', { precision: 16, scale: 2 }).notNull().default('0'),
  tax: numeric('tax', { precision: 16, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 16, scale: 2 }).notNull().default('0'),
  status: text().notNull().default('Completed'),
  soldAt: timestamp('sold_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('pos_sales_outlet_date_idx').on(table.outletId, table.soldAt), index('pos_sales_shift_idx').on(table.shiftId)])

export const posSaleItems = pgTable('pos_sale_items', {
  id: uuid().defaultRandom().primaryKey(),
  saleId: uuid('sale_id').notNull().references(() => posSales.id, { onDelete: 'cascade' }),
  product: text().notNull(),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  unit: text().notNull().default('kg'),
  unitPrice: numeric('unit_price', { precision: 16, scale: 2 }).notNull(),
  discount: numeric('discount', { precision: 16, scale: 2 }).notNull().default('0'),
  tax: numeric('tax', { precision: 16, scale: 2 }).notNull().default('0'),
  total: numeric('total', { precision: 16, scale: 2 }).notNull(),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
}, table => [index('pos_sale_items_sale_idx').on(table.saleId), index('pos_sale_items_lot_idx').on(table.stockLotId)])

export const posPayments = pgTable('pos_payments', {
  id: uuid().defaultRandom().primaryKey(),
  saleId: uuid('sale_id').notNull().references(() => posSales.id, { onDelete: 'cascade' }),
  method: text().notNull(),
  amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
  reference: text(),
  status: text().notNull().default('Received'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('pos_payments_sale_idx').on(table.saleId), index('pos_payments_method_idx').on(table.method)])

export const posReturns = pgTable('pos_returns', {
  id: uuid().defaultRandom().primaryKey(),
  saleId: uuid('sale_id').notNull().references(() => posSales.id),
  itemId: uuid('item_id').notNull().references(() => posSaleItems.id),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
  reason: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const posReconciliations = pgTable('pos_reconciliations', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  shiftId: uuid('shift_id').notNull().references(() => posShifts.id),
  businessDate: timestamp('business_date', { withTimezone: true }).notNull(),
  grossSales: numeric('gross_sales', { precision: 16, scale: 2 }).notNull().default('0'),
  returns: numeric('returns', { precision: 16, scale: 2 }).notNull().default('0'),
  discounts: numeric('discounts', { precision: 16, scale: 2 }).notNull().default('0'),
  tax: numeric('tax', { precision: 16, scale: 2 }).notNull().default('0'),
  netSales: numeric('net_sales', { precision: 16, scale: 2 }).notNull().default('0'),
  cashCollected: numeric('cash_collected', { precision: 16, scale: 2 }).notNull().default('0'),
  upiCollected: numeric('upi_collected', { precision: 16, scale: 2 }).notNull().default('0'),
  cardCollected: numeric('card_collected', { precision: 16, scale: 2 }).notNull().default('0'),
  creditSales: numeric('credit_sales', { precision: 16, scale: 2 }).notNull().default('0'),
  expectedCash: numeric('expected_cash', { precision: 16, scale: 2 }).notNull().default('0'),
  countedCash: numeric('counted_cash', { precision: 16, scale: 2 }).notNull().default('0'),
  variance: numeric('variance', { precision: 16, scale: 2 }).notNull().default('0'),
  status: text().notNull().default('Open'),
  closedBy: uuid('closed_by').references(() => appUsers.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, table => [index('pos_reconciliation_outlet_date_idx').on(table.outletId, table.businessDate)])

export const outletStockLedger = pgTable('outlet_stock_ledger', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  product: text().notNull(),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
  movementType: text('movement_type').notNull(),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  balanceAfter: numeric('balance_after', { precision: 16, scale: 3 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => appUsers.id),
}, table => [index('outlet_stock_ledger_outlet_product_idx').on(table.outletId, table.product, table.createdAt), index('outlet_stock_ledger_ref_idx').on(table.referenceType, table.referenceId)])
