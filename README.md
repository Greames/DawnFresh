# FreshRoute

FreshRoute is a first-version workspace and public storefront for a meat distribution business serving restaurants, caterers, businesses and retail customers. It covers chicken, mutton, eggs, fish and prawns, with sourcing, central processing stock, retail outlets and mobile outlets in one interface.

## What is included

- **Operations workspace (`/`)**: order-value reporting, fulfilment status, outstanding customer balances and sales opportunities; searchable records, status filters and CSV exports.
- **Orders and customers**: create and edit orders, payments received, restaurant leads, follow-up dates, estimated monthly opportunity and contact details. WhatsApp contact links are available for records with an international phone number.
- **Sourcing**: farmer/supplier purchasing records, expected intake, received status and supplier balances.
- **Inventory**: manually managed stock lots with product, quantity, unit, outlet, batch, expiry and recorded temperature.
- **Outlets and deliveries**: physical processing, retail, warehouse and mobile outlets; delivery planning with driver, vehicle, route, delivery window and delivery status. Orders automatically create and synchronize their delivery record.
- **Territory explorer**: configurable 20, 25 or 30 km territories, distance filtering of saved leads, conversion counts and estimated open pipeline. Optional Google Places discovery returns up to 20 nearby restaurants, with review-and-save lead creation.
- **Users & access**: an admin-only page backed by its own `app_users` table. Add a user by email with a role (Admin, Company staff or Franchisee, which is tied to one franchise) and a No access / View / Edit level per module: orders & deliveries, leads & territory, franchise supply, inventory, sourcing, outlets and the franchise network. Set their password when you add them. Disable a user or reset a password to sign them out everywhere; reset also unlocks an account locked after five failed attempts. Changes apply on the user's next request.
- **Franchise network**: each franchise has one allocated location and a working radius the admin chooses (5–50 km, default 20). Franchisees see restaurants, caterers and hotels within that radius as soon as they sign in. The Franchise network page lists every franchise with its contact email, active logins, last activity, customers acquired, open pipeline, orders to deliver, customer payments due and the amount it owes the company for supply. *Open dashboard* (or the network selector in the page header) narrows the overview, orders, leads, deliveries, supply and territory pages to one franchise or to company-direct business.
- **Franchisee workspace**: a franchisee signs in and sees only their own franchise: business scorecard, customer orders, processing & QC, finished stock, outlets/mobile outlets, deliveries, invoices, customer collections, territory leads and stock requests to the company.
- **Franchise supply & settlement**: the company is the supplier to every franchise. Franchisees request stock; the company prices, confirms, dispatches and records payments. HQ has a settlement view for franchise balances; franchisees cannot alter settlement or stock-audit records.
- **Public storefront (`/shop`)**: product selection, quantity controls, customer details and a WhatsApp quotation request. Wholesale, retail and caterer needs are supported without inventing prices or charging online.
- **HQ control tower**: company-wide fulfilment visibility for orders, processing/QC, delivery activity, invoices, collections and stock movement audit.
- **Billing & collections**: invoices are created from confirmed orders, balances are calculated, and payment entries are appended when collections increase. Invoices, deliveries and payment records stay linked to the originating order.
- **Stock movement audit**: processing completion posts raw → processing → finished-stock input/output/waste movements; delivered orders post finished-stock → customer/mobile-outlet movements. Physical stock lots remain the source for actual on-hand verification.
- **Business playbook**: practical planning prompts for cash flow, supplier resilience, processing yield, food safety, route density and future restaurant/catering software.

FreshRoute is the initial brand and INR is the illustrative currency because a company name and operating country were not supplied. The business name, currency, location, service radius and WhatsApp number can be changed in Business settings. Share metadata uses the FreshRoute brand; update `src/routes/__root.tsx` if changing the public brand.

## Technologies

React 19, TypeScript, TanStack Start and TanStack Router, Vite, Tailwind CSS 4 with custom responsive styles, Lucide icons and SVG charts. Persistent structured records use Netlify Database with Drizzle ORM. Netlify Functions provide the APIs. Sign-in is the app's own: users, scrypt password hashes and sessions live in the app database (`app_users`, `sessions`), with an HttpOnly session cookie.

## Run locally

Use Node.js 22 and pnpm:

```sh
pnpm install
netlify dev --port 8889
```

The local interface includes a clearly labelled, read-only sample workspace. Sign-in uses the app database, so it works anywhere the Netlify Database is available. The project is configured with the Netlify TanStack Start adapter; the deployment platform handles production builds.

## Connect the real business

