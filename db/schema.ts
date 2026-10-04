import { pgTable, text, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const records = pgTable('operations_records', {
  id: uuid().defaultRandom().primaryKey(),
  kind: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const settings = pgTable('business_settings', {
  id: text().primaryKey().default('main'),
  data: jsonb().$type<Record<string, unknown>>().notNull(),
})
