# Front-end plan: role-based retail screens on ERPNext

Status: draft v1, 31 October 2026. Companion files: Screen-Inventory.xlsx (every screen, verdict and sprint), Roles-and-Access-Matrix.xlsx (roles, areas, approval limits), Development-Plan.md (whole programme).

## 1. Goal and scope
Build the screens staff actually use, role by role, before the back end is finished. Each person sees only what their role needs, with no sidebar maze or global search. The same code must be reusable for other companies by changing configuration, not code. The visual design system will be supplied later, so everything runs on a neutral wireframe theme with swappable design tokens.

Out of scope for now: ERPNext back-end configuration, data migration, payments integration (the front end runs on a mock API first).

## 2. Build versus ERPNext (93 screens)
| Verdict | Screens | Meaning |
|---|---|---|
| Use ERPNext | 8 | Admins and finance use the standard Desk (ledgers, bank reconciliation, staff records, company expenses, asset purchase and depreciation, users and roles). |
| Configure ERPNext | 35 | ERPNext already does the job; our screen is a thin wrapper or the setting is done in ERPNext. |
| Build custom | 50 | No adequate ERPNext screen (till, scan flows, rider app, cash-up, approvals inbox, loss reports, petty cash, asset counts, and others). |

Added on 31 October after review: credit sales (credit sale at the till, customer payments, statements, receivables ageing, credit limits), expenses (requests with receipt photo, approval, petty cash floats), assets (register, transfers, maintenance, disposal, tag counts), and A5 print templates. These were only mentioned in passing before and had no screens, roles or approval limits.

Detail for every screen is in the Screens tab of Screen-Inventory.xlsx. This reconciles two earlier views: trim the standard Desk for admins and finance, and build custom screens first for the staff who found ERPNext too much.

## 3. Review findings that shape the build
- **ERP consultant:** the approvals inbox, branch manager home, shift handover, rider cash remittance and a config console were missing from the first screens list and are added.
- **Operations manager:** pilot roles are Cashier, Branch manager, Warehouse officer, Stock controller, Rider and Delivery coordinator. Targets: a sale in under 6 taps and 20 seconds; approve in 2 taps; scan-to-receive a line in 2 seconds. Offline must cover sales, stock scanning, counts and rider proof of delivery. Set a per-till cap on offline sales and a mandatory sync window.
- **Senior engineer:** one React, Vite and TypeScript PWA with lazy-loaded role modules; mock API first, ERPNext adapter later; permissions drive navigation.
- **Product designer:** one role equals one workspace, one to five destinations, home is a task queue, hidden not greyed out, approvals need a deliberate action and show the amount and limit.

