import { getUser } from '@netlify/identity'
import type { Config } from '@netlify/functions'
import { eq, desc, and } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { records, settings } from '../../db/schema.js'

const statuses: Record<string, string[]> = {
  orders: ['Pending', 'Processing', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'],
  leads: ['New lead', 'Contacted', 'Qualified', 'Customer'],
  sourcing: ['Planned', 'Ordered', 'Received'],
  inventory: ['Available', 'Low stock', 'On hold'],
  outlets: ['Active', 'Inactive'],
}

function validate(kind: string, data: Record<string, unknown>) {
  if (typeof data !== 'object' || Array.isArray(data)) return false
  const textFields = ['name', 'status', 'product', 'unit', 'phone', 'note', 'date', 'expiry', 'outlet', 'batch']
  const numberFields = ['quantity', 'amount', 'paid', 'cost', 'temperature', 'latitude', 'longitude']
  if (Object.keys(data).some(key => !textFields.includes(key) && !numberFields.includes(key))) return false
  if (textFields.some(key => data[key] !== undefined && (typeof data[key] !== 'string' || String(data[key]).length > 1000))) return false
  if (!Array.isArray(statuses[kind]) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 180) return false
  if (!statuses[kind].includes(String(data.status))) return false
  if (JSON.stringify(data).length > 12000) return false
  for (const key of ['amount', 'paid', 'quantity', 'cost']) {
    if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || Number(data[key]) < 0 || Number(data[key]) > 100000000)) return false
  }
  if (Number(data.paid || 0) > Number(data.amount || 0)) return false
  if (data.latitude !== undefined && (typeof data.latitude !== 'number' || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90)) return false
  if (data.longitude !== undefined && (typeof data.longitude !== 'number' || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180)) return false
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) return false
  if (['orders', 'sourcing', 'inventory'].includes(kind) && (!['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns'].includes(String(data.product)) || typeof data.quantity !== 'number' || (kind !== 'inventory' && data.quantity <= 0) || !['kg', 'trays', 'pieces'].includes(String(data.unit)))) return false
  if (['orders', 'sourcing'].includes(kind) && (typeof data.amount !== 'number' || typeof data.paid !== 'number')) return false
  if (kind === 'orders' && !data.date) return false
  if ((data.latitude === undefined) !== (data.longitude === undefined)) return false
  if (data.phone && !/^\d{7,15}$/.test(String(data.phone))) return false
  if (kind === 'inventory' && (!data.batch || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.expiry)) || (data.date && String(data.expiry) < String(data.date)))) return false
  if (data.temperature !== undefined && (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature))) return false
  return true
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Sign in to access business records.' }, { status: 401, headers })
    if (!user.roles?.some((role: string) => ['admin', 'staff'].includes(role))) return Response.json({ error: 'An administrator must assign you the staff or admin role in Netlify Identity.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const rows = await db.select().from(records).orderBy(desc(records.createdAt))
      const [configuration] = await db.select().from(settings).where(eq(settings.id, 'main'))
      return Response.json({ records: rows, settings: configuration?.data || {} }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 16000) return Response.json({ error: 'Record is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request data.' }, { status: 400, headers })
    if (body.kind === 'settings') {
      if (!user.roles?.includes('admin')) return Response.json({ error: 'Only administrators can change business settings.' }, { status: 403 })
      const data = body.data
      if (!data || typeof data.company !== 'string' || !data.company.trim() || data.company.length > 100 || !/^[A-Z]{3}$/.test(data.currency) || (data.whatsapp && !/^\d{7,15}$/.test(data.whatsapp)) || !Number.isFinite(Number(data.latitude)) || Math.abs(Number(data.latitude)) > 90 || !Number.isFinite(Number(data.longitude)) || Math.abs(Number(data.longitude)) > 180 || !Number.isFinite(Number(data.radius)) || Number(data.radius) < 20 || Number(data.radius) > 30) return Response.json({ error: 'Check company, currency, international WhatsApp number, coordinates, and 20–30 km radius.' }, { status: 400 })
      const saved = { company: data.company, currency: data.currency, whatsapp: data.whatsapp || '', location: String(data.location || '').slice(0, 180), latitude: Number(data.latitude), longitude: Number(data.longitude), radius: Number(data.radius) }
      await db.insert(settings).values({ id: 'main', data: saved }).onConflictDoUpdate({ target: settings.id, set: { data: saved } })
      return Response.json({ ok: true }, { headers })
    }
    if (!body.data || !validate(body.kind, body.data)) return Response.json({ error: 'Check required fields, status, amounts, and coordinates.' }, { status: 400, headers })
    if (req.method === 'PATCH') {
      if (!/^[0-9a-f-]{36}$/i.test(body.id || '')) return Response.json({ error: 'Invalid record.' }, { status: 400 })
      const [updated] = await db.update(records).set({ data: body.data }).where(and(eq(records.id, body.id), eq(records.kind, body.kind))).returning()
      if (!updated) return Response.json({ error: 'Record not found.' }, { status: 404 })
      return Response.json(updated, { headers })
    }
    const [created] = await db.insert(records).values({ kind: body.kind, data: body.data }).returning()
    return Response.json(created, { status: 201, headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/operations' }
