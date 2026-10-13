import { sql } from 'drizzle-orm'
import { pgTable, text, uuid, timestamp, numeric, index, unique, check, primaryKey, bigint, uniqueIndex } from 'drizzle-orm/pg-core'
import { franchises, appUsers, customers, stockLots } from './schema.js'

export const posOutlets = pgTable('pos_outlets', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
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
}, table => [
  index('pos_shifts_outlet_status_idx').on(table.outletId, table.status),
  // One open shift per outlet, enforced by the database as well as by open-shift.
  uniqueIndex('pos_shifts_one_open_per_outlet').on(table.outletId).where(sql`${table.status} = 'Open'`),
])

export const posSales = pgTable('pos_sales', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  shiftId: uuid('shift_id').notNull().references(() => posShifts.id),
  billNumber: text('bill_number').notNull().unique(),
  idempotencyKey: text('idempotency_key').unique(),
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
  // Cost per unit of the lot this line was taken from (for COGS); null when the lot's cost is unknown.
  unitCost: numeric('unit_cost', { precision: 16, scale: 4 }),
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
  // What happened to the returned goods: put back on the shelf (Restock) or discarded (Wastage).
  disposition: text().notNull().default('Restock'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [check('pos_returns_disposition_check', sql`${table.disposition} IN ('Restock', 'Wastage')`)])

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
}, table => [
  index('pos_reconciliation_outlet_date_idx').on(table.outletId, table.businessDate),
  unique('pos_reconciliations_shift_unique').on(table.shiftId),
])

// The single stock ledger for everything that is not company warehouse stock. A franchise's stock is the sum of
// its outlets' balances. Every movement names the lot it touched and the business reference that caused it.
// Movement quantities are signed; balance_after is the outlet/product balance after the movement and is produced
// from the locked stock_balances row, never from a read of the previous ledger row.
export const outletStockLedger = pgTable('outlet_stock_ledger', {
  id: uuid().defaultRandom().primaryKey(),
  // Tie-breaker for rows written in one transaction (created_at is the transaction start time).
  seq: bigint({ mode: 'number' }).generatedAlwaysAsIdentity(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  product: text().notNull(),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
  movementType: text('movement_type').notNull(),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  saleId: uuid('sale_id').references(() => posSales.id),
  supplyRequestId: uuid('supply_request_id'),
  purchaseOrderId: uuid('purchase_order_id'),
  goodsReceiptId: uuid('goods_receipt_id'),
  reason: text(),
  // Cost per unit of the lot at the time of the movement; wastage, count variance and supply value are quantity x this.
  unitCost: numeric('unit_cost', { precision: 16, scale: 4 }),
  balanceAfter: numeric('balance_after', { precision: 16, scale: 3 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => appUsers.id),
}, table => [
  index('outlet_stock_ledger_outlet_product_idx').on(table.outletId, table.product, table.createdAt),
  index('outlet_stock_ledger_ref_idx').on(table.referenceType, table.referenceId),
  index('outlet_stock_ledger_supply_request_idx').on(table.supplyRequestId),
  index('outlet_stock_ledger_lot_idx').on(table.stockLotId),
  check('outlet_stock_ledger_balance_check', sql`${table.balanceAfter} >= 0`),
  check('outlet_stock_ledger_movement_check', sql`(${table.movementType} IN ('SupplyIn', 'TransferIn', 'Return') AND ${table.quantity} > 0) OR (${table.movementType} IN ('Sale', 'Wastage', 'SupplyReturn') AND ${table.quantity} < 0) OR (${table.movementType} IN ('Adjustment', 'Count') AND ${table.quantity} <> 0)`),
])

// Current quantity per outlet and product. Its row is the lock that serializes every stock movement for that pair.
export const stockBalances = pgTable('stock_balances', {
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  product: text().notNull(),
  quantity: numeric('quantity', { precision: 16, scale: 3 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  primaryKey({ columns: [table.outletId, table.product] }),
  check('stock_balances_quantity_check', sql`${table.quantity} >= 0`),
])

// A physical stock count. The variance (counted - system) is posted to the ledger as a Count movement.
export const stockCounts = pgTable('stock_counts', {
  id: uuid().defaultRandom().primaryKey(),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  product: text().notNull(),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
  systemQuantity: numeric('system_quantity', { precision: 16, scale: 3 }).notNull(),
  countedQuantity: numeric('counted_quantity', { precision: 16, scale: 3 }).notNull(),
  variance: numeric('variance', { precision: 16, scale: 3 }).notNull(),
  reason: text(),
  countedBy: uuid('counted_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('stock_counts_outlet_product_idx').on(table.outletId, table.product, table.createdAt),
  check('stock_counts_quantities_check', sql`${table.countedQuantity} >= 0 AND ${table.systemQuantity} >= 0`),
])

// Money a customer owes the outlet's franchise (or the company, for a company-direct outlet) after a credit sale.
// Collected by the franchise from its own customer, at the franchise's risk: it never reduces what the franchise
// owes the company. open balance = original_amount - returned_amount - paid_amount.
export const customerReceivables = pgTable('customer_receivables', {
  id: uuid().defaultRandom().primaryKey(),
  saleId: uuid('sale_id').notNull().unique().references(() => posSales.id),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  originalAmount: numeric('original_amount', { precision: 16, scale: 2 }).notNull(),
  returnedAmount: numeric('returned_amount', { precision: 16, scale: 2 }).notNull().default('0'),
  paidAmount: numeric('paid_amount', { precision: 16, scale: 2 }).notNull().default('0'),
  status: text().notNull().default('Open'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customer_receivables_franchise_status_idx').on(table.franchiseId, table.status),
  index('customer_receivables_customer_idx').on(table.customerId),
  check('customer_receivables_amounts_check', sql`${table.originalAmount} > 0 AND ${table.returnedAmount} >= 0 AND ${table.paidAmount} >= 0 AND ${table.returnedAmount} + ${table.paidAmount} <= ${table.originalAmount}`),
  check('customer_receivables_status_check', sql`${table.status} IN ('Open', 'Partially Paid', 'Paid')`),
])

export const receivablePayments = pgTable('receivable_payments', {
  id: uuid().defaultRandom().primaryKey(),
  receivableId: uuid('receivable_id').notNull().references(() => customerReceivables.id),
  outletId: uuid('outlet_id').notNull().references(() => posOutlets.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  // The open shift that took the money, so cash collected is part of that shift's expected cash.
  shiftId: uuid('shift_id').notNull().references(() => posShifts.id),
  amount: numeric('amount', { precision: 16, scale: 2 }).notNull(),
  method: text().notNull(),
  reference: text(),
  receivedBy: uuid('received_by').references(() => appUsers.id),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('receivable_payments_receivable_idx').on(table.receivableId),
  index('receivable_payments_shift_idx').on(table.shiftId),
  index('receivable_payments_franchise_date_idx').on(table.franchiseId, table.receivedAt),
  check('receivable_payments_amount_check', sql`${table.amount} > 0`),
  check('receivable_payments_method_check', sql`${table.method} IN ('Cash', 'UPI', 'Card')`),
])
