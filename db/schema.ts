import { sql } from 'drizzle-orm'
import { pgTable, text, uuid, jsonb, timestamp, index, integer, unique, numeric, check, date, boolean } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { posOutlets } from './pos-schema.js'

// Money is numeric(16,2) and quantities numeric(16,3); both are returned by Drizzle as strings.
const money = (name: string) => numeric(name, { precision: 16, scale: 2 })
const qty = (name: string) => numeric(name, { precision: 16, scale: 3 })

export const franchises = pgTable('franchises', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Users & access: the source of truth for sign-in (scrypt password hash), role,
// franchise and per-module permissions.
export const appUsers = pgTable('app_users', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  passwordHash: text('password_hash'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  name: text(),
  role: text().notNull(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  permissions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: text().notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, table => [index('app_users_franchise_idx').on(table.franchiseId)])

// Signed-in sessions. Only a SHA-256 hash of the cookie token is stored.
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('sessions_user_idx').on(table.userId)])

// One-time links emailed to users to set (invite) or reset their password. Only a SHA-256 hash is stored.
export const passwordTokens = pgTable('password_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => appUsers.id, { onDelete: 'cascade' }),
  purpose: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, table => [index('password_tokens_user_idx').on(table.userId)])

export const records = pgTable('operations_records', {
  id: uuid().defaultRandom().primaryKey(),
  kind: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('operations_records_franchise_idx').on(table.franchiseId)])

export const settings = pgTable('business_settings', {
  id: text().primaryKey().default('main'),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
})


/**
 * Normalized operational core.
 *
 * These tables are introduced alongside operations_records so the legacy MVP can
 * migrate incrementally without a destructive cutover. New workflows can use
 * stable relational IDs while the existing UI remains compatible.
 */
export const customers = pgTable('customers', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  sourceLeadId: uuid('source_lead_id').references(() => records.id),
  name: text().notNull(),
  phone: text(),
  email: text(),
  customerType: text('customer_type').notNull().default('Business'),
  status: text().notNull().default('Active'),
  notes: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customers_franchise_idx').on(table.franchiseId),
  index('customers_phone_idx').on(table.phone),
  index('customers_source_lead_idx').on(table.sourceLeadId),
])

export const customerAddresses = pgTable('customer_addresses', {
  id: uuid().defaultRandom().primaryKey(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  label: text().notNull().default('Primary'),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text(),
  state: text(),
  postalCode: text('postal_code'),
  latitude: text(),
  longitude: text(),
  isDefault: integer('is_default').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customer_addresses_customer_idx').on(table.customerId),
])

export const customerOrders = pgTable('customer_orders', {
  id: uuid().defaultRandom().primaryKey(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  legacyRecordId: uuid('legacy_record_id').unique().references(() => records.id),
  status: text().notNull(),
  channel: text(),
  orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
  subtotal: money('subtotal'),
  tax: money('tax'),
  total: money('total'),
  paid: money('paid'),
  currency: text().notNull().default('INR'),
  deliveryDate: timestamp('delivery_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customer_orders_customer_idx').on(table.customerId),
  index('customer_orders_franchise_status_idx').on(table.franchiseId, table.status),
  index('customer_orders_date_idx').on(table.orderDate),
  check('customer_orders_paid_check', sql`${table.paid} >= 0 AND ${table.paid} <= ${table.total}`),
])

export const customerOrderItems = pgTable('customer_order_items', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => customerOrders.id, { onDelete: 'cascade' }),
  product: text().notNull(),
  quantity: qty('quantity').notNull(),
  unit: text().notNull(),
  unitPrice: money('unit_price'),
  lineTotal: money('line_total'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customer_order_items_order_idx').on(table.orderId),
])

export const auditEvents = pgTable('audit_events', {
  id: uuid().defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').references(() => appUsers.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  action: text().notNull(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('audit_events_entity_idx').on(table.entityType, table.entityId),
  index('audit_events_franchise_created_idx').on(table.franchiseId, table.createdAt),
  index('audit_events_actor_idx').on(table.actorUserId, table.createdAt),
])


export const productionOrders = pgTable('production_orders', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => customerOrders.id),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  product: text().notNull(),
  requestedQuantity: qty('requested_quantity').notNull(),
  unit: text().notNull(),
  status: text().notNull().default('Planned'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('production_orders_order_idx').on(table.orderId),
  index('production_orders_franchise_status_idx').on(table.franchiseId, table.status),
  index('production_orders_due_idx').on(table.dueAt),
])

