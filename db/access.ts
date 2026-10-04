import { getUser } from '@netlify/identity'
import type { User } from '@netlify/identity'
import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { appUsers, franchises } from './schema.js'
import { can, resolvePermissions } from '../src/lib/business.js'
import type { AccessProfile, Module, Permissions, Role } from '../src/lib/business.js'

export type FranchiseRow = typeof franchises.$inferSelect
export type AppUserRow = typeof appUsers.$inferSelect
export type Access = {
  user: User
  account: AppUserRow | null
  role: Role
  permissions: Permissions
  // Accounts with the Netlify Identity `admin` role are owners: always admin, never locked out.
  owner: boolean
  franchise: FranchiseRow | null
}
export type Denied = { error: string; status: number }

export function franchiseView(row: FranchiseRow) {
  return { ...row.data, id: row.id, email: row.email, createdAt: row.createdAt }
}

export function profile(access: Access): AccessProfile {
  return { role: access.role, permissions: access.permissions, name: access.account?.name || access.user.name, email: access.user.email, owner: access.owner }
}

export function allowed(access: Access, module: Module, level: 'view' | 'edit') {
  return can(access.permissions, module, level)
}

async function findAccount(user: User) {
  let [account]: (AppUserRow | undefined)[] = await db.select().from(appUsers).where(eq(appUsers.identityId, user.id))
  if (!account && user.email) {
    ;[account] = await db.select().from(appUsers).where(eq(appUsers.email, user.email.toLowerCase()))
    // An access row is claimed by the first account that signs in with its email.
    if (account?.identityId && account.identityId !== user.id) account = undefined
  }
  return account || null
}

export async function resolveAccess(): Promise<Access | Denied> {
  const user = await getUser()
  if (!user) return { error: 'Sign in to access business records.', status: 401 }
  const owner = !!user.roles?.includes('admin')
  const account = await findAccount(user)
  if (account && (!account.identityId || !account.lastSeenAt || Date.now() - new Date(account.lastSeenAt).getTime() > 5 * 60 * 1000)) {
    await db.update(appUsers).set({ identityId: user.id, lastSeenAt: new Date() }).where(eq(appUsers.id, account.id))
  }
  if (owner) return { user, account, role: 'admin', permissions: resolvePermissions('admin'), owner, franchise: null }
  if (!account) return { error: 'Your account has no access yet. Ask an administrator to add you on the Users & access page.', status: 403 }
  if (account.status !== 'Active') return { error: 'Your access has been disabled. Contact an administrator.', status: 403 }
  const role = account.role as Role
  if (!['admin', 'staff', 'franchisee'].includes(role)) return { error: 'Your account has an unknown role. Contact an administrator.', status: 403 }
  let franchise: FranchiseRow | null = null
  if (role === 'franchisee') {
    if (account.franchiseId) [franchise] = await db.select().from(franchises).where(eq(franchises.id, account.franchiseId))
    if (!franchise) return { error: 'Your login is not linked to a franchise yet. Ask an administrator.', status: 403 }
    if (franchise.data.status !== 'Active') return { error: 'This franchise is inactive. Contact the company administrator.', status: 403 }
  }
  return { user, account, role, permissions: resolvePermissions(role, account.permissions), owner, franchise }
}

export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === new URL(req.url).origin
}
