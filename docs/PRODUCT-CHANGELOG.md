# Product changelog

Every change that alters what the product does, for users or for the business, gets an entry here **in the same change**, newest first. Each entry says what changed, which documents were updated, and what is still open. The rule is in `CLAUDE.md`; `docs/HANDOVER.md` has the checklist.

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
