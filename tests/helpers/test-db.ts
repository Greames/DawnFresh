import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from '../../db/schema.js'
import * as pricingSchema from '../../db/pricing-schema.js'
import * as posSchema from '../../db/pos-schema.js'
import * as procurementSchema from '../../db/procurement-schema.js'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
export const db = drizzle({ client: pool, schema: { ...schema, ...pricingSchema, ...posSchema, ...procurementSchema } })
