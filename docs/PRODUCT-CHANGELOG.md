# Product changelog

Every change that alters what the product does, for users or for the business, gets an entry here **in the same change**, newest first. Each entry says what changed, which documents were updated, and what is still open. The rule is in `CLAUDE.md`; `docs/HANDOVER.md` has the checklist.

## 2026-11-02, Return window by product, category and fault (decision 40)

**What changed:** a refund request is refused if the sale is older than the allowed days. Days come from `returns.rules`: product rule, then category rule, then the company default; faulty reasons (`returns.rules.faultyReasons`) use the faulty days. Placeholders: 7 days, 30 faulty, Audio 3. The cashier sees the server's message ("... can only be returned within 3 days. This sale is 4 days old.").
**Documents updated:** `TENANT-CONFIG.md` (5 rows), `DECISIONS.md` (40), `SCENARIOS.md` (16 already), this entry. The docs guard now treats `byCategory` and `byProduct` as one setting each.
**Open:** a manager override for a late return; a screen to edit the rules (Sprint 10); the real days; RMA or restock by an inspector (decision 41) and credit partners (42, 43) are still not built.

## 2026-11-02, Owner's answers: scenarios 1 to 14, return rules, RMA, credit partners (planning only)

**What changed:** no code. The owner answered the open stories: use the suggestions as placeholders, make reason lists extendable, keep the Cash controller role, make approvers a permission, and asked for four new features: return days per category or product; faulty returns to RMA or restock by an assigned inspector; a "bill to" party for credit sales (credit partners such as Credit Direct); credit approval by a Credit control officer depending on the account.
**Documents updated:** `DECISIONS.md` (39 to 44), `SCENARIOS.md` (15, 16, 17), `FRAPPE-APP-SPEC.md` (section 12, later), this entry.
**Open:** the "A" the owner mentioned (read as Scenario 2, A); the real return days, partners, limits and inspectors; these features are not scheduled (proposal: S6 with credit, S7 with returns inspection and quarantine).

## 2026-11-02, Sprint 4 (fourth increment, completes Sprint 4): delivery, variant safeguards, offline fix, Frappe spec and scenarios

**What changed**
- **L01 dispatch board.** The coordinator gives each order to a rider; failed orders come back with their reason to be assigned again. Payment is shown (already paid, or "Collect ₦x").
- **L02 rider deliveries (phone).** The rider sees only their own deliveries, with a call link and the cash to collect; opens offline.
- **L03 proof of delivery in 3 taps** and offline (new queue type `delivery.proof`): Deliver, Delivered, Confirm. Cash on delivery needs the full amount; prepaid takes no cash; a failed delivery needs a reason (placeholder list `delivery.failedReasons`); optional small photo.
- **L04 hand in delivery cash.** The rider ticks the delivered cash on delivery orders and records the hand-in; a manager or cash controller confirms in the inbox (new approval kind `cash_remittance`, default route a placeholder). Rejecting frees the cash to hand in again.
- **L05 delivery cash not handed in.** By rider with hours and an overdue marker (setting `delivery.codRemitHours`, 24, a placeholder).
- **Variant safeguards (your wrong-variant example).** Items with variants must be **scanned**, not tapped (setting `till.scanRequiredForVariants`), and the tile shows the variant in big letters. The count differences and the write-off approval flag a **possible mix-up** when one variant is short and its sibling is over, so a swap is not read as theft. A correction flow is planned.
- **Offline bug fixed (found by the real-browser test).** A screen not yet opened online failed offline because the cached file never matched the browser's request (`Vary: Origin`). The service worker now ignores `Vary` and uses cache `erp-shell-v3`. This affected every lazy screen from Sprint 2 onward.
- **New documents:** `docs/FRAPPE-APP-SPEC.md` (everything to build in the Frappe custom app: doctypes, custom fields, workflows, the method for every API path, settings, jobs, tests, build order) and `docs/SCENARIOS.md` (the open questions as stories with numbers, including the wrong-variant story).
- Tests: 30 new (delivery rules, the five screens, variant rules, the mix-up hint) and a real-browser test on a phone, offline (`e2e/delivery.cjs`).

