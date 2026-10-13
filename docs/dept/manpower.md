# DawnFresh Manpower, HR and Training Plan (Proddatur pilot)

Prepared 2026-10-13 by the Manpower & HR/Training department agent. Launch target 10 Jan 2027. Scope: Workstream D of `docs/LAUNCH_PLAN_PRODDATUR.md`.

Ground rules: no named people appear here; every role is an unfilled vacancy or "Owner (to confirm)". Salary figures are **estimates**, not offers. Regulatory points are a checklist to confirm with the CA, FSSAI portal and Proddatur Municipality, not legal advice.

---

## 1. Org chart, roles, headcount, pay

### 1.1 Pilot org chart (company-owned unit plus one retail outlet)

```
Owner (admin account)
 |-- Accounts: external part-time CA (not an employee, no software login by default)
 |-- Operations / Unit Manager (1)  [also FSSAI food-safety supervisor, see 3.1]
 |     |-- Skilled Butcher / Processor (3)
 |     |-- Helper / Packer / Cleaner (2)
 |     |-- Retail Counter + POS Operator (2)
 |     |-- Delivery Driver (2)
 |-- Sales / Franchise Development (Owner at first; hire later)
```

Pilot headcount: 1 + 3 + 2 + 2 + 2 = **10 employees**, plus the owner and external CA. Launch-plan ranges are 2-3 butchers, 1-2 counter, 1-2 drivers; this plan takes 3 / 2 / 2 as the safe case so leave, a medical failure or no-shows do not stop the line. Owner may cut to 2 / 1 / 1 (8 employees) for the soft launch. That is a budget decision, see open questions.

### 1.2 Roles

| Role | Pilot count | Responsibilities | Required skills | Software account |
|---|---|---|---|---|
| Operations / Unit Manager | 1 | Runs the unit daily: receiving sign-off, QC pass/fail decisions, cold-chain checks, staff rota, cleaning audits, daily close review, vendor issues. Acts as FSSAI food-safety supervisor and keeps training and medical records. | 3+ years in meat, poultry or cold-chain operations; supervision of 8-10 staff; basic spreadsheet/phone-app skills; Telugu plus working Hindi or English | `staff`, broad edit (see section 5) |
| Skilled Butcher / Processor | 3 | Cut, debone, portion and clean chicken, mutton and fish to spec; record input, output and waste per batch; follow knife, PPE and hygiene SOPs. | Proven cutting speed and yield; knowledge of chicken, goat/sheep and fish cuts; hygiene discipline; basic weighing; Telugu | `staff`, processing edit only (shared tablet is acceptable, see 5.3) |
| Helper / Packer / Cleaner | 2 | Wash, pack, label, vacuum-seal, load ice, clean zones and equipment per cleaning schedule, waste handling. | Physical fitness; willingness to work in cold rooms; follows written cleaning checklist | Optional: `staff`, processing view or none; cleaning is on paper |
| Retail Counter + POS Operator | 2 | Serve walk-in customers, weigh and bill on POS, take payments, hold shift, count cash, reconcile at day end, handle WhatsApp quotation follow-ups. | Honest cash handling, numeracy, basic smartphone/PC use, courteous Telugu; weighing-scale use | `staff`, outlets/POS edit |
| Delivery Driver | 2 | Load by route, deliver in insulated or refrigerated vehicle, capture proof of delivery, collect payment where permitted, return unsold or rejected stock. | Valid driving licence for the vehicle class, local road knowledge, smartphone use, cold-chain awareness | `staff`, orders edit only (no separate driver role exists in the software) |
| Sales / Franchise Development | 1 (Owner at first) | B2B prospecting from Territory explorer, quotations, credit terms, later franchise recruitment. | Local hotel/restaurant/caterer network; negotiation | Owner uses `admin`; a later hire gets `staff` with leads and orders edit, franchises view |
| Accounts (external CA) | external | GST, books, payroll compliance (PT, ESI/EPF when thresholds apply), invoice review. | CA firm | No login unless owner wants read-only exports |

