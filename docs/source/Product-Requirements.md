# Product Requirements: Role-Based Retail Platform

Oct 31, 2026 · @Oluwarotimi

## Summary

We are building a role-based front end on ERPNext so that every person in the company sees only the screens their job needs, and sales, stock and cash move through one digital system instead of paper and Busy. The front end is built first, against a mock API, then switched to the real ERPNext back end.

Headline decisions:

- ERPNext replaces Busy as the single back end. Staff do not use ERPNext's own screens; admins and finance do.
- Roles, workflows and permissions live in ERPNext. The screens read them, so a new role works without redeploying.
- 93 screens in total: 8 use ERPNext as it is, 35 configure ERPNext behind a thin screen, 50 are built custom.
- The MVP covers one pilot branch and six roles (29 screens), built in four two-week sprints from 2 November to 25 December 2026.
- The code is reusable for other companies: branding, modules, labels and record names come from a configuration file, and the visual design system is supplied later.
- Documents print on A5 through the company's existing printers.

## Background and problem

Every sale today passes through a slow manual chain, and the software behind it, Busy, was built for accounting rather than retail. The chain works like this:

1. A sales attendant writes the customer's order on paper.
2. The customer carries the form to a cashier.
3. The cashier re-enters every item into Busy.
4. The cashier takes payment and prints a receipt.

Each order is transcribed twice by hand, which causes queues, errors and staff time spent on data entry. Busy is also expensive to run and hard to extend, so every workaround happens around it instead of within it. An earlier attempt to use ERPNext was rejected by staff as "too much", because they saw its full interface with the sidebar and global search.

The MD has backed the direction: move almost all sales and payments to digital channels, run stores with at most one cashier, focus effort on delivery, and make every transaction easy to track and audit.

## Goals, non-goals and success metrics

The product succeeds if staff can do their daily work faster than on Busy, and management can see losses the same day.

**Goals**

- Each role sees only its own screens, with no sidebar maze and no global search for restricted roles.
- Sales, returns, stock moves, cash-up and deliveries are recorded digitally at the point of work, including during power or network cuts.
- Exceptions (discounts, refunds, write-offs, payouts) need a different person's approval, within set limits.
- The same code serves another company by changing configuration only.

**Non-goals for this phase**

- ERPNext server setup, data migration from Busy and the live Paystack and bank integrations.
- The final visual design system, which is supplied later.
- Native mobile apps; the first versions are installable web apps.
- Replacing the standard ERPNext screens for admins and finance.

**Targets to validate with real users**

| Measure | Target |
| --- | --- |
| Sale at the till | Under 6 taps and 20 seconds |
| Transfer or card payment confirmation on screen | Within 10 seconds |
| Approval by a manager | 2 taps |
| Cash-up sign-off | About 1 minute |
| Scan to receive one goods line | About 2 seconds |
| Blind count of one bin | About 30 seconds |
| Proof of delivery | 3 taps |
| MD dashboard load | Under 3 seconds, from cache if offline |
| Weight of one screen | Under about 150 KB |
| Touch targets | 48 px (56 px at the till) |

## Users and roles

The platform has 20 roles. Each role gets one workspace with one to five destinations and a task queue as its home screen. Roles live in ERPNext; the front end reads them at sign-in and never keeps its own copy. The pilot starts with six.

| Group | Roles | Main job in the platform |
| --- | --- | --- |
| Branch | Cashier, Branch manager | Sell, take payment, open and close shifts, approve exceptions, sign off cash-up |
| Stock and delivery | Warehouse officer, Stock controller, Delivery coordinator, Rider / courier | Receive, count, transfer, dispatch, deliver and prove delivery |
| Sales and customers | Sales rep, Customer success manager, Customer support, Technician | Take orders on a phone, handle customers, run repair jobs |
| Growth | Digital media, Marketing manager | Web and app content, promotions, price proposals |
| Money | Procurement officer, Credit controller, Cash controller, Accountant, HR officer | Purchasing, credit, cash, books, payments and payroll |
| Oversight | MD / Executive, Auditor, Admin / IT | See everything, approve large items, audit, manage users |

**Pilot roles:** Cashier, Branch manager, Warehouse officer, Stock controller, Rider and Delivery coordinator.

**Principles**

- The person who creates a record never approves it.
- Cost prices are hidden from most roles.
- Data is scoped by branch or warehouse, so a branch manager sees only their branch.
- Admin / IT cannot grant themselves access; the MD holds a break-glass admin account.
- New roles can be created and given permissions without code changes.

The full grid of 20 roles by 24 areas is in Roles-and-Access-Matrix.xlsx.

## Product scope

