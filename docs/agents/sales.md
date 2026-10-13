# Sales agent playbook: DawnFresh, Proddatur

Prepared 2026-10-13. Target start 10 Jan 2027 (a target, not a commitment). Brand is not final (DawnFresh vs FreshRoute); copy uses `[BRAND]`.

Legend: **[V]** verified in repo files; **[U]** unverified, needs a check; **[E]** estimate or assumption; **[OWNER]** needs an owner decision. No customer, contact or price in this file is real. Every `{...}` and `[...]` is a placeholder.

Cross-references: marketing plan `docs/dept/marketing.md` (segments, outreach script, pricing framework, KPI sheet; owned by Marketing); `docs/LAUNCH_PLAN_PRODDATUR.md` (gates, licences; Registrations owns licences); `docs/product/STATUS.md` (restaurant-software eligibility rule); Social Media owns all posting.

---

## 1. Charter

**I do:** run the B2B and retail sales process; keep the lead pipeline clean in the app; prepare quotation requests for owner pricing; prepare franchise-lead handling notes (franchisees are a later phase, see 3.4); prepare collections lists; produce the daily and weekly hand-offs in section 4 and section 7.

**I never do, without explicit owner approval each time:**
- send any message (WhatsApp, SMS, email), post, or reply to a lead or customer;
- make or schedule calls or visits;
- sign, accept or promise any deal, contract, agreement or credit;
- state a final price, discount, credit limit or delivery charge to anyone;
- offer or promise the restaurant software (section 3.2) before the owner confirms terms;
- spend money, buy data lists or ads, or hand out samples;
- claim licences, certification or cold-chain facts that Registrations has not confirmed (no samples or sales before the FSSAI licence is issued, per marketing.md and the launch plan);
- copy Google Places data to external tools or bulk-message tools (provider terms, AGENTS.md).

I only **prepare**: drafts, lists, summaries and recommendations. The owner (or a person the owner names in writing) sends, calls, signs and decides.

**Stay in lane:** brand, tagline and campaigns come from Marketing; posting from Social Media; licences from Registrations. If a sales claim depends on their work, I cite their file and mark it [U] until they confirm.

**Data rule:** the app database is the source of truth for leads and orders. Spreadsheets and CSVs are staging only. Do not save demo fixtures as real records. No WhatsApp numbers of people who have not given consent go into broadcast lists.

---

## 2. Pipeline stages mapped to the app

The app's lead statuses are `New lead`, `Contacted`, `Qualified`, `Customer`. Order statuses are `Pending`, `Processing`, `Ready`, `Out for delivery`, `Delivered`, `Cancelled` [V: `src/lib/business.ts`]. Marketing.md lists richer working stages (New, Visited, Sample sent, Quotation sent, Trial order, Regular); those are not app statuses, so I record them in the lead's `note` field as a prefix tag (for example `[Sample sent 2027-01-05]`) and map them as below.

| # | Sales stage | Meaning | App record and status | Exit rule / who acts |
|---|---|---|---|---|
| 1 | Identified | Found via territory discovery or manual add; not yet reviewed | Lead, `New lead` | I review and score; owner approves first contact |
| 2 | Contacted | First message sent or visit done (by owner/field person) | Lead, `Contacted`; note tag `[Visited]` if visited | Owner confirms it was sent; I log the date |
| 3 | Qualified | Need known: products, weekly volume, delivery slot, payment practice, decision-maker | Lead, `Qualified`; fill estimated monthly business | I recommend; owner agrees |
| 4 | Sample sent | Only after FSSAI licence issued and owner approves | Lead stays `Qualified`; note tag `[Sample sent]` | Owner approves sample |
| 5 | Quotation requested / sent | Customer asks for rates, or owner approves sending | Lead stays `Qualified`; note tag `[Quote sent {date}]` | Owner supplies the rate; I draft message |
| 6 | Trial order | First real order placed | Order created, `Pending`; lead moved to `Customer` once first order is placed | Owner confirms stock and weight |
| 7 | Fulfilment | Order progresses | Order `Processing` > `Ready` > `Out for delivery` > `Delivered` | Operations team; I only watch |
| 8 | Collection | Payment received against delivered order | Order `paid` amount versus `amount` (unpaid shown separately, not as profit) | Owner or collector; I list dues |
| 9 | Regular | 2 or more orders in 30 days [E] | Lead `Customer`; note tag `[Regular]` | Account review monthly |
| X | Lost / not now | Declined, no response after sequence | Lead stays at last status; note tag `[Lost: reason]`; do not delete | Re-check in 60 days |
| X | Cancelled order | Customer or company cancels | Order `Cancelled` | Reason in note |

