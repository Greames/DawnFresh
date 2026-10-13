import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from './index.js'
import { idempotencyKeys } from './schema.js'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Throw inside a transaction to roll it back and answer the client with this status and message. */
export class Rejection extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export type Outcome = { status: number; body: unknown }
export type Done = Outcome & { replayed: boolean }

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The caller's key: header `Idempotency-Key`, else `idempotencyKey` at the top level or inside `data`. */
export function idempotencyKeyOf(req: Request, body: unknown): string | null {
  const b = body as { idempotencyKey?: unknown; data?: { idempotencyKey?: unknown } } | null
  const raw = req.headers.get('idempotency-key') ?? b?.idempotencyKey ?? b?.data?.idempotencyKey
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 120) throw new Rejection(400, 'Idempotency-Key must be a string of at most 120 characters.')
  return raw.trim()
}

/**
 * Runs `fn` in one transaction. With a key, the key is claimed first inside the same transaction: a second request
 * with the same key waits for the first to finish, then gets the first response replayed (nothing is written
 * twice); if the first rolled back the second runs normally. The stored response is committed with the change.
 * The request hash makes reusing a key for a different request an error instead of a silent replay.
 */
export async function transact(
  opts: { actor: string; action: string; key: string | null; payload: unknown },
  fn: (tx: Tx) => Promise<Outcome>,
): Promise<Done> {
  return db.transaction(async tx => {
    let hash = ''
    if (opts.key) {
      const { key, action, actor } = { key: opts.key, action: opts.action, actor: opts.actor }
      hash = createHash('sha256').update(stable(opts.payload)).digest('hex')
      const claimed = await tx.insert(idempotencyKeys).values({ actorUserId: actor, action, key, requestHash: hash }).onConflictDoNothing().returning({ id: idempotencyKeys.id })
      if (!claimed.length) {
        const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.actorUserId, actor), eq(idempotencyKeys.action, action), eq(idempotencyKeys.key, key)))
        if (!row || row.requestHash !== hash) throw new Rejection(409, 'This Idempotency-Key was already used for a different request.')
        if (row.responseStatus === null) throw new Rejection(409, 'A request with this Idempotency-Key is still being processed. Retry shortly.')
        const stored = row.responseBody
        return { status: row.responseStatus, body: stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored, replayed: true } : stored, replayed: true }
      }
    }
    const out = await fn(tx)
    if (opts.key) {
      await tx.update(idempotencyKeys).set({ responseStatus: out.status, responseBody: out.body })
        .where(and(eq(idempotencyKeys.actorUserId, opts.actor), eq(idempotencyKeys.action, opts.action), eq(idempotencyKeys.key, opts.key)))
    }
    return { ...out, replayed: false }
  })
}

/** Turns a transaction result into a Response. */
export function respond(done: Done, headers: Record<string, string>) {
  return Response.json(done.body, { status: done.status, headers: done.replayed ? { ...headers, 'Idempotent-Replayed': 'true' } : headers })
}

/**
 * Maps a thrown error to a response. Rejections carry their own safe message. Everything else is logged on the
 * server with its cause and answered with a generic message, so SQL and constraint names never reach the client.
 */
export function failure(error: unknown, headers: Record<string, string>, generic: string) {
  if (error instanceof Rejection) return Response.json({ error: error.message }, { status: error.status, headers })
  const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code
  const cause = (error as { cause?: { constraint?: string; message?: string } })?.cause
  if (code && ['23505', '23514', '23503', '40001', '40P01'].includes(code)) console.warn(`database refused a write (${code}${cause?.constraint ? `, ${cause.constraint}` : ''}): ${cause?.message ?? ''}`)
  else console.error(error, cause ?? '')
  if (code === '23505') return Response.json({ error: 'A matching record already exists.' }, { status: 409, headers })
  if (code === '23514') return Response.json({ error: 'The change was refused because it would break a stock, quantity or payment limit.' }, { status: 409, headers })
  if (code === '23503') return Response.json({ error: 'A referenced record does not exist.' }, { status: 400, headers })
  if (code === '40001' || code === '40P01') return Response.json({ error: 'The system was busy with a conflicting change. Please retry.' }, { status: 409, headers })
  return Response.json({ error: generic }, { status: 500, headers })
}
