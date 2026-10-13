# Wave 3 notes (issues #11, #13, #14, and the open-shift race)

## Claims re-checked in the code

- Audit G1 "unit price, tax and discount are client-supplied": true (`pos.mts` read them from the item). Fixed.
- **`pricing_configs.company_price_per_kg` is the price a franchise pays the company, not a customer price** (`docs/FRESHROUTE_PRICING_MODEL.md`: "Franchise Order Value = billable weight x Company Price"). Using it as the POS price would make every franchise margin zero. The brief said POS prices come from the company price list, so I added two columns to the same table, `customer_price_per_kg` (tax excluded, nullable) and `tax_rate_pct` (default 0), set through the existing `create-config` action. A config with no customer price gives a 422 at the POS; the wholesale price is never used as a fallback. **Decision for the owner: confirm this reading and have someone enter customer prices, otherwise no sale can be made.**
- `activate-config` archived every Active config of the same product and processing type, including franchise-specific ones, so activating a franchise price silently removed the company-wide price (and the reverse). Now only configs with the same scope are replaced.
- The audit said credit sales are recorded as fully paid: true (invoice was `Paid` with `paid = total` whatever the payment method).
- Wave 2 note on `open-shift` was right: check outside any lock.

## Decisions and formulas

Business date: `businessDateOf(ts)` = IST calendar date (UTC + 5:30, no DST) in `src/lib/business.ts`, with `businessDayRange`, `businessPeriodRange` (UTC instants `[start, end)`) and `isBusinessDate`. Shifts, daily close, KPIs and settlements all go through it. 18:29:59.999Z is still the earlier IST date, 18:30:00.000Z is the next.

