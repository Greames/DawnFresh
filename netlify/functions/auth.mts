import type { Config } from '@netlify/functions'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { appUsers } from '../../db/schema.js'
import { profile, resolveAccess, sameOrigin } from '../../db/access.js'
import { checkCredentials, createSession, endAllSessions, endSession, hashPassword, validPassword, verifyPassword } from '../../db/auth.js'

const headers = { 'Cache-Control': 'no-store' }
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function hasActiveAdmin() {
  const [admin] = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.role, 'admin'), eq(appUsers.status, 'Active'), isNotNull(appUsers.passwordHash))).limit(1)
  return !!admin
}

function json(body: unknown, status = 200, cookie?: string) {
  return Response.json(body, { status, headers: cookie ? { ...headers, 'Set-Cookie': cookie } : headers })
}

export default async (req: Request) => {
  try {
    if (req.method === 'GET') {
      const access = await resolveAccess(req)
      if ('error' in access) return json({ user: null, error: access.status === 401 ? undefined : access.error, setupRequired: access.status === 401 && !(await hasActiveAdmin()), setupCodeRequired: !!process.env.OWNER_SETUP_CODE })
      return json({ user: profile(access) })
    }
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 4000) return json({ error: 'Request is too large.' }, 413)
    let body
    try { body = JSON.parse(raw) } catch { return json({ error: 'Invalid request data.' }, 400) }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

    if (body?.action === 'login') {
      if (!email || typeof body.password !== 'string' || body.password.length > 128) return json({ error: 'Enter your email and password.' }, 400)
      const result = await checkCredentials(email, body.password)
      if ('error' in result) return json({ error: result.error }, 401)
      return json({ ok: true }, 200, await createSession(req, result.user.id))
    }

    if (body?.action === 'logout') return json({ ok: true }, 200, await endSession(req))

    if (body?.action === 'setup') {
      // One-time owner setup, only while no active admin with a password exists.
      if (await hasActiveAdmin()) return json({ error: 'This workspace already has an administrator. Sign in instead.' }, 409)
      const setupCode = process.env.OWNER_SETUP_CODE
      if (setupCode && String(body.code || '') !== setupCode) return json({ error: 'The setup code is incorrect.' }, 403)
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
      if (!emailPattern.test(email) || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400)
      if (!validPassword(body.password)) return json({ error: 'Use a password of 8–128 characters.' }, 400)
      const values = { name: name || null, role: 'admin', franchiseId: null, permissions: {}, status: 'Active', passwordHash: await hashPassword(body.password), failedAttempts: 0, lockedUntil: null }
      const [owner] = await db.insert(appUsers).values({ email, ...values }).onConflictDoUpdate({ target: appUsers.email, set: values }).returning()
      // If two setups raced, only the earliest admin keeps the role.
      const [first] = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.role, 'admin'), isNotNull(appUsers.passwordHash))).orderBy(asc(appUsers.createdAt), asc(appUsers.id)).limit(1)
      if (first?.id !== owner.id) {
        await db.update(appUsers).set({ role: 'staff', passwordHash: null }).where(eq(appUsers.id, owner.id))
        return json({ error: 'This workspace already has an administrator. Sign in instead.' }, 409)
      }
      return json({ ok: true }, 201, await createSession(req, owner.id))
    }

    if (body?.action === 'password') {
      const access = await resolveAccess(req)
      if ('error' in access) return json({ error: access.error }, access.status)
      if (!(await verifyPassword(String(body.current || ''), access.account.passwordHash))) return json({ error: 'Your current password is incorrect.' }, 400)
      if (!validPassword(body.password)) return json({ error: 'Use a new password of 8–128 characters.' }, 400)
      await db.update(appUsers).set({ passwordHash: await hashPassword(body.password) }).where(eq(appUsers.id, access.account.id))
      await endAllSessions(access.account.id)
      return json({ ok: true }, 200, await createSession(req, access.account.id))
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch {
    return json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, 503)
  }
}

export const config: Config = { path: '/api/auth' }
