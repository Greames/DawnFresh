# Wave 1 notes (issues #6 to #9)

## What changed

- #6: `access.id` replaced by `access.account.id` in pos, procurement, fulfillment and operations (5 sites). `close-shift` now reads `r.pos_payments`, wraps `.flat()` around the awaited array and drops the unused `returns` query.
- #7: `tsconfig.json` includes `netlify/functions/**/*.mts` (and `db/`, already covered) and the `node` types. `pnpm typecheck` added; CI (`.github/workflows/build.yml`) now uses pnpm 10.28.0, frozen lockfile, `pnpm build`, `pnpm typecheck` and `pnpm test` against a Postgres 16 service. The typecheck needs `src/routeTree.gen.ts`, which `pnpm build` generates, so run build first. Fixed: unused imports and constants, `Access` typing in `scope`/`franchiseAllowed`, transaction typing in pos (no more `as typeof db`), `Section` label map, unused `finishedStock`, and `pricing.mts` passing `null` for an invalid `actualOutputKg` (see surprising findings).
- #8: `drizzle.config.ts` now lists all four schema files (before, only `db/schema.ts`, so drizzle-kit never saw POS, pricing or procurement tables). One generated baseline snapshot `20261013082818_baseline_existing_schema` with a no-op `migration.sql`. Then `20261013082847_add_integrity_constraints`: UNIQUE settlement per (franchise, period_start, period_end), UNIQUE pos_reconciliation per shift, CHECK franchise ledger `balance_after >= 0`, CHECK goods receipt quantities (non-negative, accepted <= received), CHECK supplier invoice `0 <= paid <= total`, and `invoice_records.order_id DROP NOT NULL` (hand-added line, see below). `close-shift` closes with a conditional update inside the transaction (second closer gets 409). Duplicate settlement gets 409.
- #9: POS endpoints gate on `pos`. `franchises.mts` stores `pos: 'edit'` for new franchisees. Hard `role === 'franchisee'` 403 on create-supplier, create-po, receive-po, create-supplier-invoice, pay-supplier (transfer-to-franchise already had it). Pricing already rejected every franchisee request at the top of the handler; confirmed by test. Sale `customerId` must exist and have the same `franchise_id` as the outlet. Pricing `franchiseId` must be a real franchise; `snapshot-order` returns 409 when the config's franchise differs from the order's franchise; malformed ids return 400/404 instead of a Postgres error.

## Existing-user behaviour for the pos module

`roleModules.franchisee` already contained `pos`, so `resolvePermissions` gives any franchisee without a stored `pos` value `edit`. Existing franchisees (stored `outlets: 'none'`, no `pos` key) therefore start working with no data change, and `outlets` stays `none` for them. An admin can still set `pos` to `none` or `view`. Staff with no stored `pos` value inherit their stored `outlets` level (new rule in `resolvePermissions`), so nobody gains or loses POS access silently; staff with neither stored get `edit`, as before for all modules.

## Not done, on purpose

- `stock_lots.franchise_id` (ownership) and scoping allocation: skipped. Doing it properly means deciding who owns lots from `receive-po`, `process-batch` and franchise transfers, which is the unified stock model of #10. A column without that would be a half-build. Consequences still open: a franchisee can still pull company stock with `transfer-stock` (no supply request), and a franchise-minted lot is allocatable company-wide.
- Numeric CHECKs on `stock_lots.quantity`, `invoice_records.total/paid` and `payment_records.amount`: those columns are `text`, so no safe numeric CHECK exists. Proposal for #10: convert to `numeric(16,3)/(16,2)` in a migration with a pre-flight query for non-numeric values, then add CHECK (quantity >= 0), (paid <= total). `outlet_stock_ledger.balance_after >= 0` is representable but skipped because `record-sale` accepts a client `allowNegativeStock` flag; remove the flag first.
- Migration safety: the UNIQUE constraints fail the deploy if production already has duplicates. Pre-flight on the real database before deploying (read-only):
  `SELECT franchise_id, period_start, period_end, count(*) FROM settlement_records GROUP BY 1,2,3 HAVING count(*) > 1;` and `SELECT shift_id, count(*) FROM pos_reconciliations GROUP BY 1 HAVING count(*) > 1;`. Also check supplier invoices with paid > total and receipts with accepted > received.

## How it was verified

Local throwaway Postgres 16.15 (apt binaries, port 54329, databases `dawn_test`, `dawn_test2`, `dawn_base`), never any remote database.

- `psql -v ON_ERROR_STOP=1 -f` of every migration in directory order onto an empty database: all 14 original plus the 2 new ones applied with no errors.
- Schema drift check: generated the full schema from `db/*.ts` with drizzle-kit into a scratch directory, applied it to an empty database and compared columns, defaults, unique/check constraints and indexes with the migrated database. Only difference that matters: `invoice_records.order_id` was NOT NULL in SQL but nullable in `db/schema.ts` (fixed by the new migration). Cosmetic: default literal quoting, `order_pricing_snapshots.snapshot` default `{}` exists in SQL only, the partial unique index on `pos_sales.idempotency_key`, some FK constraints and a few indexes exist in SQL but not in the Drizzle schema (left alone, no effect on drizzle-kit output).
- `pnpm exec drizzle-kit generate --name check` after the baseline and again after the constraints migration: "No schema changes, nothing to migrate". Nothing was created.
- `DATABASE_URL=postgres://postgres@localhost:54329/dawn_test2 pnpm test`: 20 tests, 20 pass, 0 fail. The suite drops and rebuilds the `public` schema of the target database, so it refuses any non-local host or a database name without "test". Without `DATABASE_URL` it prints a FAIL message and exits 1.
- Negative control: running the same suite against the pre-#6 `pos.mts` gives 11 pass, 9 fail.
- `pnpm typecheck`: clean. `pnpm build`: succeeds.

The tests call the real handlers with real session cookies created by `db/auth.ts`. Only the database module is redirected to a `node-postgres` client by a loader hook in `tests/helpers/` (nothing local-only is committed in production code). They cover open-shift, record-sale, close-shift and audit actors for a franchisee, a concurrent triple close producing one reconciliation, cross-franchise reads and writes (POS, fulfilment), company-only procurement and pricing actions returning 403, customer and pricing franchise validation, staff procurement flow audit actors, and every new constraint.

## Could not verify

- Netlify deployment of the migrations (the Netlify migrator was not run; the files were applied with psql). Folder migrations contain `--> statement-breakpoint` comments, same as the existing ones.
- `pnpm install --frozen-lockfile` and the CI workflow on GitHub (the lockfile was regenerated with pnpm 10.28.0, which dropped `libc` hints that pnpm 10.30.3 had written).
- The e2e spec (targets the live site, deliberately not run). No UI change was exercised in a browser.
- Production data: the unique and check constraints have not been tried against real rows.

## Surprising

- `drizzle.config.ts` only pointed at `db/schema.ts`. Without the fix, the "baseline" would have been incomplete.
- `invoice_records.order_id` NOT NULL made every POS `record-sale` fail on the real schema even after the actor fix.
- Adding `@types/pg` made pnpm resolve drizzle-orm differently and turned `franchises.mts` `.returning({ id })` into a type error, so the tests use a small `pg` declaration file instead (`tests/helpers/pg.d.ts`).
- `pricing.mts` turned an invalid `actualOutputKg` (negative or non-numeric) into `null`, then wrote the string `'null'` into a numeric column (500). It now returns 400.
- `src/routeTree.gen.ts` is generated by build and is not git-ignored; it was left untracked and never committed.
