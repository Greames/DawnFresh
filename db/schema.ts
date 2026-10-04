import { pgTable, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const franchises = pgTable('franchises', {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  userId: text('user_id'),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

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