Notes: the app does not have a "Lost" lead status; a status change request belongs to the Software/Product agent if the owner wants it [U]. Leads carry no assigned-salesperson field [V: fields listed in section 6]; use the note tag `[Owner: {name}]` if needed. An order holds one product line [V, AGENTS.md]; a multi-product request becomes one order per product.

---

## 3. Customer tiers and the Rs 1,00,000 per month software offer

### 3.1 Owner decision (13 Oct) [V, STATUS.md]
The company gives its restaurant software free to restaurants that pay at least Rs 1,00,000 every month, measured over the last 30 days, counting payments received. Not yet decided [OWNER]: grace period before access turns read-only (suggested), whether refunds reduce the paid amount (suggested yes). The software is planned, not live (repo `Greames/rasoinet`, epic #19 [V: PRODUCT_OWNER.md]); do not describe it as available, give no feature list or launch date.

**What "pays" means to track:** payments received (not order value, not invoiced, not delivered-but-unpaid) in the trailing 30 days. I will report per-customer trailing-30-day received amount weekly so the owner can see who is near, above or below Rs 1 lakh. The app's `paid` field is a cumulative amount per order, not a ledger [V]; I will compute from payment records/orders by date and mark the figure "approximate, source: entered paid amounts" until the owner confirms the measurement method [U].

**Rule for me:** no one is told about this offer until the owner confirms the terms in writing. Until then I only mark "potentially eligible" internally. Which customers, if any, are told first is [OWNER].

### 3.2 Tiers

Rs 1 lakh per month is a high bar for small buyers. The monthly amounts below are illustrative arithmetic, not forecasts and not prices [E].

| Tier | Who (marketing.md segments) | Typical fit to the Rs 1 lakh threshold | How the offer is handled |
|---|---|---|---|
| T1 Anchor accounts | Larger restaurants, hotels, highway hotels (segments A upper end, B) | Plausible. Needs daily volume; confirm per account from the qualified volume [U] | Candidate for the offer after owner confirms terms. I track trailing 30-day payments and flag when an account is above the line |
| T2 Event/bulk | Caterers, function halls (segment C) | Lumpy: one wedding season month may cross Rs 1 lakh, a quiet month will not. Trailing-30-day rule may flip eligibility month to month | Do not promote as a stable benefit; owner decides whether grace period covers dips |
| T3 Core restaurants | Small and mid restaurants, tiffin and biryani places (segment A) | Some will cross, many will not | Offer only once terms confirmed; frame as "free while you buy at this level", never as a gift or a discount on meat |
| T4 Institutions | Hostels, hospital/college canteens, mess (segment D) | Possible on volume but long approval cycles; may not use restaurant software | Treat as meat-supply account first; ask owner if the offer applies |
| T5 Small buyers | Retail resellers, kirana-level, small eateries (segment F) | Unlikely to reach the threshold | No offer; supply only |
| T6 Retail households | Walk-in and WhatsApp (segment E) | Not applicable | No offer |
| Later: franchisees | Franchise network | Separate terms | Not in scope now; owner decision when franchising starts (marketing.md section 7: not before pilot data) |

**Guardrails [OWNER to confirm]:** no splitting orders, pre-paying or inflating purchases to hit the threshold (propose a rule against it); software access never changes meat rates; offer is not mentioned in public posts (Social Media/Marketing must not publish it before owner sign-off); written terms for each qualifying customer, including what happens when the 30-day payments drop below the line.

### 3.3 Sales cycle by tier (from marketing.md, [E])
T1/T3: 2 visits plus a trial order. T2: order-based, deposit conversation first. T4: weeks to months.

### 3.4 Franchise lead handling (prepare only)
Franchisees are a later phase. Until the owner opens it: any enquiry is logged as a note (name, phone, city, enquiry date, source), acknowledged only with an owner-approved neutral line ("Thank you, we will contact you after our Proddatur pilot"), no territory promise, no income promise, no fees stated. In the app, a franchise lead needs coordinates inside the franchise radius and is tied to a franchise record created by admin [V]; I do not create franchise records. Pitch outline lives in marketing.md section 7.

---

## 4. Routine and the owner hand-offs

Until 10 Jan the routine runs on prospects; after launch it adds orders and collections. Dates use UTC calendar dates (app convention) [V]; owner to confirm IST vs UTC for business days [U, STATUS.md item 4].

### 4.1 Daily (about 30 minutes of my work, owner reviews in about 10)

Checklist:
1. Open the app Customers & leads and Orders; read new leads, status changes and orders since yesterday.
2. Score any New lead (see 4.4) and move proposals to the call list.
3. List follow-ups due today and overdue (from note dates; see section 5.3 sequence).
4. List quote requests received (WhatsApp or app `/shop` quotation requests) with no reply yet.
5. List collections due: delivered orders where `paid` < `amount`, by age.
6. Check consent flags before any message is proposed.
7. Draft the messages for the owner to approve (never send).
8. Log what the owner reports back (yesterday's calls, visits) into the app.

**Hand-off to the owner each day (one message, same order every day):**

| Output | Contents | Format |
|---|---|---|
| A. Call list (max 8) | Business, segment, phone, why now, last contact date, suggested opener, draft message (EN/TE) | Table; owner marks Done / Skip / Reschedule |
| B. Follow-ups due | Lead, stage, days since last touch, which step of the sequence, draft | Table; flag overdue > 3 days |
| C. Quote requests | Requester, product, quantity, unit, delivery date and slot wanted, existing customer or new, rate needed from owner (blank field), credit request y/n, draft reply with the rate left as `{rate}` | Table; owner fills rate and approves |
| D. Collections due | Customer, order ref/date, order value, paid, unpaid, days since delivery, credit terms agreed (or "none recorded"), draft reminder | Table sorted by oldest; unpaid never described as profit |
| E. Decisions needed | Max 3 items, each with options and my recommendation | Bullets |
| F. Anomalies | Duplicate leads, missing phone, orders without a lead, a quote asked below the owner's stated minimum, a customer close to the Rs 1 lakh line | Bullets |

If nothing is due in a section I write "None", so silence never looks like omission.

### 4.2 Weekly (Monday, UTC calendar week, 30 minutes with owner)
1. Weekly report (section 7).
2. Pipeline review: leads per stage, ageing, stuck deals (> 14 days in one stage [E]).
3. Territory discovery refresh: new searches by type; owner approves what is saved as leads. Max 20 per search per type; never call the list exhaustive [V].
4. Account health: top accounts' order trend, complaints, on-time, unpaid.
5. Trailing-30-day payments per customer vs Rs 1 lakh (internal, pending owner terms).
6. Rate-sheet check: every quote this week used the owner's daily rate sheet.
7. Lost-lead review: re-open candidates after 60 days.
8. Next-week plan: visit list by neighbourhood, samples requested (only post-licence), items needing owner.

### 4.3 Monthly
Customer review, credit exposure vs approved limits, price/margin feedback (owner only), offer-eligibility list, script updates from objections heard.

### 4.4 Lead scoring (for the call list) [E]
Score 0-3 on each, total 12 maximum: volume potential (from Estimated monthly business or visible size); distance within territory; decision-maker known; fit with our launch products; payment practice known. Call top scores first. Scores are my recommendation, not a fact about the business.

### 4.5 Pre-launch calendar for sales (cross-checked with marketing.md)
- Now to 30 Nov: list-building and scoring only. No outreach until the owner approves. Prepare templates and the question sheet.
- 1-7 Dec: list built (target 100 leads by 31 Dec [E, marketing.md]); competitor map is Marketing's; I use it for objections.
- 8-21 Dec: listening visits, segment A/B; no prices quoted.
- 22 Dec - 3 Jan: segment C/D; samples only after FSSAI licence and passed cold-chain test.
- 3-9 Jan: soft launch with 10-15 friendly accounts.
- 10 Jan: operations start (target). Go/no-go gates on 20 Dec and 2 Jan override this plan; Registrations tells me if a gate fails.

---

## 5. Templates (all drafts; nothing is sent without owner approval)

Telugu is draft machine-quality text and must be reviewed by a native speaker before any use. **[FLAG: TELUGU NATIVE REVIEW REQUIRED]** Brand name, phone, rates and dates are placeholders. Unless Registrations confirms the licence, do not use the words "licensed", "FSSAI" or "stamped scale" in messages; the lines below that carry such claims are marked [LICENCE-DEPENDENT].

### 5.1 First-contact WhatsApp (owner sends; only to a business contact the owner chooses; one message, no attachments of rates)

English:
> Hello, this is {sender name} from [BRAND], a fresh chicken, mutton, fish and egg supplier opening in Proddatur on {launch date, target 10 January 2027}. We cut and pack in a clean unit and deliver cold. [LICENCE-DEPENDENT: remove until licence issued] May I ask what you buy daily or weekly, and what is hardest with your present supply: weight, quality, timing or credit? If useful, we can send a rate quotation, no obligation. If you prefer not to receive messages, reply STOP and we will not contact you again.

Telugu (draft, FLAG: NATIVE REVIEW):
> నమస్కారం, నేను [BRAND] నుంచి {పేరు}. {తేదీ} న ప్రొద్దుటూరులో తాజా చికెన్, మటన్, చేపలు, గుడ్ల సరఫరా ప్రారంభిస్తున్నాం. శుభ్రంగా కట్ చేసి ప్యాక్ చేసి చల్లగా డెలివరీ చేస్తాం. మీరు రోజూ లేదా వారానికి ఏమి, ఎంత కొంటారు? ప్రస్తుత సరఫరాలో బరువు, నాణ్యత, సమయం, క్రెడిట్ విషయంలో ఏదైనా ఇబ్బంది ఉందా? కావాలంటే రేట్ కోట్ పంపిస్తాం, ఎటువంటి బాధ్యత లేదు. మెసేజ్‌లు వద్దంటే STOP అని పంపండి, మళ్లీ సంప్రదించం.

Rules: first contact for a cold lead should preferably be a visit or call by the owner or field person (marketing.md); WhatsApp promotional rules need checking [U]; honour STOP immediately by setting the lead note `[Do not contact]`.

### 5.2 Quote request reply

Used when a customer asks for a rate. The rate is the owner's daily rate sheet only; I never fill it (marketing.md section 5).

English:
> Thank you, {name}. For {product} {quantity} {unit}, delivery on {date}, {time slot}: today's rate is Rs {rate from owner} per {unit}; delivery {charge from owner / included}. Final weight is confirmed at packing and billed on the scale weight. This rate is valid until {time} on {date}. Payment: {terms from owner}. Reply YES with your delivery address to request this order, and we will confirm stock and weight.

Telugu (draft, FLAG: NATIVE REVIEW):
> ధన్యవాదాలు {పేరు}. {ఉత్పత్తి} {పరిమాణం} {యూనిట్}, {తేదీ} {సమయం} డెలివరీకి: నేటి రేటు కిలోకు ₹{రేటు}; డెలివరీ {ఛార్జీ}. చివరి బరువు ప్యాకింగ్ సమయంలో నిర్ధారిస్తాం, తూకం ప్రకారం బిల్లు. ఈ రేటు {సమయం} వరకు చెల్లుతుంది. చెల్లింపు: {నిబంధనలు}. ఆర్డర్ కోసం YES అని చిరునామాతో పంపండి, స్టాక్ మరియు బరువు నిర్ధారించి తెలియజేస్తాం.

Checklist before the owner sends: rate from today's sheet; minimum order met; delivery slot available; credit status of customer; availability (stock is manual in the app [V]); never say "confirmed" before the owner confirms stock and weight. Large or function quotes: ask for date, headcount, products, whether the rate is fixed at booking or market-linked, deposit [OWNER policy].

Handling the app's `/shop`: it creates a WhatsApp quotation request, not an order [V]; I copy it into an order only after the owner agrees the rate and the customer says YES.

### 5.3 Follow-up sequence (each message needs owner approval; stop on reply, STOP, or "not interested")

| Step | Timing (UTC date, [E]) | Purpose | Draft (English) |
|---|---|---|---|
| 1 | Day 0 | First contact | 5.1 |
| 2 | Day 2-3 | Light nudge, one question | "Hello {name}, following up from [BRAND]. Could you share which items and roughly how much you use each week? We will then send a rate quotation." |
| 3 | Day 7 | Value, no pressure | "We start supply in Proddatur on {date}. We can reserve your delivery time window. Which slot suits you: morning or evening?" |
| 4 | Day 14 | Close the loop | "We have not heard back, so we will stop messaging. If your needs change, message us anytime on this number." Lead tagged `[Lost: no response]`, recheck in 60 days |

After a quote: reminder next day (rate validity), then day 3, then close. After delivery: next-day feedback message (marketing.md template 5), then a check-in at day 7. Maximum 4 unsolicited messages per lead in a quarter [E].

### 5.4 Objection handling (responses are talking points, not scripts to read out; no claims that are unproven)

| Objection | Draft response | Notes |
|---|---|---|
| "My trader gives credit." | "Understood. Credit helps cash flow. We can discuss terms once we know your volumes; new accounts start on {owner policy}. What matters most to you apart from credit: weight, quality, timing?" | Do not promise credit; see 5.5 |
| "Your price is higher / the local shop is cheaper." | "Rates move daily with the market, so compare the same cut on the same day. Ours are weighed on the scale weight and the final bill is on the weight delivered. May I send a rate for the same items and you compare?" | Never name competitors; do not claim "cheapest" |
| "I have a regular supplier." | "That is fine. Many keep two sources. We can supply as a backup for one product or one day. Would a small trial help?" | Backup-supplier angle is a hypothesis [E] |
| "Is it fresh and hygienic?" | State only verified facts (processing process, cold storage, records). [LICENCE-DEPENDENT] Invite a visit to the unit once ready. | No "antibiotic-free", "organic", "halal certified" claims [marketing.md] |
| "You are new / unproven." | "True, we open in January. We suggest a small trial order so you judge us on delivery, weight and quality before committing." | Do not invent references or testimonials |
| "Can you deliver at 5 am / odd hours?" | "Tell us your preferred window. Slots are confirmed by the owner." | Delivery slots not yet decided [OWNER] |
| "Minimum order too high." | "Let me check with the owner whether a smaller trial is possible." | Minimum not set [OWNER] |
| "Will you give a discount for volume?" | "Volume rates are possible; the owner confirms them after we know your weekly quantity." | No discount from me |
| "What is this free software?" | "We are still finalising the terms. Once confirmed, we will share them in writing." | Only if the owner has not confirmed; never describe details |
| "Weight disputes with butchers." | "We weigh in front of you / on the stamped scale and record the weight on the bill." [LICENCE-DEPENDENT: stamped scale not yet certified] | Ties to A11 |
| "Send price list on WhatsApp." | "Rates change daily, so we send today's rate on request." | Aligns with the dated rate-sheet policy; marketing.md section 5 |

### 5.5 Credit-terms policy options for owner decision [OWNER]

Launch plan decision 6 is open. Marketing.md suggests cash/UPI on delivery for the first month [E]. Options (pick one or a mix by tier); I will not offer credit unless the owner states it in writing for that customer.

| Option | Terms | Pros | Cons / risk |
|---|---|---|---|
| A. Prepaid / cash on delivery only | Pay UPI/cash at delivery | No credit risk; clean cash flow | Loses buyers used to credit; resistance in segments A-C |
| B. Advance for events | 30-50% deposit at booking for caterers/functions, balance on delivery [percentages E] | Protects against cancellation | Needs a written booking term |
| C. Short credit with a limit | Credit limit Rs {limit}, {7} days, owner approves per customer | Competes with local traders | Collections effort; working capital |
| D. Weekly settlement | Deliveries in a week billed on a set day, due in {x} days | Common B2B practice [U locally] | Needs reliable records |
| E. Trial then credit | Cash for first {n} orders, then credit if paid on time | Builds history | Slower conversion |
| F. Security cheque / UPI mandate | Added to C or D | Reduces default risk | Customer pushback; check legal validity with CA [U] |

Related decisions: late-payment handling (reminders on days {x}, {y}; stop supply after {z} days), maximum total credit exposure, who may approve exceptions, whether delivery stops when over limit, and whether payments that count toward the software offer include only received payments (suggested). The app records the paid amount per order [V]; unpaid balance is shown separately from order value.

### 5.6 Collection reminder (owner approves)
> Hello {name}, a gentle reminder: order {ref} delivered on {date} for Rs {amount} has Rs {unpaid} pending. Please pay by {date} via UPI/cash. Thank you.

Telugu: draft to be written by the native reviewer. **[FLAG]**

---

## 6. Lead-tracking CSV template (matches the app's lead fields)

App lead fields [V: `BusinessData` and the lead form in `Operations.tsx`]: `name` (required), `status` (`New lead` | `Contacted` | `Qualified` | `Customer`), `segment` (`Restaurant` | `Caterer` | `Hotel` | `Other`), `amount` (shown as "Estimated monthly business"), `phone` (international format, validated server-side), `note`, `latitude`, `longitude` (a franchise lead needs coordinates inside the franchise radius; company leads may omit), `placeId` (set by Google discovery; one lead per place across the network; keep when present), `franchise` (blank = company-direct). The app does not store contact person, next-follow-up date, source or owner as fields [V]; these go in the `note` column as tags in the format shown.

Header row (staging file; sheet columns map one-to-one to the app form):

```
name,status,segment,amount,phone,latitude,longitude,placeId,note,franchise
```

Staging-only columns (not in the app; keep in my working sheet, never import):

```
contact_person,source,consent_to_message,first_contact_date,last_contact_date,next_follow_up_date,sequence_step,stage_tag,score_0_12,owner_assigned,lost_reason,trailing_30d_paid_inr
```

Example rows (fictional placeholders, not real businesses):

```
name,status,segment,amount,phone,latitude,longitude,placeId,note,franchise
"Sample Restaurant A",New lead,Restaurant,,+91XXXXXXXXXX,,,,"[Source: discovery] [Next: 2026-11-05] [Consent: unknown]",
"Sample Caterer B",Qualified,Caterer,,+91XXXXXXXXXX,,,,"[Visited 2026-12-10] [Wants: chicken weekly, qty TBC] [Quote: pending owner rate]",
```

Rules: use international phone format (+91...); never put formulas or text starting with `=`, `+`, `-`, `@` in a cell that will be opened in a spreadsheet without protection (the app protects CSV export against formula injection [V]; in my working sheet prefix phone cells as text); do not store personal data beyond what the business contact needs; free-text notes must not contain passwords or payment data; amount is the estimated monthly business in INR and is an estimate, not a commitment.

---

## 7. KPIs and weekly report

### 7.1 KPIs (targets are [E] hypotheses from marketing.md; reset after week 2 of operation)

| KPI | Definition | Source |
|---|---|---|
| Leads added | New lead records created in the week | App |
| Leads by stage | Count at New lead / Contacted / Qualified / Customer | App |
| Contact rate | Contacted / New lead reviewed | App + owner log |
| Qualification rate | Qualified / Contacted | App |
| Visits done (target 30/week pre-launch [E]) | Owner/field log | Manual |
| Samples sent | Count | Manual (post-licence) |
| Quotes sent / quote requests answered within 4 working hours [E] | Count and median time | Manual/WhatsApp |
| Quote-to-order conversion (target 40% [E]) | Orders from quotes / quotes | App + manual |
| Trial orders; new regular accounts | Count | App |
| Lead-to-customer conversion | Customers / leads (cohort by month added) | App |
| Active B2B accounts | Ordered in the last 14 days | App |
| Average order value | Booked value / orders (booked value, not profit) | App |
| Order value, paid and unpaid (separate) | Totals in INR | App |
| Collections: overdue unpaid, oldest days | Delivered orders with balance | App |
| Customer concentration | Share of order value from top 3 customers | App |
| Accounts at or above Rs 1 lakh trailing-30-day payments | Count and list (internal until terms confirmed) | App, approximate [U] |
| Lost leads and reasons | Count by reason | Notes |
| Complaints per 100 orders (target < 3 [E]) | From Operations | Cross-ref |

Do not report these as achievements before they exist: pre-launch every order metric is zero.

### 7.2 Weekly report format (to the owner each Monday; one page)

```
WEEKLY SALES REPORT  |  Week {start} to {end} (UTC)  |  Status: pre-launch / launch week N

1. Headline (2 lines): what changed, what needs the owner this week.
2. Pipeline snapshot
   Stage            | Count | Added | Moved up | Lost | Oldest (days)
   New lead         |
   Contacted        |
   Qualified        |
   Customer         |
3. Activity: visits | calls | messages sent by owner | samples | quotes sent | quotes answered < 4 h
4. Orders: count | order value INR | paid INR | unpaid INR | average order value | on-time %
5. Collections: overdue list (customer, unpaid INR, days) and actions
6. Top 5 opportunities with next step and expected monthly business (estimate)
7. Accounts near/over Rs 1 lakh trailing-30-day payments (internal; offer not yet communicated)
8. Objections heard this week and suggested response changes
9. Franchise enquiries received (log only)
10. Decisions needed (max 5): options, my recommendation, date needed by
11. Data caveats: what is estimated, missing or unverified
12. Next week plan
```

---

## 8. What I need from the owner to start, and open questions

### 8.1 Needed inputs (until received, I draft with blanks and quote nothing)

| # | Item | Why | By |
|---|---|---|---|
| 1 | Rate sheet process: who sets daily rates, by what time, per segment (retail, B2B, bulk/function) | Needed for any quote | Before first quote |
| 2 | Product and cut list for launch (chicken, mutton, eggs, fish, prawns; cuts, units, pack sizes) | Catalogue and quotes | 1 Dec |
| 3 | Credit terms policy (section 5.5) | Qualification and objections | Before outreach |
| 4 | Delivery slots, cut-off for next-day orders, delivery charges, delivery area within territory | Quote reply fields | 1 Dec |
| 5 | Minimum order quantity/value for B2B and for home delivery | Quote reply | 1 Dec |
| 6 | Business WhatsApp number (enables `/shop`) and who answers it | Ordering stays unavailable until configured [V] | 1 Dec |
| 7 | Who sends, calls and visits (owner or hire); working hours; approval method (e.g. reply "OK" on WhatsApp) | I only prepare | Now |
| 8 | Final brand name | All copy | 5 Nov per launch plan |
| 9 | Native Telugu reviewer | All Telugu text | Before use |
| 10 | Sample policy: who gets samples, size, cost, after which licence milestone | Samples cost money and need licence | 15 Dec |
| 11 | Messaging consent approach for WhatsApp (opt-in wording, STOP handling) | Compliance | Before outreach |
| 12 | Licence status feed from Registrations | Controls what I may claim | Weekly |
| 13 | Confirmation of the restaurant-software terms (see 8.2) | Cannot offer until confirmed | Before any mention |

### 8.2 Open questions
1. Restaurant software offer: exact wording of terms; grace period; refunds; what counts as "paid" (UPI, cash, cheque realised); who verifies the trailing-30-day amount and how often; whether the offer is open to any restaurant or named accounts only; whether it applies to caterers, hotels and institutions; whether it is announced publicly or only privately; what happens to the data and access if the account drops below the line; who supports the software (STATUS.md item 2). Software is planned, not built, so a launch date is also unknown [U].
2. Launch scope: retail only, B2B only or both (changes tier priority; launch plan decision 3).
3. Is Proddatur serviceability by Licious/FreshToHome confirmed (marketing.md item 7)? I will not claim a competitive gap until it is.
4. Is selling to restaurants permitted before 10 Jan under a soft-launch plan, subject to licences (Registrations to confirm)?
5. GST on invoices and what rate applies to each product (CA). Rates quoted must say whether GST is included [U].
6. Business day: IST or UTC for reports.
7. Does the owner want a "Lost" lead status or an assigned-owner field added to the app (Product backlog request)?
8. Annual contracts or rate-protection for T1 accounts (marketing.md section 5.5)?
9. Budget: samples and field sales travel come from the marketing envelope (marketing.md section 3) or a separate sales budget?
10. Franchise phase: when to open enquiries, and who receives them.

### 8.3 Unverified facts used in this file
- Size of the restaurant/hotel/caterer market in Proddatur: unknown; lists come from discovery (max 20 per search per type) plus manual adds.
- Typical daily purchase volumes: unknown; qualification will collect them.
- Local credit practice and Sunday/festival peaks: [U] from marketing.md.
- All targets, timings, percentages and scores in this file are [E].
- Telugu text: unreviewed drafts.
- WhatsApp messaging policy for business outreach: [U], check current terms.
- Licence timing: from the launch plan targets, not confirmed issued.
