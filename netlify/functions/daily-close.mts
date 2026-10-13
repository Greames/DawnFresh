import type { Config } from '@netlify/functions'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, franchiseDailyCloses, franchises } from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { Rejection, failure, idempotencyKeyOf, respond, transact } from '../../db/tx.js'
import type { Tx } from '../../db/tx.js'
import { cashForDay, lockBusinessDay, openShiftsOf, windowFigures } from '../../db/daily-close.js'
import { businessDateOf, isBusinessDate } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const s = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''

/**
 * Daily franchise close, one record per franchise per IST business date.
 * - close-day: refuses while any of the franchise's outlets still has an open shift; otherwise snapshots sales, returns,
 *   credit sales, collections by method, expected versus counted cash, wastage, stock count variance and supply received
 *   from the ledgers, and signs the day off (franchisee for their own franchise, or company staff).
 * - reopen-day: company staff only, with a mandatory reason. Re-closing replaces the snapshot.
 * While a day is Closed the POS refuses sales, returns, wastage, counts, adjustments, receivable collections and shift opens
 * for that franchise on that date.
 */
export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'pos', 'view')) return Response.json({ error: 'POS access is required.' }, { status: 403, headers })
    const own = access.role === 'franchisee' ? access.franchise!.id : null

    if (req.method === 'GET') {
      const requested = new URL(req.url).searchParams.get('franchiseId')
      if (requested && !uuidPattern.test(requested)) return Response.json({ error: 'Invalid franchise.' }, { status: 400, headers })
      if (own && requested && requested !== own) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
      const franchiseId = own ?? requested
      const rows = await db.select().from(franchiseDailyCloses).where(franchiseId ? eq(franchiseDailyCloses.franchiseId, franchiseId) : undefined).orderBy(desc(franchiseDailyCloses.businessDate)).limit(400)
      return Response.json({ closes: rows }, { headers })
    }

    if (req.method !== 'POST' || !sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    if (!allowed(access, 'pos', 'edit')) return Response.json({ error: 'POS edit access is required.' }, { status: 403, headers })
    const body = await req.json()
    const action = s(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id
    const key = idempotencyKeyOf(req, body)
    const run = (fn: (tx: Tx) => Promise<{ status: number; body: unknown }>) => transact({ actor, action, key, payload: { ...data, franchiseId: own ?? data.franchiseId } }, fn)

    const franchiseId = own ?? s(data.franchiseId, 80)
    const date = data.businessDate
    if (!uuidPattern.test(franchiseId)) return Response.json({ error: 'A valid franchise is required.' }, { status: 400, headers })
    if (own && data.franchiseId && data.franchiseId !== own) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
    if (!isBusinessDate(date)) return Response.json({ error: 'businessDate must be an IST calendar date (YYYY-MM-DD).' }, { status: 400, headers })
    if (date > businessDateOf(new Date())) return Response.json({ error: 'A future business day cannot be closed.' }, { status: 400, headers })

    if (action === 'close-day') {
      const notes = s(data.notes, 500) || null
      const done = await run(async tx => {
        const [franchise] = await tx.select({ id: franchises.id }).from(franchises).where(eq(franchises.id, franchiseId))
        if (!franchise) throw new Rejection(404, 'Franchise not found.')
        await lockBusinessDay(tx, franchiseId, date, 'exclusive')
        const [existing] = await tx.select().from(franchiseDailyCloses).where(and(eq(franchiseDailyCloses.franchiseId, franchiseId), eq(franchiseDailyCloses.businessDate, date)))
        if (existing?.status === 'Closed') throw new Rejection(409, `The business day ${date} is already closed for this franchise.`)
        const open = await openShiftsOf(tx, franchiseId)
        if (open.length) throw new Rejection(409, `${open.length} shift(s) are still open at this franchise's outlets. Close every shift (count the cash) before closing the day.`)
        const figures = await windowFigures(tx, franchiseId, date, date)
        const cash = await cashForDay(tx, franchiseId, date)
        const totals = { businessDate: date, ...figures, cash }
        const values = { status: 'Closed', totals, expectedCash: String(cash.expected), countedCash: String(cash.counted), cashVariance: String(cash.variance), notes, closedBy: actor, closedAt: new Date() }
        const [row] = existing
          ? await tx.update(franchiseDailyCloses).set(values).where(eq(franchiseDailyCloses.id, existing.id)).returning()
          : await tx.insert(franchiseDailyCloses).values({ franchiseId, businessDate: date, ...values }).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'franchise_daily_close', entityId: row.id, action: existing ? 'reclosed' : 'closed', metadata: { businessDate: date, salesTotal: figures.sales.total, returns: figures.returns.amount, expectedCash: cash.expected, countedCash: cash.counted, cashVariance: cash.variance, idempotencyKey: key } })
        return { status: 201, body: row }
      })
      return respond(done, headers)
    }

    if (action === 'reopen-day') {
      if (access.role === 'franchisee') return Response.json({ error: 'Only company staff can reopen a closed day.' }, { status: 403, headers })
      const reason = s(data.reason, 300)
      if (!reason) return Response.json({ error: 'A reason is required to reopen a closed day.' }, { status: 400, headers })
      const done = await run(async tx => {
        await lockBusinessDay(tx, franchiseId, date, 'exclusive')
        const [existing] = await tx.select().from(franchiseDailyCloses).where(and(eq(franchiseDailyCloses.franchiseId, franchiseId), eq(franchiseDailyCloses.businessDate, date))).for('update')
        if (!existing || existing.status !== 'Closed') throw new Rejection(409, `The business day ${date} is not closed for this franchise.`)
        const [row] = await tx.update(franchiseDailyCloses).set({ status: 'Reopened', reopenedBy: actor, reopenedAt: new Date(), reopenReason: reason, reopenCount: existing.reopenCount + 1 }).where(eq(franchiseDailyCloses.id, existing.id)).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'franchise_daily_close', entityId: row.id, action: 'reopened', metadata: { businessDate: date, reason, previousClosedBy: existing.closedBy, previousClosedAt: existing.closedAt.toISOString(), idempotencyKey: key } })
        return { status: 200, body: row }
      })
      return respond(done, headers)
    }

    return Response.json({ error: 'Unknown daily close action.' }, { status: 400, headers })
  } catch (e) {
    return failure(e, headers, 'Daily close could not be completed.')
  }
}

export const config: Config = { path: '/api/daily-close' }