POS sale (#11), per line: `subtotal = round2(qty x server price)`, `tax = round2(subtotal x rate / 100)`, `total = subtotal + tax`; tax-exclusive pricing, no discounts. Price lookup (`db/pricing.ts`): Active, in-date configs; franchise-specific beats company-wide, `Standard` processing beats others, then newest effective date/version; the first one with a customer price wins. A client-supplied `unitPrice` or `tax` is optional but must equal the server value (0.004 tolerance), any non-zero `discount` is 400, no price is 422. One payment may omit its amount (it then covers the server total), which is what `POS.tsx` now sends (price input removed).

Cost: `stock_lots.unit_cost` and `outlet_stock_ledger.unit_cost` (numeric(16,4)); a franchise child lot takes the company price (franchise-specific first) in force at `transfer-to-franchise` or `transfer-stock`; the ledger row copies the lot's cost; each sale line records `unit_cost`; return lots copy the sold line's cost. **Null means unknown and is never guessed.** Existing lots (including `OPENING-` lots) stay null.

Credit: a `Credit` payment needs a customer and creates `customer_receivables` (`original`, `returned`, `paid`; open balance = original - returned - paid). The invoice is `Partially Paid`/`Issued` with `paid` = what was tendered. `collect-receivable` (Cash/UPI/Card, needs an open shift of the franchise so cash lands in that shift's expected cash) locks the receivable row, rejects overpayment with 409 and is idempotent. A return on a credit sale first cancels the open balance, only the rest is refunded as money. Receivables are the franchise's own and are not read anywhere in settlement.

Settlement (#13), for a franchise and inclusive IST dates `[from, to]`:

```
supply value   = sum(quantity x unit_cost)   over outlet_stock_ledger SupplyIn + TransferIn rows of the franchise in the period
returns value  = sum(-quantity x unit_cost)  over SupplyReturn rows
amount due     = supply value - returns value + sum(adjustments)          (must be >= 0)
outstanding    = amount due - sum(settlement_payments)
status         = Open (no payment) -> Partially Settled -> Settled (payments = due, settled_at set); due = 0 is Settled at once
```

The client sends franchise, period, adjustments (`amount` signed, mandatory `reason`) and a key; any other money field is ignored. Each adjustment gets a row (actor, reason) and an audit event, as do the settlement and each payment. Overlap of an inclusive period with any existing row of the same franchise (legacy rows included, backfilled to IST dates) is 409; it is serialized by a per-franchise advisory lock, not an exclusion constraint (that needs `btree_gist`). A period whose supply has any movement with no unit cost is refused (409) rather than valued at zero. Payments are recorded by company staff; overpayment 409 under a lock on the settlement row; CHECK `payments_total <= amount_due` for derived rows. New: `return-supply` (pos action): a franchise outlet returns a company-supplied lot (needs `parent_lot_id` and a unit cost, mandatory reason) to its company lot as a `SupplyReturn` ledger row.

Legacy retirement: `operations.mts` answers 410 to any POST/PATCH of kind `settlements` (old rows stay in `operations_records` and in GET), `fulfillment.mts` `create-settlement` answers 410 (403 first for franchisees), `settlement_records` legacy rows keep `derived = false` and are read-only (payments refused). `Operations.tsx` shows a note instead of the free-form settlement form. `grossSales` and `collections` columns on `settlement_records` are legacy and stay 0 on derived rows.

Daily close (#14): `franchise_daily_closes`, unique per franchise and date. `close-day` (franchisee for own franchise or company staff, `pos` edit) refuses (409) while any shift of the franchise's outlets is open, whatever its date. Snapshot (`totals` JSON plus cash columns): sales count/subtotal/tax/total by `sold_at`; returns by `created_at`; credit sales; POS collections by method by payment `received_at`, cash refunds, receivable collections, total by method; cash from shifts opened that IST date (expected = opening + cash taken - cash refunded + cash collected on receivables, counted at shift close, variance = counted - expected); wastage and `Count` variance from ledger rows with values at carried cost; supply received and returned. `reopen-day` is staff only with a mandatory reason; re-closing replaces the snapshot (same row, audit events `closed`, `reopened`, `reclosed`). While Closed, `record-sale`, `return-sale`, `record-wastage`, `adjust-stock`, `count-stock`, `collect-receivable` and `open-shift` return 409 for that franchise on today's IST date. These take a shared advisory lock on `(franchise, date)` first and close/reopen take the exclusive one, so nothing slips in beside a sign-off.

KPIs (`GET /api/kpi?from&to[&franchiseId]`, staff all franchises, franchisee own, 404 for another): per franchise `revenueExTax = subtotal - discount - returns ex tax`, `cogs = sold qty x line unit_cost - returned qty x that cost`, `grossMargin = revenueExTax - cogs` (flagged `cogsComplete: false` with `uncostedQuantity` when any line has no cost), wastage and stock variance quantity/value, collections by method, `customerReceivablesOutstanding`, `deliveryCost: null` (no such field exists), `owesCompany = outstanding derived settlements + supply not covered by any settlement` (as at now). A returned item reduces COGS whichever the disposition; goods discarded appear in wastage (a Wastage-disposition return writes a Wastage ledger row), so cost is not counted twice. Receivables and owes are as at the request time, not range-limited.

Open-shift race: `open-shift` now runs in a transaction under `pg_advisory_xact_lock(outlet)`, checks, inserts and audits; the partial unique index `pos_shifts_one_open_per_outlet` is the backstop (a 23505 is also answered 409).

## What changed

Migrations (generated by drizzle-kit @beta, `drizzle-kit generate` then reports "No schema changes"):
1. `pos_pricing_cost_receivables`: unit_cost columns, pricing customer price/tax with CHECKs, `customer_receivables`, `receivable_payments`, partial unique index on open shifts (hand-added pre-flight aborts naming the count if an outlet has several open shifts).
2. `derived_settlement`: settlement columns, `settlement_adjustments`, `settlement_payments`, status/payments/date CHECKs, `SupplyReturn` in the ledger movement CHECK (hand-added pre-flight on status values and end < start, and a backfill of IST period dates for legacy rows).
3. `franchise_daily_close`: the table.

Code: `db/pricing.ts`, `db/settlement.ts`, `db/daily-close.ts`; `settlements.mts`, `daily-close.mts`, `kpi.mts`; `pos.mts` (pricing, credit, collect-receivable, return-supply, guards, open-shift), `procurement.mts` (cost at transfer), `pricing.mts` (new fields, scoped activate), `fulfillment.mts`/`operations.mts` (retirement), `stock.ts` (unit cost, `SupplyReturn`), `POS.tsx`, `Operations.tsx` (minimum). Two existing tests were edited for retired or changed behaviour (manual settlement now 410; one sale test had a client price of 10).

## Verification (local throwaway Postgres 16 on port 54329, data under /var/tmp/pgw3; no remote database touched)

```
DATABASE_URL=postgres://postgres@localhost:54329/dawn_test2 pnpm test    # 67 tests: 46 old + 21 in tests/wave3.test.ts, 0 fail
pnpm build && pnpm typecheck                                              # both clean (routeTree.gen.ts deleted before each commit)
pnpm exec drizzle-kit generate --name check                              # "No schema changes, nothing to migrate" after each migration
```
- Upgrade path: a database at the wave 2 migration with a legacy `settlement_records` row took the three new migrations with no error; the legacy row got IST dates (`2026-10-01`..`2026-10-07`) and `derived = false`.
- Pre-flight: two open shifts on one outlet made migration 1 abort with "1 outlet(s) have more than one open shift".
- Negative control: removing the day guard from `record-sale` fails 2 of the 21 new tests.
- wave3 tests cover: server price ignores client price; echoed price accepted; wrong price/tax/discount 400; tax 5% hand-checked; franchise-specific price and cost; missing or null customer price 422 writing nothing; credit sale, partial payments, overpayment 409, replay, concurrent overpay (3 parallel, one wins), cross-franchise 404; return on credit sale; expected cash including receivable cash; open-shift `Promise.all` x6 leaves one open and the index refuses a second; settlement = 900 - 120 + 30 = 810 and unchanged by customer sales/credit/collections; replay, key reuse 409, overlap/duplicate/contained 409, concurrent overlapping creates, status Open -> Partially -> Settled with `settled_at`, concurrent payments, uncosted supply refusal, retirement checks; IST helper at 18:29:59.999/18:30:00 UTC (also day range, year and leap boundaries); daily close totals vs hand computation (sales 1400, returns 100, credit 200, cash 750/UPI 400/Card 200, expected 800, counted 790, variance -10, wastage 1/60, count variance -0.5/-30, supply 1800); every blocked action after close, audited reopen by staff only with a reason, sales again then re-close; KPI revenue/COGS/margin/receivables/owes vs hand computation; franchise isolation on KPI, close and settlements; ledger rows, shifts and sales exactly at 18:30 UTC split across two IST days.

## Could not verify

- Netlify's migrator and the `drizzle-orm/netlify-db` driver (tests use node-postgres behind the same API); `pg_advisory_xact_lock_shared` and `FILTER` aggregates are standard Postgres but ran only on node-postgres.
- No browser run of `POS.tsx` or `Operations.tsx` (typechecked and built only).
- `e2e/franchise-procurement.spec.ts` not run (targets the live site); it does not touch pricing, so it may need a customer price in production before POS sales work.
- Production data: none of the migrations has seen real rows.

## Production pre-flight (read-only)

```sql
SELECT outlet_id, count(*) FROM pos_shifts WHERE status = 'Open' GROUP BY 1 HAVING count(*) > 1;           -- migration 1 aborts if any
SELECT status, count(*) FROM settlement_records GROUP BY 1;                                                  -- only Open / Partially Settled / Settled allowed
SELECT id FROM settlement_records WHERE period_end < period_start;
-- customer prices: none exist yet; expect every row null until the company enters them
SELECT product, status, company_price_per_kg, customer_price_per_kg FROM pricing_configs WHERE status = 'Active';
-- earlier credit sales were recorded as fully paid invoices; they have no receivable (listed so someone can decide)
SELECT s.id, s.bill_number, s.customer_id, p.amount FROM pos_payments p JOIN pos_sales s ON s.id = p.sale_id WHERE p.method = 'Credit';
-- lots whose cost will be unknown (all existing ones); supply of these cannot be settled until costed
SELECT count(*) FROM stock_lots WHERE pos_outlet_id IS NOT NULL AND unit_cost IS NULL;
SELECT count(*) FROM outlet_stock_ledger WHERE movement_type IN ('SupplyIn','TransferIn') AND unit_cost IS NULL;
```

## Surprises

- Two upstream docs commits landed on the branch during the run (`e78028d`, `3e8a699`); my commits sit on top of them.
- The wave 2 test for settlement replay and the wave 1 duplicate-settlement test exercised the manual path; they were replaced by the retirement checks and by the new endpoint's tests.
- Existing franchise supply moved before this wave carries no cost, so settling those periods is refused until the lots are costed (an admin fix such as `UPDATE stock_lots SET unit_cost = ... ` plus the ledger rows, not provided because the right price is the owner's call).
- A shift that spans midnight IST is attributed (cash) to the date it opened, while its sales are attributed by `sold_at`; closing is refused while it is open, so totals stay consistent per day but a late-night shift can split between two days.

## Decisions for the owner

1. Confirm customer price lives in a new `customer_price_per_kg` on the price list (see first section) and who enters it, and the 5 products' tax rates (default 0; GST scope pending, #18).
2. Existing lots and ledger rows have no cost: how to back-fill supply costing for settlements of past periods.
3. Company-direct outlets are never daily-closed (no franchise); say if they should be.
4. Settlement adjustments can only be given at creation; an "add adjustment later" action is not built.
5. Delivery cost is null in KPIs until a cost field is designed.