**Documents updated:** `docs/FRAPPE-APP-SPEC.md` and `docs/SCENARIOS.md` (new), `docs/ERPNEXT-MAPPING.md` (delivery and variant rows), `docs/APPROVAL-ROUTING.md` (`cash_remittance`), `docs/DECISIONS.md` (decisions 34 to 38, delivery and variant questions, a pointer to the scenarios), `docs/GLOSSARY.md`, `docs/TENANT-CONFIG.md` (`delivery.failedReasons`, `delivery.codRemitHours`, `till.scanRequiredForVariants`), `docs/SCREEN-STATUS.md` (L01 to L05), `docs/HANDOVER.md`, `README.md`, `CLAUDE.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** the failed-delivery reasons, the cash hand-in time, who confirms delivery cash, a short-paying customer; the mix-up correction flow and who approves it; every question in `docs/SCENARIOS.md`.

## 2026-11-02, Sprint 4 (third increment): physical stock count, recount and write-off

**What changed**
- **K01 stock count, blind.** The counter gets the list of items with **no system quantities**. Count by scanning or typing (an explicit 0 counts); you see progress ("Items counted: 3 of 12"). Count the shelf or the warehouse. It works offline: the count is saved and queued (new queue type `count.submit`), sent once, and shown in the sync tray.
- **Recount by a different person.** If items differ, they come back flagged "Recount needed". Someone other than the first counter counts only those items, still without seeing quantities; the recount is the final figure. This is a setting, `stock.recountByDifferentPerson`.
- **K02 differences and write-off request.** After the recount, the items that still differ are shown (system, counted, short or over, as icon and words). The Stock controller asks for approval to adjust stock with an optional note. **Stock changes only when the last approval step approves;** a rejection (with a reason) adjusts nothing and closes the count. The approval is a new kind `write_off` that follows the routing setting (default two steps: Branch manager or MD, then Auditor or MD, placeholders) and the stock write-off limit (₦100,000 at cost, above it the MD).
- **Cost is hidden from the counter.** The value at cost is shown only to approvers. **A leak was found and fixed:** the response to the person who asked for the write-off contained the cost; one shared function now hides it everywhere an approval is returned.
- **Access.** Anyone who may create counts can open K01, so a different person can do the recount (the Warehouse officer and the Branch manager as well as the Stock controller).
- Tests: 31 new (blind sheet, recount rules, retries, write-off chain, hidden cost, the screens, offline count) and a real-browser test (`e2e/count.cjs`).

**Documents updated:** `docs/ERPNEXT-MAPPING.md` (count, recount, write-off rows and two new staging questions), `docs/APPROVAL-ROUTING.md`, `docs/DECISIONS.md` (decisions 30 to 33), `docs/GLOSSARY.md`, `docs/TENANT-CONFIG.md` (`stock.recountByDifferentPerson`), `docs/SCREEN-STATUS.md` (K01, K02), `docs/HANDOVER.md`, `README.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** the cut-off while stock is moving; how often and which items are counted; what happens after a second difference; who approves write-offs (placeholders). ERPNext: how Stock Reconciliation records the first count and the recount, and how to treat movements during a count (see the staging questions).

## 2026-11-02, Sprint 4 (second increment): shortage ruling, and the ERPNext mapping rule

**What changed**
- **A shortage is ruled on, never charged automatically.** When a transfer is received with items missing, the system opens a ruling (new approval kind `shortage`) for someone independent of the branch. Default route: Auditor or MD, a placeholder (change it in `approval-routing.json`). The person who received the stock cannot rule on it and does not see its cost value.
- **The ruler chooses who bears the loss:** the branch that received it, the warehouse that packed it, or the transport. Approving needs that choice; rejecting needs a reason and charges nothing (for example when the items were found). Only a ruling against the branch is charged to the branch, and the manager home shows "Missing stock charged to this branch".
- **Valued at cost, cost hidden.** The value at cost is held on the server and shown only to rulers. The ruling follows the stock write-off limit (₦100,000 for the Auditor, above it the MD).
- **Overdue marker.** A ruling waiting longer than `stock.shortageRulingHours` (48, a placeholder) shows "Waiting too long" with an icon and words. It is not charged automatically.
- **The receiver is told what happens next** ("The missing items were flagged. Someone independent will rule on who bears the loss. Nothing is charged yet.").
- **The inbox follows the approval setting.** Anyone named in a routing sees the approvals inbox; anyone who can approve a closing balance sees Q02. Before, the Auditor and the Cash controller could not reach the inbox at all.
- **ERPNext rule.** New `docs/ERPNEXT-MAPPING.md` maps every concept to its ERPNext/Frappe record from the owner's inventory, marked Owner, Seen or Proposal, with the open questions to answer on staging. `pnpm check:docs` now fails if an approval kind or queued action is not mapped. The rule is in `CLAUDE.md` and the handover.
- Tests: 25 new (server ruling rules, limits, hidden cost, the routing setting, inbox visibility, the ruling cards).

