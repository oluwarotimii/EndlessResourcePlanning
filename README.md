# Role-based retail front end (Sprints 1-4 complete; Sprint 5, the ERPNext adapter, is next)

React + Vite + TypeScript PWA on a mock API, built to switch to ERPNext later. See `docs/source/` for the requirements, plan and spreadsheets, and `docs/DESIGN-SYSTEM.md` for how the AURA design system is applied.

## Run

```bash
pnpm install
pnpm dev          # mock server on :4010 and web app on http://localhost:5173
pnpm check        # token guard, docs guard, typecheck, tests, build
pnpm docs:status  # regenerate docs/SCREEN-STATUS.md after building a screen
pnpm e2e          # real-browser offline till test (see below)
```

Needs Node 22+ and pnpm 10 (`corepack enable`).

Demo PINs: Cashier **1111**, Branch manager **2222**, Warehouse officer **3333**, Stock controller **4444**, Rider **5555**, Delivery coordinator **6666**.

## Documentation map (start here if you are new)
| Read | For |
| --- | --- |
| `CLAUDE.md` | Rules for anyone (human or AI) changing this repo, including the documentation rule |
| `docs/HANDOVER.md` | How to take over: architecture, rules, pitfalls, what is next |
| `docs/PROCESS-PLAYBOOK.md` | The detailed how: every technique and command used, and the mistakes made |
| `docs/PRODUCT-CHANGELOG.md` | Every product change, newest first |
| `docs/DECISIONS.md` | Decisions, open questions for the business, problems found in the source documents |
| `docs/SCREEN-STATUS.md` | Generated status of all 93 screens |
| `docs/FRAPPE-APP-SPEC.md` | The build list for the custom Frappe app on the back end |
| `docs/SCENARIOS.md` | The open questions as stories with numbers (start here to answer them) |
| `docs/ERPNEXT-MAPPING.md` | How each concept lives in ERPNext, and the questions to answer on staging |
| `docs/TENANT-CONFIG.md` | Every company setting in `tenant.json` |
| `docs/APPROVAL-ROUTING.md` | Who approves what, and how to change it |
| `docs/GLOSSARY.md` | Plain-word meanings (closing balance, float, variance...) |
| `docs/DESIGN-SYSTEM.md`, `docs/PRINTING.md` | Design system use and A5 printing |
| `docs/source/` | The owner's original requirements, plan, spreadsheets and design demonstrator |

## What Sprint 1 delivers

- **Monorepo:** `apps/web`, `apps/mock-server`, `packages/{api-contract,tenant-config,tokens,permissions}`.
- **Contract:** Zod schemas in `api-contract`; the mock server is contract-tested.
- **Tenant config:** `packages/tenant-config/tenant.json`, validated at start-up (a bad file shows a readable error screen).
- **Tokens:** two themes compiled to CSS variables, light and dark, contrast-tested. Switch theme in the header.
- **Login:** device-registered users with PIN pad, idle lock, sign out; mock includes wrong-PIN lockout and outage cases.
- **Permissions:** 20 roles, 24 areas and 93 screens generated from the spreadsheets (`pnpm fixtures`). Navigation is the registry filtered by the user's capabilities. Task roles (cashier, rider) get tiles and no menu. A guessed URL is refused.
- **Offline bar:** Online / Offline / Syncing with a pending count (stub; the real IndexedDB queue is Sprint 2). In dev, buttons simulate offline.
- **Role home:** a task queue with approval-style cards showing amount and limit.
- **CI:** `.github/workflows/ci.yml`.

## What Sprint 3 adds so far (approvals)

- **Approvals inbox (A01):** who raised the request, what it is, the amount, the limit, the customer and the note. Approve by holding until the bar fills; reject through a dialog that requires a reason. Decided requests show who decided and why.
- **Rules enforced twice:** the UI hides the controls when the role may not decide, the request is the user's own, or the device is offline; the mock server checks the same rules and that a decision is still pending. Decisions are idempotent.
- **S05 (needs-manager request) is built inside the till:** "Ask a manager" raises a discount or void request with an optional reason. Nothing changes until approval; an approved discount applies to the gross subtotal before VAT, and an approved void clears the cart. Requests are blocked offline.
- **CR01 (over-limit credit request)** is built the same way: when a credit sale would go over the customer's available credit, "Ask a manager" raises a `credit_over_limit` request; once approved it is tied to that customer and amount and can be used for one sale only.

## What Sprint 3 adds so far (cash and approvals)

- **Approvals inbox (A01)** with hold-to-confirm and a required rejection reason; **needs-manager request (S05)**; **over-limit credit approval**.
- **Closing balance (Q01):** closing a shift is a blind count by note, then the variance; a mismatch needs a reason. **Approval (Q02):** a manager or cash controller signs it off; the cashier never approves their own count.
- **Manager home (A02)** and **closing balance differences by cashier (G01)**: server-computed figures that also open offline from the last saved copy.
- **Customer returns (T01):** find the sale, choose what comes back, a manager approves the refund through the routing setting, then the return is completed once. Cash refunds lower the expected closing balance.
- **Branch stock request (H02):** ask the warehouse for stock and follow the request.
- **Sprint 3 is complete.** Next is Sprint 4 (stock and delivery).
- **Real-browser tests:** `node e2e/till-offline.cjs` and `node e2e/returns.cjs` (see "Real-browser test"), and `node e2e/stock.cjs`, `node e2e/count.cjs`.