### 1.3 Later: three franchises

Each franchise has one franchisee login (`franchisee` role, bound to that franchise) and works inside its allocated radius. Franchise staff are employed by the franchisee, not DawnFresh; DawnFresh supplies training, SOPs and the software.

| Per franchise (indicative) | Count | Notes |
|---|---|---|
| Franchisee / owner-operator | 1 | The `franchisee` login. Must complete FSSAI food-safety training for supervisors. |
| Butcher / processor | 1-2 | Same skill test as 2.4 |
| Counter / POS | 1 | Same POS SOP |
| Delivery rider/driver | 1 | Only if franchise does local delivery |

For 3 franchises: about 3 franchisees plus 9-12 franchise staff, all employed by franchise owners. HQ additions to consider once franchise 1 is live: one Franchise Support / Quality Auditor (company staff, `staff` role with franchises view, supply edit), and a second shift supervisor at the unit. Do not hire these before pilot numbers exist (matches Risks table: pilot first).

### 1.4 Indicative monthly pay (estimates, Proddatur / AP)

Proddatur is a smaller town in YSR Kadapa. No Proddatur-specific data was found for any role, so ranges below are my judgement anchored to the cited points; they are all **ESTIMATES, treat as UNVERIFIED for Proddatur** until checked against two or three local quotes (local job agents, existing meat shops, staffing contacts).

