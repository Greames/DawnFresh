import { drizzle } from 'drizzle-orm/netlify-db'
import * as schema from './schema.js'
import * as pricingSchema from './pricing-schema.js'
import * as posSchema from './pos-schema.js'
import * as procurementSchema from './procurement-schema.js'

export const db = drizzle({ schema: { ...schema, ...pricingSchema, ...posSchema, ...procurementSchema } })
