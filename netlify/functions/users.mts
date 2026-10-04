import type { Config } from '@netlify/functions'
import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { appUsers, franchises } from '../../db/schema.js'
import { resolveAccess, sameOrigin } from '../../db/access.js'
import type { AppUserRow } from '../../db/access.js'
import { endAllSessions, hashPassword, validPassword } from '../../db/auth.js'
import { roleModules, userStatuses } from '../../src/lib/business.js'
import type { Role } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Never returns the password hash.
function view(row: AppUserRow) {
  return { id: row.id, email: row.email, name: row.name || undefined, role: row.role, franchiseId: row.franchiseId, permissions: row.permissions, status: row.status, createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, hasPassword: !!row.passwordHash, locked: !!row.lockedUntil && row.lockedUntil > new Date() }
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

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (access.role !== 'admin') return Response.json({ error: 'Only administrators can manage users and access.' }, { status: 403, headers })
    if (req.method === 'GET') {
      const rows = await db.select().from(appUsers).orderBy(appUsers.createdAt)
      return Response.json({ users: rows.map(view) }, { headers })
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
    if (body.password && !validPassword(body.password)) return Response.json({ error: 'The password must be 8–128 characters.' }, { status: 400, headers })
    const passwordHash = body.password ? await hashPassword(String(body.password)) : null

    if (req.method === 'POST') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Response.json({ error: 'Enter a valid email address.' }, { status: 400, headers })
      if (!passwordHash) return Response.json({ error: 'Set a password so this user can sign in.' }, { status: 400, headers })
      const [taken] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.email, email))
      if (taken) return Response.json({ error: 'This email already has access. Edit the existing user instead.' }, { status: 409, headers })
      const [created] = await db.insert(appUsers).values({ email, passwordHash, ...cleaned.values }).returning()
      return Response.json(view(created), { status: 201, headers })
    }

    if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid user.' }, { status: 400, headers })
    const [existing] = await db.select().from(appUsers).where(eq(appUsers.id, body.id))
    if (!existing) return Response.json({ error: 'User not found.' }, { status: 404, headers })
    const losingAdmin = existing.role === 'admin' && (cleaned.values.role !== 'admin' || cleaned.values.status !== 'Active')
    if (losingAdmin && existing.id === access.account.id) return Response.json({ error: 'You cannot remove your own admin access. Ask another administrator.' }, { status: 400, headers })
    if (losingAdmin) {
      const [other] = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.role, 'admin'), eq(appUsers.status, 'Active'), isNotNull(appUsers.passwordHash), ne(appUsers.id, existing.id))).limit(1)
      if (!other) return Response.json({ error: 'Keep at least one active administrator.' }, { status: 400, headers })
    }
    const [updated] = await db.update(appUsers).set({ ...cleaned.values, ...(passwordHash ? { passwordHash, failedAttempts: 0, lockedUntil: null } : {}) }).where(eq(appUsers.id, existing.id)).returning()
    // A password reset or disabling signs the user out everywhere.
    if ((passwordHash || cleaned.values.status !== 'Active') && existing.id !== access.account.id) await endAllSessions(existing.id)
    return Response.json(view(updated), { headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/users' }
