import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./db/schema.ts', './db/pricing-schema.ts', './db/pos-schema.ts', './db/procurement-schema.ts'],
  out: 'netlify/database/migrations',
})
