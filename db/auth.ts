import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import { db } from './index.js'
import { appUsers, passwordTokens, sessions } from './schema.js'

export const SESSION_COOKIE = 'fr_session'
const SESSION_DAYS = 14
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15
const KEY_LENGTH = 64
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, COST, (error, key) => error ? reject(error) : resolve(key)))
}

export function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`
}

// Used when the email is unknown so failed sign-ins take the same time either way.
const decoy = hashPassword(randomBytes(16).toString('hex'))

export async function verifyPassword(password: string, stored: string | null) {
  const [scheme, salt, expected] = (stored || await decoy).split('$')
  if (scheme !== 'scrypt' || !salt || !expected) return false
  const key = await derive(password, Buffer.from(salt, 'base64'))
  const target = Buffer.from(expected, 'base64')
  return key.length === target.length && timingSafeEqual(key, target) && !!stored
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function readSessionToken(req: Request) {
  const cookie = req.headers.get('cookie') || ''
  const match = cookie.split(/;\s*/).find(part => part.startsWith(`${SESSION_COOKIE}=`))
  const token = match?.slice(SESSION_COOKIE.length + 1)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

function cookie(req: Request, value: string, maxAge: number) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export async function createSession(req: Request, userId: string) {
  const token = randomBytes(32).toString('base64url')
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  await db.insert(sessions).values({ tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) })
  return cookie(req, token, SESSION_DAYS * 86400)
}

export async function endSession(req: Request) {
  const token = readSessionToken(req)
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)))
  return cookie(req, '', 0)
}

export async function endAllSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId))
}

export async function sessionUser(req: Request) {
  const token = readSessionToken(req)
  if (!token) return null
  const [row] = await db.select({ user: appUsers }).from(sessions).innerJoin(appUsers, eq(sessions.userId, appUsers.id)).where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
  return row?.user ?? null
}

// Returns the user on success; counts failures and locks the account briefly after repeated failures.
export async function checkCredentials(email: string, password: string) {
  const [user] = await db.select().from(appUsers).where(eq(appUsers.email, email.trim().toLowerCase()))
  if (user?.lockedUntil && user.lockedUntil > new Date()) return { error: `Too many attempts. Try again after ${LOCK_MINUTES} minutes or ask an administrator to reset your password.` }
  const ok = await verifyPassword(password, user?.passwordHash ?? null)
  if (!user || !ok) {
    if (user) {
      const failed = user.failedAttempts + 1
      await db.update(appUsers).set({ failedAttempts: failed >= MAX_FAILED_ATTEMPTS ? 0 : failed, lockedUntil: failed >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null }).where(eq(appUsers.id, user.id))
    }
    return { error: 'Incorrect email or password.' }
  }
  if (user.status !== 'Active') return { error: 'Your access has been disabled. Contact an administrator.' }
  await db.update(appUsers).set({ failedAttempts: 0, lockedUntil: null, lastSeenAt: new Date() }).where(eq(appUsers.id, user.id))
  return { user }
}

// One-time links for setting (invite) or resetting a password. Issuing a new link
// invalidates the user's earlier unused links.
export async function createPasswordToken(userId: string, purpose: 'invite' | 'reset', hours: number) {
  const token = randomBytes(32).toString('base64url')
  await db.delete(passwordTokens).where(eq(passwordTokens.userId, userId))
  await db.insert(passwordTokens).values({ tokenHash: tokenHash(token), userId, purpose, expiresAt: new Date(Date.now() + hours * 3600000) })
  return token
}

export async function recentPasswordToken(userId: string, minutes: number) {
  const [row] = await db.select({ tokenHash: passwordTokens.tokenHash }).from(passwordTokens).where(and(eq(passwordTokens.userId, userId), gt(passwordTokens.createdAt, new Date(Date.now() - minutes * 60000)), isNull(passwordTokens.usedAt))).limit(1)
  return !!row
}

export async function passwordTokenUser(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const [row] = await db.select({ user: appUsers, purpose: passwordTokens.purpose }).from(passwordTokens).innerJoin(appUsers, eq(passwordTokens.userId, appUsers.id)).where(and(eq(passwordTokens.tokenHash, tokenHash(token)), gt(passwordTokens.expiresAt, new Date()), isNull(passwordTokens.usedAt)))
  return row && row.user.status === 'Active' ? row : null
}

// Marks the link used; succeeds only once even if two requests race.
export async function consumePasswordToken(token: string) {
  const [used] = await db.update(passwordTokens).set({ usedAt: new Date() }).where(and(eq(passwordTokens.tokenHash, tokenHash(token)), gt(passwordTokens.expiresAt, new Date()), isNull(passwordTokens.usedAt))).returning({ userId: passwordTokens.userId })
  return used?.userId ?? null
}