export const processingBatches = pgTable('processing_batches', {
  id: uuid().defaultRandom().primaryKey(),
  productionOrderId: uuid('production_order_id').references(() => productionOrders.id),
  product: text().notNull(),
  inputQuantity: qty('input_quantity').notNull(),
  outputQuantity: qty('output_quantity').notNull(),
  wasteQuantity: qty('waste_quantity').notNull().default('0'),
  unit: text().notNull(),
  status: text().notNull().default('Planned'),
  qcStatus: text('qc_status').notNull().default('Pending'),
  qcRemarks: text('qc_remarks'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('processing_batches_production_idx').on(table.productionOrderId),
  index('processing_batches_status_idx').on(table.status),
])

export const qcChecks = pgTable('qc_checks', {
  id: uuid().defaultRandom().primaryKey(),
  processingBatchId: uuid('processing_batch_id').notNull().references(() => processingBatches.id, { onDelete: 'cascade' }),
  status: text().notNull(),
  temperature: text(),
  remarks: text(),
  checkedBy: uuid('checked_by').references(() => appUsers.id),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('qc_checks_batch_idx').on(table.processingBatchId),
])

export const stockLots = pgTable('stock_lots', {
  id: uuid().defaultRandom().primaryKey(),
  product: text().notNull(),
  quantity: qty('quantity').notNull(),
  unit: text().notNull(),
  stage: text().notNull().default('Finished stock'),
  sourceBatchId: uuid('source_batch_id').references(() => processingBatches.id),
  outletId: uuid('outlet_id').references(() => records.id),
  // Ownership. Both null = company stock (allocatable by company allocation only). franchise_id set = owned by
  // that franchise; pos_outlet_id set = physically held by that POS outlet (and sellable there). A lot received by
  // a franchise from the company is a child lot (parent_lot_id) of the company lot it was cut from.
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  posOutletId: uuid('pos_outlet_id').references(() => posOutlets.id),
  parentLotId: uuid('parent_lot_id').references((): AnyPgColumn => stockLots.id),
  batchCode: text('batch_code').notNull(),
  // Cost per unit carried by the lot. A franchise's child lot takes the company price at transfer; null = unknown (not guessed).
  unitCost: numeric('unit_cost', { precision: 16, scale: 4 }),
  expiryAt: timestamp('expiry_at', { withTimezone: true }),
  status: text().notNull().default('Available'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('stock_lots_product_stage_idx').on(table.product, table.stage),
  index('stock_lots_batch_code_idx').on(table.batchCode),
  index('stock_lots_expiry_idx').on(table.expiryAt),
  index('stock_lots_outlet_product_idx').on(table.posOutletId, table.product),
  index('stock_lots_franchise_idx').on(table.franchiseId),
  check('stock_lots_quantity_check', sql`${table.quantity} >= 0`),
])

export const packages = pgTable('packages', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => customerOrders.id),
  packageCode: text('package_code').notNull().unique(),
  product: text().notNull(),
  quantity: qty('quantity').notNull(),
  unit: text().notNull(),
  status: text().notNull().default('Packed'),
  packedAt: timestamp('packed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('packages_order_idx').on(table.orderId),
  index('packages_status_idx').on(table.status),
])

export const packageItems = pgTable('package_items', {
  id: uuid().defaultRandom().primaryKey(),
  packageId: uuid('package_id').notNull().references(() => packages.id, { onDelete: 'cascade' }),
  stockLotId: uuid('stock_lot_id').references(() => stockLots.id),
  quantity: qty('quantity').notNull(),
  unit: text().notNull(),
}, table => [
  index('package_items_package_idx').on(table.packageId),
])

export const labels = pgTable('labels', {
  id: uuid().defaultRandom().primaryKey(),
  packageId: uuid('package_id').notNull().references(() => packages.id, { onDelete: 'cascade' }),
  code: text().notNull().unique(),
  payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  printedAt: timestamp('printed_at', { withTimezone: true }),
  printCount: integer('print_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('labels_package_idx').on(table.packageId),
])

export const drivers = pgTable('drivers', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  phone: text().notNull(),
  status: text().notNull().default('Available'),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('drivers_franchise_status_idx').on(table.franchiseId, table.status),
])

export const vehicles = pgTable('vehicles', {
  id: uuid().defaultRandom().primaryKey(),
  registrationNumber: text('registration_number').notNull().unique(),
  type: text().notNull(),
  status: text().notNull().default('Available'),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('vehicles_franchise_status_idx').on(table.franchiseId, table.status),
])

export const deliveryRoutes = pgTable('delivery_routes', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  routeDate: timestamp('route_date', { withTimezone: true }).notNull(),
  status: text().notNull().default('Planned'),
  driverId: uuid('driver_id').references(() => drivers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  routeCode: text('route_code').notNull().unique(),
  notes: text(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('delivery_routes_date_status_idx').on(table.routeDate, table.status),
  index('delivery_routes_franchise_idx').on(table.franchiseId),
])

export const deliveryStops = pgTable('delivery_stops', {
  id: uuid().defaultRandom().primaryKey(),
  routeId: uuid('route_id').notNull().references(() => deliveryRoutes.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id').notNull().references(() => customerOrders.id),
  sequence: integer().notNull(),
  status: text().notNull().default('Planned'),
  addressId: uuid('address_id').references(() => customerAddresses.id),
  latitude: text(),
  longitude: text(),
  deliveryWindow: text('delivery_window'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  failureReason: text('failure_reason'),
}, table => [
  index('delivery_stops_route_sequence_idx').on(table.routeId, table.sequence),
  index('delivery_stops_order_idx').on(table.orderId),
])

export const dispatchLoads = pgTable('dispatch_loads', {
  id: uuid().defaultRandom().primaryKey(),
  routeId: uuid('route_id').notNull().references(() => deliveryRoutes.id, { onDelete: 'cascade' }),
  packageId: uuid('package_id').notNull().references(() => packages.id),
  scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
  scannedBy: uuid('scanned_by').references(() => appUsers.id),
  status: text().notNull().default('Loaded'),
}, table => [
  index('dispatch_loads_route_idx').on(table.routeId),
  index('dispatch_loads_package_idx').on(table.packageId),
  unique('dispatch_loads_route_package_unique').on(table.routeId, table.packageId),
])

export const proofOfDelivery = pgTable('proof_of_delivery', {
  id: uuid().defaultRandom().primaryKey(),
  stopId: uuid('stop_id').notNull().unique().references(() => deliveryStops.id, { onDelete: 'cascade' }),
  status: text().notNull().default('Delivered'),
  recipientName: text('recipient_name'),
  notes: text(),
  photoUrl: text('photo_url'),
  signatureRef: text('signature_ref'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const invoiceRecords = pgTable('invoice_records', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => customerOrders.id),
  posSaleId: uuid('pos_sale_id'),
  invoiceNumber: text('invoice_number').notNull().unique(),
  subtotal: money('subtotal').notNull().default('0'),
  tax: money('tax').notNull().default('0'),
  total: money('total').notNull().default('0'),
  paid: money('paid').notNull().default('0'),
  status: text().notNull().default('Draft'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('invoice_records_order_idx').on(table.orderId),
  index('invoice_records_status_idx').on(table.status),
  check('invoice_records_paid_check', sql`${table.paid} >= 0 AND ${table.paid} <= ${table.total}`),
])

export const paymentRecords = pgTable('payment_records', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => customerOrders.id),
  invoiceId: uuid('invoice_id').references(() => invoiceRecords.id),
  posSaleId: uuid('pos_sale_id'),
  amount: money('amount').notNull(),
  method: text().notNull(),
  reference: text(),
  status: text().notNull().default('Received'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('payment_records_order_idx').on(table.orderId),
  index('payment_records_invoice_idx').on(table.invoiceId),
])

// A franchise settlement for an inclusive range of IST business dates, derived on the server from the supply
// ledger (see netlify/functions/settlements.mts). derived = false marks legacy manually entered rows, which stay
// readable but are never changed. For derived rows:
//   amount_due = supply value - supply returns value + adjustments (what the franchise owes the company for the period)
//   outstanding = amount_due - payments_total; status Open -> Partially Settled -> Settled (settled_at set).
// grossSales and collections are legacy columns and stay 0 on derived rows: the franchise's own customer
// collections and receivables never enter this amount.
export const settlementRecords = pgTable('settlement_records', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').notNull().references(() => franchises.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  periodStartDate: date('period_start_date', { mode: 'string' }),
  periodEndDate: date('period_end_date', { mode: 'string' }),
  grossSales: money('gross_sales').notNull().default('0'),
  collections: money('collections').notNull().default('0'),
  supplyValue: money('supply_value').notNull().default('0'),
  returnsValue: money('returns_value').notNull().default('0'),
  adjustments: money('adjustments').notNull().default('0'),
  amountDue: money('amount_due').notNull().default('0'),
  paymentsTotal: money('payments_total').notNull().default('0'),
  derived: boolean().notNull().default(false),
  status: text().notNull().default('Open'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('settlement_records_franchise_period_idx').on(table.franchiseId, table.periodStart),
  unique('settlement_records_franchise_period_unique').on(table.franchiseId, table.periodStart, table.periodEnd),
  check('settlement_records_status_check', sql`${table.status} IN ('Open', 'Partially Settled', 'Settled')`),
  check('settlement_records_payments_check', sql`${table.paymentsTotal} >= 0 AND (${table.derived} = false OR ${table.paymentsTotal} <= ${table.amountDue})`),
  check('settlement_records_dates_check', sql`${table.periodStartDate} IS NULL OR ${table.periodEndDate} >= ${table.periodStartDate}`),
])

// A signed correction to a derived settlement (positive = franchise owes more). The reason is mandatory.
export const settlementAdjustments = pgTable('settlement_adjustments', {
  id: uuid().defaultRandom().primaryKey(),
  settlementId: uuid('settlement_id').notNull().references(() => settlementRecords.id),
  franchiseId: uuid('franchise_id').notNull().references(() => franchises.id),
  amount: money('amount').notNull(),
  reason: text().notNull(),
  createdBy: uuid('created_by').notNull().references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('settlement_adjustments_settlement_idx').on(table.settlementId),
  check('settlement_adjustments_amount_check', sql`${table.amount} <> 0`),
  check('settlement_adjustments_reason_check', sql`length(btrim(${table.reason})) > 0`),
])

// Money the franchise paid the company against a settlement, recorded by company staff.
export const settlementPayments = pgTable('settlement_payments', {
  id: uuid().defaultRandom().primaryKey(),
  settlementId: uuid('settlement_id').notNull().references(() => settlementRecords.id),
  franchiseId: uuid('franchise_id').notNull().references(() => franchises.id),
  amount: money('amount').notNull(),
  method: text().notNull(),
  reference: text(),
  recordedBy: uuid('recorded_by').notNull().references(() => appUsers.id),
  paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('settlement_payments_settlement_idx').on(table.settlementId),
  check('settlement_payments_amount_check', sql`${table.amount} > 0`),
])

// Replay store for retried writes. A client-chosen key plus the acting user and action identify one logical
// request; the first transaction that claims the key stores its response here, in the same transaction as the
// business change, so a replay returns the same result and never repeats the change.
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: uuid().defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').notNull().references(() => appUsers.id),
  action: text().notNull(),
  key: text().notNull(),
  requestHash: text('request_hash').notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body').$type<unknown>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [unique('idempotency_keys_actor_action_key_unique').on(table.actorUserId, table.action, table.key)])