**Documents updated:** `docs/ERPNEXT-MAPPING.md` (new), `docs/APPROVAL-ROUTING.md`, `docs/DECISIONS.md` (decisions 26 to 29), `docs/GLOSSARY.md`, `docs/TENANT-CONFIG.md` (`stock.shortageRulingHours`), `CLAUDE.md`, `docs/HANDOVER.md`, `README.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** who rules and how long they have; what happens if nobody rules in time; whether a carrier can really be charged; whether staff are charged personally (legal and HR). ERPNext: what happens to the remainder after a partial receipt, and the cleanest way to write it off to a cost centre (see the questions in the mapping).

## 2026-11-02, Sprint 4 (first increment): stock transfers, stock lookup and the in-transit report

**What changed**
- **H03 pack and send stock.** The warehouse sees the branch's requests (from H02), opens one, scans each item as it is packed (or uses + and -), and sends. It may send less than was asked for. The request becomes "On its way".
- **H04 receive stock.** The branch opens a transfer, scans each item as it comes out of the box, and confirms. Anything missing is flagged as a **shortage** on the transfer; counting more than was sent is refused; an item nobody counted is sent as zero, so nothing is assumed to have arrived. Recently received transfers show "Shortage: n" or "Complete" (icon and word).
- **Both work offline.** Each is saved on the device and queued with an idempotency key (new queue types `transfer.dispatch` and `transfer.receive`), shown in the sync tray, and sent once when the connection returns. A retry never sends stock twice or adds it twice.
- **Two people at every hand-over (dual control).** The person who raised a request cannot dispatch it, and the person who dispatched a transfer cannot receive it. The server enforces both.
- **Stock numbers.** Dispatch takes stock out of the warehouse; receiving adds what was counted to the branch shelf (the quantity sales draw from).
- **H05 stock lookup.** Shelf and warehouse quantities with a "Low" flag, search by name, code or barcode, opens offline from the last saved list.
- **G02 in-transit report.** Transfers on the road longer than the alert time, oldest first; the alert time is the new setting `stock.inTransitAlertHours` (default 24). Server-computed; opens offline from the last saved copy.
- Tests: 40 new (transfer rules, dual control, shortage, retries, the in-transit clock, the four screens, offline dispatch) and a real-browser test (`e2e/stock.cjs`): the warehouse packs by scanning, the branch goes offline, counts the delivery with one item missing, reconnects, and the server records the shortage once.

**Documents updated:** `docs/DECISIONS.md` (decisions 22 to 25), `docs/GLOSSARY.md`, `docs/TENANT-CONFIG.md` (`stock.inTransitAlertHours`), `docs/SCREEN-STATUS.md` (H03, H04, H05, G02), `docs/screen-status-notes.json`, `docs/HANDOVER.md`, `README.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** what to do with the part of a request that was not sent (it is not re-requested automatically); where missing items go (a loss or quarantine record, Sprint 7); cancelling a request; the low-stock level (fixed at 5 for now); how long a transfer may stay unreceived before someone must act.

## 2026-10-31, Sprint 3 (fifth increment, completes Sprint 3): customer returns and branch stock request