| Role | Estimated range (INR / month, gross) | Evidence found | Status |
|---|---|---|---|
| Operations / Unit Manager | 25,000 - 40,000 | No source found | UNVERIFIED |
| Skilled butcher / processor | 15,000 - 25,000 (plus yield or attendance incentive) | National average about 21,621 from only 6 reports ([Indeed butcher India](https://in.indeed.com/career/butcher/salaries)); meat cutter in Guntur AP about 15,046 (Indeed city page, URL not verified; see [Indeed meat cutter listing](https://in.indeed.com/career/meat-cutter/salaries/Pune--Maharashtra) for the series); ERI model estimates roughly 35,000-41,000 a month nationally ([ERI butcher](https://www.erieri.com/salary/job/butcher/india), [ERI meat cutter](https://www.erieri.com/salary/job/meat-cutter/india)) which is likely high for a small town | Estimate; evidence thin |
| Helper / packer / cleaner | 10,000 - 14,000 | Statutory floor reference below | Estimate |
| Retail counter + POS operator | 12,000 - 18,000 | No direct source found | UNVERIFIED |
| Delivery driver | 14,000 - 22,000 (plus fuel allowance if own vehicle used) | One Kadapa posting up to 15,000; AP statewide average about 34,444 from 39 reports, with city values from about 13,000 to 41,600 ([Indeed AP delivery driver](https://in.indeed.com/career/delivery-driver/salaries/Andhra-Pradesh)) | Estimate; wide spread |
| Sales / franchise development (later hire) | 20,000 - 35,000 plus commission | No source found | UNVERIFIED |
| Part-time CA support | By quote | None | UNVERIFIED |

Statutory floor: AP Shops and Commercial Establishments minimum wage rates revised from 1 Apr 2026 are roughly 12,300-14,500 a month across grades (about 12,647 unskilled Zone I, about 13,467 skilled, about 14,504 manager tier), with a variable dearness allowance of 8,947 included ([factoHR summary](https://factohr.com/minimum-wages-in-india/andhra-pradesh/), [SGCMS notice](https://www.sgcms.com/regulatory-updates/3139-2/)). Aggregator sites disagree on Zone II values and on grading, and a meat-processing unit may fall under a different scheduled-employment notification. Confirm the applicable notification and zone for Proddatur with the CA. No pay offer should go below the confirmed minimum.

Budget view (pilot, all 10 employees, monthly gross at estimate range): low about 1.52 lakh, high about 2.36 lakh, before employer PF/ESI (CA to confirm thresholds, launch plan A12) and the owner's decision on uniforms, food and incentives. Arithmetic: manager 25-40k, 3 butchers 45-75k, 2 helpers 20-28k, 2 counter 24-36k, 2 drivers 28-44k.

---

## 2. Hiring plan

### 2.1 Timeline (aligned to Workstream D; today is 13 Oct)

| Date | Milestone | Owner |
|---|---|---|
| 13-24 Oct | Owner confirms headcount (8 vs 10), pay bands, probation terms; finalise job descriptions from 1.2; confirm applicable minimum wage with CA | Owner, CA |
| 25 Oct | Entity decision (A1) fixed, so offer letters can name the employer | Owner |
| 26 Oct - 14 Nov | Manager search: post and refer; shortlist | Owner |
| 15 Nov | CA support engaged (matches plan) | Owner |
| 15 Nov - 25 Nov | Manager interviews, references, offer | Owner |
| By 1 Dec | **Manager hired** and joined (needed to run later hiring and SOP finalisation); sales/franchise lead role stays with owner | Owner |
| 1-5 Dec | Butcher and counter/driver job posts live (earlier posting for butchers because trade tests take time) | Manager + Owner |
| 6-9 Dec | Butcher trade tests (2.4) and interviews | Manager + Owner |
| By 10 Dec | **Butchers hired (3)**, offers accepted; start medical exams | Owner |
| 8-13 Dec | Counter, helper, driver interviews and checks | Manager |
| By 15 Dec | **Helpers, counter/POS, drivers hired**; all offers signed; joining date 18-20 Dec at the latest | Owner |
| 16-19 Dec | Medical fitness certificates collected (2.5), ID and driving licence copies verified, uniforms sized, software accounts requested | Manager |
| 20 Dec | Go/no-go check #1: roster complete; training starts (section 6) | Owner |
| Reserve | Keep 1 butcher and 1 helper alternates on a shortlist until 2 Jan | Manager |

Slip rule: if the manager is not hired by 1 Dec, the owner runs butcher interviews personally and the manager joins by 15 Dec at the latest; do not push the dry run (21 Dec) back for a missing helper, but do for missing butchers.

### 2.2 Sourcing channels

- Referrals from the owner's own network and from existing meat/poultry traders in Proddatur and Kadapa (best for butchers; ask vendors from Workstream C for referrals only with their consent).
- Local retail and poultry shop staff looking to move up; wholesale chicken/mutton markets.
- Walk-in notice at the premises during fit-out, and printed posters in market areas.
- WhatsApp groups and local-language Facebook community pages for Proddatur/Kadapa jobs.
- Job portals with local filters (Indeed, Apna, WorkIndia, Naukri for the manager); budget for portal posting is unverified, check current plans.
- State skill programmes and ITIs/polytechnics in Kadapa district for helpers and drivers (existence and current schemes UNVERIFIED; ask the District Skill Development office).
- Manpower agencies for drivers and counter staff, accepted only with a written replacement guarantee.
- Delivery drivers: ask existing local logistics operators; check licence validity with the transport authority records the driver can show.

Screening for everyone: Aadhaar or other ID, address proof, two references, previous-employer call, police verification where the owner wants it (process UNVERIFIED locally), written consent for medical examination, signed hygiene undertaking.

### 2.3 Interview structure (all roles)

1. 15-minute phone screen: availability by 15-20 Dec, salary expectation, shift tolerance, cold-room work, health declaration (no current infections).
2. 30-minute interview by the manager (or owner for the manager): scenario questions, references.
3. Role test (below). Score sheet kept in the HR file, not in the app.
4. Offer with 3-month probation and training-completion condition.

### 2.4 Butcher interview and skill test

Held at a clean, licensed or friendly premises or at the fitted unit once ready; the owner or manager scores. Bring own knife or use provided; PPE provided.

| Component | Weight | What is tested | Pass mark |
|---|---|---|---|
| Hygiene and safety observation | 20% | Hand-wash before starting, clean apron/gloves/cap, no jewellery, covers cuts, knife handling, board colour discipline, no phone at the table | No critical fault (a critical fault is skipping hand-wash, wiping hands on apron, or unsafe knife handling) |
| Chicken: dress and cut | 25% | 3 whole broilers (or provided carcasses) to curry cuts; time and visual quality | Average time within the owner's benchmark set after watching one reference butcher; no damage to skin or meat |
| Mutton: portion and debone | 25% | 2 kg bone-in to 1 kg curry cut and 1 kg boneless portions; uniform pieces | Yield measured against a reference and consistent piece size |
| Yield and waste | 15% | Weigh input, output and waste; compute yield percent | Waste within an owner-agreed tolerance (set tolerance after a benchmark butcher cuts the same carcass; no external figure used here) |
| Fish handling (if fish is in launch scope) | 10% | Scaling, gutting, cleaning, ice discipline | Clean cut, correct ice use |
| Attitude and reliability | 5% | Punctuality, references, willingness for early shifts | Satisfactory |

Pass: at least 70% overall and no critical hygiene fault. Rank the passers; hire the top 3 and hold the next 1-2 as alternates. Two scorers where possible, to reduce bias. Record the scores in a paper file, kept for the FSSAI training-record folder. Note the benchmarks are owner-defined; any "typical yield" numbers should come from the Pricing & yield screen once real data exist.

### 2.5 Medical fitness (pre-joining)

Every food handler needs a medical fitness certificate on the FSSAI format before handling food. The FSSAI sample certificate cites Para 10.1.2 of Part II of Schedule 4 and covers physical examination, eye test, skin examination, and enteric-group vaccination compliance, plus any tests indicated for communicable disease ([FSSAI hygiene portal sample form](https://hygiene.fssai.gov.in/files/reports/quiz14180812_adobe%20scan%20jul%2026,%202024.pdf)). Third-party sources describe it as an annual requirement (validity period should be **confirmed against the regulation text**, UNVERIFIED here). Use a registered medical practitioner; clinic fee per person UNVERIFIED, budget a small amount and ask local clinics. Drivers who do not touch open food still receive the certificate if they handle packed product, as a conservative policy (owner decision).

---

## 3. Onboarding and FSSAI-aligned hygiene/medical training

### 3.1 What FSSAI expects (to confirm with CA and FoSCoS)

- Medical fitness certificate for each food handler, annual (confirm), with records kept at the premises (see 2.5).
- Retail meat shops are within Schedule 4 sanitary requirements, which also cover the health status of food handlers and training ([FSSAI Direction, 28 Nov 2022](https://www.fssai.gov.in/upload/advisories/2022/12/638edf17bdbb2Direction_Licensing_28_11_2022_.pdf), cited as referencing the retail meat shop sections).
- FoSTaC (Food Safety Training and Certification) Basic course is listed by FSSAI as applicable to petty retail outlets and meat shops, and supervisors are expected to give periodic on-site training to food handlers, at least quarterly, with records ([FoSTaC Basic](https://fostac.fssai.gov.in/fostacV2/basic.jsp)). A secondary source says state and central licence holders must have at least one FoSTaC-trained supervisor on site ([PetPooja checklist](https://blog.petpooja.com/templates-checklist/fssai-compliance-checklist/)); I could not verify that against a notification, so the CA must confirm whether it is a licence condition for the licence category DawnFresh will hold.

Plan consequence: enrol the Operations Manager (and the owner) in a FoSTaC course (Advanced Retail/Distribution or the level the licence category needs) in November, before the manager's start date if possible, otherwise on joining. Book via a FoSTaC training partner (availability and fee in Andhra UNVERIFIED; check the FoSTaC portal). Other staff receive the in-house training below and, where the licence category requires, a FoSTaC Basic seat.

### 3.2 Onboarding steps for every joiner

| Step | When | Evidence kept |
|---|---|---|
| ID, address, bank details, offer letter and policy acknowledgement | Joining day | HR file |
| Medical fitness certificate on FSSAI format | Before first handling of food | Certificate copy, expiry date tracked on a wall chart |
| Hygiene undertaking (illness reporting, no work with diarrhoea, vomiting, fever, infected wounds) | Day 1 | Signed |
| Uniform, apron, cap, gloves, boots issued | Day 1 | Issue register |
| Premises tour: raw/clean zones, hand-wash, cold room, waste route, fire exit | Day 1 | Attendance sheet |
| Role training modules (3.3) | 20-31 Dec | Training register with trainer sign-off |
| Software account and permissions set by the admin | Before module on the screen | Users & access page records the account |
| Buddy shadowing in the dry run | 21-31 Dec | Manager checklist |
| 30/60/90-day review and refresher | After launch | HR file |

### 3.3 Training modules

| # | Module | Audience | Duration | Trainer |
|---|---|---|---|---|
| T1 | Personal hygiene and hand-washing (demonstrate, then each person demonstrates) | All | 2 h | Manager (FoSTaC-trained) |
| T2 | Medical fitness, illness reporting, wound dressing, fitness-to-work rules | All | 1 h | Manager |
| T3 | Cross-contamination, raw/ready-to-eat separation, colour-coded boards and knives | Butchers, helpers, counter | 2 h | Manager |
| T4 | Cold chain: storage temperatures set by the owner and CA from FSSAI guidance, FIFO, thaw rules, logging | All | 2 h | Manager |
| T5 | Cleaning and sanitising: chemicals, dilution, schedule, verification | Helpers, butchers, counter | 2 h | Manager |
| T6 | Receiving and GRN (section 4.1) | Manager, helpers, butchers | 2 h | Manager + Owner |
| T7 | Processing, QC and yield recording | Butchers, manager | 3 h | Manager |
| T8 | POS counter and cash | Counter, manager | 3 h | Manager, with the POS screen on dummy data |
| T9 | Delivery, proof of delivery and vehicle hygiene | Drivers, manager | 2 h | Manager |
| T10 | Daily close and exceptions | Manager, counter | 1.5 h | Owner |
| T11 | Customer handling, complaints and returns script (E8) | Counter, drivers | 1 h | Owner |
| T12 | Fire, first aid, power-cut and generator drill | All | 1 h | Manager |
| T13 | FoSTaC (external) | Manager, owner | Per course | Training partner |
| T14 | Assessment: written/oral quiz (pass 80%) plus practical demonstration | All | 1 h | Manager |

Temperature limits and shelf-life numbers in SOPs are left as `[owner/CA to set from FSSAI guidance]` placeholders: I did not find a verified figure to cite, so none are invented here.

---

## 4. SOP outlines mapped to the software

Software facts used (from code): roles are `admin`, `staff`, `franchisee`; module permissions are `none/view/edit` over nine modules (`orders, leads, supply, inventory, sourcing, outlets, pos, processing, franchises`). Server-side gating observed: procurement uses `sourcing` (receiving, purchase orders) and `supply`; the fulfilment functions (production, batches, packages, routes, loads, settlements) use `processing` and `orders`; the POS function checks `outlets`; deliveries, invoices and payments records follow `orders`; settlements and stock-movement audit follow `supply`. Screen names come from the navigation in `src/components/Operations.tsx`.

Important gap: there is **no dedicated temperature-log screen** and no driver role. Temperature is a field on stock records (Inventory form); a paper/phone-photo log is the primary cold-chain record until engineering adds a log. Daily close in the app today is POS shift reconciliation; the launch plan lists a wider daily close as F4 (due 5 Dec), so this SOP needs a re-check once F4 ships.

### 4.1 Receiving and GRN

- Screen: **Sourcing** (purchase orders and goods receipt), then **Inventory** (incoming stock lot with batch, expiry, temperature).
- Role: Manager (approves), helper or butcher (weigh and count). Needs `sourcing` edit and `inventory` edit.
- Outline: 1) Check vendor vehicle cleanliness and the vet/health document; 2) check the order against the purchase order; 3) take product temperature and visual/smell check; 4) weigh against the invoice; 5) accept, partly accept or reject, with reasons written; 6) enter goods receipt in the app; 7) create the incoming stock lot with batch and expiry; 8) label and move to the correct cold zone within the owner-set time. Reject and photograph anything out of tolerance; record in the vendor file for Workstream C scoring.
- Records: paper receiving sheet plus GRN in app.

### 4.2 Processing and QC

- Screens: **Processing & QC** and **Fulfilment control** (production, batches, QC; finished-stock lots created from passed batches).
- Roles: Butcher (record input, output, waste); Manager (QC pass/fail/hold). Needs `processing` edit; Manager alone also holds QC authority by procedure (software does not separate "QC approver" from "processor", see matrix note).
- Outline: 1) pull the raw lot (FIFO); 2) wash hands, set up colour-coded boards; 3) start the batch; 4) record input; 5) process; 6) weigh output and waste; 7) QC check (appearance, odour, temperature, weight); 8) pass, fail or hold; failed or held batches are not released to dispatch; 9) label with batch and packed date; 10) move to the finished-stock zone. The app computes yield; the manager reviews daily outliers.