## What Sprint 4 adds so far (stock and delivery)

- **Pack and send stock (H03)** and **receive stock (H04):** scan each item, send less than asked if needed, flag any shortage; both work offline; the dispatcher can never receive their own transfer.
- **Stock lookup (H05)** (shelf and warehouse, opens offline) and the **in-transit report (G02)** (transfers on the road too long, setting `stock.inTransitAlertHours`).
- **Shortage ruling:** missing stock opens a ruling for someone independent (default Auditor or MD); the ruler chooses who bears the loss (branch, warehouse or transport); nothing is charged automatically; the value at cost is hidden from the branch.
- **Stock count (K01)** is blind: no system quantities, offline, items that differ are recounted by a different person; **differences (K02)** go for approval and stock changes only when approved.
- **Delivery:** dispatch board (L01), rider deliveries on a phone (L02), proof of delivery in 3 taps offline (L03), hand in delivery cash confirmed by a manager (L04), delivery cash not handed in (L05). **Sprint 4 is complete.** Variants must be scanned, and a stock count flags a possible mix-up.
- Real-browser test for delivery: `node e2e/delivery.cjs` (needs a fresh mock server).
- Real-browser test: `node e2e/stock.cjs`.

## Goods receipt (H01), added after Sprint 4

- **Goods receipt from a supplier (H01):** scan what arrives against a purchase order; receiving less than ordered is normal (the rest may come in a later delivery); receiving more than the order plus the configured allowance (`stock.overReceiptAllowancePercent`) is refused, the same way ERPNext's Purchase Receipt works. Works offline. Raising a purchase order is a later screen (R01); orders arrive here already open, seeded in the mock. This was the last MVP placeholder; the 29 MVP screens are now all built or partly built.

## Branch-to-branch stock requests

- **A branch can ask a sister branch for stock, not only the warehouse (H02).** Picking a sister branch shows what it holds, per item, before asking. A sister branch's own Warehouse officer packs and sends it (H03, unchanged in shape) from that branch's own stock; H04 and H05 show which branch stock moved through. A demo sister branch, "Victoria Island Branch", and its officer ("Bayo Fashola", PIN **3334**) are seeded for this.

## What Sprint 2.1 adds (VAT, credit, split payments)

- **VAT is a company setting** (`tax.mode` in `tenant.json`): `inclusive` (price already has VAT), `exclusive` (VAT added on top, the customer pays more) or `none`. One shared rule is used by the till, documents and the server.
- **Payment methods are configurable:** cash, transfer, card, **credit**, other. **Split payments** and **part credit** are allowed (`till.allowSplitPayments`). Credit needs a customer with credit terms and room under their limit (checked on the device and by the server).
- **Closing balance** counts only cash payments as cash in the drawer.
- Documents show each payment and the balance on credit. See `docs/TENANT-CONFIG.md` and `docs/PRODUCT-CHANGELOG.md`.

## What Sprint 2 adds (cashier core)

- **Offline queue** (`packages/offline`): IndexedDB, every action carries an idempotency key, replays in order per record, never under another identity, failed items stay visible. Sync tray at screen P03.
- **Till (S01):** scan (keyboard-wedge scanners: the code arrives as typing + Enter) or search, cart that survives reload, payment buttons from `till.paymentMethods`, optional customer, park a sale, recent sales with logged reprint.
- **Parked sales (S02), shift open/close (S03), customer lookup (S04).**
- **Offline limits** from `tenant.json`: a cap on unsynced sales per till and a sync window block further sales when exceeded.
- **A5 invoice and receipt printing** with COPY label for unsynced sales (`docs/PRINTING.md`).
- **Works with no network:** a service worker caches every screen on first visit; the catalogue, cart, shift and queue live in IndexedDB.
- **Mock server** gained products, customers, sales, shifts and print log, all idempotent.

### Real-browser test

```bash
pnpm build
pnpm --filter @erp/mock-server start &      # port 4010
pnpm --filter @erp/web preview &            # port 4173
npx playwright install chromium             # once
node e2e/till-offline.cjs                   # sell online, go offline, reload, sell, print A5, reconnect
```

## Not built yet (by design)

Camera barcode scanning (keyboard scanners are the default per the plan), real payment confirmation (Paystack, Sprint 9), the ERPNext adapter (S5), per-account credit approvers and credit partners (decisions 42, 43), the mix-up correction flow (Scenario 13), and the remaining Later screens. Every other registry screen opens a placeholder; see `docs/SCREEN-STATUS.md` for the current count.
