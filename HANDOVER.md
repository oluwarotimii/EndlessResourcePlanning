# Handover: how to take over this project

Written for an AI model (or a person) starting cold, for example DeepSeek taking over from the model that built Sprints 1 and 2. Read this file top to bottom, then `docs/PROCESS-PLAYBOOK.md`, before changing anything. It is self-contained; the other documents are linked where you need detail.

Last updated: 2026-10-31 (after the first Sprint 3 increment: the approvals engine and inbox).

---

## 1. What this project is, in five lines
- A **role-based front end on ERPNext** for a Nigerian retail company moving off the Busy accounting software. Staff see only the screens their job needs (till, stock, cash-up, approvals, delivery), not ERPNext's full interface.
- It is built **front end first against a mock API**; the ERPNext adapter comes in Sprint 5. Nothing talks to a real ERPNext yet.
- 20 roles, 24 business areas, 93 screens, of which 29 are the **MVP for one pilot branch and 6 roles**: Cashier, Branch manager, Warehouse officer, Stock controller, Rider, Delivery coordinator.
- Built in two-week sprints (S1 2 Nov to S4 25 Dec 2026 plus a buffer). **S1 and S2 are done; S3 is next.**
- The owner is **Oluwarotimii (the user)**. They work in the Claude Code cloud sessions, take the result as a **zip** and handle git themselves. **Do not commit, push or open a pull request unless they ask.** (Pushing to the new repo was also blocked by GitHub App permissions.)

## 2. Where everything is
```
CLAUDE.md                      rules for any agent working here (read first)
README.md                      how to run, what each sprint delivers
docs/HANDOVER.md               this file
docs/PROCESS-PLAYBOOK.md       the detailed how: techniques, commands, mistakes and fixes
docs/PRODUCT-CHANGELOG.md      every product change, newest first
docs/DECISIONS.md              decisions, open questions, problems in the source documents
docs/SCREEN-STATUS.md          GENERATED table of all 93 screens and their status
docs/TENANT-CONFIG.md          every tenant.json setting explained
docs/DESIGN-SYSTEM.md          how the AURA design system is applied and where we deviate
docs/PRINTING.md               A5 printing and silent printing
docs/source/                   the owner's originals: requirements, frontend plan, two spreadsheets, design demonstrator
apps/web                       the React PWA (Vite, Tailwind, strict TypeScript)
apps/mock-server               stand-in for ERPNext (plain Node http, in memory)
packages/api-contract          Zod schemas and shared pure rules (computeTotals, cashOf, creditOf)
packages/tenant-config         tenant.json, its schema and loader
packages/tokens                design tokens: theme JSON -> CSS variables
packages/permissions           roles, areas, screens (generated JSON) and navigation building
packages/offline               IndexedDB queue and key-value store
e2e/till-offline.cjs           real-browser offline test (Playwright)
scripts/                       check-tokens.mjs, check-docs.mjs
tools/gen-fixtures.py          regenerates the roles/screens JSON from the spreadsheets
```
The five documents that matter most for the product are in `docs/source/`: **Product-Requirements.md** (what and why), **Frontend-Plan.md** (architecture, UX rules, sprints, working rules), **Screen-Inventory.xlsx** (93 screens), **Roles-and-Access-Matrix.xlsx** (roles, approval limits, data scope), and the **AURA design demonstrator**. Both markdown files have an "Amendments" section at the bottom recording what changed after the build started.

## 3. Verify the current state in three commands
```bash
corepack enable && pnpm install
pnpm check            # token guard, docs guard, typecheck, tests (100), production build
pnpm dev              # mock server :4010 + web app http://localhost:5173
```
Demo PINs: Cashier 1111, Branch manager 2222, Warehouse 3333, Stock controller 4444, Rider 5555, Delivery coordinator 6666.
Real-browser test (needs Chromium; see README): build, start the mock server and `pnpm --filter @erp/web preview`, then `node e2e/till-offline.cjs`. It must print `E2E PASSED`.
If `pnpm check` is not green on arrival, stop and fix that first; do not build on a red base.

