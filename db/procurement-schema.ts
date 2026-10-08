import { pgTable, text, uuid, timestamp, numeric, index } from 'drizzle-orm/pg-core'
import { franchises, appUsers, stockLots } from './schema.js'

export const suppliers = pgTable('suppliers', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  phone: text(),
  email: text(),
  status: text().notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('suppliers_status_idx').on(table.status)])

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid().defaultRandom().primaryKey(),
  supplyRequestId: uuid('supply_request_id'),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  product: text().notNull(),
  quantity: numeric({ precision: 16, scale: 3 }).notNull(),
  unit: text().notNull(),
  unitPrice: numeric('unit_price', { precision: 16, scale: 2 }).notNull(),
  total: numeric({ precision: 16, scale: 2 }).notNull(),
  status: text().notNull().default('Draft'),
  orderedAt: timestamp('ordered_at', { withTimezone: true }).defaultNow().notNull(),
  expectedAt: timestamp('expected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('purchase_orders_supplier_status_idx').on(table.supplierId, table.status)])

export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid().defaultRandom().primaryKey(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id),
  receivedQuantity: numeric('received_quantity', { precision: 16, scale: 3 }).notNull(),
  acceptedQuantity: numeric('accepted_quantity', { precision: 16, scale: 3 }).notNull(),
  rejectedQuantity: numeric('rejected_quantity', { precision: 16, scale: 3 }).notNull().default('0'),
  unit: text().notNull(),
  qcStatus: text('qc_status').notNull().default('Pending'),
  batchCode: text('batch_code').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  receivedBy: uuid('received_by').references(() => appUsers.id),
}, table => [index('goods_receipts_po_idx').on(table.purchaseOrderId)])

export const supplierInvoices = pgTable('supplier_invoices', {
  id: uuid().defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  invoiceNumber: text('invoice_number').notNull().unique(),
  total: numeric({ precision: 16, scale: 2 }).notNull(),
  paid: numeric({ precision: 16, scale: 2 }).notNull().default('0'),
  status: text().notNull().default('Issued'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
}, table => [index('supplier_invoices_supplier_status_idx').on(table.supplierId, table.status)])

export const supplierPayments = pgTable('supplier_payments', {
  id: uuid().defaultRandom().primaryKey(),
  supplierInvoiceId: uuid('supplier_invoice_id').notNull().references(() => supplierInvoices.id),
  amount: numeric({ precision: 16, scale: 2 }).notNull(),
  method: text().notNull(),
  reference: text(),
  status: text().notNull().default('Paid'),
  paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('supplier_payments_invoice_idx').on(table.supplierInvoiceId)])

export const franchiseStockLedger = pgTable('franchise_stock_ledger', {
  id: uuid().defaultRandom().primaryKey(),
  supplyRequestId: uuid('supply_request_id'),
  purchaseOrderId: uuid('purchase_order_id'),
  goodsReceiptId: uuid('goods_receipt_id'),
  franchiseId: uuid('franchise_id').notNull().references(() => franchises.id),
  product: text().notNull(),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
  movementType: text('movement_type').notNull(),
  quantity: numeric({ precision: 16, scale: 3 }).notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  balanceAfter: numeric('balance_after', { precision: 16, scale: 3 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => appUsers.id),
}, table => [
  index('franchise_stock_ledger_franchise_product_idx').on(table.franchiseId, table.product, table.createdAt),
  index('franchise_stock_ledger_ref_idx').on(table.referenceType, table.referenceId),
  index('franchise_stock_ledger_supply_request_idx').on(table.supplyRequestId, table.createdAt),
])