The product covers 24 business areas and 93 screens. Not every screen is built from scratch: each has a verdict.

| Verdict | Screens | Meaning |
| --- | --- | --- |
| Use ERPNext | 8 | Admins and finance use the standard Desk (ledgers, bank reconciliation, staff records, asset depreciation, users and roles) |
| Configure ERPNext | 35 | ERPNext already does the job; ours is a thin wrapper or a setting |
| Build custom | 50 | No adequate ERPNext screen (till, scan flows, rider app, cash-up, approvals inbox, loss reports, petty cash, asset counts) |

**Areas:** Web and app, Stores (POS), CRM, Digital media, Marketing, Customer success, Procurement, Warehouse, Stock control, Returns, Delivery, Repairs, Cash-up, Credit sales, Expenses, Accounting, Payments, Payroll, Tax and VAT, HR and staff, Assets, Audit, Reporting, and Admin and IT.

**In scope now:** the front end only, running on a mock API, for the 29 MVP screens.

**In scope later:** the ERPNext adapter, the custom Frappe app (Repair Job, Cash-up, Payout Batch, Referral, Proof of Delivery, Audit Finding), Paystack, GAPS payroll export, and Busy migration.

**Out of scope:** changing ERPNext core source, and native mobile apps unless the PWA proves inadequate for riders.

Screen-by-screen detail is in Screen-Inventory.xlsx.

## Functional requirements by epic

MVP items are for the pilot branch (sprints S1 to S4). Later items follow in S5 to S10.

| Epic | MVP (pilot) | Later |
| --- | --- | --- |
| Foundation | Sign-in, PIN sign-in on shared tills, permission-driven navigation, tenant config, offline bar | Config console, design-system swap |
| Till and sales | Scan or search, cart, payment, parked sales, shift open and close, credit sale at the till, A5 invoice and receipt | Sales rep phone app, customer app |
| Returns and approvals | Returns, needs-manager request, approvals inbox, manager home | Returns inspection, quarantine, serial check |
| Cash | Cash-up, sign-off, variance report | Petty cash, expenses with receipt photo, bank deposit matching |
| Stock | Stock request, goods and transfer receipt, blind count, write-off request | Loss reports, cycle count scheduling |
| Delivery | Dispatch board, rider trips, proof of delivery, cash remittance | Failed-delivery handling, rider performance |
| Credit | Credit sale at the till | Customer payments, statements, ageing, credit limits |
| Repairs | None | Repair intake, job board, parts, customer pickup |
| Payments and payroll | None | Paystack reconciliation, payee whitelist, payout batch, GAPS export, VAT report |
| Oversight | None | MD dashboard, audit findings, asset register and counts |

**Key rules**

- Money, stock and approval actions carry a unique key so a retry never posts twice.
- Approving and payout actions are blocked offline.
- Every approval shows who, what, the amount and the limit, and rejection needs a reason.
- Reprints are allowed but logged.

## Key user journeys

**1. A cashier sells an item (target under 20 seconds)**

1. The cashier scans the barcode and the item appears in the cart.
2. The customer pays by transfer, card or credit, and the screen confirms.
3. The A5 receipt prints on the normal printer.
4. If the network drops, the sale is queued, printed as a copy and synced later.

**2. A customer asks for a discount**

1. The cashier sends a request instead of typing a manager PIN.
2. The branch manager gets it in the approvals inbox with the amount and limit.
3. The manager holds to confirm; the cashier sees the result and completes the sale.

**3. Branch manager closes the day**

1. The cashier counts and closes the shift.
2. The cash controller or manager reviews the variance and signs off the cash-up.
3. The result shows on the manager home and the MD dashboard.

**4. Stock moves from the warehouse to a branch**

1. The branch raises a stock request.
2. The warehouse officer picks and dispatches; the transfer shows as in transit.
3. The branch scans the goods in. Any shortage is flagged against the transfer.

**5. A rider delivers an order**

1. The delivery coordinator assigns a trip on the dispatch board.
2. The rider follows the trip on a phone and takes proof of delivery in 3 taps.
3. For cash on delivery, the rider remits the cash at the branch, and the manager confirms.

## Controls, approvals and limits

Every exception needs an approver who is not the creator. The values below are suggested starting points; the MD must confirm them. Rows marked placeholder are unreviewed guesses.