## 4. Architecture you must understand
**Data flow of a sale (the heart of the app).** The cashier pays -> the sale is written to IndexedDB **and** queued with a unique idempotency key (the key is the queue item id) -> the receipt prints from local data -> the queue sends it when reachable -> the server answers `ok` or `duplicate`, both mean "delete it from the queue". A failure is classified: network = keep and retry; auth = keep until the same user signs in; permanent (validation, forbidden) = mark failed and show it in the sync tray, never silently drop. Items replay in order per record (a shift), and **only under the user who created them**. See `packages/offline/src/queue.ts` and `apps/web/src/state/sync.tsx`.

**One contract.** `packages/api-contract` is our own domain contract (Sale, Shift, Customer, Capabilities, Task...). Screens use the `ApiClient` interface (`apps/web/src/api/client.ts`). The mock implements it today; the ERPNext adapter must implement the same interface. Pure shared rules live here too: `computeTotals` (VAT), `cashOf`, `creditOf`. The server (mock now, ERPNext later) is the authority and recomputes totals.

**Permissions.** `capabilities` returned at sign-in = roles + area permission letters (V view, C create, E edit, A approve) + scope. Navigation is the screen registry filtered by those capabilities (`packages/permissions`). **Hidden, never greyed out.** Direct URLs to forbidden screens show a refusal. The UI only hides; the server must enforce.

**Approvals (Sprint 3, first increment).** `GET /api/approvals` lists requests the user may decide (or raised). `POST /api/approvals/:id/decision` is the only way to decide one. Every decision carries an idempotency key; a rejection needs a reason; the creator is refused; the approver needs the `A` letter on the area mapped in `packages/permissions` (`approvalArea`); approvals are online-only. The inbox (`apps/web/src/screens/ApprovalsPage.tsx`) shows who/what/amount/limit/customer, hides the controls when the role is not allowed, and uses `HoldToConfirm` so a short tap cannot approve. Requests are seeded in the mock until S05 and CR01 raise them.

**Configuration.** Everything company-specific is in `packages/tenant-config/tenant.json` (brand, VAT mode, payment methods, offline limits, printing, themes). Validated at start-up. See `docs/TENANT-CONFIG.md`.

**Design tokens.** `packages/tokens/src/themes/*.json` (primitive -> semantic -> component) compile to CSS variables; Tailwind maps to them (`apps/web/tailwind.config.ts`). A second neutral theme proves the swap. `scripts/check-tokens.mjs` fails the build on any hard-coded colour or text under 16px.

**Offline shell.** `apps/web/public/sw.js` precaches every built file (from `asset-manifest.json`) so the till opens with no network. Data offline lives in IndexedDB. Sign-in itself needs a connection (open question).

**Printing.** `window.print()` of an A5 document rendered into a portal; paper size from config; always printed in light theme; unsynced sales carry a COPY label; reprints are logged. See `docs/PRINTING.md`.

**Screens.** `apps/web/src/screens/registry.ts` maps a registry ID (for example `S01`) to a lazy page. Anything not in that map renders a placeholder showing the planned pattern, device, offline need and sprint. After building one, run `pnpm docs:status`.

## 5. Hard rules (do not break these; they come from the requirements)
1. **Tokens only.** No hex, rgb, Tailwind palette colours or inline colour styles. Use `bg-primary`, `text-text-muted`, `bg-success-subtle text-success-ink`, and so on.
2. **No user-facing text in components.** Add it to `apps/web/src/i18n/en.ts` and call `t("key")`. The dictionary is typed, so the compiler lists any missing key.
3. **Touch targets 48px (56px at the till), text at least 16px, status = icon + word + colour,** money and counts use `tabular`. Buttons use `btn-spring`. Overlays use blur (`scrim` / `glass-panel`).
4. **Money is whole naira, never a float.** VAT only through `computeTotals`.
5. **Every money, stock or approval write carries an idempotency key** and is safe to retry. Approvals and payouts are **blocked offline**.
6. **The creator of a record never approves it.** Cost prices are hidden from most roles. Data is scoped by branch/warehouse.
7. **Roles, approval limits and the screen list come from the spreadsheets** (`pnpm fixtures`), never a second hand-kept copy.
8. **Handwritten core screens** (till, receiving, cash-up, delivery proof). No generic form engine until a pattern repeats three times.
9. **Documentation is part of the change** (section 8).

## 6. How the previous model worked (follow this process)
**The full step-by-step playbook, with the actual commands, the real-browser test procedure and a table of mistakes made, is in `docs/PROCESS-PLAYBOOK.md`. Read it after this section.** The summary:

