# Vendor procurement playbook (Proddatur, target start 10 Jan 2027)

Prepared 2026-10-13 by the Vendor Procurement agent. Builds on `docs/dept/vendors.md` (scorecard, RFQ, onboarding checklist, discovery plan), `docs/dept/vendor-comparison-template.csv` and `db/procurement-schema.ts` (suppliers: name, phone, email, status). Not repeated here; read those first. I never contact anyone, agree terms or commit money. Every vendor below is **UNVERIFIED** until a human confirms.

## 1. Candidates found (real, public listings only)

Honest summary: web search is weak for this region. **8 candidates found, only 1 is local to Kadapa district.** Nothing was found for mutton/goat or slaughter options, for egg wholesalers in Proddatur/Kadapa, or for any fish/prawn trader inside Rayalaseema. Page fetches failed (network), so listings were read from search summaries only. I did not record any phone number: the one number shown for Menaka came back truncated, so read it from the listing yourself. Do not treat these as qualified vendors; they are leads to call.

| # | Business | Category | Location | Public source | Contact on listing | Status |
|---|---|---|---|---|---|---|
| 1 | Menaka Chicken Wholesale & Retails (Menaka Chicken Center, YSR Circle) | Broiler chicken (live birds, fresh chicken; says rates change daily) | Kadapa town (Proddatur not named as served) | https://m.indiamart.com/menaka-chicken | Phone shown on listing (truncated in my result; read it on the page) | UNVERIFIED |
| 2 | Satyanarayana Food Solutions | Fish and prawns (fresh/frozen, wholesale) | Not stated in snippet | https://www.restaurantindia.in/supplier/supplier-details/satyanarayana-foold-solutions/410 | None captured | UNVERIFIED |
| 3 | Aum Traders | Fish, prawns, crab (per-kg prices listed) | Chennai | https://m.indiamart.com/aumtraders-chennai/ | None captured | UNVERIFIED |
| 4 | Vkings | Eggs (listed as egg supplier) | Krishna district, AP | https://www.globallinker.com/seller/vkings | None captured | UNVERIFIED; different district, confirm products and reach |
| 5 | Surakhsha Transport Systems | Reefer/insulated truck bodies (small vehicles to large trucks) | Coimbatore | https://www.motorindiaonline.in/special-feature-on-reefer-vehicles-cold-chain-logistics-surakhsha/ | None captured | UNVERIFIED |
| 6 | Konvekta Refrigeration India | Reefer units sold mainly via body builders/OEMs | India (location not captured) | https://www.motorindiaonline.in/cold-chain-transport-in-india-konvekta/ | None captured | UNVERIFIED; useful to find a body builder and service near AP |
| 7 | Sun Packaging | Meat storage/vacuum pouches (listing price about Rs 2 per piece, not a quote) | New Delhi | https://m.indiamart.com/sunpackaging-delhi/packaging-pouch.html | None captured | UNVERIFIED |
| 8 | Saurabh Plastvac | High-barrier vacuum pouches (meat, seafood use stated) | Ahmedabad | https://www.globallinker.com/products/180-mm-x-250-mm-high-barrier-vacuum-pouch-transparent-8411050 | None captured | UNVERIFIED |

Also seen but excluded: Pradip Refrigeration (Guwahati, too far), Consta Cool (Gujarat cold rooms; listed only as a possible equipment quote), Blue Star and Uniref (named in a 2026 cold-room list, no location), Paqee Packaging (sells machines; location unclear).

Gaps the humans must fill (categories with zero usable local leads): mutton/goat traders, licensed slaughter option, egg wholesalers near Proddatur, Rayalaseema fish/prawn traders, cold-room dealers with Kadapa/Tirupati service. Use the discovery channels in vendors.md section 5, plus IndiaMART/JustDial searches by town done by a person with a local phone. Add each new lead as a row in the capture CSV.

## 2. Enquiry scripts

Use for phone or WhatsApp. Open with: who you are, that you are enquiring (not ordering), then ask. Write every answer in the capture CSV during the call. Never agree to anything or pay an advance. Say "we will revert after comparing."

### 2.1 Common opening (English)
"Namaste, I am [name] from DawnFresh, a new fresh-meat business starting in Proddatur in January. We are comparing suppliers for [product]. May I ask a few questions about your rates and supply? This is only an enquiry."

