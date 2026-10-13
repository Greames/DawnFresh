# DawnFresh software audit, Phase 1 (stabilise and audit)

Date: 2026-10-13. Scope: read-only audit against issue #4 "First franchise pilot readiness". No data changed, nothing deployed, pushed or committed. The only file written is this one.

Repo state audited: branch `claude/gifted-maxwell-r0za8a` at `ec08e84` (one commit ahead of local `main` `cc7be83`; the extra commit only adds `docs/LAUNCH_PLAN_PRODDATUR.md`). Line numbers below refer to this checkout.

## 1. Commands run and results

| Command | Result |
|---|---|
| `node -v`, `pnpm -v` | Node v22.22.0, pnpm 10.28.0 |
| `pnpm install --frozen-lockfile` | Succeeded in 7.4 s. Lockfile is in sync. Warning only: build scripts for esbuild and sharp are ignored (`pnpm approve-builds`); the build still works. |
| `pnpm exec tsc --noEmit` (first run, before any build) | FAILED. The route tree `src/routeTree.gen.ts` does not exist until a build generates it, so `router.tsx`, `routes/index.tsx` and `routes/shop.tsx` report errors. This is expected and not a code bug. |
| `pnpm build` (`vite build`) | SUCCEEDED. Client and SSR built and the Netlify SSR entry was written. It created `src/routeTree.gen.ts` (untracked, not in `.gitignore`), `dist/` and `.netlify/v1/` (both git-ignored). |
| `pnpm exec tsc --noEmit` (second run, after build) | FAILED with 3 real errors (route-tree errors gone): (a) `db/pos-schema.ts(1,42)` unused import `integer` (TS6133); (b) `src/components/Operations.tsx(206,9)` unused `finishedStock` (TS6133); (c) `src/components/Operations.tsx(228,9)` the section-label `Record<Section,string>` is missing `pos`, `fulfilment` and `pricing` (TS2739). The build passes because Vite does not typecheck. Strict settings (`noUnusedLocals`) therefore do not gate deployment. |
| Throwaway typecheck of the `.mts` functions using a tsconfig in the scratchpad (not in the repo) | `tsconfig.json` only includes `**/*.ts` and `**/*.tsx`, so **all `netlify/functions/*.mts` are never typechecked**. My ad hoc check reports (ignoring missing node types, which are noise from my minimal config) the real errors listed in section 3, item G0. Nothing was written to the repo. |
| Cleanup | Removed `src/routeTree.gen.ts`, `dist/` and `.netlify/v1/`. `git status --short` afterwards showed only untracked `docs/dept/` (this file plus other departments' files, e.g. `location-outlet.md`, which I did not create). No tracked file was modified. |
| Not run | `pnpm test:e2e` (Playwright): there is no `playwright.config.*`, it needs saved logins for the live site, and it would write data to the live database, which Phase 1 forbids. `drizzle-kit generate/check` and any migration run: not run (would write files or touch a DB). `netlify dev`: not run. No local Postgres was available or used, so none of the findings below was exercised against a database; they come from reading code and from the type checker. |

CI note: `.github/workflows/build.yml` runs `npm install` and `npm run build` (the repo uses pnpm) and has no typecheck step. The only pnpm workflow triggers on branch `fix/critical-franchise-pilot-bugs`, which is already merged (PR #5 closed/merged).

## 2. Migrations review

Files in `netlify/database/migrations`: five Drizzle-generated folders (`20261004071917` to `20261004122606`, each with `migration.sql` plus `snapshot.json`) followed by nine hand-written flat `.sql` files (`20261006183030` to `20261008141000`) with no snapshots.

Findings:
- Ordering is consistent. Every referenced table exists before use: `stock_lots` (created in `20261007090000`) precedes `goods_receipts.stock_lot_id` (`...141000`); `goods_receipts` and `purchase_orders` (`...113000`) precede `...140000` and `...141000`; `operations_records` and `franchises` come from the first folders. I found no forward references.
- Idempotency: every statement in the hand-written files uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so re-runs are safe. Not safe or not reversible: `20261008110000` runs `ALTER COLUMN order_id DROP NOT NULL` on `payment_records` (idempotent in effect, but silently loosens integrity: a payment may exist with no order and no POS sale). No migration has a down path.
- Risk 1, schema/migration drift: Drizzle schema declares things the SQL does not match. `db/schema.ts` types money and quantities as `text` (`stockLots.quantity`, `invoiceRecords.total`, `paymentRecords.amount`, `settlementRecords.*`), while the POS and procurement tables use `numeric(16,x)`. Arithmetic is done in JavaScript floats on strings (for example `procurement.mts:143-147`). Rounding drift is possible and DB-level checks (`CHECK (quantity >= 0)`) are impossible on text columns.
- Risk 2, no database constraints backing the business rules: no `CHECK` for non-negative stock, none for `paid <= total`, no unique constraint on `settlement_records(franchise_id, period_start, period_end)`, none on `pos_reconciliations(shift_id)`, none on `goods_receipts` for duplicate batch codes per PO, and none that stops two `purchase_orders` for the same `supply_request_id`. Application-only enforcement is what the concurrency findings in section 3 depend on.
- Risk 3, the next `drizzle-kit generate` will break deployment unless the baseline is fixed: Drizzle compares against the latest snapshot (`20261004122606_password_links`), which predates all the hand-written tables. Generating now would emit `CREATE TABLE` for about 40 tables that already exist, and the deploy would fail with "relation already exists". This is exactly what happened on 8 Oct and what open PRs #2 and #3 describe.

Are open PRs #2 and #3 still needed against `main`?
- Both PRs (opened 8 Oct, still open) add a generated migration `20261008173632_dusty_unus` whose SQL is a documented no-op baseline plus its Drizzle snapshot, and bump the lockfile.
- `main` has no `20261008173632_dusty_unus` folder (checked the `netlify/database/migrations` listing), and `pnpm install --frozen-lockfile` passes on main, so the lockfile part is obsolete (PR #5 regenerated it). The deploy-failure they fix cannot occur on `main` as it stands.
- The snapshot half is still valuable, but only as a future guard: when someone next changes `db/schema.ts` and generates a migration, it will re-create all existing tables unless a baseline snapshot of the current schema exists. Recommendation: do not merge #2/#3 as they are (two near-duplicates, stale lockfile, dated name that would sort before nothing newer). Close both and, as one small task (backlog S-3), generate a single baseline snapshot on a throwaway database, commit it as a no-op migration, and verify `drizzle-kit generate` then reports "no changes". I did not do this because it writes to the repo.
- I could not read the two PR diffs themselves beyond their descriptions; I relied on the PR bodies.

## 3. Issue #4 audit (read-only), with file:line

Scoring key: CRITICAL = pilot cannot work or money/stock integrity breaks; HIGH = fails an issue #4 item; MEDIUM = hardening.

### G0. Defects that make existing flows fail at runtime (CRITICAL)

1. `actor = access.id` where `Access` has no `id` (the user id is `access.account.id`; `pricing.mts:53,61` uses it correctly). `actor` is therefore `undefined` in:
   - `netlify/functions/pos.mts:53`. `pos_shifts.cashier_id` and `pos_sales.cashier_id` are `NOT NULL` (`db/pos-schema.ts:19,36`), so `open-shift` (pos.mts:74) and `record-sale` (pos.mts:128) should fail with a not-null violation. As written, POS cannot open a shift or sell. I did not execute this; it follows from the code and the type error.
   - `netlify/functions/procurement.mts:32`: the audit actor and `goods_receipts.received_by` and ledger `created_by` become null, so audit events lose who acted.
   - `netlify/functions/fulfillment.mts:74` (audit actor, `qc_checks.checked_by`, `dispatch_loads.scanned_by`).
   - `netlify/functions/operations.mts:208,271` (audit actor for orders and customers).
   - Cause: `.mts` files are excluded from `tsc` (see section 1).
2. `pos.mts:277-280`: the join result is read as `r.posPayments`, but Drizzle keys joined rows by table name (`pos_payments`), so `r.posPayments` is `undefined` and throws whenever a closing shift has at least one payment row. `close-shift` therefore fails for any shift that had sales.
3. `pos.mts:286`: `await Promise.all(...).flat()` calls `.flat()` on the Promise, which throws for any shift with sales (precedence bug; it should wrap the await). Lines 285 (`returns`) is also computed and never used.
4. `franchises.mts:67` creates every franchisee with `outlets: 'none'`, but `pos.mts:27,56,68,79,180,226,270` gate on the `outlets` module (not the `pos` module that exists in `roleModules`, `src/lib/business.ts:100`). A newly created franchisee gets 403 from `/api/pos` until an admin edits their permissions manually.
5. There is no UI for procurement at all (no `/api/procurement` caller in `src`) and none for POS returns or stock transfer (`POS.tsx` only calls open-shift, record-sale and close-shift). The supply to PO to GRN to transfer flow works only through the API and the Playwright test.

### G1. Franchise stock ledger and sale traceability (issue item 1) (HIGH)

- The franchise ledger (`franchise_stock_ledger`) is written only by `procurement.mts:148` (`SupplyIn`). Nothing ever writes an outflow row (sale, return, wastage, adjustment, count). The franchise balance can only go up. grep confirms no other writer.
- POS sells from a different ledger, `outlet_stock_ledger` (`pos.mts:15-20,121,164`). Its only inflow is `transfer-stock` (`pos.mts:179-223`), which draws from **company** finished-stock lots, not from the franchise's own received stock. The supply to franchise stock to POS chain is therefore broken in the data model: franchise receipt does not become sellable outlet stock, and a POS sale does not reduce franchise stock.
- Authorization hole: `transfer-stock` (`pos.mts:179-183`) only checks `scope(access, outlet.franchiseId)`, so a franchisee with outlets edit can pull any quantity of company stock into their own outlet with no supply request, no price and no payable. The PR #5 restriction was applied only to `procurement.mts:117` (`transfer-to-franchise`). Also no row lock on the lots (no `.for('update')`, pos.mts:187-189) so concurrent transfers can double-allocate.
- Sale traceability: `pos_sale_items.stock_lot_id` and `outlet_stock_ledger.stock_lot_id` are taken straight from the client (`pos.mts:138,165`), never validated to belong to that outlet or product, and optional. Sales can therefore carry no source lot or a wrong one. There is no `supply_request_id` or `goods_receipt_id` on outlet ledger rows (`db/pos-schema.ts:100-112`), so a sale cannot be traced back to the supply reference.
- `transfer-to-franchise` (`procurement.mts:116-158`): quantity is not capped to the supply request quantity or to the GRN's accepted quantity less earlier transfers; it takes whatever is left in the single GRN lot and can deliver more than was requested or confirmed. The company-side lot decrement is correct and transactional, but the request is then permanently `Delivered`, so a partial delivery cannot be completed.
- No stock take or variance mechanism: no count entry, no adjustment movement type, no write-off/wastage movement for a franchise or an outlet. `return-sale` always restocks (`pos.mts:245-249`) with no restock-versus-wastage choice, which is wrong for fresh meat that was already sold.
- Concurrency: `latestBalance` reads the newest ledger row with no lock (`pos.mts:15-20`), so two simultaneous sales can both pass the stock check and oversell. `allowNegativeStock` is a client-controlled flag (`pos.mts:122`), so any POS user can bypass the check.
- Price and cost: unit price, tax and discount are client-supplied (`pos.mts:97-111`). There is no price list lookup; `pricing.mts` (configs) is not used by POS. No unit cost is recorded on ledger rows or sale items, which blocks COGS (G3).

### G2. Settlement derivation (issue item 2) (HIGH)

- `fulfillment.mts:214-226` (`create-settlement`): the server still accepts `grossSales`, `collections` and `adjustments` from the client (line 220). Only `amountDue = grossSales - collections + adjustments` (222) is computed. It is not derived from supply value, POS sales, returns or collections. The AGENTS.md claim "derive settlement" is only partly met.
- No dedupe or period overlap guard (no unique index on franchise and period, see section 2), so two settlements for the same period can be created and no idempotency key exists. No state transition endpoint at all: nothing moves a settlement from `Open` to `Partially Settled`/`Settled`, and no settlement payment table exists. `settled_at` is never written.
- The business formula is undefined in code: what a franchisee owes HQ (supply value at company price, less returns, plus/minus adjustments, less payments already made) is not modelled; `supply` records carry a hand-entered cumulative `paid` and `amount` (`operations.mts:36,42,150-151`) rather than a payable ledger.
- A legacy free-form `settlements` kind also remains (`operations.mts:13,43,66`) and can be edited manually by anyone with `supply` edit, giving two competing settlement records.

### G3. Daily close and KPI absence (issue item 3) (HIGH)

- Only a per-shift close exists (`pos.mts:269-312`), and it is broken (G0 items 2 and 3). `pos_reconciliations` has no unique key on `shift_id` or on outlet and date (`db/pos-schema.ts:78-98`) and the shift status check at pos.mts:273 is outside the transaction, so a double click can close twice and write two reconciliation rows.
- There is no daily franchise close: no table, no endpoint, no lock on a business date, no sum across outlets, no stock count, no sign-off, and no rule blocking sales into a closed day. `businessDate` is stored as `new Date()` (pos.mts:298), not a UTC calendar date as AGENTS.md requires.
- No KPI code exists anywhere. A search for COGS, gross margin, wastage, variance, KPI and daily in `netlify` and `db` finds nothing server side. Nothing computes sales, COGS, gross margin, wastage, stock variance, collections, outstanding or delivery cost, and there is no HQ pilot dashboard endpoint. Inputs are missing for several (no unit cost, no wastage movement, no delivery cost field, no count).
- The reconciliation stores `returns`, `creditSales` and per-method totals, but credit (`Credit` method, pos.mts:9) creates a `Paid` invoice (pos.mts:151) with no receivable, so credit sales appear as paid. Collections and outstanding on credit sales are wrong.

### G4. Idempotency and concurrency (issue item 6) (HIGH)

- Only `record-sale` has an idempotency key (`pos.mts:82,86-92`), and the check happens outside the transaction, so two concurrent retries race and the second fails on the unique index with a 500 rather than replaying. The UI never sends a key (no `idempotencyKey` in `POS.tsx`), so the protection is unused in practice. Default bill number `POS-${Date.now()}` (pos.mts:125) can collide.
- No idempotency or duplicate guard on: `create-po` (`procurement.mts:41-53`; two POs can be created for one supply request, and the request is overwritten to `Confirmed`), `create-supplier-invoice`, `pay-supplier` (`procurement.mts:100-114`, the lock prevents overpayment, but a retry after a timeout records a second payment), `return-sale` (`pos.mts:225-267`; the remaining-quantity check at 233-235 is outside the transaction and unlocked, so concurrent returns can exceed the sold quantity), `record-payment` (`fulfillment.mts:182-196`), `create-invoice` (228-236), `create-settlement`, `create-package`, `scan-load` (the existence check is not in a transaction), and all `/api/operations` creates.
- Good: `receive-po` locks the PO row (`procurement.mts:66`), `transfer-to-franchise` locks the supply request and lot, `process-batch` locks the production order, `pay-supplier` locks the invoice.
- `fulfillment.mts:182-196` (`record-payment`) has no overpayment check against the invoice total, writes no audit event, and is not transactional: the payment row and the invoice update are separate statements.
- `/api/operations` (`operations.mts:149-340`) projects each order into customers, customer_orders, items, production, invoice and delivery records as many separate non-transactional statements; a failure midway leaves partial data, and the catch (`operations.mts:~342`) hides the cause behind a 503. Order PATCH deletes and re-inserts items (line ~258).
- Stock lot quantities are text with float arithmetic (`db/schema.ts:199-203`).

### G5. Audit events (issue item 6) (MEDIUM/HIGH)

Audited: `procurement.mts` (4 insert sites), `pos.mts` (5), `fulfillment.mts` (7), `operations.mts` (3), none in `franchises.mts`, `users.mts`, `auth.mts`, `pricing.mts`.
Missing audit events for state changes that move money, stock or access:
- `procurement.mts`: `create-supplier` (line 37), `create-supplier-invoice` (86-98), `pay-supplier` (100-114). A supplier payment, the money event, has no audit row.
- `pos.mts`: `create-outlet` (55-65), `open-shift` (67-76).
- `fulfillment.mts`: `scan-load` (151-166), `proof-of-delivery` (168-180, which also changes the order status to Delivered), `record-payment` (182-196), `create-driver`, `create-vehicle`, `create-invoice` (228-236).
- `operations.mts`: updates and creates for supply, payments, invoices, settlements, stock_movements, sourcing and inventory records have no audit event (audits exist only for customer and order projection at 121 and 58). Supply status changes made by company staff (Requested to Confirmed to Dispatched) and the `paid` amount edits are unaudited; legacy payment amounts can be edited upward in place (line 159).
- `franchises.mts`: create (line 61), update including radius/status change (79): unaudited. `users.mts`, `auth.mts`: role, permission, password reset and disable events are unaudited (these are the highest risk for a multi-user pilot).
- `pricing.mts`: `create-config`, `activate-config`, `snapshot-order` (price changes) are unaudited, and `snapshot-order` overwrites an existing snapshot via `onConflictDoUpdate` (line 79) and does not check the order's franchise.
- Audit events are written outside the business transaction in `fulfillment.mts` and `operations.mts`, so an event can be missing even though the change was committed (or the reverse).
- Audit rows have no immutability protection and no read endpoint or UI for HQ.

### G6. Cross-franchise authorization on franchise-scoped endpoints (issue item 5)

Checked every endpoint. What holds: `resolveAccess` (`db/access.ts:32-46`) re-reads the user each request; `/api/operations` forces the franchise server-side (`operations.mts:126-137`) and 404s foreign PATCH ids (122); `fulfillment.mts` checks order, route and stop franchise on `create-production`, `create-package`, `add-stop`, `scan-load`, `proof-of-delivery`, `record-payment`, `create-invoice`; `pos.mts` uses `scope()` on outlet reads and writes; franchise settlement and transfer are company-only.
Gaps:
- `fulfillment.mts:23-25`, `pos.mts:12-13`: `franchiseAllowed`/`scope` accept `Access | Denied`; a null `franchiseId` is denied for franchisees, which is right, but `process-batch` and `create-production` exist on the franchisee API. A franchisee with `processing` edit can process-batch on its own production order and mint a finished-stock lot (`fulfillment.mts:102-104`), a stock lot that has no franchise column (`stock_lots` has no `franchise_id`, `db/schema.ts:199-213`). That lot is then eligible for company-wide allocation in `pos.mts:187-189` and `procurement.mts:136-138`, so one franchise's lot can be consumed by company allocation or another franchise's outlet transfer (the stock-lot table is global and not scoped by franchise at all).
- `fulfillment.mts:51-52,58`: franchisee lot visibility is derived through batch and production chains only; lots created by `receive-po` (no `sourceBatchId`) are invisible to franchisees, while the company's `GET` returns all lots, batches and loads unfiltered.
- `fulfillment.mts:62`: franchisee `loads` filtered by routes only, not by orders.
- `procurement.mts:25,27`: `GET` loads **all** ledger rows from the database and filters in memory for franchisees (performance, not a leak). Role check for writes is by module (`sourcing` edit) rather than by role, so any non-franchisee staff with `sourcing` edit can create POs and receipts; the only explicit `access.role==='franchisee'` guard is on transfer-to-franchise (line 117). A franchisee given `sourcing` edit by an admin could call `create-po`, `receive-po`, `pay-supplier` (no role guard on lines 41, 55, 86, 100). Default franchisee permission is `sourcing: none`, so this is a configuration trap rather than an open hole; recommend a hard `role !== 'franchisee'` guard.
- `pos.mts:38-45`: GET reads every outlet, sale, payment and ledger row in the database into memory and filters in JS (the `payments` filter is quadratic, line 43). No leak, but a scaling and timing risk.
- `pricing.mts:36`: franchisees blocked, but pricing configs carry `franchiseId` without validating it refers to a real franchise (line 61). `snapshot-order` (71-81) is not scoped to the order's franchise.
- `discover.mts` and `catalog.mts` not franchise-scoped by design; `discover` not re-audited here.
- Sale `customerId` (`pos.mts:128`) is not validated to belong to the same franchise (a franchise could attach another franchise's customer id).
- `outlets` `franchiseId` null is the company; any staff can create an outlet for any franchise (`pos.mts:57-58`), expected for staff.
- No automated test covers any negative (cross-franchise) case.

## 4. e2e/franchise-procurement.spec.ts

What it does: one serial Playwright API test against the live site (default `https://coruscating-concha-76e38b.netlify.app`, line 4) using saved browser sessions (`e2e/.auth/*.json`, created by `pnpm e2e:auth`). Flow: franchisee creates a supply request, company creates supplier (or reuses the first), PO, GRN (`receive-po` Passed), then `transfer-to-franchise`, then asserts traceability fields (franchise, supply request, PO, GRN, stock lot) on the ledger and `Delivered` on the request.

Weaknesses:
- Runs against the live production database (default `baseURL`), leaves permanent test records (`E2E-<timestamp>` markers, a real PO, lots and ledger rows), and cannot be re-run safely or cleaned up. It should target a branch/preview deploy with a disposable database.
- Needs hand-made logins, no `playwright.config.*`, no CI job, and it self-skips when the auth files are missing (lines 10-12), so a missing login looks like a pass.
- Tests only the happy path. No negative tests (over-receipt, over-transfer, repeated transfer returns 409, cross-franchise read/write, franchisee calling company endpoints, view-only user).
- It does not detect the G0 defects, because it never touches `/api/pos`.

What is needed for the full supply, receive, sell, return, close, settle test:
1. Test environment: a Netlify deploy preview with its own database branch, plus a seed step creating an admin, a staff user, two franchises each with a franchisee login and a franchisee user with a known password. Log in via `/api/auth` with credentials from env vars (no manual browser step). Add `playwright.config.ts`, a CI job, and fail (not skip) on missing credentials.
2. Fix prerequisites first: G0 items 1-4, a path that moves received franchise stock into outlet stock (G1), the franchise ledger outflows, a derived settlement endpoint (G2) and a daily-close endpoint (G3). Without these the test cannot be written; sections of it would fail today.
3. Steps to automate: (a) franchisee requests supply; (b) company creates supplier, PO, GRN; (c) transfer to franchise; assert company lot decremented and ledger balance up; (d) franchisee creates outlet, opens shift, sells with an idempotency key; assert stock and ledger decrease and the replay returns the same sale; (e) partial return; assert restock or wastage as chosen and a reversed payment; (f) over-return rejected; (g) close shift with counted cash; assert expected cash and variance; (h) daily close for the franchise; assert KPIs (sales, COGS, margin, wastage, stock variance, collections, outstanding); (i) HQ creates the settlement for the period; assert the amount equals supply value less returns less payments, derived server side, and that a repeat call is rejected or returns the same record; (j) record a settlement payment and assert the status moves to Settled; (k) assert audit events exist for every step with the right actor.
4. Negative suite: franchise B cannot read or write franchise A's outlets, sales, ledger, settlements, invoices or lots; franchisee cannot call `transfer-stock` against company stock; view-only user cannot write; a disabled user is rejected.

## 5. Engineering backlog (ordered; S = up to 1 day, M = 2-4 days, L = 1-2 weeks)

Assumes one developer. Dates are 2026; feature freeze 15 Dec (launch plan: KPI and e2e target 5 Dec, audit review 15 Dec, production config 20 Dec, go-live 10 Jan 2027).

| # | Item | Size | Window |
|---|---|---|---|
| S-1 | Fix `access.id` to `access.account.id` in pos, procurement, fulfillment, operations (G0.1) and fix `close-shift` join and `.flat()` bugs (G0.2-0.3) | S | 14-15 Oct |
| S-2 | Add `.mts` functions and `db/` to `tsc` (`tsconfig` include), fix the 3 existing type errors and the `pricing.mts` ones, add `pnpm typecheck` and make CI use pnpm and run it | S | 16 Oct |
| S-3 | Baseline Drizzle snapshot (replace PRs #2/#3, close them); decide numeric vs text money columns, add CHECK and UNIQUE constraints (non-negative stock, `paid<=total`, one settlement per franchise and period, one reconciliation per shift) | M | 19-23 Oct |
| M-1 | Permissions: give franchisees the `pos` module and gate POS on `pos` (not `outlets`); hard role guards on procurement, pricing and company-only actions; franchise ownership on `stock_lots` (add `franchise_id`/location) and per-franchise scoping in lot allocation | M | 26-30 Oct |
| M-2 | Unified stock model: franchise stock (ledger outflows for sale, return, wastage, adjustment, count) feeding outlet/POS stock; remove franchisee access to company stock in `transfer-stock`; validate sale item lot, outlet and product; transactional row locks; remove client `allowNegativeStock`; add reference columns (supply request, GRN) to outlet ledger rows | L | 2-13 Nov |
| M-3 | Price source of truth on POS: server price list (from `pricing_configs`), server-side tax calculation, unit cost on lot/ledger (for COGS), credit sales create a receivable instead of `Paid` | M | 16-20 Nov |
| M-4 | Idempotency and transactions: keys (header or body) on sale, return, payment, PO, supplier payment, settlement, close; wrap multi-statement flows (`record-payment`, `/api/operations` projection, `scan-load`) in transactions; make audit rows part of the same transaction; send the key from the POS UI | M | 23-27 Nov |
| M-5 | Derived settlement: server computes supply value, returns, POS and collections for a period from ledgers; client sends only franchise, period and adjustments with a reason; settlement payments table and status transitions; retire the legacy manual `settlements` kind | L | 23 Nov-4 Dec (overlaps M-4; two people or slip to 8 Dec) |
| M-6 | Daily franchise close and HQ pilot KPI endpoint (sales, COGS, gross margin, wastage, stock variance, collections, outstanding, delivery cost field), UTC business date, locks closed days, minimal HQ page | L | 23 Nov-5 Dec |
| M-7 | Audit completeness (G5 list, incl. users/auth/franchises/pricing), HQ audit read view, immutable-by-convention policy | M | 30 Nov-4 Dec |
| M-8 | Minimum pilot UI: procurement (PO/GRN/transfer), POS return and stock transfer, wastage and count entry, daily close, KPI page; Telugu labels deferred unless owner requires | L | 9 Nov-4 Dec (parallel with the above) |
| M-9 | Full e2e (section 4) on a preview deploy and disposable DB with seeded users, in CI, plus negative isolation tests | L | 30 Nov-8 Dec |
| M-10 | Hardening and bug fix after e2e; scaling fix for unfiltered table reads in `pos.mts`/`procurement.mts`/`fulfillment.mts`; backups/export and outage runbook (launch plan F8) | M | 8-14 Dec |
| M-11 | Independent security and audit review (launch plan F6) and fixes | M | review 8-12 Dec, fixes by 15 Dec |
| Freeze | Feature freeze, bug fixes only | | 15 Dec |
| Config | Production config and training data (section 6) | S | 16-20 Dec |

Risk: the plan is tight. M-2 through M-9 are about 5 weeks of work for one developer inside a 6-week window with no slack, and none of it has run against a database yet. Priorities if time runs out, in order: S-1, S-2, M-1, M-2, M-4, M-6, M-5, M-9. The Telugu and GST work below is the first to cut, and the owner must confirm GST scope with the CA.

## 6. Production configuration the owner must supply, and India-specific gaps

Environment variables (Netlify site settings; redeploy after changing):
- `OWNER_SETUP_CODE`: set before the first deploy so nobody else can claim the first admin account (`auth.mts:77`).
- `GOOGLE_PLACES_API_KEY`: server-only, Places API (New) enabled with billing and key restrictions (`discover.mts:36`). Optional but used for lead discovery in Proddatur.
- `RESEND_API_KEY` and `EMAIL_FROM` (verified sending domain): optional, for invitation and password reset links (`db/email.ts:8`). Without them an admin sets passwords by hand.
- `URL` is provided by Netlify and used for email links (`db/email.ts:12`).
- Netlify Database is provisioned automatically; confirm the production database and restore/backup plan with the host.
- Netlify "visitor access" must not require a Netlify login on production (README troubleshooting).

Business data the owner must supply (entered in the app, not code):
- Business settings (admin only): company name, currency `INR`, the WhatsApp number in international digits (e.g. `91...`; ordering on `/shop` stays disabled until set), location text, latitude and longitude of the processing unit/outlet in Proddatur (the repo has no verified coordinates; use the exact premises; I did not look them up), service radius 1-50 km.
- Each franchise: name, contact email (unique, becomes the login), location, coordinates, radius (default 20 km), phone.
- First admin name, email and password; staff and franchisee accounts and per-module permissions.
- Products and prices: the catalog is fixed in code to Chicken, Mutton, Eggs, Fish, Prawns (`products` arrays in `operations.mts:41`, `pos.mts:8`, `procurement.mts`, `fulfillment.mts:11`, and `src/lib/business.ts`). There is no product master or price-list table; selling prices are typed in at the POS and company prices go into `pricing_configs`. The owner must supply: the product list with units, supplier prices and company price per kg per product (and per franchise if different), standard yield percentages, logistics and other cost per kg, and the opening cash float. A change to the product list needs a code change today.
- Outlets (physical, with codes), drivers, vehicles, suppliers and their contact details.
- GSTIN, legal name, address, FSSAI licence number and invoice numbering rules (needed on printed invoices once built).

India-specific gaps in the software (flagged only, nothing implemented):
- GST: no GSTIN, HSN code, place of supply, CGST/SGST/IGST split or tax rate. Tax is a free number per line (`pos.mts:99,110`), and invoice numbers are `POS-<bill>` or `INV-<year>-<id>`, not a GST-compliant gap-free series. No printable tax invoice, no credit note for returns. Whether fresh unbranded meat attracts GST, and at what rate, for each product is a question for the CA; the software has no tax-rate table or exemption flag.
- INR formatting: `src/lib/business.ts:223` formats with locale `'en'`, so values show `₹1,234,567` (million grouping), whereas `POS.tsx:10` already uses `en-IN` (lakh grouping). The two are inconsistent; the default currency is only illustrative (README). Standardise on `en-IN`. Server amounts are plain decimals with no rounding rule to rupee or paise.
- Payment modes: Cash, UPI, Card, Credit exist at POS (`pos.mts:9`) and the close splits cash, UPI, card and credit. Gaps: no UPI transaction reference requirement or UPI/QR reconciliation, no wallet or bank-transfer or cheque mode on POS, the order and invoice payment screens use free-text methods (`fulfillment.mts:189`, `Operations.tsx:137`), and Credit sales are recorded as fully paid (G3). No cash-handling controls (denomination count, drop, safe).
- Telugu labels: no i18n at all (no locale files, UI strings hard coded in English). Customer-facing `/shop`, POS and delivery screens have no Telugu text; WhatsApp messages are English. Customer names and addresses accept Unicode, but no Telugu font is bundled or tested.
- Phone numbers: validated as 7 to 15 digits with no country code normalisation (`operations.mts:48`, `franchises.mts:236`), so Indian 10-digit numbers without `91` produce WhatsApp links that do not work; address fields have no PIN code or state validation.
- Dates and time zone: records use UTC calendar dates per AGENTS.md; daily close should be based on IST (UTC+5:30) business days, which is not implemented (`pos.mts:298`, a raw timestamp). A shift closing after 18:30 UTC would fall on the next UTC date. Needs an explicit decision.
- Units and weights: kg only in practice (`unit` is free text defaulting to `kg`); no pieces for eggs (tray/dozen), no tare, no weighing scale integration. Legal Metrology scale verification is a launch-plan item, not software.
- Food-safety: temperature is a single manual observation; no cold-chain logger, no batch recall flow (the traceability fields would support one), no FSSAI licence number on labels and invoices.
- Compliance outputs: no GSTR-ready exports, no TDS or e-invoice/e-way bill (likely out of scope at pilot scale; confirm with the CA).

## 7. Summary of what to do first

1. Fix the `access.id` and `close-shift` defects and typecheck the `.mts` files (about 2 days). Until then POS cannot open a shift or record a sale, and procurement and fulfilment audit rows lose their actor. These findings come from code reading and the type checker, not from a database run, so confirm with a smoke test on a preview deploy after the fix.
2. Close PRs #2 and #3 and replace them with one baseline snapshot before anyone runs `drizzle-kit generate`.
3. Decide the unified franchise to outlet stock model before building daily close, KPIs and settlement on top of it.