**Before building**
1. Read every source document. Then tell the user, in plain words, *what you understand and what you do not* before writing code. When the user's request conflicts with a document, or the stack is ambiguous, say so and choose the documented option unless told otherwise. (Early in this project a guess about the product was wrong because the documents had not been read; do not repeat that.)
2. Find inconsistencies in the sources and **report them, do not silently fix them** (see `docs/DECISIONS.md`, "Problems found in the source documents").

**While building, in this order for each feature**
1. **Contract and pure logic first**, with unit tests (for example `computeTotals`, the queue, limits).
2. **Mock server** behaviour, including the awkward cases (wrong PIN, outage, duplicate key, over limit), with contract tests.
3. **UI**, with the typed dictionary and tokens.
4. **Component tests** in jsdom for the flows (scan, pay, offline, retry, split payment, credit refusal).
5. **Gates:** `pnpm check:tokens`, `pnpm check:docs`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
6. **A real browser run** (`e2e/till-offline.cjs`, screenshots, the PDF). This caught bugs the jsdom tests could not: tiny buttons from a CSS class conflict, pay buttons below the fold, top-level `await` failing the production build, and a stale server.
7. **Documentation** (section 8), then **package**: zip without `node_modules`, `.git` and `dist`, unzip into a clean folder, `pnpm install --frozen-lockfile`, `pnpm check`. Only then hand it over.

**When something fails**
- Decide whether it is an **app bug or a test bug** and show the evidence before changing anything. Several failures here were test mistakes (React batching two events into one, a selector matching two elements, asserting before a deliberate 50 ms delay). Fix the test honestly; never weaken an assertion just to make it pass.
- When the application is wrong, fix the application and add a test that would have caught it.

**How to report to the user**
- Short and plain. Lead with what now works and how it was verified. Then: what is **not** done, decisions they must confirm, problems in their documents, and the next step. Never claim something is verified when it was not; say "not tested on real hardware" when that is the case.
- Send visible evidence (screenshots, the printed PDF) and the zip.

## 7. Pitfalls already hit in this environment
- **Never use `pkill -f <word>` in the same shell command line that contains that word**; it kills your own shell. Track PIDs and `kill <pid>`.
- **A stale mock server on port 4010** returned `403 unknown endpoint` for new routes and looked like an app bug. Before an e2e run, make sure only the current server is running (`ss -ltnp | grep 4010`).
- **No top-level `await`** in `apps/web/src/main.tsx` (build target rejects it); start-up is an async function.
- **Vite does not serve dot-folders in preview**, so the build manifest is named `asset-manifest.json` (not `.vite/manifest.json`); the service worker reads it.
- **Playwright selectors:** `getByLabel("Cash")` matches substrings; use `{ exact: true }`. The `.print-area` is hidden on screen by design: wait for `state: "attached"`, then set print media and use `page.pdf`.
- **jsdom:** `window.print` does not exist; tests stub it. React batches two events fired in one `act`; dispatch `offline` and `online` in separate `act` calls.
- **Tailwind class conflicts:** a custom `px-0` loses to a component's built-in `px-5`. Use the `icon` prop on `Button`.
- **Global Playwright:** run with `NODE_PATH=$(npm root -g) node e2e/till-offline.cjs`; do not install another Playwright version (it will not find the browser).
- **The mock server is in memory** and accumulates sales across runs; compare before and after counts in tests, do not assert absolute totals.
- **Some harnesses require reading a file before overwriting it**; read first.
- **Hold-to-confirm** holds for 700 ms. Its tests use real timers (an 800 ms `act`) because fake timers fight `waitFor`; also assert that a short pointer-down/up does not approve.

## 8. Documentation rule (you must do this with every product change)
A change to behaviour, a setting, a rule or a decision is not done until these are updated **in the same change**:
- [ ] `docs/PRODUCT-CHANGELOG.md`: new entry at the top (what changed, documents updated, what is open)
- [ ] `docs/DECISIONS.md`: edit the decision or open question
- [ ] `docs/TENANT-CONFIG.md`: a row for every new `tenant.json` setting (enforced by `pnpm check:docs`)
- [ ] `docs/SCREEN-STATUS.md`: run `pnpm docs:status` (enforced by `pnpm check:docs`); add a note in `docs/screen-status-notes.json` for a partly built screen
- [ ] `README.md` and `docs/PRINTING.md` if what they describe changed
- [ ] `docs/source/Product-Requirements.md` / `Frontend-Plan.md`: append to their Amendments section when the requirement or plan changed (never rewrite the original text)
- [ ] The reply to the user says what was documented and lists anything recorded as an open question

