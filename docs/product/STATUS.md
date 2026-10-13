# Product status

Last review: 2026-10-13 (initial).

## Where things stand
- Code audit done (`docs/dept/software-audit.md`). Findings are code reading only; nothing has been run against a database.
- Backlog created: issues #6-#19 (see charter for order).
- Department playbooks: `docs/dept/`.

## Brand name (owner decision, 13 Oct)
**TulaFresh** is the chosen name (tula = scales/balance; Tulasi kept as the private origin story; rooster-at-dawn/scales logo idea; descriptor "Fresh chicken & meats"). It is NOT cleared: IP India, MCA, domains, social handles and Google Maps/Justdial checks are still to be done by the owner/CA (checklist in `docs/dept/brand-name-options.md`). Fallbacks if it fails, in order: DawnFresh, FreshRoost. The app and docs still say FreshRoute until clearance; see the rename backlog issue.

## Decided
- Business day is IST (13 Oct). Timestamps stay UTC.

- Customer prices at the POS are set by the company (13 Oct; read as the answer to 'who sets the customer price'). To confirm: whether a franchise may discount within a limit.

- Franchises may sell on credit to their customers, at the franchisee's own risk (13 Oct). Implication: a franchise owes the company for supply it received whether or not its own customers pay; uncollected franchise receivables must not reduce the settlement. The franchise's credit sales still need a receivable record (#11) so its collections and outstanding are reported correctly.

## Decisions needed from the owner
1. Rasoinet eligibility (owner, 13 Oct): free while the restaurant pays at least Rs 1,00,000 every month, measured over the last 30 days, counting payments received. To confirm: grace period before access turns read-only (suggested), and whether refunds reduce the paid amount (suggested yes).
2. Who supports the restaurant software after an operator takes over the meat business.
3. Entity structure and final brand name.
5. GST scope for invoices (confirm with the CA).