### 2.2 Common questions (all categories)
1. Rate today for [product/grade], and per what unit? Is it live weight, dressed weight, count size, per tray?
2. Which published rate do you follow (and your add or minus on it)? How often does the rate change, and how do you tell customers (call/WhatsApp, time of day)? How long is a quote valid?
3. Minimum order quantity per delivery. Ordering cut-off time.
4. Daily capacity; can you supply 150-300 kg a day from January and surge 25-30% on 24 hours notice? (Confirm the volume with the owner first.)
5. Can you deliver to Proddatur? Which days and times, who pays freight and ice/crates, what temperature at receipt?
6. Payment terms: advance, cash on delivery, weekly, credit days? Bank transfer/UPI with invoice?
7. FSSAI licence number and validity? GST number? Will you give a GST invoice?
8. Vet fitness certificate for meat (per lot)? Which slaughterhouse or farm?
9. Returns/rejection: what if the lot fails our check or birds/eggs/fish arrive damaged? Credit note or replacement, how fast, mortality/breakage allowance?
10. Cold chain: how do you keep temperature in transit?
11. Two current customers we may call as references?
12. Can we visit your premises, and when?
Close: "Thank you. May I send details on WhatsApp? We will contact you after comparing." Do not promise orders.

### 2.3 Category add-ons
- **Broiler:** target live weight and range, age and antibiotic withdrawal period, live vs dressed and yield, mortality in transit, who dresses the birds and where, Sunday/festival supply, rate board followed.
- **Mutton:** goat or sheep (never mixed), per head vs per kg live vs carcass kg, what is included (head, skin, offal), age, which licensed slaughterhouse, vet ante/post-mortem certificate, chilling time, festival rates (Sankranti falls just after our start).
- **Fish:** species, freshwater or sea, source and catch/harvest date, ice-to-fish ratio, box type, transit hours, size grades, fishing-ban impact on supply.
- **Prawns:** count grades (pieces per kg), headless/head-on, fresh iced or frozen, harvest date, residue/lab statement, price changes by week.
- **Eggs:** which NECC zone rate you follow, size/weight grade, eggs per tray and per carton, breakage allowance, lay date, delivery frequency.
- **Packaging:** exact item and size, material and food-grade certificate, MOQ, price breaks, printing/label support, lead time, sample availability, freight to Proddatur.
- **Cold-chain equipment:** capacity, panel thickness, compressor brand, price ex-GST and installed, delivery and install time, warranty, local service engineer and response time, power load.
- **Reefer/insulated vehicle:** vehicle model and body size, temperature range, unit make, build time, warranty, service near Kadapa/Tirupati, temperature logger option, buy vs hire.

### 2.4 Telugu draft (needs native-speaker review before use)
Opening: "నమస్కారం, నేను [పేరు], ప్రొద్దుటూరులో జనవరిలో ప్రారంభమయ్యే DawnFresh తాజా మాంసం వ్యాపారం నుంచి మాట్లాడుతున్నాను. [ఉత్పత్తి] రేట్లు, సరఫరా గురించి కొన్ని వివరాలు అడగవచ్చా? ఇది కేవలం విచారణ మాత్రమే."
Questions:
1. ఈ రోజు [ఉత్పత్తి] రేటు ఎంత? కిలోకా, ట్రేకా, కౌంట్ ప్రకారమా? లైవ్ వెయిట్ ఆ, డ్రెస్డ్ వెయిట్ ఆ?
2. మీరు ఏ రేటును ఆధారంగా తీసుకుంటారు? రేటు ఎంత తరచుగా మారుతుంది, ఎలా తెలియజేస్తారు?
3. కనీస ఆర్డర్ పరిమాణం ఎంత? ఆర్డర్ చెప్పాల్సిన చివరి సమయం ఏది?
4. రోజుకు ఎంత సరఫరా చేయగలరు? అవసరమైతే 24 గంటల ముందు చెబితే పెంచగలరా?
5. ప్రొద్దుటూరుకు డెలివరీ చేస్తారా? ఏ రోజులు, ఏ సమయం? రవాణా, ఐస్, క్రేట్ల ఖర్చు ఎవరిది?
6. చెల్లింపు విధానం ఏమిటి? అడ్వాన్స్, క్రెడిట్ రోజులు, బ్యాంక్ ట్రాన్స్‌ఫర్ లేదా UPI?
7. FSSAI లైసెన్స్ నంబర్, GST నంబర్ ఉన్నాయా? GST బిల్లు ఇస్తారా?
8. మాంసానికి వెటర్నరీ ఫిట్‌నెస్ సర్టిఫికెట్ ఇస్తారా? ఏ వధశాల లేదా ఫారం నుంచి?
9. నాణ్యత సరిగా లేకపోతే తిరిగి తీసుకుంటారా లేదా క్రెడిట్ ఇస్తారా? ఎంత సమయంలో?
10. రవాణాలో చల్లదనం (కోల్డ్ చైన్) ఎలా నిర్వహిస్తారు?
11. మేము మాట్లాడగలిగే ఇద్దరు ప్రస్తుత కస్టమర్ల వివరాలు ఇవ్వగలరా?
Closing: "ధన్యవాదాలు. పోల్చి చూసిన తర్వాత మేము మళ్లీ సంప్రదిస్తాము."