**What changed**
- **T01 customer return.** Find the sale by its invoice number, choose the lines and quantities coming back (only what is left), give a reason, and choose how to pay the customer back. A manager must approve the refund, then the cashier completes the return.
- **The refund is what the customer actually paid for those lines**: a share of the sale total by the lines' share of the subtotal. That respects an approved discount and VAT added on top (`refundFor`, one shared rule). The server recomputes it; the client's amount is ignored.
- **A refund is an approval that follows the routing setting.** New kind `refund`; default route: step 1 Branch manager or MD, step 2 Cash controller or MD (two different people, in order; change it in `approval-routing.json`). The per-item limit from the approval-limits spreadsheet applies (largest returned line). An approved refund is tied to that sale and those exact lines and can be used once.
- **Credit and cash.** If part of the sale was on credit, that share first reduces what the customer owes; the rest is paid back by the chosen method. A **cash refund lowers the expected closing balance** (the server and the closing balance count both subtract it); card and transfer refunds do not.
- **Manager home** shows the amount refunded so far.
- **H02 branch stock request.** Search items, set quantities, add a note, send; see the requests with their status as icon and word (requested, on its way, received, cancelled). A retried send never raises two requests.
- **Both need a connection** (a refund needs someone else's approval; stock requests are marked "No" for offline in the screen inventory).
- New setting `returns.reasons` (placeholders). Two mock people are used by the default route: Cash controller (PIN 9999) and MD (PIN 7777).
- Tests: refund maths (discount, VAT, rounding), returns server rules (two steps, single use, mismatched lines, credit share, closing balance), the return wizard, the stock request, and a real-browser check of the whole refund with three different people (`e2e/returns.cjs`).

**Documents updated:** `docs/DECISIONS.md` (decisions 18 to 21, new open questions), `docs/APPROVAL-ROUTING.md` (refund is now built), `docs/TENANT-CONFIG.md` (`returns.reasons`), `docs/SCREEN-STATUS.md` (T01, H02), `docs/HANDOVER.md`, `README.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** real return reasons; the return window (how many days after a sale); whether returned goods go back on the shelf or to quarantine (Sprint 7); returns while offline; a printed credit note; who sets the refund route (default is a placeholder for the owner to confirm).

## 2026-10-31, naming: plain words everywhere

**What changed (at the owner's request: names staff will understand quickly)**
- **"Opening balance"** replaces "opening float" and **"closing balance"** replaces "cash-up" in every screen, screen title and current-state document. "Approve" replaces "sign off", and "difference" is used instead of "variance".
- Screen titles that come from the spreadsheet are overridden without editing the spreadsheet, in `packages/permissions/src/data/title-overrides.json` (merged by `pnpm fixtures`): Q01 Closing balance count, Q02 Closing balance approval, Q03 Cross-branch closing balance review and bank deposit, G01 Loss report: closing balance differences by cashier, K02 Count differences and write-off request, G05 Loss report: stock count differences and write-offs, EX03 Petty cash balance and reconciliation.
- **Internal names are unchanged** (the `cash_up` approval kind, the `cashUp.*` settings, the roles-matrix area "Cash-up") so nothing breaks; the mapping is in `docs/GLOSSARY.md`.
- Older entries below keep the words used at the time.
- Working preference recorded: **no zip or patch is produced unless the owner asks** (`docs/HANDOVER.md`, `CLAUDE.md`).

**Documents updated:** `docs/GLOSSARY.md` (rewritten, with a plain-word to internal-name table), `docs/APPROVAL-ROUTING.md`, `docs/DECISIONS.md`, `docs/TENANT-CONFIG.md`, `docs/SCREEN-STATUS.md` (regenerated), `docs/screen-status-notes.json`, `docs/HANDOVER.md`, `README.md`, `CLAUDE.md`, and an amendment to `docs/source/Product-Requirements.md`.

## 2026-10-31, Sprint 3 (fourth increment): approver routing is a setting

**What changed**
- **Who decides each kind of approval is configurable** in `packages/permissions/src/data/approval-routing.json`: ordered steps, each naming the roles allowed to decide it. Rules: the requester never decides; one person never decides two steps; a rejection ends the chain; amount limits still apply per approver; a kind not listed falls back to the matrix Approve letter. Change the file and the next request follows the new route (for example the Auditor signs off the cash-up, or the manager then the MD).
- **Approval chains** are stored on the approval (`steps`), enforced by the server, and shown in the inbox in order with who decided each step and whose turn it is. A person who is not the current step gets no decision controls.
- **Mock people added** to try the routes: MD (PIN 7777), Auditor (8888), Cash controller (9999).
- **The cash-up approver** is now just a line in that file (default unchanged: Branch manager or Cash controller). The wording on the close screen no longer says "your manager".
- **Refunds** (T01, not built yet) will use the same routing, so the owner can require more than the manager.
- Tests: chains, turn order, dual control, rejection, a role named only in the routing (Auditor), a typo guard on role names, and the inbox display.

**Documents updated:** `docs/APPROVAL-ROUTING.md` (new; the docs guard now fails if an approval kind is undocumented), `docs/GLOSSARY.md` (new, plain-word definitions including cash-up), `docs/DECISIONS.md` (decisions 16 and 17; cash-up process roles as an open question), `docs/HANDOVER.md`, `README.md`.

**Open:** the owner's cash-up process (who handles opening cash, who signs off closing, who counts at the bank, whether the manager must confirm the opening float before selling); a screen to edit the routing (Sprint 10); real ERPNext workflow mapping (Sprint 5).

## 2026-10-31, Sprint 3 (third increment): cash-up count and sign-off, manager home, variance report

**What changed**
- **Q01 cash-up count (blind).** Closing a shift now goes through a count by note (`cashUp.denominations`). The expected cash appears only after counting; a count that does not match needs a reason (`cashUp.varianceReasons`, placeholders) and an optional note. Closing queues the shift close (offline-safe) and signs the cashier out. S03 now opens a shift and links to the count instead of closing directly.
- **Server rules for the close:** the notes must add up to the counted cash, a mismatch needs a reason, and a retried close raises only one cash-up. Closing raises a **cash-up approval** for someone else; a client cannot raise one itself.
- **Q02 cash-up sign-off** is the approvals inbox narrowed to cash-ups, showing expected, counted and the difference. Sign-off is hold-to-confirm; rejection needs a reason; the cashier cannot sign off their own count.
- **Who may sign off:** default chosen, the Branch manager and the Cash controller (see `docs/DECISIONS.md` decisions 13 and 14). Implemented by `packages/permissions/src/data/matrix-amendments.json`, which `pnpm fixtures` merges over the spreadsheet; the spreadsheet is untouched.
- **A02 branch manager home:** approvals and cash-ups waiting for the manager, sales so far split into cash and credit, open shifts, and a link to the report. **G01 cash-up differences by cashier,** worst first, with icon + word (cash missing / over / balanced). Both are server-computed, read-only, restricted to roles with View on Reporting, and keep the last good copy on the device ("Saved figures").
- Tests: 52 new (server rules, permissions, count wizard, sign-off, manager home, report, offline saved figures).

**Documents updated:** `docs/DECISIONS.md` (decisions 13 to 15, reason-code and recount questions, problem 1 handled by default), `docs/TENANT-CONFIG.md` (`cashUp.denominations`, `cashUp.varianceReasons`), `docs/SCREEN-STATUS.md` (Q01, Q02, A02, G01 built), `docs/HANDOVER.md`, `README.md`, and Amendments in `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Open:** the real cash-up approver and variance reason codes; what happens after a rejected cash-up (no recount flow yet); branch scoping of manager figures; returns (T01) and the branch stock request (H02) remain in Sprint 3.

## 2026-10-31, Sprint 3 (second increment): S05 needs-manager request

**What changed**
- **S05 is built as a dialog inside the till.** "Ask a manager" lets a cashier request a discount (a whole percentage) or a void of the current sale, with an optional reason. The request lands in A01 with a unique key, so sending it twice never raises two requests. Nothing on the till changes until the request is approved; the cashier checks the result with "Check again".
- **An approved discount comes off the gross subtotal before VAT.** One shared `discountAmount` rule is used by the till, the receipt and the server. The till shows the discount as its own line, the sale carries `discountApprovalId`, and the server applies the approval exactly once. Any later change to the lines clears the discount, so a stale approval cannot be reused. An approved void clears the cart.
- **Requests are blocked offline**; the action is hidden and the reason is shown rather than leaving a request that can never be decided.
- **Server authority:** `POST /api/approvals` validates and keys the request, checks the create letter on `Stores (POS)`, uses the configured limit, requires a customer with credit terms and actual over-limit room for credit requests, and is idempotent. Decision now also refuses an amount above the approver's own limit; the inbox says "above your limit, the MD must decide". Seed `AP-0001` is 2% so a manager can decide it. The sale endpoint requires an approved, unused discount raised by the same cashier and recomputes VAT and total.
- Tests: contract (`CreateApprovalInput`, `discountAmount`), permissions thresholds, mock-server raise/limit/discount-reuse cases, and two till flows (discount and void).
- **Documentation status:** a dialog can count as a built screen (`BUILT_DIALOGS`), so S05 is reported as built without inventing a route.

**Documents updated:** `docs/SCREEN-STATUS.md` (S05 built), `docs/screen-status-notes.json`, `docs/DECISIONS.md`, `docs/HANDOVER.md`, `README.md`.

**Open:** the over-limit credit request from the till (CR01) is the next increment. Real approval limits still need the MD to confirm them. Cash-up sign-off remains blocked by the source-document mismatch in `docs/DECISIONS.md` (problem 1), and the cash-up variance / return reason codes are still an open question.

## 2026-10-31, Sprint 3 (first increment): approvals engine and inbox

**What changed**
- **Approvals contract:** `Approval` and `ApprovalDecisionInput` in `packages/api-contract`. Each decision carries an idempotency key; a rejection must include a reason of at least three characters.
- **Approvals inbox (A01) is built.** It shows who raised the request, what it is, the amount and the limit, the requester's note and the customer when there is one. Pending requests can be approved only by holding the button until the bar fills (a short tap does nothing), or rejected through a dialog that requires a reason. Decided requests show who decided and why. The creator of a request never sees the approve or reject controls; the server enforces the same rule.
- **Approvals are blocked offline.** Offline, the inbox keeps showing the list but hides both decision controls and explains why. The server is the authority: it checks the approve letter on the relevant area (`Stores (POS)` for discounts, `Returns` for voids, `Credit sales` for over-limit credit), that the decision is still pending, and the creator rule.
- **Mock server** gained `GET /api/approvals` and `POST /api/approvals/:id/decision`, with seeded requests for the demo, duplicate-safe decisions and the awkward cases (own request, wrong role, already decided, missing reason).
- Tests: contract rules, permission mapping, mock-server behaviour and six component tests for the inbox.

**Documents updated:** `docs/SCREEN-STATUS.md` (A01 built), `docs/screen-status-notes.json`, `docs/DECISIONS.md`, `docs/HANDOVER.md`, `README.md`.

**Open:** requests are raised from the screens themselves next (S05 needs-manager request and the manager-approval half of CR01). Real approval limits still need the MD to confirm them. Cash-up sign-off remains blocked by the source-document mismatch in `docs/DECISIONS.md` (problem 1), and the cash-up variance / return reason codes are still an open question.

## 2026-10-31, Sprint 2.1: configurable VAT, credit and split payments

**What changed**
- **VAT is a company setting** (`tax.mode`): `inclusive` (price already contains VAT, customer pays the price), `exclusive` (VAT added on top, customer pays price plus VAT) or `none`. One shared rule (`computeTotals` in `packages/api-contract`) is used by the till, parked sales, printed documents and the mock server. The server recomputes and rejects a sale whose VAT or total does not match.
- **Payment methods are configurable** (`till.paymentMethods`): `cash`, `transfer`, `card`, `credit`, `other`. A sale now carries a list of payments, not one method.
- **Credit and part credit.** A sale can be fully on credit or part cash/transfer/card and part credit (`till.allowSplitPayments`). Credit needs a customer with credit terms and room under their limit. The till checks (from the customers it has seen) and the server checks again. The receivable is recorded once even if the sale is retried.
- **Cash-up uses cash payments only.** Expected cash = opening float + the cash portion of sales. Card, transfer, credit and other never count as cash in the drawer.
- **Documents** show the subtotal and "VAT added" in exclusive mode, each payment, and "Balance on credit".
- **Customers** carry `creditLimit` and `balance`; the till and customer screen show how much is still available. The device remembers customers so credit sales work offline (balances may be out of date until online).

**Documents updated:** `docs/TENANT-CONFIG.md` (new, with a check that fails if a setting is undocumented), `docs/SCREEN-STATUS.md` (new, generated), `docs/DECISIONS.md`, `docs/PRINTING.md`, `docs/HANDOVER.md`, `README.md`, `CLAUDE.md`, and an "Amendments" section appended to `docs/source/Product-Requirements.md` and `docs/source/Frontend-Plan.md`.

**Also:** `docs/PROCESS-PLAYBOOK.md` added (how the work was done, step by step) and linked from the handover and README.

**Open:** the credit limit approval flow (a manager approves going over the limit) is Sprint 3. The credit limit values, VAT rate and VAT mode are placeholders to confirm with the business and the accountant.

## 2026-10-31, Sprint 2: cashier core

Offline queue with idempotency keys (IndexedDB), till with scanner input, parked sales, shift open and close, customer lookup, sync tray, A5 invoice and receipt printing, service worker so the app opens with no network, offline limits (50 sales, 12 hours), mock server endpoints for products, customers, sales, shifts and print log. A real-browser test (`e2e/till-offline.cjs`) covers selling online, going offline, reloading, selling, printing and reconnecting.
**Documents updated:** `README.md`, `docs/PRINTING.md`, a Sprint 2 notes file (since merged into `docs/DECISIONS.md`).

## 2026-10-31, Sprint 1: foundation

Monorepo (pnpm, Vite, React, strict TypeScript), Zod contract, mock server, `tenant.json` loader checked at start-up, AURA design tokens (light, dark and a neutral second theme) with a guard that fails on hard-coded colours, login with PIN pad and idle lock, permission-driven navigation generated from the roles and screen spreadsheets, offline bar, role home as a task queue, CI.
**Documents updated:** `README.md`, `CLAUDE.md`, `docs/DESIGN-SYSTEM.md`.