### 4.3 Cold-chain temperature logging

- Screen: **Inventory** (temperature field per lot) plus paper/phone log.
- Roles: Helper or counter takes readings; Manager verifies and signs. Needs `inventory` edit for the lot-level readings.
- Outline: log cold room, chiller and freezer temperatures at set times (for example opening, mid-day, closing; frequency set by owner/CA); record vehicle temperature on loading and at each delivery handover; define the corrective action (move stock, call equipment vendor, switch to generator, quarantine and decide); a power-cut drill (T12). Calibrate thermometers and keep the certificate.

### 4.4 Cleaning

- Screen: none (paper schedule). Manager reviews weekly; breaches go into the training register.
- Roles: Helper (does), Manager (verifies daily), Owner (monthly walk).
- Outline: pre-op clean and sanitise, during-shift spot cleaning, end-of-day deep clean, weekly deep clean for the cold room and drains, monthly pest-control and drain check, waste out to the arranged disposal (B8). Colour-coded cloths and chemicals, dilution chart on the wall, sign-off sheet with times.

### 4.5 POS counter

- Screen: **POS / Outlet sales** (outlets, shifts, sales, payments, ledger, reconciliations).
- Role: Counter/POS operator; Manager supervises voids and discounts. Server checks `outlets` edit, so the POS operator needs `outlets` edit (and the `pos` module set to edit to see the screen and match the UI).
- Outline: open shift with opening cash; verify the weighing scale (Legal Metrology stamp, A11); bill item by item; take payment (cash/UPI/other as configured); print or send the bill; hand over with label and date; handle returns by manager approval; fridge-stock checks against the outlet ledger. Sales deduct outlet stock in the app.

