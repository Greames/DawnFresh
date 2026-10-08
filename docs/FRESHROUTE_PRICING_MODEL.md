# FreshRoute Company → Franchise Pricing Model

## Purpose

The first commercial model to harden is Company → Franchisee raw-material supply. The company sources from approved suppliers and suppliers deliver directly to the franchisee processing facility.

## Commercial flow

Franchisee stock order → company price confirmation → franchisee upfront payment → company supplier purchase → supplier direct delivery to franchise processing facility → franchise receiving/weight/QC → franchise processing.

The company does not need to warehouse every franchise order.

## Upfront payment

A franchisee must fund the order before the company confirms the supplier purchase, subject to the configured prepaid-stock policy.

The franchise fee may include an initial stock credit. That credit should be represented separately as a **Franchise Prepaid Stock Balance**, not mixed into individual supplier invoices.

## Configurable pricing

Pricing is configuration-driven and effective-dated. No commercial assumption is hard-coded.

Configurable inputs include:

- Supplier price per live kilogram
- Standard yield %
- Logistics cost per live kilogram
- Other cost per live kilogram
- Company price per standard billable kilogram
- Product
- Processing type
- Supplier
- Optional franchise-specific price
- Effective-from / effective-to dates

## Commercial formula

**Standard Billable Weight = Live Weight × Standard Yield %**

**Supplier Cost = Live Weight × Supplier Price**

**Landed Cost = Supplier Cost + Live Weight × (Logistics Cost + Other Cost)**

**Franchise Order Value = Standard Billable Weight × Company Price**

**Gross Margin = Franchise Order Value − Landed Cost**

**Gross Margin % = Gross Margin ÷ Franchise Order Value × 100**

## Example

Live weight = 100 kg  
Supplier price = ₹120/kg  
Standard yield = 70%  
Company price = ₹180/billable kg  
Logistics = ₹0/kg  
Other cost = ₹0/kg

Billable weight = 100 × 70% = **70 kg**

Supplier cost = 100 × ₹120 = **₹12,000**

Franchise value = 70 × ₹180 = **₹12,600**

Gross sourcing margin = **₹600**

## Standard yield vs actual yield

The standard yield is the **commercial billing assumption**. Actual processing yield is an operational KPI.

Example:

- Standard yield: 70%
- Live input: 100 kg
- Standard billable weight: 70 kg
- Actual finished output: 68 kg
- Actual yield: 68%
- Yield variance: -2 percentage points

Actual yield should not automatically rewrite the confirmed commercial price. Exceptions and tolerance rules can be introduced later if the business decides they are required.

## Pricing versioning

Every configuration is versioned. Historical orders must retain the exact pricing snapshot used when they were confirmed.

A later supplier-price or yield change must not retroactively change an old franchise order.

## Scenario analysis

Before activating a commercial change, management can test:

- Supplier price increases/decreases
- Yield changes
- Logistics cost changes
- Company price changes
- Resulting billable weight
- Landed cost
- Franchise order value
- Gross margin and margin %

Scenarios are stored for decision history.

## Direct supplier → franchise receiving

Because the supplier delivers directly to the franchise, receiving is a controlled event:

Supplier dispatch → franchise receives → physical weight → accepted/rejected quantity → QC → discrepancy.

The company needs the supplier order, expected quantity, received quantity and discrepancy to remain linked.

## Ownership

Independent and company-owned franchisees use the same operational model. Ownership affects reporting/accounting, not the core supply workflow.

## Future extensions

The model is designed to support supplier-specific yield, product/processing-specific yield, franchise-specific pricing, taxes, rebates, volume tiers, transport charges, payment terms and margin targets without redesigning the order engine.