## 3. Price capture

File: `docs/agents/vendor-price-capture.csv`. One row per call (add a row per product quoted). Pre-filled with the 11 found leads (PLANNED) and 6 TO_BE_FOUND placeholders. Columns: call_id, call_date, caller, vendor, category, product, quoted_rate_inr, unit, rate_basis, moq, daily_capacity, delivery_to_proddatur, payment_terms, licences_seen, notes, follow_up_date, lead_status. Rules: record the rate as spoken with its basis (live/dressed/count), date and time of day; write "claimed" next to licence numbers until checked on FoSCoS; never enter a rate without the unit. Rates move daily, so compare only quotes taken within the same 3 days, or normalise to the named published basis. When lead_status becomes CALLED or REJECTED, copy the vendor into the fuller `vendor-comparison-template.csv` (scores, documents).

## 4. Scoring, ranking and negotiation

### 4.1 Procedure (uses the vendors.md scorecard unchanged)
1. Gate check first: no FSSAI licence/registration, no vet certificate for slaughter meat, refuses written spec, or cash-only with no invoice. Any fail is rejected, whatever the price. A "claimed" licence passes only after FoSCoS verification.
2. Score the seven criteria 1-5 as defined in vendors.md. Use evidence: price stability from the stated basis, quality from sample/trial, documents seen, credit days, MOQ vs pilot volume, backup capacity, delivery logistics. Missing information scores 1, not a guess.
3. Weighted score = sum(score/5 x weight), total 100. For fish, prawns and chicken use the perishable adjustment (quality 25, logistics 20, credit 5, min qty 5).
4. Landed cost: convert every quote to price per kg of sellable product (include yield, freight, ice, crates, GST, rejection allowance). Rank by weighted score, and use landed cost only to break ties within 5 points. Do not choose on headline rate.
5. Pick rank 1 (primary) and rank 2 (backup) per category, suggested split 70/30 (UNVERIFIED rule of thumb). If fewer than 2 qualify, mark the category "single-source risk" and keep searching. Nothing is final until a site visit, a reference check and a trial lot (vendors.md steps 3-4).
6. Output: ranked table per category, gate results, landed cost, open risks, then draft purchase terms for owner approval. The owner or CA reviews any contract.

### 4.2 Negotiation preparation (for the human)
- Know your walk-away: the second-best vendor's landed cost and the minimum documents.
- Offer predictability, not promises: weekly settlement on time, a fixed daily ordering time and a stated pilot volume. Do not state volumes you cannot meet.
- Ask for price as "published rate of the day plus or minus a fixed amount" in writing, rather than a fixed price that will not hold.
- Ask for: credit note for rejections within 24 hours, mortality/breakage allowance, free crate/ice or shared cost, 7-day payment terms after 4 clean weeks, written notice of rate change before the morning order cut-off, festival supply commitment.
- Trade volume for service, not for a big advance. Avoid advances until after trials (owner decides credit capacity).
- Split orders to keep the backup vendor warm (at least weekly small order).
- Equipment/vehicles: get 3 quotes, compare warranty, service response time and installed price including GST; ask for reference installations and call them.
- Do not share one vendor's rate with another by name.

