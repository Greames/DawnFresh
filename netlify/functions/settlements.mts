import type { Config } from '@netlify/functions'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, franchises, settlementAdjustments, settlementPayments, settlementRecords } from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { Rejection, failure, idempotencyKeyOf, respond, transact } from '../../db/tx.js'
import type { Tx } from '../../db/tx.js'
import { supplyTotals } from '../../db/settlement.js'
import { r2 } from '../../db/stock.js'
import { businessDateOf, businessPeriodRange, isBusinessDate } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const n = (v: unknown, d = Number.NaN) => { const x = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : Number.NaN; return Number.isFinite(x) ? x : d }
const s = (v: unknown, m = 500) => typeof v === 'string' ? v.trim().slice(0, m) : ''
const MAX_DAYS = 400
const EPS = 0.0001

/**
 * Derived franchise settlement. The server computes everything from the supply ledger:
 *   amount due = supply value - supply returns value + adjustments        (what the franchise owes for the period)
 *   outstanding = amount due - payments the franchise has made to the company
 * The client names the franchise, the inclusive IST business-date period and adjustments with reasons. Nothing the
 * franchise collects from its own customers (sales, credit, receivables) enters this amount.
 */
export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'supply', 'view')) return Response.json({ error: 'Supply access is required.' }, { status: 403, headers })
    const own = access.role === 'franchisee' ? access.franchise!.id : null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const franchiseParam = url.searchParams.get('franchiseId')
      if (franchiseParam && !uuidPattern.test(franchiseParam)) return Response.json({ error: 'Invalid franchise.' }, { status: 400, headers })
      if (own && franchiseParam && franchiseParam !== own) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
      const franchiseId = own ?? franchiseParam
      const from = url.searchParams.get('from'), to = url.searchParams.get('to')
      if (from || to) {
        // Preview: the figures a settlement for this period would carry, without creating anything.
        if (!franchiseId || !isBusinessDate(from) || !isBusinessDate(to) || to < from) return Response.json({ error: 'A franchise and an inclusive from/to date (YYYY-MM-DD) are required.' }, { status: 400, headers })
        const t = await db.transaction(tx => supplyTotals(tx, franchiseId, from, to))
        return Response.json({ franchiseId, from, to, ...t, amountDueBeforeAdjustments: r2(t.supplyValue - t.returnsValue) }, { headers })
      }
      const rows = await db.select().from(settlementRecords).where(franchiseId ? eq(settlementRecords.franchiseId, franchiseId) : undefined).orderBy(desc(settlementRecords.createdAt))
      const ids = new Set(rows.map(r => r.id))
      const [adjustments, payments] = await Promise.all([
        db.select().from(settlementAdjustments).orderBy(asc(settlementAdjustments.createdAt)),
        db.select().from(settlementPayments).orderBy(asc(settlementPayments.paidAt)),
      ])
      return Response.json({
        settlements: rows.map(r => ({ ...r, outstanding: r2(Number(r.amountDue) - Number(r.paymentsTotal)) })),
        adjustments: adjustments.filter(a => ids.has(a.settlementId)),
        payments: payments.filter(p => ids.has(p.settlementId)),
      }, { headers })
    }

    if (req.method !== 'POST' || !sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    if (access.role === 'franchisee' || !allowed(access, 'supply', 'edit')) return Response.json({ error: 'Only authorized company staff can create settlements or record settlement payments.' }, { status: 403, headers })
    const body = await req.json()
    const action = s(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id
    const key = idempotencyKeyOf(req, body)
    const run = (fn: (tx: Tx) => Promise<{ status: number; body: unknown }>) => transact({ actor, action, key, payload: data }, fn)

    if (action === 'create-settlement') {
      const franchiseId = s(data.franchiseId, 80), from = data.periodStart, to = data.periodEnd
      if (!uuidPattern.test(franchiseId)) return Response.json({ error: 'A valid franchise is required.' }, { status: 400, headers })
      if (!isBusinessDate(from) || !isBusinessDate(to) || to < from) return Response.json({ error: 'The period needs inclusive start and end business dates (YYYY-MM-DD), end not before start.' }, { status: 400, headers })
      if (to > businessDateOf(new Date())) return Response.json({ error: 'A settlement period cannot end in the future.' }, { status: 400, headers })
      if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 + 1 > MAX_DAYS) return Response.json({ error: `A settlement period can cover at most ${MAX_DAYS} days.` }, { status: 400, headers })
      // The client sends adjustments with reasons only: any money figure beyond that is ignored by design.
      const rawAdjustments = data.adjustments === undefined ? [] : data.adjustments
      if (!Array.isArray(rawAdjustments) || rawAdjustments.length > 20) return Response.json({ error: 'Adjustments must be a list of at most 20.' }, { status: 400, headers })
      const adjustments: { amount: number; reason: string }[] = []
      for (const a of rawAdjustments) {
        const amount = n(a?.amount), reason = s(a?.reason, 300)
        if (!Number.isFinite(amount) || r2(amount) === 0 || Math.abs(amount) > 1e9) return Response.json({ error: 'Each adjustment needs a non-zero amount (positive: the franchise owes more).' }, { status: 400, headers })
        if (!reason) return Response.json({ error: 'Each adjustment needs a reason.' }, { status: 400, headers })
        adjustments.push({ amount: r2(amount), reason })
      }
      const { start, end } = businessPeriodRange(from, to)
      const done = await run(async tx => {
        const [franchise] = await tx.select({ id: franchises.id }).from(franchises).where(eq(franchises.id, franchiseId))
        if (!franchise) throw new Rejection(400, 'A valid franchise is required.')
        // Serialize settlements of one franchise so the overlap check cannot be raced.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'settlement:' + franchiseId}))`)
        const [overlap] = await tx.select({ id: settlementRecords.id, from: settlementRecords.periodStartDate, to: settlementRecords.periodEndDate }).from(settlementRecords)
          .where(and(eq(settlementRecords.franchiseId, franchiseId), lte(settlementRecords.periodStartDate, to), gte(settlementRecords.periodEndDate, from))).limit(1)
        if (overlap) throw new Rejection(409, `This period overlaps an existing settlement (${overlap.from} to ${overlap.to}) for the franchise.`)
        const totals = await supplyTotals(tx, franchiseId, from, to)
        if (totals.uncostedMovements > 0) throw new Rejection(409, `${totals.uncostedMovements} supply movement(s) in this period have no company price recorded, so their value is unknown. Set the company price and correct those lots before settling.`)
        const adjustmentTotal = r2(adjustments.reduce((a, x) => a + x.amount, 0))
        const amountDue = r2(totals.supplyValue - totals.returnsValue + adjustmentTotal)
        if (amountDue < 0) throw new Rejection(409, `The adjustments make the amount due negative (${amountDue.toFixed(2)}). Settle credits to the franchise outside this record.`)
        const status = amountDue === 0 ? 'Settled' : 'Open'
        const [settlement] = await tx.insert(settlementRecords).values({
          franchiseId, periodStart: start, periodEnd: end, periodStartDate: from, periodEndDate: to, derived: true,
          supplyValue: String(totals.supplyValue), returnsValue: String(totals.returnsValue), adjustments: String(adjustmentTotal), amountDue: String(amountDue),
          paymentsTotal: '0', status, settledAt: status === 'Settled' ? new Date() : null, createdBy: actor,
        }).returning()
        const saved = adjustments.length ? await tx.insert(settlementAdjustments).values(adjustments.map(a => ({ settlementId: settlement.id, franchiseId, amount: String(a.amount), reason: a.reason, createdBy: actor }))).returning() : []
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'franchise_settlement', entityId: settlement.id, action: 'created', metadata: { periodStart: from, periodEnd: to, ...totals, adjustments: adjustmentTotal, amountDue, status, idempotencyKey: key } })
        for (const a of saved) {
          await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'settlement_adjustment', entityId: a.id, action: 'recorded', metadata: { settlementId: settlement.id, amount: Number(a.amount), reason: a.reason } })
        }
        return { status: 201, body: { settlement: { ...settlement, outstanding: amountDue }, adjustments: saved } }
      })
      return respond(done, headers)
    }

    if (action === 'record-settlement-payment') {
      const settlementId = s(data.settlementId, 80), amount = n(data.amount), method = s(data.method, 40) || 'Bank'
      if (!uuidPattern.test(settlementId)) return Response.json({ error: 'Settlement not found.' }, { status: 404, headers })
      if (!Number.isFinite(amount) || r2(amount) <= 0 || amount > 1e9) return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400, headers })
      const done = await run(async tx => {
        // The settlement row is the lock for its balance: concurrent payments queue here and re-read the total.
        const [settlement] = await tx.select().from(settlementRecords).where(eq(settlementRecords.id, settlementId)).for('update')
        if (!settlement) throw new Rejection(404, 'Settlement not found.')
        if (!settlement.derived) throw new Rejection(409, 'This is a legacy manually entered settlement and is read-only. Create a derived settlement for the period instead.')
        const outstanding = r2(Number(settlement.amountDue) - Number(settlement.paymentsTotal))
        if (r2(amount) > outstanding + EPS) throw new Rejection(409, `The payment exceeds the outstanding amount of ${outstanding.toFixed(2)}.`)
        const [payment] = await tx.insert(settlementPayments).values({ settlementId, franchiseId: settlement.franchiseId, amount: String(r2(amount)), method, reference: s(data.reference, 200) || null, recordedBy: actor }).returning()
        const paid = r2(Number(settlement.paymentsTotal) + amount), left = r2(Number(settlement.amountDue) - paid)
        const status = left <= EPS ? 'Settled' : 'Partially Settled'
        const [updated] = await tx.update(settlementRecords).set({ paymentsTotal: String(paid), status, settledAt: status === 'Settled' ? new Date() : null }).where(eq(settlementRecords.id, settlementId)).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: settlement.franchiseId, entityType: 'settlement_payment', entityId: payment.id, action: 'paid', metadata: { settlementId, amount: r2(amount), method, paymentsTotal: paid, outstanding: left, status, idempotencyKey: key } })
        return { status: 201, body: { settlement: { ...updated, outstanding: left }, payment } }
      })
      return respond(done, headers)
    }

    return Response.json({ error: 'Unknown settlement action.' }, { status: 400, headers })
  } catch (e) {
    return failure(e, headers, 'Settlement operation failed.')
  }
}

export const config: Config = { path: '/api/settlements' }
