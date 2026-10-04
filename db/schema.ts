import { pgTable, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const franchises = pgTable('franchises', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// Users & access: the source of truth for who may sign in, their role, their franchise
// and their per-module permissions. Netlify Identity only authenticates.
export const appUsers = pgTable('app_users', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  identityId: text('identity_id').unique(),
  name: text(),
  role: text().notNull(),
  franchiseId: uuid('franchise_id').references(() => franchises.id),
  permissions: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: text().notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, table => [index('app_users_franchise_idx').on(table.franchiseId)])

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
