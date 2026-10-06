# FreshRoute Implementation Roadmap

## Phase 1 — Foundation
- Customer master and addresses
- Proper order and order-item model
- Stable IDs and audit events
- Idempotent automation/event processing
- Customer conversion from lead
- Unified order intake for web, staff and future WhatsApp

## Phase 2 — Fulfilment
- Production demand calculation
- Processing batches
- QC workflow
- Finished-stock lots
- Weighing and package records
- Label generation
- Packing and scan verification

## Phase 3 — Dispatch
- Ready-for-dispatch queue
- Delivery route planning
- Driver and vehicle assignment
- Loading manifests and scan verification
- Driver mobile/PWA
- Proof of delivery

## Phase 4 — Commercial automation
- Invoice lifecycle
- Payment/collection
- Customer credit controls
- Franchise settlement
- Customer notifications

## Phase 5 — Integrations
- WhatsApp order ingestion
- Thermal label printers
- Barcode scanners
- Weighing scales
- Maps/routing provider
- Email/SMS/WhatsApp notifications

## Engineering rule

Build the business workflow first and keep infrastructure inexpensive. At the initial target of 10–15 franchises and roughly 1,000–1,500 orders/day, use the existing Netlify/PostgreSQL foundation. Introduce queues, workers, caching, stronger database infrastructure or service separation only when measured usage requires them.

Each phase must preserve the same source-of-truth IDs and business events so later infrastructure changes do not require rewriting the workflow.