1. Deploy the project. Netlify Database is automatically provisioned on connection; the included migration creates the operational-record and business-settings tables.
2. Open the site. A new workspace opens a one-time **Create the administrator** dialog: enter your name, email and password. That account is the first admin; the dialog disappears once an active admin exists. To stop anyone else claiming it before you, set an `OWNER_SETUP_CODE` environment variable in Netlify before the first deploy; setup then asks for that code. Add everyone else in **Users & access** with a password and share it privately; they can change it from the account menu (click their name at the bottom of the sidebar). There is no public sign-up and no password email: an admin resets forgotten passwords. Netlify Identity is not used.
3. A real workspace starts empty; sample records are never written into the database.
4. As an administrator, configure the business name, currency, WhatsApp number in international digits, starting location, latitude/longitude and service radius (up to 50 km). Use the actual processing unit or outlet coordinates.
5. Add the processing unit, retail outlet and mobile outlet. Then add supplier purchases, processed stock lots, customers and orders.
6. For optional live discovery, configure `GOOGLE_PLACES_API_KEY` as a server-only Netlify Functions environment variable, enable Places API (New), configure its billing and API restrictions, and redeploy. Never put this key in client code or a public `VITE_` variable. This feature can incur provider charges. Follow Google's applicable attribution, permitted-use and data-storage requirements when using or saving provider-sourced information.

## Email (invitations and password resets)

Email is optional. Without it, admins set passwords on Users & access and share them privately. With it, new users can be emailed an invitation link to set their own password, admins can email a reset link, and anyone can use **Forgot password?** on the sign-in screen. Links work once and expire (invitations 72 hours, admin resets 24 hours, self-service resets 1 hour).

1. Create a free account at [resend.com](https://resend.com) and verify your sending domain (add the DNS records it shows). Until a domain is verified, Resend only delivers to your own account address.
2. Create an API key in Resend.
3. In Netlify → Site configuration → Environment variables, add `RESEND_API_KEY` (the key) and `EMAIL_FROM` (for example `DawnFresh <login@yourdomain.com>`, on the verified domain).
4. Redeploy. Users & access shows "Email is on" when both are set.

## Troubleshooting

- **Users or franchisees see a Netlify login page, or the app says Netlify asked for its own login** (older versions showed `Unexpected token '<'`): Netlify team login protection is on for production. In Netlify → Project configuration → Access & security → Visitor access, set it to non-production deploys only or turn it off. The app's own sign-in protects business data.
- **A push to `main` does not appear on the site**: in Netlify → Deploys, check for a failed build, or for locked auto publishing / stopped builds, then use Trigger deploy.
- **Changed an environment variable** (`GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_SETUP_CODE`): redeploy; functions only read new values after a deploy.

## Important boundaries

- The dashboard's order value represents booked sales, not collected revenue or profit. Receivables and unfulfilled orders are separate indicators. Cancelled orders are excluded from dashboard financial totals.
- Each order currently records one product line. Enter separate records for additional products and use notes for a shared customer reference. Multi-line invoicing is a future extension.
- WhatsApp checkout sends a quotation request; it does not create a confirmed order or payment. Staff must confirm pricing, actual weight, availability and delivery charges and enter confirmed orders in the workspace. WhatsApp messages are not ingested automatically.
- Stock movements, allocation, processing yield, wastage, supplier intake and sales are not automatically reconciled. Keep physical stock records accurate, record processed output as a separate batch and manually update available quantities. The recorded temperature is an observation, not live monitoring or a food-safety certification.
- Google discovery is a limited search, not an exhaustive directory of every restaurant in a territory. The map is an illustration; lead distances use a straight-line haversine calculation, not driving routes. Manually entered leads without both coordinates are excluded from radius filtering.
- One deployment represents one business (the supplier) and its franchise network. Company staff share all records; each franchisee sees only their own franchise's records. This is not a multi-tenant restaurant ERP.
- Franchise territories are straight-line circles (the radius set for each franchise) around the allocated coordinates. The server rejects franchise leads without coordinates or outside the circle. Territories may overlap (the network page flags it); a Google-discovered business can be saved as a lead only once across the whole network.
- Supply to franchises does not change company inventory or franchise stock automatically, and supply payments are an entered cumulative amount, not an audited ledger. Restaurant/caterer ERP, automated inventory, processing reconciliation, invoicing/tax, route optimisation, customer credit enforcement, audited accounting and multi-territory reporting remain explicit roadmap items.
- The cash-flow and food-safety playbook is a general planning aid. Verify actual local licensing, handling, tax and invoicing obligations with qualified advisers before operating.

## Database changes

Define schema changes in `db/schema.ts` and generate the corresponding migration:

```sh
pnpm exec drizzle-kit generate --name add_descriptive_change
```

Migrations belong in `netlify/database/migrations`. Use the `@beta` versions of `drizzle-orm` and `drizzle-kit` required by the native Netlify adapter. Never run schema-changing SQL against the provisioned database outside migrations.
