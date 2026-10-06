# FreshRoute Business Flow

## Vision

FreshRoute should automate the routine path from customer demand to delivered product. Staff should manage exceptions, quality decisions and business approvals; the system should coordinate the normal flow.

## End-to-end flow

```text
LEAD
  ↓
CUSTOMER
  ↓
WEB / WHATSAPP ORDER
  ↓
ORDER VALIDATION
  ↓
AVAILABILITY / CREDIT / PRICE CHECK
  ↓
PRODUCTION PLAN
  ↓
PROCESSING QUEUE
  ↓
PROCESSING
  ↓
QC
  ↓
WEIGHING
  ↓
LABEL PRINT
  ↓
PACKING
  ↓
SCAN & VERIFY
  ↓
READY FOR DISPATCH
  ↓
DELIVERY PLANNING
  ↓
ROUTE + DRIVER + VEHICLE
  ↓
LOADING SCAN
  ↓
OUT FOR DELIVERY
  ↓
DELIVERY CONFIRMATION
  ↓
INVOICE / PAYMENT
  ↓
SETTLEMENT / REPORTING
```

## 1. Lead to customer

A lead can be converted into a customer.

Customer master data should include:

- Customer identity and contact details
- WhatsApp/mobile number
- Delivery addresses and GPS coordinates
- Customer type: restaurant, caterer, retail, hotel, etc.
- Pricing tier
- Payment terms and credit limit
- Assigned franchise/outlet
- Delivery preferences
- Order and payment history

Conversion should create one durable customer identity. Future web and WhatsApp orders must resolve to this customer rather than creating duplicates.

## 2. Order intake

All channels feed the same order engine:

- FreshRoute web storefront
- WhatsApp
- Franchisee workspace
- HQ/staff entry
- Future API/integrations

A WhatsApp message should become a draft order when the system has enough information. Ambiguous information should trigger a confirmation rather than an unsafe assumption.

A confirmed order should contain customer, delivery address, requested products/quantities, requested date/time window, pricing, payment terms and source channel.

## 3. Production planning

The system calculates:

**Confirmed demand − available finished stock = production requirement**

Production planning groups requirements by product, date, processing capability and required delivery window.

Shortages become exceptions visible to HQ.

## 4. Processing

Processing staff receive a prioritized queue.

For each batch:

- Start processing
- Record input
- Record finished output
- Record waste/by-product
- Calculate yield
- Link the batch to the originating demand

Completed processing creates traceable stock movement from raw/incoming to processing and then finished stock.

## 5. QC

Every production batch passes through QC.

QC can:

- Pass
- Fail
- Hold for review

Failed or held batches must not become available for dispatch automatically.

## 6. Weighing and label printing

Each package should receive a unique package/label identity.

A label should be able to carry, as appropriate:

- FreshRoute/business name
- Customer/order
- Product
- Actual package weight
- Batch/lot
- Packed date/time
- Use-by information according to the business food-safety process
- Barcode/QR code

The final design should be compatible with the selected weighing scale and thermal printer hardware.

## 7. Packing

Packing is driven by the order's required items.

The packer scans each package. The system verifies:

- Correct order
- Correct product
- Expected quantity/weight
- Valid batch
- QC passed
- Package not already dispatched

When all required packages are verified, the order becomes **Ready for Dispatch**.

Missing or incorrect packages create exceptions.

## 8. Delivery planning

The delivery planner groups ready orders using:

- Delivery area
- Customer time window
- Vehicle capacity
- Product/temperature requirements
- Priority
- Franchise/outlet
- Route density

The planner produces routes, stops, drivers and vehicles.

Initially this can be assisted by rules; later it can use route optimization APIs when volume justifies the cost.

## 9. Loading

The loading team scans packages against the assigned route.

The vehicle should not be marked dispatched until required packages are accounted for, subject to an authorized exception process.

The system should show:

- Route
- Driver
- Vehicle
- Orders
- Packages
- Total weight
- Missing packages
- Loading completion

## 10. Delivery

The driver's mobile/PWA view should provide:

- Ordered stop sequence
- Customer address
- Navigation
- Packages expected
- Call/WhatsApp options
- Delivery confirmation
- OTP/signature/photo when required
- Quantity discrepancy
- Payment collection

Delivery confirmation updates the same order and package records used by HQ.

## 11. Finance

The operational flow automatically creates or updates:

- Invoice
- Amount due
- Payment
- Balance
- Collection status
- Franchise settlement where applicable

Financial corrections should be auditable rather than silently overwriting history.

## 12. Notifications

Events can trigger customer and staff notifications:

- Order confirmed
- Order accepted
- Processing started
- Packed
- Out for delivery
- Delivery completed
- Payment received
- Delay/exception

Channels can include WhatsApp, email and SMS depending on provider cost and business requirements.

## 13. Exception-driven operations

FreshRoute should prioritize exceptions such as:

- Production shortage
- QC failure
- Packing delay
- Missing package
- Wrong package scan
- Vehicle capacity problem
- Route delay
- Failed delivery
- Payment/credit issue
- Stock mismatch

Routine orders should move automatically without requiring multiple teams to re-enter the same information.

## 14. Business control tower

HQ should see one operational picture:

**Orders → Production → QC → Packing → Ready → Dispatch → Delivery → Collections**

Useful KPIs include:

- Orders due today
- Production required/completed
- QC holds
- Packages ready
- Dispatch readiness
- Deliveries completed/pending
- Outstanding invoices
- Collections
- Production yield and waste
- Stock discrepancies
- Route performance

## 15. Role boundaries

### HQ
Owns company-wide planning, pricing, production, inventory, finance, franchises and exceptions.

### Franchise
Sees and manages its permitted customers, orders, supply, stock, outlets and local deliveries.

### Processing/Packing
Works only on production, QC, weighing, labeling and packing tasks.

### Driver
Works only on assigned routes, stops, packages, delivery confirmation and permitted collections.

### Customer
Creates and tracks their own orders without seeing internal operational data.

## 16. Automation rules

1. Do not duplicate the same customer or order in separate modules.
2. Every operational object gets a stable ID.
3. Every important status transition is auditable.
4. Automation must be idempotent: retrying an event must not create duplicate invoices, packages or payments.
5. Human approval is required for exceptions and irreversible business decisions.
6. Physical stock remains verifiable against recorded stock.
7. Customer-facing promises must use confirmed availability and delivery capacity.
8. WhatsApp is a channel, not a second order database.

## 17. Scaling approach

The initial target is 10–15 franchises at approximately 100 orders per franchise per day, or about 1,000–1,500 orders/day.

Start with the low-cost Netlify/PostgreSQL deployment during development and pilot operation.

Scale in response to measured usage:

**MVP → pilot → indexed relational core → background workers/queues → scaled database → additional services only when justified.**

The business flow should remain stable while infrastructure evolves.

## Success criteria

FreshRoute is successful when a confirmed order can move through the normal lifecycle with minimal manual re-entry:

**Customer → Order → Production → QC → Package → Label → Packing → Route → Load → Delivery → Invoice → Payment**

The operator's job becomes supervising exceptions, not moving information from one screen to another.
