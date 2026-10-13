import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pool, db } from './test-db.js'
import { appUsers, franchises } from '../../db/schema.js'
import { createSession } from '../../db/auth.js'

const migrationsDir = path.resolve(import.meta.dirname, '../../netlify/database/migrations')

// Refuses to run against anything that is not an obviously local test database, because
// it drops the public schema.
export async function resetDatabase() {
  const url = new URL(process.env.DATABASE_URL!)
  const name = url.pathname.slice(1)
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(url.hostname) || url.hostname.startsWith('/')
  if (!local || !/test/i.test(name)) throw new Error(`Refusing to reset "${name}" on "${url.hostname}": use a local database whose name contains "test".`)
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  for (const entry of readdirSync(migrationsDir).sort()) {
    const full = path.join(migrationsDir, entry)
    const file = statSync(full).isDirectory() ? path.join(full, 'migration.sql') : full
    await pool.query(readFileSync(file, 'utf8'))
  }
}

export async function createUser(role: 'admin' | 'staff' | 'franchisee', email: string, extra: { franchiseId?: string; permissions?: Record<string, string> } = {}) {
  const [user] = await db.insert(appUsers).values({
    email, name: email.split('@')[0], role, status: 'Active', passwordHash: null,
    franchiseId: extra.franchiseId ?? null, permissions: extra.permissions ?? {},
  }).returning()
  const setCookie = await createSession(new Request('http://localhost/'), user.id)
  return { user, cookie: setCookie.split(';')[0] }
}

export async function createFranchise(name: string, email: string, latitude = 14.7, longitude = 78.5) {
  const [row] = await db.insert(franchises).values({ email, data: { name, location: name, latitude, longitude, radius: 20, status: 'Active' } }).returning()
  return row
}

export type Actor = { user: typeof appUsers.$inferSelect; cookie: string }

export async function call(handler: (req: Request) => Promise<Response>, actor: Actor | null, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const headers: Record<string, string> = { origin: 'http://localhost', 'content-type': 'application/json' }
  if (actor) headers.cookie = actor.cookie
  const res = await handler(new Request('http://localhost/api/test', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json }
}
