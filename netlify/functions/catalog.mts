import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { settings } from '../../db/schema.js'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  try {
    const [row] = await db.select().from(settings).where(eq(settings.id, 'main'))
    return Response.json({ company: row?.data.company || 'FreshRoute', whatsapp: row?.data.whatsapp || '', currency: row?.data.currency || 'INR', location: row?.data.location || '' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Business details are temporarily unavailable.' }, { status: 503 })
  }
}
export const config: Config = { path: '/api/catalog' }
