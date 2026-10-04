import { getUser } from '@netlify/identity'
import type { User } from '@netlify/identity'
import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { franchises } from './schema.js'

export type FranchiseRow = typeof franchises.$inferSelect
export type Access =
  | { scope: 'company'; user: User; admin: boolean }
  | { scope: 'franchise'; user: User; franchise: FranchiseRow }
  | { error: string; status: number }

export function franchiseView(row: FranchiseRow) {
  return { ...row.data, id: row.id, email: row.email, createdAt: row.createdAt }
}

// Company roles (admin/staff) take precedence. A franchisee is bound to exactly one
// franchise by the account id recorded at creation, or by the invited email address.
export async function resolveAccess(): Promise<Access> {
  const user = await getUser()
  if (!user) return { error: 'Sign in to access business records.', status: 401 }
  const roles = user.roles || []
  if (roles.includes('admin') || roles.includes('staff')) return { scope: 'company', user, admin: roles.includes('admin') }
  if (!roles.includes('franchisee')) return { error: 'An administrator must assign you the staff, admin or franchisee role in Netlify Identity.', status: 403 }
  let [franchise]: (FranchiseRow | undefined)[] = await db.select().from(franchises).where(eq(franchises.userId, user.id))
  if (!franchise && user.email) [franchise] = await db.select().from(franchises).where(eq(franchises.email, user.email.toLowerCase()))
  if (franchise?.userId && franchise.userId !== user.id) franchise = undefined
  if (!franchise) return { error: 'Your franchise login is not linked to a franchise location yet. Ask the company administrator.', status: 403 }
  if (franchise.data.status !== 'Active') return { error: 'This franchise is inactive. Contact the company administrator.', status: 403 }
  if (!franchise.userId) await db.update(franchises).set({ userId: user.id }).where(eq(franchises.id, franchise.id))
  return { scope: 'franchise', user, franchise }
}

export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return !origin || origin === new URL(req.url).origin
}