### 4.6 Delivery and proof of delivery

- Screens: **Deliveries** and **Fulfilment control** (routes, stops, loads, packages), **Payments & collections** if the driver collects cash.
- Roles: Manager plans routes and loads; Driver delivers. Driver has `orders` edit (the app has no narrower option; see the risk below).
- Outline: pre-trip vehicle clean and temperature check; scan or tick loading against route; confirm quantities with the customer; update the stop to Delivered (or Failed, Rescheduled) in the app; capture the proof the app supports (OTP, signature or photo are in the business-flow design and may not all be live, so verify in the dry run); record payment and any quantity discrepancy; return and book unsold stock; never leave product unrefrigerated on a failed stop beyond the owner-set limit.

### 4.7 Daily close

- Screens: **POS / Outlet sales** (shift close, reconciliation), **Orders & sales**, **Invoices**, **Payments & collections**, **Inventory** (stock count vs recorded).
- Roles: Counter operator closes the shift; Manager reconciles; Owner reviews exceptions and the cash deposit.
- Outline: close POS shift; count cash and reconcile to POS and UPI; check open orders, pending deliveries and unpaid invoices; physical stock count vs the app for the high-value items; confirm temperature log complete; resolve and note mismatches (do not edit history silently); lock the cash to the bank deposit routine; clean-down sign-off. Re-do this SOP when F4 daily close ships.