## 4. Architecture (recommended defaults)
- **Monorepo (pnpm and Turborepo):** `apps/web` (shell), `apps/mock-server`; packages `api-contract` (Zod schemas), `api-client`, `erp-adapter`, `permissions`, `tenant-config`, `offline`, `devices` (scan, print), `ui-headless`, `tokens`, and `modules/*` per area. Modules import packages, never each other.
- **Rep and rider apps:** installable PWA first (camera scanning, offline storage and push work on Android Chrome). Move the rider app to React Native only if background GPS or Bluetooth printing proves unreliable.
- **Mock first:** define our own domain contract (Sale, StockTransfer, CashUp) rather than raw ERPNext records. The API client has a mock adapter and an ERPNext adapter; contract tests run against both. Mock the awkward cases too: permission errors, validation errors, duplicates, latency, dropped connections.
- **Permissions:** at login, a read-only server method returns the user's roles, record permissions, workflow actions and branch and warehouse scopes. The navigation is the screen registry filtered by those capabilities. The server stays the authority; the UI only hides things. Always handle a refusal gracefully.
- **Multi-company configuration:** a `tenant.json` loaded at runtime and checked at start-up, holding brand, enabled modules, labels, record-name mappings, field mappings, workflow-state names, currency, tax, receipt template, scanner and offline limits. Rules: no record names, colours or text hard-coded outside the adapter, token files and the dictionary.
- **Design tokens:** three layers (primitive, semantic, component) in a JSON file compiled to CSS variables. The later design system replaces that file only. Headless components styled only with variables; Storybook with a theme switch to prove the swap works.
- **Forms and lists:** handwritten for the till, receiving, cash-up and delivery proof (speed, offline and scanning matter). Metadata-driven forms for the long tail only after the same pattern repeats a third time.
- **Offline:** an IndexedDB queue where every action carries a unique key so retries never double-post; ordered per record, visible pending and failed list, conflicts shown for review. Money-moving actions (approvals, payouts) are blocked offline.
- **Devices:** keyboard-wedge barcode scanners by default with camera as fallback.
- **Printing (A5 on normal printers):** documents are print templates styled for A5 (half of A4), printed through the browser's normal print path to the existing office printers. No thermal printer or ESC/POS support is needed for the MVP. Templates cover the sales invoice and receipt, customer statement, delivery note, transfer note and payout advice, and each shows the company logo, VAT, bank details and a copy label. Paper size, margins and layout live in the tenant config so another company can use A4 or a thermal roll later. Keep a reprint button, and log every reprint. To avoid the print dialog at the till, run the browser in its silent-printing mode on a computer with a default printer; test this early, because a tablet may not support it and the cashier would then confirm the print each time. Offline, the print is generated from the queued sale and marked as a copy until it syncs.
- **Shared tills:** a device is registered to a branch; cashiers sign in with a PIN, fast user switch, idle lock, full sign-out at shift close; the offline queue is tagged by user and shift and never replayed under another identity.
- **Quality:** strict TypeScript, Vitest, Testing Library, Playwright (phone, tablet, desktop, offline), accessibility checks, lint rules that ban hard-coded colours, record names and text, and CI on every pull request.

## 5. UX rules
- Navigation of one to five destinations; cashier, rider and technician get task screens with no menu.
- Seven patterns only: list, detail, form, approval inbox, scan flow, dashboard, wizard.
- Status is always icon, word and colour. Errors say what happened and what to do, and keep what was typed.
- A persistent bar shows Online, Offline or Syncing with a count.
- Touch targets 48px (56px at the till), 16px minimum text, each screen under about 150KB, lists of 25 per page.
- The till asks a manager for a discount or void as a request; the cashier never types a manager PIN.
- Approval cards show who, what, the amount and the limit; hold-to-confirm on phones; rejection needs a reason; payouts need the MD's one-time code.

## 6. MVP for the pilot branch
Roles: Cashier, Branch manager, Warehouse officer, Stock controller, Rider, Delivery coordinator. 29 screens are marked MVP in the inventory: till, credit sale at the till, A5 print templates, parked sales, shift open and close, returns, cash-up and sign-off, approvals inbox, manager home, stock request, goods and transfer receipt, blind count and write-off request, dispatch board, rider trips, proof of delivery, cash remittance, and the cash-up variance and in-transit reports. If credit sales turn out to be a small share of sales, move the credit sale at the till to Sprint 6.

## 7. Sprint plan (two weeks each, about 40 hours)
| Sprint | Dates | Goal |
|---|---|---|
| S1 | 2 to 13 Nov | Foundation: monorepo, CI, mock server, tenant config, tokens, shell, login, permission-driven navigation |
| S2 | 16 to 27 Nov | Cashier core: offline queue, scanner, till, parked sales, shift open and close, A5 invoice and receipt printing |
| S3 | 30 Nov to 11 Dec | Cash and approvals: returns, needs-manager request, credit sale at till, approvals inbox, cash-up, manager home, variance report |
| S4 | 14 to 25 Dec | Stock and delivery: receipts, blind count, write-off, dispatch board, rider app, proof of delivery |
| Buffer | 28 to 31 Dec | Handover: fixes, runbook, Storybook, test report, handover session |
| S5 | Jan 2027 | ERPNext adapter (reads) and contract tests |
| S6 | Jan to Feb | Adapter writes, pilot hardening on slow connections, customer payments and statements, expense requests and approval |
| S7 | Feb | Loss reports, quarantine, returns inspection, serial check, receivables ageing, credit limits, petty cash |
| S8 | Mar | Repairs and sales rep |
| S9 | Mar | Paystack reconciliation, payee whitelist, payout batch, VAT |
| S10 | Apr | MD dashboard, config console, design-system swap |

