# FreshRoute project guide

## Product and architecture

FreshRoute is a meat-distribution operations workspace with a public WhatsApp quotation storefront. It supports one business (the supplier) with one company territory (1–50 km), multiple outlets and a franchise network. Each franchise has one allocated location with an admin-chosen working radius (1–50 km, default 20; the Google Places limit is 50 km) and its own franchisee login. It is not a multi-tenant restaurant ERP.

The React application uses TanStack Start/Router and the Netlify Vite adapter. The root route renders the operational product, not a template dashboard. `/shop` is public. Visitors can inspect a labelled sample workspace, but real records require signing in with the app's own accounts: an active user in the `app_users` table with a password. Netlify Identity is not used.

## Key directories

- `src/routes/__root.tsx`: application shell, favicon and finished share metadata. Keep `siteName` and `siteDescription` aligned with the public brand; do not add `og:image`.
- `src/routes/index.tsx`, `src/components/Operations.tsx`: internal workspace, analytics, record forms, team login/invitation/recovery, territory discovery and planning playbook.
- `src/components/Franchises.tsx`: franchise network cards, per-franchise summaries and the franchise form.
- `src/components/Users.tsx`: admin-only Users & access page and the role/franchise/module-permission form.
- `src/routes/shop.tsx`, `src/components/Storefront.tsx`: public catalog, quantity selection and WhatsApp quotation flow.
- `src/lib/business.ts`: TypeScript domain types, product catalog, statuses, haversine distance, currency formatting and read-only demo fixtures.
- `src/styles.css`: custom responsive design, typography and emerald/sage design tokens. SVG graphs and map illustrations are code-native; there is no charting-library dependency.
- `netlify/functions/operations.mts`: protected record retrieval/create/update and admin-only settings. Check authentication and server-assigned roles on every request.
- `netlify/functions/franchises.mts`: franchise list/create/update, gated by the `franchises` module permission.
- `netlify/functions/auth.mts`: session check, sign-in, sign-out, own password change and one-time first-administrator setup (optionally gated by the `OWNER_SETUP_CODE` environment variable).
- `netlify/functions/users.mts`: admin-only users & access CRUD, including setting/resetting passwords. Never returns password hashes.
- `db/email.ts`: optional transactional email through Resend (`RESEND_API_KEY`, `EMAIL_FROM`) for invitation and password-reset links. Never echo provider responses.
- `db/auth.ts`: server-only scrypt password hashing, one-time password links (`password_tokens`, hashed, single use, newest link only), constant-time verification, lockout after 5 failed attempts, and session cookies (`fr_session`, HttpOnly, SameSite=Lax, Secure on HTTPS, 14 days; only a SHA-256 hash of the token is stored).
- `db/access.ts`: shared server-side access resolution from the session cookie and the user's current `app_users` row. Returns role, resolved module permissions and, for franchisees, their active franchise. Writes require a same-origin request.
- `netlify/functions/catalog.mts`: public projection of company/contact configuration only; never expose internal records here.
- `netlify/functions/discover.mts`: signed-in optional Google Places proxy for restaurants, caterers and/or hotels (one search per type, merged, deduplicated, filtered to the radius and sorted by distance; nearest or most-popular ranking). Franchisees always search their own location and radius, and the workspace runs this automatically after a franchisee signs in. Read the provider key on the server; never expose it or echo provider error payloads.
- `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`: Drizzle schema, native Netlify Database client and migration configuration.
- `netlify/database/migrations`: generated schema migrations, automatically applied during deployment.
- `.netlify/results.md`: standalone change summary for the hosting workflow.

## Data model and non-obvious decisions

`operations_records` stores one row per operational record, identified by a UUID and a validated kind (`orders`, `leads`, `sourcing`, `inventory`, `outlets`, `supply`), with typed domain fields in a Postgres JSONB payload, a nullable `franchise_id` and a creation timestamp. A null `franchise_id` is company-direct business; only orders, leads and supply can belong to a franchise, and supply always does. `franchises` stores the contact email (unique) and the location/status payload; logins live in `app_users`. The server, never the client, decides a franchisee's `franchise_id`, checks franchise leads against the franchise's own radius, forces franchise supply requests to `Requested` with no price, and preserves a lead's Google `placeId` (one lead per place across the network). `app_users` is the users & access table: email (unique), scrypt password hash, failed-attempt/lock fields, name, role (`admin`, `staff`, `franchisee`), franchise (franchisees only), sparse per-module permissions (`none`/`view`/`edit`, missing modules fall back to role defaults in `resolvePermissions`) and Active/Disabled status. `sessions` holds hashed session tokens; a password reset, disabling or the user's own password change deletes their other sessions. Every function checks the resolved permission for the record kind on each request, and GET responses omit kinds the user cannot view. `business_settings` has one `main` row for company, currency, contact number and territory. This compact first-version model allows related operational forms to share a CRUD interface. Expand into relational line-item, batch-movement and payment-ledger tables when those workflows are added; do not pretend free-form notes enforce accounting integrity.

The database is the source of truth. Demo fixtures are illustrations only and must never be saved or presented as live records. React state is a rendering cache/form state, not persistent storage. Do not replace Netlify Database with local files, browser storage or external databases. Do not use Netlify Blobs for structured operational records.

Orders and sourcing do not automatically change stock quantities. A stock lot is a manually maintained available quantity with batch/expiry/temperature fields. The delivery screen is a filtered order view, not a separate transport ledger. An order holds one product line. Payments are an entered cumulative paid amount, not an audited transaction ledger.

Google Places search returns at most 20 businesses; do not label it exhaustive. Provider results are reviewed before record creation. Saved leads are filtered by actual coordinates and straight-line distance. Map pins are an explicitly labelled illustration, not geographic plotting. Respect the provider's attribution and data-use terms.

Public checkout requests quotations through WhatsApp and never silently inserts orders or claims a purchase is confirmed. Ordering stays unavailable until an administrator configures the business number. Restaurant/catering ERP features are roadmap copy, not working software.

## Conventions

- Use strict TypeScript and PascalCase component names; keep shared domain definitions in `src/lib/business.ts`.
- Server functions use `.mts`, Web Request/Response APIs and default exports. Keep server-only imports out of client modules.
- Authentication is the app's own (`db/auth.ts`); do not reintroduce Netlify Identity or store plain-text or reversible passwords. Access is granted only by the server-side `app_users` table; there is no public signup. Keep at least one active admin. Settings and users & access require `admin`.
- Validate numeric fields, status, required quantities and products, paid-versus-total amounts, coordinates, international phone format and batch expiry on the server as well as the form.
- Maintain empty/loading/error states, keyboard navigation, focus handling, mobile layout and reduced-motion support. Preserve CSV formula-injection protection.
- Use UTC calendar dates for consistent operational reporting. Show order value, unpaid balances and fulfilment separately; do not call booked order value profit.
- Keep secrets out of output, tracked files, client code and public configuration responses.
- Schema changes require a generated migration in `netlify/database/migrations`. Keep `drizzle-orm` and `drizzle-kit` on the required `@beta` release line for the Netlify adapter.

## Development

Use Node.js 22 and pnpm. Local UI development uses `netlify dev --port 8889`. The hosting pipeline handles build and validation. Follow the current run's restrictions before invoking build, dev-server or test commands. Do not edit the generated route tree manually or create build artifacts as part of ordinary changes.

Before adding a Netlify feature, read its skill under `/opt/buildhome/.agents/skills`. Adding Forms later requires its activation script. Read `README.md` for operational setup and first-version boundaries.