---

## 5. Role-to-permission matrix

### 5.1 Matrix (recommended settings in Users & access)

`E` = edit, `V` = view, `-` = none. Staff default is `edit` on everything except `franchises` (`view`), so every non-owner account **must have the modules below set explicitly**, especially `-` entries; do not leave defaults.

| Role | Account role | orders | leads | supply | inventory | sourcing | outlets | pos | processing | franchises |
|---|---|---|---|---|---|---|---|---|---|---|
| Owner | admin | E | E | E | E | E | E | E | E | E |
| Operations / Unit Manager | staff | E | V | V | E | E | E | E | E | V |
| Butcher / Processor | staff | V | - | - | V | - | - | - | E | - |
| Helper / Packer / Cleaner | staff | - | - | - | V | - | - | - | V | - |
| Counter + POS Operator | staff | V | - | - | V | - | E | E | - | - |
| Delivery Driver | staff | E | - | - | - | - | - | - | V | - |
| Sales / Franchise Dev (later hire) | staff | E | E | V | V | - | - | - | - | V |
| Franchise Support (later) | staff | V | V | E | V | - | V | V | V | V |
| Franchisee | franchisee | E | E | E | E | (none by role) | E | E | E | (none by role) |
| External CA | none by default | optional read-only export | | | | | | | | |

