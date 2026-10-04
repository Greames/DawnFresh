import { admin } from '@netlify/identity'
import type { User } from '@netlify/identity'
import type { Config } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { appUsers, franchises } from '../../db/schema.js'
import { resolveAccess, sameOrigin } from '../../db/access.js'
import type { AppUserRow } from '../../db/access.js'
import { roleModules, userStatuses } from '../../src/lib/business.js'
import type { Role } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function listIdentityUsers() {
  const users: User[] = []
  for (let page = 1; page <= 20; page++) {
    const batch = await admin.listUsers({ page, perPage: 100 })
    users.push(...batch)
    if (batch.length < 100) break
  }
  return users
}

function view(row: AppUserRow, identity?: User) {
  return { id: row.id, email: row.email, name: row.name || undefined, role: row.role, franchiseId: row.franchiseId, permissions: row.permissions, status: row.status, identityId: row.identityId, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, login: identity ? { exists: true, lastSignInAt: identity.lastSignInAt, confirmedAt: identity.confirmedAt, invitedAt: identity.invitedAt } : { exists: false } }
}

// Keeps only modules the role can use and valid levels; missing modules use role defaults.
function cleanPermissions(role: Role, input: unknown) {
  if (role === 'admin' || !input || typeof input !== 'object' || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  return Object.fromEntries(roleModules[role].filter(module => ['none', 'view', 'edit'].includes(String(source[module]))).map(module => [module, String(source[module])]))
}

async function cleanAccess(body: Record<string, unknown>) {
  const role = String(body.role) as Role
  if (!['admin', 'staff', 'franchisee'].includes(role)) return { error: 'Choose a role.' }
  if (!userStatuses.includes(String(body.status))) return { error: 'Choose a status.' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length > 120) return { error: 'Name is too long.' }
  let franchiseId: string | null = null
  if (role === 'franchisee') {
    if (typeof body.franchiseId !== 'string' || !uuidPattern.test(body.franchiseId)) return { error: 'Choose the franchise this user works for.' }
    const [franchise] = await db.select({ id: franchises.id }).from(franchises).where(eq(franchises.id, body.franchiseId))
    if (!franchise) return { error: 'Choose the franchise this user works for.' }
    franchiseId = franchise.id
  }
  return { values: { role, status: String(body.status), name: name || null, franchiseId, permissions: cleanPermissions(role, body.permissions) } }
}

function validPassword(password: unknown) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 72
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess()
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (access.role !== 'admin') return Response.json({ error: 'Only administrators can manage users and access.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const rows = await db.select().from(appUsers).orderBy(appUsers.createdAt)
      let identities: User[] | null = null
      try { identities = await listIdentityUsers() } catch { identities = null }
      const match = (row: AppUserRow) => identities?.find(user => user.id === row.identityId) || identities?.find(user => !row.identityId && user.email?.toLowerCase() === row.email)
      const matched = new Set(rows.map(match).filter(Boolean).map(user => user!.id))
      // Signed-up or invited Identity accounts that have no access row yet.
      const pending = identities?.filter(user => !matched.has(user.id) && user.email).map(user => ({ identityId: user.id, email: user.email!.toLowerCase(), name: user.name, lastSignInAt: user.lastSignInAt, roles: user.roles || [] })) ?? null
      return Response.json({ users: rows.map(row => view(row, match(row))), pending, identityAvailable: !!identities }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 8000) return Response.json({ error: 'Request is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request data.' }, { status: 400, headers })
    const cleaned = await cleanAccess(body)
    if ('error' in cleaned) return Response.json({ error: cleaned.error }, { status: 400, headers })
    if (body.password && !validPassword(body.password)) return Response.json({ error: 'The password must be 8–72 characters.' }, { status: 400, headers })
    const password = body.password ? String(body.password) : ''

    if (req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: 'Enter a valid email address.' }, { status: 400, headers })
      const [taken] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email))
      if (taken) return Response.json({ error: 'This email already has access. Edit the existing user instead.' }, { status: 409, headers })
      let identityId: string | null = null
      if (password) {
        // Identity only authenticates; access comes from this table, so no Identity roles are written.
        try { identityId = (await admin.createUser({ email, password, data: { app_metadata: { provider: 'email' } } })).id }
        catch { return Response.json({ error: 'A login could not be created. If this email already has a Netlify Identity account, save without a password; access links on their next sign-in.' }, { status: 409, headers }) }
      }
      let created
      try { [created] = await db.insert(appUsers).values({ email, identityId, ...cleaned.values }).returning() }
      catch (cause) { if (identityId) await admin.deleteUser(identityId).catch(() => undefined); throw cause }
      return Response.json(view(created), { status: 201, headers })
    }

    if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid user.' }, { status: 400, headers })
    const [existing] = await db.select().from(appUsers).where(eq(appUsers.id, body.id))
    if (!existing) return Response.json({ error: 'User not found.' }, { status: 404, headers })
    const self = existing.identityId === access.user.id || existing.email === access.user.email?.toLowerCase()
    if (self && (cleaned.values.role !== 'admin' || cleaned.values.status !== 'Active')) return Response.json({ error: 'You cannot remove your own admin access. Ask another administrator.' }, { status: 400, headers })
    let identityId = existing.identityId
    if (password) {
      try {
        if (!identityId) identityId = (await listIdentityUsers()).find(user => user.email?.toLowerCase() === existing.email)?.id ?? null
        if (identityId) await admin.updateUser(identityId, { password })
        else identityId = (await admin.createUser({ email: existing.email, password, data: { app_metadata: { provider: 'email' } } })).id
      } catch { return Response.json({ error: 'The password could not be set. Manage this account in Netlify Identity.' }, { status: 409, headers }) }
    }
    const [updated] = await db.update(appUsers).set({ ...cleaned.values, identityId }).where(eq(appUsers.id, existing.id)).returning()
    return Response.json(view(updated), { headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/users' }
