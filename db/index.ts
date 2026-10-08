import { drizzle } from 'drizzle-orm/netlify-db'
import * as schema from './schema.js'
import * as pricingSchema from './pricing-schema.js'

export const db = drizzle({ schema: { ...schema, ...pricingSchema } })
