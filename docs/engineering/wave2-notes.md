# Wave 2 notes (issues #10 and #12)

## Data model decision: one ledger, linked to lots, not two ledgers

Before: `franchise_stock_ledger` (franchise level, inflow only, written by transfer-to-franchise) and `outlet_stock_ledger` (outlet level, fed only by a free `transfer-stock`). Receipt never became sellable stock and sales never reduced franchise stock.

Decision: **unify on `outlet_stock_ledger`**. A franchise's stock is the sum of its outlets' balances; "franchise stock" and "outlet stock" are the same thing, because POS can only sell what an outlet holds. Keeping both would need paired rows and a third balance to reconcile. `franchise_stock_ledger` is kept, frozen and read-only (history, and its `SupplyIn` rows still count toward a request's delivered quantity). Nothing writes it any more.

```
 company warehouse                         franchise F / outlet O
 ---------------------                     ----------------------------------------------
 stock_lots (franchise_id NULL,            stock_lots (franchise_id = F, pos_outlet_id = O,
             pos_outlet_id NULL)  ------>              parent_lot_id -> company lot)
   ^ receive-po (GRN lot)       transfer-     |
                                to-franchise  |  every change = one outlet_stock_ledger row
   supply request (records) ---- refs ------->|    supply_request_id, purchase_order_id,
   purchase_orders, goods_receipts            |    goods_receipt_id, sale_id, reference_type/id,
                                              |    stock_lot_id, reason, balance_after, seq
                                              v
   stock_balances (outlet_id, product, quantity >= 0)   <- the row lock, one per outlet/product

 movements: SupplyIn (company->franchise), TransferIn (company staff direct), Sale (-), Return (+),
            Wastage (-), Adjustment (+/-), Count (+/-, with a stock_counts row)
 return-sale: Restock = Return(+). Wastage = Return(+) then Wastage(-) on the same lot (full trail, net zero).
```

Invariant (asserted by `assertInvariant` in the tests after every scenario): balance = sum of the outlet's lots for the product = last ledger `balance_after` = sum of signed ledger quantities, and each `balance_after` equals the running total.

Rules:
- Company allocation only ever sees lots with `franchise_id IS NULL AND pos_outlet_id IS NULL`. A franchise's lots (outlet lots, and lots made by its own `process-batch`) are never candidates for company allocation or another franchise.
- Receipt cuts a **child lot** at the receiving outlet from the GRN lot (same batch and expiry, `parent_lot_id`). Partial deliveries make several child lots.
- Locking order is always: idempotency key row, business parent row (supply request, sale item, invoice, package), `stock_balances` row, then lot rows. The balance row is the mutex for an outlet/product, so lot locks cannot deadlock between same-product operations; multi-product sales take balances in product order.
- Sale lines may name a lot (`stockLotId`; it must be this outlet's lot of this product) or omit it, in which case the server allocates first-expiry-first-out and writes one sale line per lot (discount and tax split pro rata). So every sale line and ledger row carries a lot, with no UI change. Expired lots are skipped for sales.
- Franchise accounts can reduce stock (wastage, negative adjustment, count below book) but cannot add it (positive adjustment, count above book): that would be the "pull stock with no supply request" hole by another door. Company staff can.
- `transfer-stock` is company-only (403 for franchisees). `transfer-to-franchise` needs a receiving outlet: the one named by `outletId`, else the franchise's only active outlet; none or several is a clear 409/400.
- Delivery cap: quantity <= request quantity - already delivered, and <= GRN accepted - already transferred from that GRN, and <= the lot's quantity. The request becomes `Dispatched` after a partial delivery and `Delivered` when complete; `deliveredQuantity` is cumulative.

## What changed

Schema (3 generated migrations, `drizzle-kit generate` now reports "No schema changes"):
1. `numeric_money_and_quantity`: text money/quantity columns become `numeric(16,2)` / `numeric(16,3)` (orders, order items, invoices, payments, settlements, stock lots, packages, package items, production, batches). Hand-added to the SQL (snapshots untouched): a pre-flight `DO` block that aborts with the table and column named if any value is non-numeric or would violate the new CHECKs, and `DROP DEFAULT`/`SET DEFAULT 0` around columns with a text default (Postgres cannot cast those automatically). CHECKs: `stock_lots.quantity >= 0`, `invoice_records` and `customer_orders` `0 <= paid <= total`, `outlet_stock_ledger.balance_after >= 0`.
2. `unified_outlet_stock_model`: `stock_lots.franchise_id/pos_outlet_id/parent_lot_id`; `stock_balances` (CHECK quantity >= 0); `stock_counts`; ledger columns `seq` (identity tie-breaker), `franchise_id`, `sale_id`, `supply_request_id`, `purchase_order_id`, `goods_receipt_id`, `reason`, plus a movement/sign CHECK; `pos_returns.disposition`. Hand-added: a pre-flight for the movement CHECK, then a backfill (lot franchise from production orders, ledger franchise from outlet, balances as the sum of signed ledger quantities, and one `OPENING-xxxx` lot per non-empty outlet/product so the invariant holds from day one).
3. `idempotency_and_uniqueness`: `idempotency_keys` (unique per actor, action, key), `UNIQUE(route_id, package_id)` on `dispatch_loads`, partial unique index so a supply request has one live (non-cancelled) purchase order. Pre-flight for both.

Server:
- `db/tx.ts`: `transact` (one transaction, key claimed first with `INSERT ... ON CONFLICT DO NOTHING`, so a concurrent same-key request waits for the first and replays its stored response; a rolled-back request does not burn its key; same key with a different payload is 409), `Rejection` (roll back and answer with a safe message), `failure` (known constraint codes get a generic message and a one-line server warning; anything else is logged with its cause and answered generically).
- `db/stock.ts`: `lockBalance`, `moveStock`, `allocateOutletLots`, `lockCompanyLots`, `receiveFromCompanyLot`, `removeStock`, `addStock`.
- `pos.mts`: record-sale in one transaction (shift share-lock, lot validation and FEFO, bill number from the sale id instead of `Date.now()`, duplicate bill number is 409), `allowNegativeStock` removed, return-sale with disposition and the remaining-quantity check under the sale-item lock, new `record-wastage`, `adjust-stock`, `count-stock`, `transfer-stock` company-only, close-shift totals computed inside the transaction under a shift lock. GET also returns `lots` and `balances`.
- `procurement.mts`: create-po (request lock, one live PO), receive-po, create-supplier-invoice, pay-supplier, transfer-to-franchise all transactional with audit events in the same transaction and idempotency keys.
- `fulfillment.mts`: record-payment (invoice lock, overpayment 409, audit), create-package and scan-load in transactions (scan-load locks the package and the route), create-invoice (paid <= total) and create-settlement with keys and audit, franchisee-made lots now carry `franchise_id`.
- `operations.mts`: the record and every projected row (customer, order, items, production, invoice, delivery, payment, stock movement, audit) commit in one transaction; a failure rolls everything back and the cause is logged server-side, the client still gets the existing 503 text. The one-lead-per-place check now runs under an advisory lock inside that transaction.
- `POS.tsx`: one idempotency key per sale attempt (same key while the payload is unchanged, cleared after success).
- Idempotency key: header `Idempotency-Key`, or `idempotencyKey` at top level or in `data`. Replays return the stored status and body plus `replayed: true` and an `Idempotent-Replayed` header. Applied to record-sale, return-sale, record-wastage/adjust-stock/count-stock/transfer-stock, close-shift, record-payment, create-invoice, create-settlement, create-po, receive-po, create-supplier-invoice, pay-supplier, transfer-to-franchise.

API shape changes: `transfer-to-franchise` rows now include `outletId`, `sourceStockLotId` (the company lot) and `stockLotId` is the franchise's child lot; the request is `Dispatched` until fully delivered; `record-sale` returns `{ sale, invoice, items }`; a replayed sale returns 201 with `replayed: true` (was 200); `procurement` GET `franchiseStock` is the unified ledger rows plus frozen legacy rows marked `legacy: true`; `record-payment` on an order with no invoice is now 409 (was an orphan payment). The e2e spec was edited for these (it creates an outlet, reads `sourceStockLotId`); it was not run.

## Verification (all on the local throwaway Postgres 16, port 54329, never a remote database)

```
DATABASE_URL=postgres://postgres@localhost:54329/dawn_test2 pnpm test      # 46 tests, 13 suites, 46 pass, 0 fail
pnpm build                                                                 # succeeds
pnpm typecheck                                                             # exit 0 (after build generated src/routeTree.gen.ts)
pnpm exec drizzle-kit generate --name check                                # "No schema changes, nothing to migrate"
psql -v ON_ERROR_STOP=1 -f <each migration in order> on an empty database  # all 19 apply, no errors
```
- Wave 1's 20 tests still pass (two edited: transfer-stock is now done by company staff, and a franchisee's transfer is 403).
- New `tests/wave2.test.ts` (26 tests): the full flow with ledger balances asserted at every step; partial delivery completing a request; over-transfer rejected (request cap and GRN cap); franchisee cannot pull company stock; company allocation never touches franchise lots; another franchise cannot see or sell a lot; oversell blocked under `Promise.all` (unpinned and lot-pinned); concurrent transfers; concurrent supply transfers; concurrent double return, double payment and double scan; replay by key (sale, header form, concurrent sale retries, return, payment, invoice, settlement, close-shift, create-po, supplier invoice, supplier payment); a rejected request does not burn its key; rollback of the order projection and of a half-built sale, with no SQL detail in the response; numeric column types and the new CHECKs refuse bad rows.
- Negative control: removing the `FOR UPDATE` from `lockBalance` makes the lot-pinned concurrent sale test fail (45 of 46 pass).
- Migration on legacy-shaped data: a database at the previous migration with outlet ledger rows, a text-quantity lot and an invoice migrated to balance 12 and an `OPENING-` lot of 12. Bad data (non-numeric lot quantity, negative lot, paid > total) aborted migration 1 with a message naming the table and column, leaving the columns as text.

## Could not verify

- The Netlify migrator and the real `drizzle-orm/netlify-db` driver (tests use node-postgres behind the same Drizzle API). Transactions and `FOR UPDATE` were already used in production code, but concurrent behaviour was only exercised on node-postgres.
- No UI exercised in a browser; `POS.tsx` change is typechecked and built only.
- `e2e/franchise-procurement.spec.ts` (targets the live site; deliberately not run).
- Production data: none of the migrations has seen real rows.

## Production pre-flight (read-only, run before deploying; the migrations also check and abort with a message)

```sql
-- Non-numeric or negative values, per column (repeat for each converted column in migration 1)
SELECT count(*) FROM stock_lots WHERE quantity !~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$';
SELECT id, quantity FROM stock_lots WHERE quantity ~ '^\s*-' ;
-- Values with more than 2 (money) or 3 (quantity) decimals will be ROUNDED by the cast; list them
SELECT id, total, paid FROM invoice_records WHERE total ~ '\.[0-9]{3,}' OR paid ~ '\.[0-9]{3,}';
SELECT id, quantity FROM stock_lots WHERE quantity ~ '\.[0-9]{4,}';
-- paid must be within 0..total
SELECT id, total, paid FROM invoice_records WHERE paid::numeric < 0 OR paid::numeric > total::numeric;
SELECT id, total, paid FROM customer_orders WHERE paid::numeric < 0 OR paid::numeric > total::numeric;
-- earlier allowNegativeStock sales
SELECT outlet_id, product, balance_after FROM outlet_stock_ledger WHERE balance_after < 0;
-- ledger rows the new movement CHECK would refuse
SELECT id, movement_type, quantity FROM outlet_stock_ledger WHERE NOT ((movement_type IN ('SupplyIn','TransferIn','Return') AND quantity > 0) OR (movement_type IN ('Sale','Wastage') AND quantity < 0) OR (movement_type IN ('Adjustment','Count') AND quantity <> 0));
-- uniqueness rules
SELECT route_id, package_id, count(*) FROM dispatch_loads GROUP BY 1,2 HAVING count(*) > 1;
SELECT supply_request_id, count(*) FROM purchase_orders WHERE status <> 'Cancelled' AND supply_request_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
-- stock that the old model delivered to a franchise but could never sell (frozen legacy ledger)
SELECT franchise_id, product, sum(quantity) FROM franchise_stock_ledger GROUP BY 1,2;
-- after deploy: each outlet balance equals the sum of its lots (expect zero rows)
SELECT b.outlet_id, b.product FROM stock_balances b LEFT JOIN (SELECT pos_outlet_id, product, sum(quantity) q FROM stock_lots WHERE pos_outlet_id IS NOT NULL GROUP BY 1,2) l ON l.pos_outlet_id = b.outlet_id AND l.product = b.product WHERE b.quantity <> coalesce(l.q, 0);
```

## Surprises

- The audit's "the UI never sends a key" was stale: `POS.tsx` sent `${shift.id}-${Date.now()}`, a new key per click, so it deduplicated nothing. Now one key per attempt.
- `latestBalance` ordered by `created_at`, which is the transaction start time, so rows written in one transaction tie. A transfer drawing from several lots could compute wrong `balance_after` values. Balances are now taken from the locked `stock_balances` row, and the backfill uses the sum of signed quantities rather than trusting old `balance_after`.
- `receive-po` returned the receipt without `stockLotId` (the update came after the insert returned), although the e2e spec asserted it. Fixed in the response.
- `close-shift` computed its totals before the transaction, so a sale landing in between was missing from the reconciliation. Now computed after an exclusive shift lock, and sales take a shared lock on the shift.
- Text defaults (`'0'`) cannot be cast by `ALTER ... TYPE` ("default cannot be cast automatically"); the generated migration needed `DROP DEFAULT`/`SET DEFAULT` hand-added around nine columns.
- A franchise's own `process-batch` lots were allocatable company-wide. They now carry `franchise_id`.

## Not done, decisions for the owner

- Lots made by a franchisee's own `process-batch` are franchise-owned but not at an outlet, so POS cannot sell them yet. Needs a "move lot to outlet" action (or processing into an outlet); not built to avoid inventing a workflow (#16 screens).
- `open-shift` still checks "no open shift" outside a lock, so two concurrent opens can both succeed. A partial unique index on `pos_shifts(outlet_id) WHERE status = 'Open'` fixes it (needs a pre-flight); not in the issue scope.
- Franchise-side legacy balances in `franchise_stock_ledger` stay stranded until company staff add them to an outlet with a positive `adjust-stock` (reason recorded). Query above lists them.
- Sales without `stockLotId` are auto-allocated first-expiry-first-out. If you want the lot to be mandatory in the request (barcode/lot scan at the till), that is a one-line change plus UI.
- Replayed responses are 201 with `replayed: true` (a wave-1 replay was 200).
- Idempotency rows are kept forever; add a retention job (e.g. 30 days) when volume matters.
- Audit events (#15) beyond the flows touched here are untouched.
