import { pgTable, text, uuid, jsonb, timestamp, index, integer } from 'drizzle-orm/pg-core'

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
  subtotal: text(),
  tax: text(),
  total: text(),
  paid: text(),
  currency: text().notNull().default('INR'),
  deliveryDate: timestamp('delivery_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('customer_orders_customer_idx').on(table.customerId),
  index('customer_orders_franchise_status_idx').on(table.franchiseId, table.status),
  index('customer_orders_date_idx').on(table.orderDate),
])

export const customerOrderItems = pgTable('customer_order_items', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => customerOrders.id, { onDelete: 'cascade' }),
  product: text().notNull(),
  quantity: text().notNull(),
  unit: text().notNull(),
  unitPrice: text('unit_price'),
  lineTotal: text('line_total'),
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
  requestedQuantity: text('requested_quantity').notNull(),
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
  inputQuantity: text('input_quantity').notNull(),
  outputQuantity: text('output_quantity').notNull(),
  wasteQuantity: text('waste_quantity').notNull().default('0'),
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
  quantity: text().notNull(),
  unit: text().notNull(),
  stage: text().notNull().default('Finished stock'),
  sourceBatchId: uuid('source_batch_id').references(() => processingBatches.id),
  outletId: uuid('outlet_id').references(() => records.id),
  batchCode: text('batch_code').notNull(),
  expiryAt: timestamp('expiry_at', { withTimezone: true }),
  status: text().notNull().default('Available'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('stock_lots_product_stage_idx').on(table.product, table.stage),
  index('stock_lots_batch_code_idx').on(table.batchCode),
  index('stock_lots_expiry_idx').on(table.expiryAt),
])

export const packages = pgTable('packages', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => customerOrders.id),
  packageCode: text('package_code').notNull().unique(),
  product: text().notNull(),
  quantity: text().notNull(),
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
  quantity: text().notNull(),
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
  subtotal: text().notNull().default('0'),
  tax: text().notNull().default('0'),
  total: text().notNull().default('0'),
  paid: text().notNull().default('0'),
  status: text().notNull().default('Draft'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('invoice_records_order_idx').on(table.orderId),
  index('invoice_records_status_idx').on(table.status),
])

export const paymentRecords = pgTable('payment_records', {
  id: uuid().defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => customerOrders.id),
  invoiceId: uuid('invoice_id').references(() => invoiceRecords.id),
  posSaleId: uuid('pos_sale_id'),
  amount: text().notNull(),
  method: text().notNull(),
  reference: text(),
  status: text().notNull().default('Received'),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('payment_records_order_idx').on(table.orderId),
  index('payment_records_invoice_idx').on(table.invoiceId),
])

export const settlementRecords = pgTable('settlement_records', {
  id: uuid().defaultRandom().primaryKey(),
  franchiseId: uuid('franchise_id').notNull().references(() => franchises.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  grossSales: text('gross_sales').notNull().default('0'),
  collections: text().notNull().default('0'),
  adjustments: text().notNull().default('0'),
  amountDue: text('amount_due').notNull().default('0'),
  status: text().notNull().default('Open'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('settlement_records_franchise_period_idx').on(table.franchiseId, table.periodStart),
])
