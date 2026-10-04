# FreshRoute project guide

## Product and architecture

FreshRoute is a meat-distribution operations workspace with a public WhatsApp quotation storefront. The initial product supports one business and one active 20–30 km territory, with multiple outlets. It is not a multi-tenant restaurant ERP.

The React application uses TanStack Start/Router and the Netlify Vite adapter. The root route renders the operational product, not a template dashboard. `/shop` is public. Visitors can inspect a labelled sample workspace, but real records require an authenticated Netlify Identity account with the `admin` or `staff` role.

## Key directories

- `src/routes/__root.tsx`: application shell, favicon and finished share metadata. Keep `siteName` and `siteDescription` aligned with the public brand; do not add `og:image`.
- `src/routes/index.tsx`, `src/components/Operations.tsx`: internal workspace, analytics, record forms, team login/invitation/recovery, territory discovery and planning playbook.
- `src/routes/shop.tsx`, `src/components/Storefront.tsx`: public catalog, quantity selection and WhatsApp quotation flow.
- `src/lib/business.ts`: TypeScript domain types, product catalog, statuses, haversine distance, currency formatting and read-only demo fixtures.
- `src/styles.css`: custom responsive design, typography and emerald/sage design tokens. SVG graphs and map illustrations are code-native; there is no charting-library dependency.
- `netlify/functions/operations.mts`: protected record retrieval/create/update and admin-only settings. Check authentication and server-assigned roles on every request.
- `netlify/functions/catalog.mts`: public projection of company/contact configuration only; never expose internal records here.
- `netlify/functions/discover.mts`: staff-only optional Google Places proxy. Read the provider key on the server; never expose it or echo provider error payloads.
- `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`: Drizzle schema, native Netlify Database client and migration configuration.
- `netlify/database/migrations`: generated schema migrations, automatically applied during deployment.
- `.netlify/results.md`: standalone change summary for the hosting workflow.

## Data model and non-obvious decisions

`operations_records` stores one row per operational record, identified by a UUID and a validated kind (`orders`, `leads`, `sourcing`, `inventory`, `outlets`), with typed domain fields in a Postgres JSONB payload and a creation timestamp. `business_settings` has one `main` row for company, currency, contact number and territory. This compact first-version model allows related operational forms to share a CRUD interface. Expand into relational line-item, batch-movement and payment-ledger tables when those workflows are added; do not pretend free-form notes enforce accounting integrity.

The database is the source of truth. Demo fixtures are illustrations only and must never be saved or presented as live records. React state is a rendering cache/form state, not persistent storage. Do not replace Netlify Database with local files, browser storage or external databases. Do not use Netlify Blobs for structured operational records.

Orders and sourcing do not automatically change stock quantities. A stock lot is a manually maintained available quantity with batch/expiry/temperature fields. The delivery screen is a filtered order view, not a separate transport ledger. An order holds one product line. Payments are an entered cumulative paid amount, not an audited transaction ledger.

Google Places search returns at most 20 businesses; do not label it exhaustive. Provider results are reviewed before record creation. Saved leads are filtered by actual coordinates and straight-line distance. Map pins are an explicitly labelled illustration, not geographic plotting. Respect the provider's attribution and data-use terms.

Public checkout requests quotations through WhatsApp and never silently inserts orders or claims a purchase is confirmed. Ordering stays unavailable until an administrator configures the business number. Restaurant/catering ERP features are roadmap copy, not working software.

## Conventions

- Use strict TypeScript and PascalCase component names; keep shared domain definitions in `src/lib/business.ts`.
- Server functions use `.mts`, Web Request/Response APIs and default exports. Keep server-only imports out of client modules.
- Use `@netlify/identity`, not deprecated widgets or GoTrue clients. Only server-assigned `user.roles` grant access. Do not grant staff privileges at public signup. Settings writes require `admin`.
- Validate numeric fields, status, required quantities and products, paid-versus-total amounts, coordinates, international phone format and batch expiry on the server as well as the form.
- Maintain empty/loading/error states, keyboard navigation, focus handling, mobile layout and reduced-motion support. Preserve CSV formula-injection protection.
- Use UTC calendar dates for consistent operational reporting. Show order value, unpaid balances and fulfilment separately; do not call booked order value profit.
- Keep secrets out of output, tracked files, client code and public configuration responses.
- Schema changes require a generated migration in `netlify/database/migrations`. Keep `drizzle-orm` and `drizzle-kit` on the required `@beta` release line for the Netlify adapter.

## Development

Use Node.js 22 and pnpm. Local UI development uses `netlify dev --port 8889`; actual Identity flows should be checked on a deployed Netlify preview or production environment. The hosting pipeline handles build and validation. Follow the current run's restrictions before invoking build, dev-server or test commands. Do not edit the generated route tree manually or create build artifacts as part of ordinary changes.

Before adding a Netlify feature, read its skill under `/opt/buildhome/.agents/skills`. Netlify Identity is already enabled; adding Forms later also requires its activation script. Read `README.md` for operational setup and first-version boundaries.