**Reality check.** About 8.5 weeks (roughly 170 hours) remain before 31 December, so only S1 to S4 plus a buffer fit, and S3 (9 screens), S4 (12 screens) and later S7 (12 screens) are overloaded for about 40 hours each. Cut in this order if time runs short: rider remittance polish, blind count and write-off, dispatch board, manager home extras, then reports. Never cut: offline till, cash-up, approvals inbox, tenant config, permissions, CI. Rider and dispatch can ship as a demo. S5 onward needs a continuing owner, which depends on the contractor agreement.

## 8. Definitions
**Ready:** acceptance list and mock-API contract written; roles and permissions named; offline behaviour stated; business decision resolved; fits within 10 hours.
**Done:** passes type check, unit tests, the Playwright happy path and accessibility checks; works offline if specified; 48px touch targets; under 150KB; tokens only; contract test passes; small pull request reviewed and merged; demoed on a real device.

## 9. Dependencies and risks
**Business decisions:** pilot branch; approval limits and discount rules; cash-up and return reason codes; payment methods at the till; the continuing owner after 31 December.
**Hardware (buy in week 1):** a barcode scanner, an Android tablet and a low-cost Android phone for riders. For printing, use the company's existing A4 printers; confirm one that prints A5 cleanly (set the paper size or print two to a sheet) and test silent printing on the till computer.
**Back end (needed by mid-January):** a stable API contract, the read-only capabilities method, safe-to-retry write endpoints, and a staging ERPNext with test data.
**Top risks:** capacity of about 170 hours; offline double-posting; the mock drifting from real ERPNext; A5 print layout and silent printing on tills; scanner compatibility; PWA limits on some phones; the metadata approach turning into a second ERP; data leaks on shared devices; configuration sprawl.

## 10. Working with Claude Code in the cloud
Put these rules in a `CLAUDE.md` at the repo root:
- One task per pull request, under about 300 lines; contract and tests first, then mock, then UI.
- No hard-coded colours, ERPNext record names or user-facing text outside the token files, the adapter and the dictionary.
- No secrets in the cloud environment; use the mock server only.
- Money, permission and offline code is always reviewed by a human.
- Every screen declares its roles, offline behaviour and pattern, and has an acceptance list.

Suggested first task for Sprint 1: "Set up the monorepo with pnpm and Turborepo, a Vite React TypeScript PWA shell, the Zod api-contract package, a mock server, a tenant.json loader validated at start-up, a token pipeline with two throwaway themes, strict TypeScript, lint rules and CI. Add login and a permission-driven navigation for three demo roles (Cashier, Branch manager, Warehouse officer) from fixtures generated from the roles matrix."

## Amendments after the first build (31 October 2026)

The text above is the original. Full log: `docs/PRODUCT-CHANGELOG.md`.

- **Stack as built:** pnpm workspaces and Vite + React + strict TypeScript. Turborepo was not used (plain pnpm workspaces were enough). `packages/offline` holds the IndexedDB queue; `packages/permissions` holds the roles and screen registry generated from the spreadsheets (`pnpm fixtures`).
- **Design system:** the AURA demonstrator is applied as the token set (`docs/DESIGN-SYSTEM.md`), including deliberate deviations (status colour tokens, 16px minimum text, readable accent text).
- **Offline model:** save first, then send; one idempotency key per write; replay in order per shift; never under another identity; a service worker caches the app shell so the till opens with no network.
- **Sprint 2 scope delivered** and **credit/split payments and VAT modes** added (see changelog). The sprint plan above is otherwise unchanged; Sprint 3 absorbs the manager-approval half of credit sales.
- **Documentation rule:** product changes must update the handover documents in the same change (`CLAUDE.md`).
