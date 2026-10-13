import type { Config } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises } from '../../db/schema.js'
import { allowed, resolveAccess } from '../../db/access.js'
import { failure } from '../../db/tx.js'
import { openReceivables, windowFigures } from '../../db/daily-close.js'
import { owedToCompany } from '../../db/settlement.js'
import { isBusinessDate } from '../../src/lib/business.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const r2 = (x: number) => Math.round(x * 100) / 100
const MAX_DAYS = 400

/**
 * HQ KPIs for inclusive IST business dates, per franchise, computed from ledgers only (sales, sale lines, returns,
 * payments, receivables, the outlet stock ledger, settlements). Company staff see every franchise (or one, with
 * franchiseId); a franchisee only ever sees their own.
 *
 *   revenue ex tax   = sales subtotal - discounts - returns ex tax
 *   COGS             = sold quantity x unit cost carried by the lot - returned quantity x that cost
 *   gross margin     = revenue ex tax - COGS (complete only when cogsComplete is true)
 *   wastage / stock variance value = quantity x unit cost on the ledger row
 *   owes company     = outstanding derived settlements + supply not yet in any settlement (as at now)
 * Delivery cost is null: no delivery-cost field exists in the data model.
 */
export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers })
    if (!allowed(access, 'pos', 'view')) return Response.json({ error: 'POS access is required.' }, { status: 403, headers })
    const own = access.role === 'franchisee' ? access.franchise!.id : null
    const url = new URL(req.url)
    const from = url.searchParams.get('from'), to = url.searchParams.get('to'), requested = url.searchParams.get('franchiseId')
    if (!isBusinessDate(from) || !isBusinessDate(to) || to < from) return Response.json({ error: 'from and to must be IST dates (YYYY-MM-DD), to not before from.' }, { status: 400, headers })
    if ((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 + 1 > MAX_DAYS) return Response.json({ error: `A KPI range can cover at most ${MAX_DAYS} days.` }, { status: 400, headers })
    if (requested && !uuidPattern.test(requested)) return Response.json({ error: 'Invalid franchise.' }, { status: 400, headers })
    if (own && requested && requested !== own) return Response.json({ error: 'Franchise not found.' }, { status: 404, headers })
    const wanted = own ?? requested

    const result = await db.transaction(async tx => {
      const all = await tx.select({ id: franchises.id, data: franchises.data }).from(franchises).where(wanted ? eq(franchises.id, wanted) : undefined).orderBy(franchises.createdAt)
      const rows = []
      for (const f of all) {
        const w = await windowFigures(tx, f.id, from, to)
        const receivables = await openReceivables(tx, f.id)
        const owes = await owedToCompany(tx, f.id)
        const revenueExTax = r2(w.sales.subtotal - w.sales.discount - w.returns.amountExTax)
        const cogs = r2(w.cogs.soldCost - w.returns.costValue)
        const uncostedQuantity = r2(w.cogs.uncostedQuantity + w.returns.uncostedQuantity)
        rows.push({
          franchiseId: f.id, name: String(f.data.name ?? ''),
          sales: { count: w.sales.count, subtotal: w.sales.subtotal, discount: w.sales.discount, tax: w.sales.tax, total: w.sales.total, returns: w.returns.amount, net: r2(w.sales.total - w.returns.amount), revenueExTax, creditSales: w.creditSales },
          cogs, cogsComplete: uncostedQuantity === 0, uncostedQuantity,
          grossMargin: r2(revenueExTax - cogs), grossMarginPct: revenueExTax > 0 ? r2((revenueExTax - cogs) / revenueExTax * 100) : null,
          wastage: w.wastage, stockVariance: w.stockVariance,
          collections: w.collections,
          customerReceivablesOutstanding: receivables,
          deliveryCost: null,
          owesCompany: owes,
        })
      }
      return rows
    })
    const sum = (pick: (r: (typeof result)[number]) => number) => r2(result.reduce((a, r) => a + pick(r), 0))
    return Response.json({
      from, to, timezone: 'Asia/Kolkata', franchises: result,
      totals: access.role === 'franchisee' ? undefined : {
        salesTotal: sum(r => r.sales.total), returns: sum(r => r.sales.returns), cogs: sum(r => r.cogs), grossMargin: sum(r => r.grossMargin),
        wastageValue: sum(r => r.wastage.value), stockVarianceValue: sum(r => r.stockVariance.value),
        collections: sum(r => r.collections.total.Cash + r.collections.total.UPI + r.collections.total.Card),
        customerReceivablesOutstanding: sum(r => r.customerReceivablesOutstanding.balance), owesCompany: sum(r => r.owesCompany.total),
      },
      notes: {
        deliveryCost: 'Not available: the data model has no delivery cost field.',
        receivablesAndOwes: 'Outstanding receivables and amounts owed to the company are as at the time of the request, not limited to the date range.',
        cost: 'COGS, wastage and variance values use the unit cost carried on stock lots; quantities with no cost are excluded and reported in uncostedQuantity / uncostedMovements.',
      },
    }, { headers })
  } catch (e) {
    return failure(e, headers, 'KPIs could not be computed.')
  }
}

export const config: Config = { path: '/api/kpi' }
