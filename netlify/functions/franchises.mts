import { admin } from '@netlify/identity'
import type { User } from '@netlify/identity'
import type { Config } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises } from '../../db/schema.js'
import { franchiseView, resolveAccess, sameOrigin } from '../../db/access.js'
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

function validPassword(password: unknown) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 72
}

async function createLogin(email: string, password: string) {
  const user = await admin.createUser({ email, password, data: { app_metadata: { provider: 'email', roles: ['franchisee'] } } })
  return user.id
}

async function listLogins() {
  const users: User[] = []
  for (let page = 1; page <= 20; page++) {
    const batch = await admin.listUsers({ page, perPage: 100 })
    users.push(...batch)
    if (batch.length < 100) break
  }
  return users
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess()
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (access.scope !== 'company' || !access.admin) return Response.json({ error: 'Only company administrators can manage franchises.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const rows = await db.select().from(franchises).orderBy(franchises.createdAt)
      let users: User[] | null = null
      try { users = await listLogins() } catch { users = null }
      const logins = Object.fromEntries(rows.map(row => {
        const user = users?.find(candidate => candidate.id === row.userId) || users?.find(candidate => candidate.email?.toLowerCase() === row.email)
        return [row.id, user ? { exists: true, confirmedAt: user.confirmedAt, lastSignInAt: user.lastSignInAt, invitedAt: user.invitedAt, franchisee: !!user.roles?.includes('franchisee') } : { exists: false }]
      }))
      return Response.json({ franchises: rows.map(franchiseView), logins: users ? logins : null }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 8000) return Response.json({ error: 'Request is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    const data = clean(body?.data)
    if (!data) return Response.json({ error: 'Check the franchise name, location, coordinates, phone and status.' }, { status: 400, headers })
    if (body.password !== undefined && body.password !== '' && !validPassword(body.password)) return Response.json({ error: 'The login password must be 8–72 characters.' }, { status: 400, headers })
    const password = body.password ? String(body.password) : ''
    if (req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: 'Enter a valid login email for the franchisee.' }, { status: 400, headers })
      const [taken] = await db.select({ id: franchises.id }).from(franchises).where(eq(franchises.email, email))
      if (taken) return Response.json({ error: 'Another franchise already uses this login email.' }, { status: 409, headers })
      let userId: string | null = null
      if (password) {
        try { userId = await createLogin(email, password) }
        catch { return Response.json({ error: 'The login could not be created. If this email already has an account, save the franchise without a password and assign the franchisee role in Netlify Identity.' }, { status: 409, headers }) }
      }
      let created
      try { [created] = await db.insert(franchises).values({ email, userId, data }).returning() }
      catch (cause) { if (userId) await admin.deleteUser(userId).catch(() => undefined); throw cause }
      return Response.json(franchiseView(created), { status: 201, headers })
    }
    if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid franchise.' }, { status: 400, headers })
    const [existing] = await db.select().from(franchises).where(eq(franchises.id, body.id))
    if (!existing) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
    let userId = existing.userId
    if (password) {
      try {
        if (userId) await admin.updateUser(userId, { password })
        else userId = await createLogin(existing.email, password)
      } catch { return Response.json({ error: 'The login password could not be updated. Manage this account in Netlify Identity.' }, { status: 409, headers }) }
    }
    const [updated] = await db.update(franchises).set({ data, userId }).where(eq(franchises.id, existing.id)).returning()
    return Response.json(franchiseView(updated), { headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/franchises' }
