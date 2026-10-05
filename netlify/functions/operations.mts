import type { Config } from '@netlify/functions'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises, records, settings } from '../../db/schema.js'
import { allowed, franchiseView, profile, resolveAccess, sameOrigin } from '../../db/access.js'
import { distance, franchiseKinds, segments, validRadius } from '../../src/lib/business.js'
import type { Kind, Module } from '../../src/lib/business.js'

const statuses: Record<string, string[]> = {
  processing: ['Planned', 'Processing', 'Quality Check', 'Completed', 'Rejected'],
  orders: ['Pending', 'Processing', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'],
  leads: ['New lead', 'Contacted', 'Qualified', 'Customer'],
  sourcing: ['Planned', 'Ordered', 'Received'],
  inventory: ['Available', 'Low stock', 'On hold'],
  outlets: ['Active', 'Inactive'],
  supply: ['Requested', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'],
}

function validate(kind: string, data: Record<string, unknown>) {
  if (typeof data !== 'object' || Array.isArray(data)) return false
  const textFields = ['name', 'status', 'product', 'unit', 'phone', 'note', 'date', 'expiry', 'outlet', 'batch', 'segment', 'placeId', 'customerType', 'channel', 'outletType', 'vehicleNumber', 'driver', 'paymentMethod', 'paymentReference', 'sourceStock', 'processingBatch']
  const numberFields = ['quantity', 'amount', 'paid', 'cost', 'temperature', 'latitude', 'longitude', 'inputQuantity', 'outputQuantity', 'wasteQuantity', 'yieldPct']
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
  if (['orders', 'sourcing', 'inventory', 'supply', 'processing'].includes(kind) && (!['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns'].includes(String(data.product)) || typeof data.quantity !== 'number' || (kind !== 'inventory' && data.quantity <= 0) || !['kg', 'trays', 'pieces'].includes(String(data.unit)))) return false
  if (['orders', 'sourcing', 'supply'].includes(kind) && (typeof data.amount !== 'number' || typeof data.paid !== 'number')) return false
  if (kind === 'orders' && !data.date) return false
  if ((data.latitude === undefined) !== (data.longitude === undefined)) return false
  if (data.phone && !/^\d{7,15}$/.test(String(data.phone))) return false
  if (kind === 'inventory' && (!data.batch || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.expiry)) || (data.date && String(data.expiry) < String(data.date)))) return false
  if (data.segment !== undefined && (kind !== 'leads' || !segments.includes(String(data.segment)))) return false
  if (data.placeId !== undefined && (kind !== 'leads' || !/^[A-Za-z0-9_-]{1,300}$/.test(String(data.placeId)))) return false
  if (data.temperature !== undefined && (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature))) return false
  if (kind === 'processing') {
    if (typeof data.inputQuantity !== 'number' || data.inputQuantity <= 0 || typeof data.outputQuantity !== 'number' || data.outputQuantity < 0 || typeof data.wasteQuantity !== 'number' || data.wasteQuantity < 0) return false
    if (data.outputQuantity + data.wasteQuantity > data.inputQuantity + 0.000001) return false
    const calculatedYield = data.inputQuantity ? data.outputQuantity / data.inputQuantity * 100 : 0
    if (data.yieldPct !== undefined && (typeof data.yieldPct !== 'number' || data.yieldPct < 0 || data.yieldPct > 100)) return false
    data.yieldPct = Number(calculatedYield.toFixed(2))
  }
  return true
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const networkKinds: string[] = ['orders', 'leads', 'supply', 'processing', 'inventory', 'outlets']