## 5. Three-week calling plan (13 Oct to 20 Nov)

Calling window 10:00-12:00 and 16:00-18:00 for traders (they are busy early morning with markets; ask them when to call). Calling weeks run to 3 Nov, ahead of vendors.md dates (phone screen by 10 Nov) so site visits and trials fit before 20 Nov.

| Dates | Focus | Who |
|---|---|---|
| Tue 13 - Fri 16 Oct | Owner answers section 6. Telugu scripts reviewed by a native speaker. Print capture sheet. Local scouting walk (Proddatur market, butchers, egg and fish shops) for local leads. | Owner, staff |
| Week 1: Mon 19 - Sun 25 Oct | Chicken (leads 1 plus local), eggs (lead 4 plus local), mutton/slaughter source (municipal health officer, Animal Husbandry office). Target 8-10 calls. | Telugu-speaking staff for local calls; owner for municipal and department visits |
| Week 2: Mon 26 Oct - Sun 1 Nov | Fish and prawns (leads 2, 3 plus Nellore/Kadapa locals), packaging (7, 8 plus a local printer). Long list of 5-8 leads per category complete by Fri 30 Oct. | Staff calls; owner on fish contacts |
| Week 3: Mon 2 - Tue 3 Nov | Cold-chain equipment (cold room dealers), reefer/insulated vehicle (5, 6, local dealers). Chase unreturned calls. | Owner (large-ticket), staff for follow-ups |
| Wed 4 - Sun 8 Nov | Score all rows, run gates, pick top 3 per category for visits. Agent produces draft ranking when results are pasted. | Agent, owner |
| Mon 9 - Sun 15 Nov | Site visits, FoSCoS and GST checks, reference calls. | Owner plus one staff |
| Mon 16 - Fri 20 Nov | Trial lots (poultry, mutton first; others may run to 1 Dec per vendors.md), final shortlist, draft terms to owner and CA. Decision by Fri 20 Nov. | Owner, CA, agent |

Division of calls: owner takes equipment, vehicle, municipal/department and any call where terms are discussed; staff member 1 (Telugu speaker) takes chicken, eggs, mutton local traders; staff member 2 (or the same) takes fish, prawns and packaging. Each caller logs rows within an hour. Aim for 2 calls per day per caller, and a follow-up date on every row.

## 6. What I need from the owner
1. Pilot volumes per product, kg per day (location-outlet.md assumes 150-300 kg a day total) and egg trays per day; which products are in the January pilot (fish and prawns?).
2. Quality specs: broiler live weight range, dressed or live purchase, goat or sheep, fish species list, prawn counts, egg size grade.
3. Slaughter decision: buy dressed from a licensed/municipal source (assumed in registrations.md) or own processing.
4. Budget: working-capital limit, whether any advance is acceptable, target credit days, equipment and vehicle budget, buy or hire.
5. Who makes calls and their numbers, plus a native Telugu reviewer for the script.
6. Whether to accept vendors outside Rayalaseema (Chennai, Hyderabad, Nellore) for fish, prawns and packaging, given transit time.
7. A proper business phone/WhatsApp for enquiries, so vendors see one number.

## 7. Hand-off: how to record and send results
1. Callers fill `vendor-price-capture.csv` (one row per product quoted). Include FSSAI and GST numbers only as the vendor stated them.
2. Paste the filled CSV rows into this session, with: caller notes on tone and reliability, documents photographed or seen, and any owner constraints that changed.
3. The agent then returns: gate results, scores per vendor using the vendors.md scorecard, ranked shortlist with 2 per category (or a single-source flag), landed cost comparison, negotiation points per vendor, and draft purchase terms (price basis, MOQ, delivery, payment, rejection, document list, review dates) for owner approval.
4. The owner approves; the owner or CA reviews any contract; the owner signs and pays. The agent never contacts vendors or commits money.
5. Approved suppliers go into the app's suppliers table (name, phone, email, status Active). Document expiry, GSTIN, bank details, category and price basis have no field in `db/procurement-schema.ts`; they stay in the comparison CSV until engineering decides.
6. Re-score monthly from goods-receipt data (rejected vs received quantity) and on-time delivery.