| Control | Who acts | Limit | Above the limit |
| --- | --- | --- | --- |
| Discount at till | Cashier | 0% | Branch manager |
| Discount | Branch manager | 3% of sale | MD |
| Refund or void | Branch manager | ₦50,000 per item | MD |
| Stock write-off | Branch manager, with Auditor | ₦100,000 | MD |
| Purchase order | Procurement officer | ₦500,000 | MD |
| New supplier | Procurement officer | 2 approvals, plus TIN check | n/a |
| Payout, single payee | Accountant prepares | ₦100,000 | MD one-time code |
| Payout, batch | Accountant prepares | ₦1,000,000 | MD one-time code |
| Payout, daily cap | System | ₦2,000,000 | Blocked |
| Payee account change | System | 24-hour hold | Released after hold |
| Price change | Digital media / Marketing | 5% margin shift | MD |
| Credit limit change (placeholder) | Credit controller | ₦500,000 | MD |
| Credit sale over limit or overdue (placeholder) | Branch manager | Blocked unless approved | MD |
| Expense claim (placeholder) | Branch manager | ₦20,000 | MD |
| Branch petty cash float (placeholder) | Cash controller | ₦100,000 | MD |
| Item treated as an asset (placeholder) | Accountant | From ₦100,000 | Below = expense |
| Asset disposal or write-off (placeholder) | Accountant prepares | Always | MD |

**Payout safeguards:** payee whitelist, account-name match, no one both adds a payee and releases the payout, and payouts come from a separately funded Paystack balance, not the sales settlement balance.

In ERPNext, approval is a workflow step, not a permission. All limits are held as configuration so the company can change them without code.

## Non-functional requirements

- **Offline:** sales, stock scanning, counts and proof of delivery keep working without a network. Each action is queued with a unique key, replayed in order per record, and visible as pending or failed. There is a cap on offline sales per till and a mandatory sync window. Money-moving approvals and payouts are blocked offline.
- **Speed:** each screen under about 150 KB; lists of 25 per page; dashboard under 3 seconds; usable on low-cost Android phones and slow connections.
- **Security:** the server is the authority and the UI only hides things. Every custom endpoint checks permissions. No secrets in the front end. Shared tills use PIN sign-in, idle lock, and full sign-out at shift close; the offline queue is never replayed under another identity.
- **Accessibility and touch:** 48 px touch targets (56 px at the till), text of at least 16 px, status shown as icon, word and colour, and errors that say what happened and keep what was typed.
- **Printing:** documents print on A5 (half of A4) through the browser to the company's existing printers. Templates cover the sales invoice and receipt, customer statement, delivery note, transfer note and payout advice, with logo, VAT, bank details and a copy label. Silent printing at the till must be tested early.
- **Data protection:** comply with the Nigeria Data Protection Act; cost prices hidden from most roles.
- **Maintainability:** strict TypeScript, automated tests on every pull request, no hard-coded colours, record names or text outside the token files, adapter and dictionary.
- **Ownership:** code, server, domain and payment accounts belong to the company.

## Dependencies and assumptions

**Assumptions**

- ERPNext remains the single back end and source of truth for roles, workflows and records.
- The first build runs on a mock API; the ERPNext adapter follows once a stable contract and staging site exist.
- The visual design system will be supplied later and swapped in through the token files.
- The pilot branch has stable power for the till computer, or an accepted offline fallback.

**Dependencies**

- Business decisions: pilot branch, approval limits, discount rules, cash-up and return reason codes, payment methods at the till.
- Hardware in week 1: a barcode scanner, an Android tablet, a low-cost Android phone for riders, and one printer confirmed to print A5 cleanly.
- Back end by mid-January: stable API contract, a read-only capabilities method, safe-to-retry write endpoints, and a staging ERPNext with test data.
- Accounts: Paystack, bank, domain and server in the company's name.
- People: a second person who can deploy from the runbook, and an owner for work after 31 December 2026, to be agreed.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| About 170 hours remain before 31 Dec 2026; S3 and S4 are overloaded | Cut in order: rider remittance polish, blind count and write-off, dispatch board, manager home extras, reports. Never cut offline till, cash-up, approvals inbox, tenant config, permissions, CI |
| Offline sales posted twice | Unique key on every action; contract tests for retries |
| Mock API drifts from real ERPNext | Own domain contract in Zod; contract tests against both adapters; mock awkward cases |
| A5 layout or silent printing fails on tills | Test early on the real printer and computer; allow a confirm-to-print fallback |
| Scanner or PWA limits on some phones | Keyboard-wedge scanners by default, camera fallback; React Native for riders only if needed |
| Metadata forms grow into a second ERP | Handwritten core screens; metadata only after a pattern repeats three times |
| Data leaks on shared devices | PIN sign-in, idle lock, queue tagged by user and shift |
| Configuration sprawl across companies | One validated tenant.json; lint rules ban hard-coded values |
| Staff reject the system again | One role, one workspace, few destinations; pilot with real users before roll-out |
| No owner after 31 Dec 2026 | Agree ownership and support before handover; runbook and second deployer |