Franchisee notes: the role limits modules to orders, leads, supply, processing, inventory, outlets and pos, and the server binds data to that franchise; settlement and stock-movement audit records are company-controlled for franchisees.

### 5.2 Why these levels

- Butcher: needs `processing` edit to log batches; `inventory` view to see the raw lot; `orders` view so the day's demand is visible. Not `edit` on orders, so a butcher cannot alter prices or payment.
- Counter: server-side POS routes check `outlets` edit, so `outlets` edit is required even though the module screen is labelled POS; `orders` view to see quotations; no sourcing.
- Driver: the deliveries, invoices and payments records sit under `orders`, so a driver must have `orders` edit to update a stop. Same grant also lets the driver edit all orders, invoices and payments, and the fulfilment function ties settlement creation to `orders` edit as well (company staff only). **Risk:** a driver account has more reach than the job needs. Mitigations until a narrower role exists: phone-only login used under the manager's rules, daily audit of changed orders, and a feature request (see open questions).
- Manager: `sourcing` edit and `inventory` edit for GRN; `supply` view only (franchise supply is a later workflow); `franchises` view for visibility.
- Users & access and Settings are admin-only: no non-owner receives them. Keep at least one active admin (the software enforces it) and set a second admin only if the owner chooses a deputy.

### 5.3 Account hygiene

- One named login per person; no shared logins for cash-handling or QC sign-off. A shared kitchen tablet is acceptable only for butchers' batch entry if the manager reviews the entries; otherwise each butcher gets an account (preferred, because yield and QC audit trails depend on identity).
- Invitations and password resets go by email link (Resend, if configured) or admin-set password; staff without email need the admin to set the password in person and tell them to change it. Account lockout after 5 failed attempts means the manager must know whom to call.
- Disable accounts on the leaving day. Disabling deletes the sessions.
- Review permissions monthly during the pilot.

---

## 6. Training calendar, 20-31 Dec 2026

