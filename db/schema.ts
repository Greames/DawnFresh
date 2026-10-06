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
