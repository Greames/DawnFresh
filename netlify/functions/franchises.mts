import type { Config } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { appUsers, franchises } from '../../db/schema.js'
import { allowed, franchiseView, resolveAccess, sameOrigin } from '../../db/access.js'
import { FRANCHISE_RADIUS_KM, franchiseStatuses } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clean(data: Record<string, unknown>) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const location = typeof data.location === 'string' ? data.location.trim() : ''
  const phone = typeof data.phone === 'string' ? data.phone.trim() : ''
  const note = typeof data.note === 'string' ? data.note.trim() : ''
  const latitude = data.latitude, longitude = data.longitude
  if (!name || name.length > 120 || !location || location.length > 180 || note.length > 1000) return null
  if (phone && !/^\d{7,15}$/.test(phone)) return null
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null
  if (!franchiseStatuses.includes(String(data.status))) return null
  return { name, location, latitude, longitude, radius: FRANCHISE_RADIUS_KM, status: String(data.status), ...(phone ? { phone } : {}), ...(note ? { note } : {}) }
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (access.role === 'franchisee' || !allowed(access, 'franchises', 'view')) return Response.json({ error: 'You do not have access to the franchise network.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const rows = await db.select().from(franchises).orderBy(franchises.createdAt)
      const members = await db.select({ franchiseId: appUsers.franchiseId, status: appUsers.status, lastSeenAt: appUsers.lastSeenAt }).from(appUsers).where(eq(appUsers.role, 'franchisee'))
      const logins = Object.fromEntries(rows.map(row => {
        const linked = members.filter(member => member.franchiseId === row.id)
        const lastSeen = linked.map(member => member.lastSeenAt).filter(Boolean).sort().pop()
        return [row.id, { users: linked.length, active: linked.filter(member => member.status === 'Active').length, lastSignInAt: lastSeen ? new Date(lastSeen).toISOString() : undefined }]
      }))
      return Response.json({ franchises: rows.map(franchiseView), logins }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!allowed(access, 'franchises', 'edit')) return Response.json({ error: 'You have view-only access to the franchise network.' }, { status: 403, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 8000) return Response.json({ error: 'Request is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    const data = clean(body?.data)
    if (!data) return Response.json({ error: 'Check the franchise name, location, coordinates, phone and status.' }, { status: 400, headers })
    if (req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: 'Enter a valid contact email for the franchise.' }, { status: 400, headers })
      const [taken] = await db.select({ id: franchises.id }).from(franchises).where(eq(franchises.email, email))
      if (taken) return Response.json({ error: 'Another franchise already uses this contact email.' }, { status: 409, headers })
      const [created] = await db.insert(franchises).values({ email, data }).returning()
      return Response.json(franchiseView(created), { status: 201, headers })
    }
    if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid franchise.' }, { status: 400, headers })
    const [updated] = await db.update(franchises).set({ data }).where(eq(franchises.id, body.id)).returning()
    if (!updated) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
    return Response.json(franchiseView(updated), { headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/franchises' }