The dry run (21-31 Dec) runs in parallel with training: each module is first taught, then performed on dummy data. 20 Dec is a Sunday; 25 Dec (Friday) is Christmas and 31 Dec is Thursday. Whether to treat 25 Dec as a working day is an owner decision (shown as a light day). Go/no-go #1 is on 20 Dec; Go/no-go #2 is 2 Jan.

| Date | Day | Morning | Afternoon | Evidence |
|---|---|---|---|---|
| 20 Dec | Sun | Onboarding: joining formalities, medical certificates checked, uniforms, premises tour, Go/no-go #1 roster check | T1 hygiene and hand-washing (all) | Attendance, certificates on file |
| 21 Dec | Mon | T2 illness reporting; T3 cross-contamination | T4 cold chain and temperature logging; start cold-room temperature log (begin the 48-hour test for 2 Jan, if equipment is ready) | Register, log started |
| 22 Dec | Tue | T5 cleaning and sanitising; first full clean-down | T6 receiving and GRN with a dummy delivery on dummy data | Cleaning sheet, dummy GRN in app |
| 23 Dec | Wed | T7 processing, QC and yield (butchers and manager) with dummy batches | T8 POS counter training (counter and manager); dummy bills, shift open and close | Dummy batch and QC records, dummy POS shift |
| 24 Dec | Thu | T9 delivery and proof of delivery; vehicle clean and temperature check | Route and load dry run; T11 customer handling | Dummy route, load and delivery records |
| 25 Dec | Fri | Light day or off (owner decision). If working: T12 fire, first aid, power-cut and generator drill | Review and make-up sessions for anyone absent | Drill sheet |
| 26 Dec | Sat | Full dry run cycle 1: receive, process, QC, stock, sell | T10 daily close; practice reconciliation | Dry-run issue list (software and SOP gaps) |
| 27 Dec | Sun | Rest or make-up day; FoSTaC session if a training partner slot is available | Same | Certificate copies if issued |
| 28 Dec | Mon | Dry run cycle 2 with deliberate exceptions (QC fail, wrong quantity, missing package, temperature breach) | Exception handling review with Owner | Exception log |
| 29 Dec | Tue | T14 assessment: written/oral quiz and practical skills for every role | Fix weak areas; re-test failures | Scored assessment sheets |
| 30 Dec | Wed | Dry run cycle 3 end to end, timed; manager runs it with the owner observing | Update SOPs with what broke; finalise accounts and permissions | Final SOP versions, permissions printout |
| 31 Dec | Thu | Final readiness walk: every checklist, medical file, training register, thermometer calibration, scale stamping (A11) | Staff briefing for 3-9 Jan soft launch, rota published | Readiness checklist signed by the Owner |

Pass rule before 2 Jan go/no-go #2: each employee has an attendance sheet entry for every module for their role, a valid medical certificate, and at least 80% on T14 (or a second attempt on 1 Jan). Anyone failing the second attempt does not work on food or cash on 3 Jan.

---

## 7. Open questions for the owner

1. Approve pilot headcount: 10 employees (this plan) or the lean 8.
2. Approve pay bands (section 1.4); no sourced Proddatur data was found for most roles.
3. Which FSSAI licence category will apply (state licence or registration), and does it require a FoSTaC-certified supervisor? Needs the CA.
4. Will the manager be hired by 1 Dec? If not, who runs interviews, and does the owner take the FoSTaC course?
5. Is 25 Dec a working day, and are 20 and 27 Dec (Sundays) working days?
6. Does the owner want driver access narrowed (a new `driver` role or per-screen permission) before launch? Today a driver account needs `orders` edit.
7. Is a temperature-log screen and QC-approver separation worth requesting before the 15 Dec feature freeze (F9)? If not, paper logs are the system of record.
8. Will the owner accept shared tablet logins for butchers, or issue individual accounts?
9. Franchise staff: will DawnFresh pay for franchise training and FoSTaC seats, or will the franchisee?