## Open questions

1. Which branch is the pilot?
2. What are the real approval limits, especially for credit, expenses and assets?
3. What share of sales is on credit? If small, the credit sale at the till moves to Sprint 6.
4. Which ERPNext version is pinned, and does it run with bench or Docker on the Linux machine?
5. Which payment methods appear at the till?
6. Which reason codes are used for returns, cash-up variances and write-offs?
7. Who owns the code, support and further build after 31 December 2026?
8. Which printer will be used for A5, and does silent printing work on the till computer?
9. When will the design system be supplied?

## Companion documents

- **Cashierless-Store-Proposal** (.docx and .md): the case for the MD.
- **Roles-and-Access-Matrix.xlsx:** 20 roles by 24 areas, approval limits, data scope.
- **Screen-Inventory.xlsx:** 93 screens with verdicts, MVP flag and sprint, plus the sprint plan.
- **Development-Plan.md:** reviews, gaps, decisions, architecture, phases and handover checklist.
- **Frontend-Plan.md:** front-end architecture, UX rules, MVP, sprints and Claude Code rules.

## Amendments after the first build (31 October 2026)

The text above is the original. These changes were made during the build; the full log is `docs/PRODUCT-CHANGELOG.md`.

1. **VAT is configurable per company** (`tax.mode` in `tenant.json`): prices already include VAT, VAT is added on top at the till, or no VAT. This replaces the single assumption that prices are VAT-inclusive. The rate and mode need confirming with the accountant.
2. **Payment methods are configurable** and include **credit** and **other**. A sale may be paid with several methods at once, including part credit (decision on open question 5, "payment methods at the till"; the final list is still the business's to choose).
3. **Credit sale at the till (CR01) was started in Sprint 2**, earlier than planned: a credit sale needs a customer with credit terms and room under their limit. Approval by a manager when over the limit remains in Sprint 3 with the approvals inbox. Credit limits are placeholders (see the approval limits table).
4. **Cash-up** expects only the cash portion of sales in the drawer; card, transfer, credit and other are excluded.
5. **Offline credit sales** use customer data remembered on the device, so balances can be out of date until the till is online; the server re-checks the limit when the sale syncs.

6. **Cash-up is a blind count followed by a sign-off** (journey 3): the cashier counts by note before seeing the expected cash; a mismatch needs a reason; closing the shift raises the cash-up for a manager or the cash controller to sign off. The Branch manager was given the Approve step on Cash-up by a documented amendment (the matrix and the journey disagreed); the reason codes are placeholders until supplied.
7. **Manager home (A02) and the cash-up differences report (G01)** show server-computed figures, open offline from the last saved copy, and are limited to roles with View on Reporting.
8. **Plain words.** The screens and documents say "opening balance" and "closing balance" instead of "opening float" and "cash-up", "approve" instead of "sign off", and "difference" instead of "variance". The original text above keeps the original words. See `docs/GLOSSARY.md`.
9. **Returns need an approved refund** (Returns epic): the refund is what the customer paid for the returned lines; the approval follows the owner's routing setting (default two steps, to be confirmed); a cash refund lowers the expected closing balance; part of a credit sale reduces what the customer owes. Returns and branch stock requests need a connection. The reasons for returns are placeholders until supplied.
10. **Stock transfers** (journey 4): the branch asks, the warehouse packs and sends by scanning, the branch scans the goods in. A shortage is flagged against the transfer; an item nobody counted counts as none received. The requester cannot dispatch their own request and the dispatcher cannot receive their own transfer. Dispatch and receiving work offline. Transfers on the road longer than a configurable time appear in a report (default 24 hours).
11. **Missing stock is ruled on, not charged automatically.** When a transfer is received short, someone independent of the branch rules on who bears the loss (the branch that received it, the warehouse that packed it, or the transport). Only a ruling against the branch is charged to the branch. The loss is valued at cost and the cost is hidden from the branch. Who rules and the time limit are settings (placeholders until the owner decides).
12. **Physical stock counts are blind and recounted.** The counter does not see the system quantity until the count is final. Items that differ are counted again by a different person (a setting). A difference changes stock only after approval (who approves is a setting; the stock write-off limit applies), and the counter does not see the cost.
13. **Delivery** (journey 5): the coordinator assigns orders to riders; the rider sees only their own, records proof in 3 taps (works offline), collects the full cash on delivery or marks the delivery failed with a reason; the cash is handed in and a manager or cash controller confirms it; cash not handed in within a set time is shown as overdue.
14. **Variants must be scanned** at the till, and a stock count flags a possible mix-up between variants. A correction flow for a mix-up is planned.
