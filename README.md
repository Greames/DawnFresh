# FreshRoute

FreshRoute is a first-version workspace and public storefront for a meat distribution business serving restaurants, caterers, businesses and retail customers. It covers chicken, mutton, eggs, fish and prawns, with sourcing, central processing stock, retail outlets and mobile outlets in one interface.

## What is included

- **Operations workspace (`/`)**: order-value reporting, fulfilment status, outstanding customer balances and sales opportunities; searchable records, status filters and CSV exports.
- **Orders and customers**: create and edit orders, payments received, restaurant leads, follow-up dates, estimated monthly opportunity and contact details. WhatsApp contact links are available for records with an international phone number.
- **Sourcing**: farmer/supplier purchasing records, expected intake, received status and supplier balances.
- **Inventory**: manually managed stock lots with product, quantity, unit, outlet, batch, expiry and recorded temperature.
- **Outlets and deliveries**: outlet records and a delivery view of orders that are ready, on the road or delivered. Driver, route and time-window information can be recorded in order notes.
- **Territory explorer**: configurable 20, 25 or 30 km territories, distance filtering of saved leads, conversion counts and estimated open pipeline. Optional Google Places discovery returns up to 20 nearby restaurants, with review-and-save lead creation.
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
- One deployment represents one business with one active territory. Staff share its records; this is not a multi-tenant restaurant ERP. Restaurant/caterer ERP, automated inventory, processing reconciliation, invoicing/tax, route optimisation, customer credit enforcement, audited accounting and multi-territory reporting remain explicit roadmap items.
- The cash-flow and food-safety playbook is a general planning aid. Verify actual local licensing, handling, tax and invoicing obligations with qualified advisers before operating.

## Database changes

Define schema changes in `db/schema.ts` and generate the corresponding migration:

```sh
pnpm exec drizzle-kit generate --name add_descriptive_change
```

Migrations belong in `netlify/database/migrations`. Use the `@beta` versions of `drizzle-orm` and `drizzle-kit` required by the native Netlify adapter. Never run schema-changing SQL against the provisioned database outside migrations.