## 9. What is done and what is next

**Done**
- **Sprint 1:** foundation, tokens, tenant config, login with PIN, permission-driven navigation, offline bar, role home, CI.
- **Sprint 2:** offline queue, till, parked sales, shift open/close, customer lookup, sync tray, A5 printing, service worker, real-browser test.
- **Sprint 2.1:** configurable VAT mode, configurable payment methods including credit and other, split and part-credit payments, credit limit checks, cash-up on cash payments only, customer cache for offline credit sales.
- **Sprint 3, first increment:** approvals contract, permission mapping, mock endpoints, seeded requests, and the A01 inbox (hold-to-confirm, rejection reason, creator rule, offline block).
Status of every screen: `docs/SCREEN-STATUS.md` (currently 7 of the 29 MVP screens built, 3 partly built).

**Now: rest of Sprint 3, "Cash and approvals"** (30 Nov to 11 Dec per the plan; do it next regardless of dates)
Screens from `Screen-Inventory.xlsx`: T01 customer return (receipt lookup, wizard), S05 needs-manager request (discount or void, a dialog, not a PIN), ~~A01 approvals inbox~~ (done), **A02 branch manager home**, Q01 cash-up count (wizard), Q02 cash-up sign-off (approval), G01 loss report (cash-up variance by branch and cashier), H02 branch stock request, and the **manager-approval half of CR01** (over-credit-limit).
Suggested order and notes:
1. **S05 and CR01 next.** The cashier raises a discount/void request (S05) and an over-limit credit request (CR01); both land in the A01 inbox and the cashier sees the result. The mock decides the over-limit sale only after an approval exists, so add `createApproval` to the contract and client, then wire the till.
2. Returns (needs receipt lookup from local and server sales), then cash-up count and sign-off, then manager home and the variance report.
3. **Fix the cash-up approval mismatch** (`docs/DECISIONS.md`, problem 1) with the user before building sign-off, because the matrix and the journey disagree about who may approve.
4. Ask the user for the **cash-up variance and return reason codes** (requirements, open question 6); do not invent them.
Acceptance targets from the requirements: approval by a manager in 2 taps; cash-up sign-off about 1 minute; each screen under about 150 KB (the till chunk is about 5.4 KB gzipped plus about 117 KB shared).

**Later sprints** (see `Frontend-Plan.md` section 7): S4 stock and delivery; S5 the ERPNext adapter (needs a pinned ERPNext version, a staging site, a read-only capabilities method, safe-to-retry write endpoints, and a PIN sign-in method); S6 to S10 as planned. Camera barcode scanning, real payment confirmation (Paystack) and per-item VAT exemption are not built.

## 10. What you must not do
- Do not commit, push or open pull requests unless the user asks. Deliver a zip.
- Do not invent ERPNext facts (doctype fields, endpoints, versions). Ask, or write the question into `docs/DECISIONS.md`.
- Do not invent business values (limits, VAT, reason codes, printers). Use placeholders clearly marked as such and list them as open questions.
- Do not change the owner's original text in `docs/source/`; append amendments.
- Do not bypass the guards (token check, docs check, tests) to get green.
- Do not add hard-coded colours, text, or record names, even "temporarily".
- Do not store secrets in the repo; the mock server is the only back end in the cloud environment.

## 11. A ready message to start the next session
> You are taking over a role-based retail front end on ERPNext (React/Vite/TypeScript monorepo, mock API). Read `CLAUDE.md` and `docs/HANDOVER.md`, then `docs/PRODUCT-CHANGELOG.md`, `docs/DECISIONS.md` and `docs/SCREEN-STATUS.md`. Run `pnpm install && pnpm check` and confirm it is green. Also read `docs/PROCESS-PLAYBOOK.md`. Then tell me what you understand and what you do not, and propose how to do Sprint 3 (starting with the approvals engine). Follow the process in section 6, update the documents as in section 8, do not commit or push, and deliver a zip when done.
