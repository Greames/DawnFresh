# FreshRoute

FreshRoute is a first-version workspace and public storefront for a meat distribution business serving restaurants, caterers, businesses and retail customers. It covers chicken, mutton, eggs, fish and prawns, with sourcing, central processing stock, retail outlets and mobile outlets in one interface.

## What is included

- **Operations workspace (`/`)**: order-value reporting, fulfilment status, outstanding customer balances and sales opportunities; searchable records, status filters and CSV exports.
- **Orders and customers**: create and edit orders, payments received, restaurant leads, follow-up dates, estimated monthly opportunity and contact details. WhatsApp contact links are available for records with an international phone number.
- **Sourcing**: farmer/supplier purchasing records, expected intake, received status and supplier balances.
- **Inventory**: manually managed stock lots with product, quantity, unit, outlet, batch, expiry and recorded temperature.
- **Outlets and deliveries**: outlet records and a delivery view of orders that are ready, on the road or delivered. Driver, route and time-window information can be recorded in order notes.
- **Territory explorer**: configurable 20, 25 or 30 km territories, distance filtering of saved leads, conversion counts and estimated open pipeline. Optional Google Places discovery returns up to 20 nearby restaurants, with review-and-save lead creation.
- **Users & access**: an admin-only page backed by its own `app_users` table. Add a user by email with a role (Admin, Company staff or Franchisee, which is tied to one franchise) and a No access / View / Edit level per module: orders & deliveries, leads & territory, franchise supply, inventory, sourcing, outlets and the franchise network. Optionally set a password to create their login immediately. Disable a user to block them, reset passwords, and grant access to Netlify Identity accounts that have signed up or been invited but have no role yet. Changes apply on the user's next request.
- **Franchise network**: franchises each have one allocated location and a fixed 20 km territory. The Franchise network page lists every franchise with its contact email, active logins, last activity, customers acquired, open pipeline, orders to deliver, customer payments due and the amount it owes the company for supply. *Open dashboard* (or the network selector in the page header) narrows the overview, orders, leads, deliveries, supply and territory pages to one franchise or to company-direct business.
- **Franchisee workspace**: a franchisee signs in and sees only their own franchise: a scorecard of business acquired and pending, customer orders, deliveries, customer payments pending, leads within their 20 km territory, discovery of restaurants, caterers and hotels around their location, and stock requests to the company.
- **Franchise supply**: the company is the supplier to every franchise. Franchisees request stock; the company prices, confirms, dispatches and records payments. Franchisees can only cancel a request until the company confirms it.
- **Public storefront (`/shop`)**: product selection, quantity controls, customer details and a WhatsApp quotation request. Wholesale, retail and caterer needs are supported without inventing prices or charging online.
- **Business playbook**: practical planning prompts for cash flow, supplier resilience, processing yield, food safety, route density and future restaurant/catering software.

FreshRoute is the initial brand and INR is the illustrative currency because a company name and operating country were not supplied. The business name, currency, location, service radius and WhatsApp number can be changed in Business settings. Share metadata uses the FreshRoute brand; update `src/routes/__root.tsx` if changing the public brand.

## Technologies

React 19, TypeScript, TanStack Start and TanStack Router, Vite, Tailwind CSS 4 with custom responsive styles, Lucide icons and SVG charts. Persistent structured records use Netlify Database with Drizzle ORM. Netlify Functions provide the APIs, and `@netlify/identity` protects team data.

## Run locally

Use Node.js 22 and pnpm:

```sh
pnpm install
netlify dev --port 8889
```

The local interface includes a clearly labelled, read-only sample workspace. Identity flows should be exercised on a real Netlify preview or production deployment, where the Identity service and cookies are available. The project is configured with the Netlify TanStack Start adapter; the deployment platform handles production builds.

## Connect the real business

1. Deploy the project. Netlify Database is automatically provisioned on connection; the included migration creates the operational-record and business-settings tables.
2. Netlify Identity has been enabled. In the project Identity settings, use invitation-only registration for a private team. Invite the owner and assign the `admin` role using Netlify's Identity administration. Invite other users with the `staff` role. Unassigned users cannot access business data, and there is no public team-signup screen.
   - Netlify Identity only checks passwords. Access comes from **Users & access**: the owner (an Identity account with the `admin` role) signs in, then adds staff and franchisees there, with a password or by inviting the same email from Netlify Identity (no Identity role needed; the account links on first sign-in by email). Identity `staff`/`franchisee` roles on their own no longer grant access; existing accounts appear under *Accounts waiting for access* for one-click granting. Franchise logins created before this change are migrated automatically. Setting a franchise to Inactive blocks all of its users.
3. Accept the invitation, set a password and sign in. A real workspace starts empty; sample records are never written into the database.
4. As an administrator, configure the business name, currency, WhatsApp number in international digits, starting location, latitude/longitude and 20–30 km service radius. Use the actual processing unit or outlet coordinates.
5. Add the processing unit, retail outlet and mobile outlet. Then add supplier purchases, processed stock lots, customers and orders.
6. For optional live discovery, configure `GOOGLE_PLACES_API_KEY` as a server-only Netlify Functions environment variable, enable Places API (New), configure its billing and API restrictions, and redeploy. Never put this key in client code or a public `VITE_` variable. This feature can incur provider charges. Follow Google's applicable attribution, permitted-use and data-storage requirements when using or saving provider-sourced information.

## Important boundaries

- The dashboard's order value represents booked sales, not collected revenue or profit. Receivables and unfulfilled orders are separate indicators. Cancelled orders are excluded from dashboard financial totals.
- Each order currently records one product line. Enter separate records for additional products and use notes for a shared customer reference. Multi-line invoicing is a future extension.
- WhatsApp checkout sends a quotation request; it does not create a confirmed order or payment. Staff must confirm pricing, actual weight, availability and delivery charges and enter confirmed orders in the workspace. WhatsApp messages are not ingested automatically.
- Stock movements, allocation, processing yield, wastage, supplier intake and sales are not automatically reconciled. Keep physical stock records accurate, record processed output as a separate batch and manually update available quantities. The recorded temperature is an observation, not live monitoring or a food-safety certification.
- Google discovery is a limited search, not an exhaustive directory of every restaurant in a territory. The map is an illustration; lead distances use a straight-line haversine calculation, not driving routes. Manually entered leads without both coordinates are excluded from radius filtering.
- One deployment represents one business (the supplier) and its franchise network. Company staff share all records; each franchisee sees only their own franchise's records. This is not a multi-tenant restaurant ERP.
- Franchise territories are straight-line 20 km circles around the allocated coordinates. The server rejects franchise leads without coordinates or outside the circle. Territories may overlap (the network page flags it); a Google-discovered business can be saved as a lead only once across the whole network.
- Supply to franchises does not change company inventory or franchise stock automatically, and supply payments are an entered cumulative amount, not an audited ledger. Restaurant/caterer ERP, automated inventory, processing reconciliation, invoicing/tax, route optimisation, customer credit enforcement, audited accounting and multi-territory reporting remain explicit roadmap items.
- The cash-flow and food-safety playbook is a general planning aid. Verify actual local licensing, handling, tax and invoicing obligations with qualified advisers before operating.

## Database changes

Define schema changes in `db/schema.ts` and generate the corresponding migration:

```sh
pnpm exec drizzle-kit generate --name add_descriptive_change
```

Migrations belong in `netlify/database/migrations`. Use the `@beta` versions of `drizzle-orm` and `drizzle-kit` required by the native Netlify adapter. Never run schema-changing SQL against the provisioned database outside migrations.