function outsideTerritory(data: Record<string, unknown>, franchise: { data: Record<string, unknown> }) {
  const center = { latitude: Number(franchise.data.latitude), longitude: Number(franchise.data.longitude) }
  if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return 'Franchise leads need latitude and longitude so the territory can be checked.'
  if (distance(data.latitude, data.longitude, center) > Number(franchise.data.radius)) return `This business is outside the franchise's ${franchise.data.radius} km territory.`
  return ''
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    const own = access.role === 'franchisee' ? access.franchise : null
    if (req.method === 'GET') {
      // Only record kinds the user may view are returned.
      const visible = (rows: (typeof records.$inferSelect)[]) => rows.filter(row => Object.hasOwn(statuses, row.kind) && allowed(access, row.kind as Module, 'view'))
      if (own) {
        const rows = await db.select().from(records).where(eq(records.franchiseId, own.id)).orderBy(desc(records.createdAt))
        const [configuration] = await db.select().from(settings).where(eq(settings.id, 'main'))
        return Response.json({ records: visible(rows), settings: { company: configuration?.data.company, currency: configuration?.data.currency }, franchise: franchiseView(own), access: profile(access) }, { headers })
      }
      const rows = await db.select().from(records).orderBy(desc(records.createdAt))
      const [configuration] = await db.select().from(settings).where(eq(settings.id, 'main'))
      const network = await db.select().from(franchises).orderBy(franchises.createdAt)
      // Without franchise-network access, staff still get names so network records stay labelled.
      const listed = allowed(access, 'franchises', 'view') ? network.map(franchiseView) : network.map(row => ({ id: row.id, name: row.data.name, location: '', latitude: 0, longitude: 0, radius: row.data.radius, status: row.data.status, email: '' }))
      return Response.json({ records: visible(rows), settings: configuration?.data || {}, franchises: listed, access: profile(access) }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 16000) return Response.json({ error: 'Record is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request data.' }, { status: 400, headers })
    if (body.kind === 'settings') {
      if (access.role !== 'admin') return Response.json({ error: 'Only administrators can change business settings.' }, { status: 403, headers })
      const data = body.data
      if (!data || typeof data.company !== 'string' || !data.company.trim() || data.company.length > 100 || !/^[A-Z]{3}$/.test(data.currency) || (data.whatsapp && !/^\d{7,15}$/.test(data.whatsapp)) || !Number.isFinite(Number(data.latitude)) || Math.abs(Number(data.latitude)) > 90 || !Number.isFinite(Number(data.longitude)) || Math.abs(Number(data.longitude)) > 180 || !validRadius(Number(data.radius))) return Response.json({ error: 'Check company, currency, international WhatsApp number, coordinates, and a 1–50 km radius.' }, { status: 400, headers })
      const saved = { company: data.company, currency: data.currency, whatsapp: data.whatsapp || '', location: String(data.location || '').slice(0, 180), latitude: Number(data.latitude), longitude: Number(data.longitude), radius: Number(data.radius) }
      await db.insert(settings).values({ id: 'main', data: saved }).onConflictDoUpdate({ target: settings.id, set: { data: saved } })
      return Response.json({ ok: true }, { headers })
    }
    if (own && !franchiseKinds.includes(body.kind as Kind)) return Response.json({ error: 'Franchise accounts can manage orders, leads, supply, processing, inventory and outlet records.' }, { status: 403, headers })
    if (typeof body.kind !== 'string' || !Object.hasOwn(statuses, body.kind)) return Response.json({ error: 'Unknown record type.' }, { status: 400, headers })
    if (!allowed(access, body.kind as Module, 'edit')) return Response.json({ error: 'You have view-only or no access to these records. Ask an administrator.' }, { status: 403, headers })
    if (!body.data || !validate(body.kind, body.data)) return Response.json({ error: 'Check required fields, status, amounts, and coordinates.' }, { status: 400, headers })
    const data: Record<string, unknown> = { ...body.data }
    let existing: typeof records.$inferSelect | undefined
    if (req.method === 'PATCH') {
      if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid record.' }, { status: 400, headers })
      ;[existing] = await db.select().from(records).where(and(eq(records.id, body.id), eq(records.kind, body.kind)))
      if (!existing || (own && existing.franchiseId !== own.id)) return Response.json({ error: 'Record not found.' }, { status: 404, headers })
      if (existing.data.placeId) data.placeId = existing.data.placeId
      else delete data.placeId
    }
    // Which franchise the record belongs to is decided by the server: a franchisee's own,
    // or the one an administrator/staff member selected (company-direct when empty).
    let franchise = own
    if (!own) {
      const requested = 'franchiseId' in body ? body.franchiseId : existing?.franchiseId
      if (requested && !networkKinds.includes(body.kind)) return Response.json({ error: 'Only orders, leads and supply can belong to a franchise.' }, { status: 400, headers })
      if (requested) {
        if (typeof requested !== 'string' || !uuidPattern.test(requested)) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400, headers })
        ;[franchise] = await db.select().from(franchises).where(eq(franchises.id, requested))
        if (!franchise) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400, headers })
      }
    }
    if (body.kind === 'supply' && !franchise) return Response.json({ error: 'Choose the franchise this supply is for.' }, { status: 400, headers })
    if (body.kind === 'leads' && franchise) {
      const problem = outsideTerritory(data, franchise)
      if (problem) return Response.json({ error: problem }, { status: 400, headers })
    }
    if (body.kind === 'supply' && franchise) data.name = String(franchise.data.name)
    if (body.kind === 'supply' && own) {
      // Franchisees request supply; the company confirms price, dispatch and payments.
      if (existing && existing.data.status !== 'Requested') return Response.json({ error: 'The company has already confirmed this supply. Contact them to change it.' }, { status: 409, headers })
      if (existing && !['Requested', 'Cancelled'].includes(String(data.status))) return Response.json({ error: 'You can only cancel a supply request.' }, { status: 400, headers })
      if (!existing) data.status = 'Requested'
      data.amount = 0
      data.paid = 0
    }
    if (body.kind === 'leads' && data.placeId && !existing) {
      const [claimed] = await db.select({ id: records.id }).from(records).where(and(eq(records.kind, 'leads'), sql`${records.data}->>'placeId' = ${String(data.placeId)}`)).limit(1)
      if (claimed) return Response.json({ error: 'This business is already a lead in the network.' }, { status: 409, headers })
    }
    const franchiseId = franchise?.id ?? null
    if (existing) {
      const [updated] = await db.update(records).set({ data, franchiseId }).where(eq(records.id, existing.id)).returning()
      return Response.json(updated, { headers })
    }
    const [created] = await db.insert(records).values({ kind: body.kind, data, franchiseId }).returning()
    return Response.json(created, { status: 201, headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/operations' }
