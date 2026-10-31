# Role-based retail front end (Sprints 1-2.1, Sprint 3 in progress)

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
| `docs/TENANT-CONFIG.md` | Every company setting in `tenant.json` |
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
- Requests are raised from the screens next (`S05` needs-manager request and the manager-approval half of `CR01`); the mock seeds a few for the demo.

## What Sprint 2.1 adds (VAT, credit, split payments)

- **VAT is a company setting** (`tax.mode` in `tenant.json`): `inclusive` (price already has VAT), `exclusive` (VAT added on top, the customer pays more) or `none`. One shared rule is used by the till, documents and the server.
- **Payment methods are configurable:** cash, transfer, card, **credit**, other. **Split payments** and **part credit** are allowed (`till.allowSplitPayments`). Credit needs a customer with credit terms and room under their limit (checked on the device and by the server).
- **Cash-up** counts only cash payments as cash in the drawer.
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

Returns, needs-manager request, raising an over-limit credit request from the till, cash-up and sign-off, the manager home and the variance report (rest of S3); stock and delivery (S4). Camera barcode scanning (keyboard scanners are the default per the plan), real payment confirmation (Paystack, Sprint 9), the ERPNext adapter (S5). Every other registry screen opens a placeholder.
