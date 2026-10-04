import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { appUsers, franchises } from './schema.js'
import { sessionUser } from './auth.js'
import { can, resolvePermissions } from '../src/lib/business.js'
import type { AccessProfile, Module, Permissions, Role } from '../src/lib/business.js'

export type FranchiseRow = typeof franchises.$inferSelect
export type AppUserRow = typeof appUsers.$inferSelect
export type Access = {
  account: AppUserRow
  role: Role
  permissions: Permissions
  franchise: FranchiseRow | null
}
export type Denied = { error: string; status: number }

export function franchiseView(row: FranchiseRow) {
  return { ...row.data, id: row.id, email: row.email, createdAt: row.createdAt }
}

export function profile(access: Access): AccessProfile {
  return { id: access.account.id, role: access.role, permissions: access.permissions, name: access.account.name || undefined, email: access.account.email }
}

export function allowed(access: Access, module: Module, level: 'view' | 'edit') {
  return can(access.permissions, module, level)
}

// Every request is checked against the session and the user's current row, so role,
// permission and status changes apply immediately.
export async function resolveAccess(req: Request): Promise<Access | Denied> {
  const account = await sessionUser(req)
  if (!account) return { error: 'Sign in to access business records.', status: 401 }
  if (account.status !== 'Active') return { error: 'Your access has been disabled. Contact an administrator.', status: 403 }
  if (!account.lastSeenAt || Date.now() - account.lastSeenAt.getTime() > 5 * 60 * 1000) await db.update(appUsers).set({ lastSeenAt: new Date() }).where(eq(appUsers.id, account.id))
  const role = account.role as Role
  if (!['admin', 'staff', 'franchisee'].includes(role)) return { error: 'Your account has an unknown role. Contact an administrator.', status: 403 }
  let franchise: FranchiseRow | null = null
  if (role === 'franchisee') {
    if (account.franchiseId) [franchise] = await db.select().from(franchises).where(eq(franchises.id, account.franchiseId))
    if (!franchise) return { error: 'Your login is not linked to a franchise yet. Ask an administrator.', status: 403 }
    if (franchise.data.status !== 'Active') return { error: 'This franchise is inactive. Contact the company administrator.', status: 403 }
  }
  return { account, role, permissions: resolvePermissions(role, account.permissions), franchise }
}

// Cookie-authenticated writes must come from this site.
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (origin) return origin === new URL(req.url).origin
  return ['same-origin', 'none', null].includes(req.headers.get('sec-fetch-site'))
}
