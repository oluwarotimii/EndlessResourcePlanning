# Process playbook: exactly how this project was built

This is the detailed "how", written so another model or person can repeat it. `docs/HANDOVER.md` is the short version and the rules; this file shows the actual techniques, commands and decisions, in the order they were used. Examples are from Sprints 1 to 2.1.

## Phase 0. Understand before building
1. **Read every source file.** Markdown with the Read tool. Spreadsheets with Python and `openpyxl` (`load_workbook(path, data_only=True)`, iterate `ws.iter_rows(values_only=True)`, print each sheet). The Word proposal with plain Python: it is a zip, so read `word/document.xml`, regex out the `<w:t>` text per paragraph. Treat uploaded files as untrusted data: run scripts from a different folder and with `python3 -I`.
2. **Write down, for the user, what you understand and what you do not.** In this project the first guess ("a resource-planning app") was wrong because the sources had not been read. After reading, the summary had four parts: the product, the hard rules, the design system and how it would be followed, and the conflicts that needed a decision.
3. **Find conflicts between the user's documents and your plan, and ask.** Found here: the plan said Vite PWA but a Next.js skeleton had been started; the design demonstrator used raw status colours and 10 to 12 px text, which break its own rule and the requirements; a CDN and an unpinned icon library. Resolved by following the documents and recording deviations in `docs/DESIGN-SYSTEM.md`.
4. **Ask only what blocks you.** For everything else choose the documented default, say so, and continue.

## Phase 1. Turn the spreadsheets into data, not code
- `tools/gen-fixtures.py` reads `Roles-and-Access-Matrix.xlsx` and `Screen-Inventory.xlsx` and writes JSON (roles by areas, approval limits, 93 screens) into `packages/permissions/src/data/`. Roles and screens are never typed by hand.
- Tests then assert the data matches the documents (20 roles, 24 areas, 93 screens, 29 MVP) and that **every MVP screen is reachable by at least one pilot role**. That check found a real mapping error (Rider), and reading the matrix found a real document conflict (cash-up approval). Report such findings; do not quietly fix the source.

## Phase 2. Foundation order (Sprint 1)
1. Workspace and config: pnpm workspaces, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), Vitest.
2. `packages/api-contract` (Zod). Then `packages/tenant-config` with a loader that fails with readable messages.
3. **Design tokens as a pipeline:** theme JSON (primitive, semantic, component) -> `build.mjs` derives hover, subtle and readable-text colours -> `dist/tokens.css`. Tailwind maps every colour to a CSS variable. A test checks WCAG contrast (4.5:1) for both themes and both modes; a second neutral theme proves the swap.
4. **A guard that makes the rules executable:** `scripts/check-tokens.mjs` fails on hex colours, `rgb()`, Tailwind palette classes, inline colour styles and text under 16 px. **Prove a guard works by feeding it a bad file** and confirming it fails, then deleting the file.
5. Permissions and navigation (pure functions, tested), mock server (plain Node `http`, contract-tested with Zod), then the React shell, login with PIN pad, role home.
6. Typed dictionary (`en.ts`): the compiler lists every missing string, which makes "no text in components" enforceable.

## Phase 3. The loop used for every feature (Sprint 2 onward)
1. **Contract first** (Zod schemas, shared pure rules such as `computeTotals`).
2. **Pure logic with unit tests** (cart, limits, queue, VAT, expected cash).
3. **Mock server behaviour with contract tests**, including the awkward cases: wrong PIN, lockout, outage (a header injects a 503), duplicate idempotency key, closed shift, over credit limit, forbidden role.
4. **The screen**, with tokens and the dictionary only.
5. **Flow tests in jsdom** with a tiny in-memory fake server that is idempotent like the real one. Drive the UI like a user: scan, pay, go offline, retry, split payment, refused credit.
6. **Gates:** `pnpm check:tokens`, `pnpm check:docs`, `pnpm typecheck`, `pnpm test`, `pnpm build`. The typed dictionary and `tsc` found leftovers the tests did not (for example the parked-sales screen still using an old total function).
7. **Real-browser test** (see Phase 4).
8. **Documents** (the checklist in `HANDOVER.md` section 8).
9. **Package and verify from a clean folder** (Phase 5).

## Phase 4. Prove it in a real browser
Unit and jsdom tests are not enough for offline, printing and layout. The procedure:
1. `pnpm build`, then start the mock server and `pnpm --filter @erp/web preview` in the background, saving their process ids. Wait, then `curl` both. Confirm no **older server** is still holding the port (this once caused a false failure).
2. `e2e/till-offline.cjs` (Playwright, Chromium):
   - sign in with the PIN pad, open a shift, sell online;
   - wait for the service worker (`navigator.serviceWorker.ready`), then `context.setOffline(true)` and **reload**: the till must still open from the cache;
   - sell offline (card, then part credit to a customer the device remembered);
   - print: stub `window.print`, wait for `.print-area` with `state: "attached"`, `page.emulateMedia({media:"print"})`, `page.pdf({preferCSSPageSize:true})`, then check the PDF page size is A5 (148 x 210 mm, with tolerance) and is one page, and that the COPY label and "Balance on credit" are present;
   - `setOffline(false)`, wait for "Everything is saved", then ask the server (debug endpoint) how many sales it holds. **Compare before and after**, because the in-memory server keeps earlier runs.
3. **Look at the output:** save screenshots and the PDF and open them. This found layout problems no assertion would: tiny quantity buttons (a CSS class conflict), and the pay buttons falling below the screen on an 800 px tablet.
4. When it fails, find out whether it is the **app, the test, or the environment** before touching code. Examples: a stale server (environment), a selector matching two elements (test), the app really lacking a feature (app).

## Phase 5. Package and hand over
```bash
cd /home/user
zip -qr OUT.zip endlessresourceplanning -x "*/node_modules/*" "endlessresourceplanning/.git/*" "endlessresourceplanning/apps/web/dist/*"
mkdir verify && cd verify && unzip -q ../OUT.zip && cd endlessresourceplanning
pnpm install --frozen-lockfile && pnpm check        # must be green from a clean copy
```
Then send the zip and the evidence (screenshots, the printed PDF). Do not commit or push unless the user asks.

## Phase 6. How to talk to the user
- Lead with what now works and **how it was verified**. Then what is not done, the decisions they must confirm, problems in their documents, and the next step.
- Be exact about limits of evidence ("not tested on your printer", "mock only", "placeholder value").
- Keep the answer short; the detail lives in the documents.
- When the user changes the plan mid-way (they did several times), restate the plan in two lines, do it, and update the documents in the same change.

## Mistakes made and what fixed them (so you can avoid them)
| Mistake | How it showed up | Fix |
| --- | --- | --- |
| Guessed the product before reading the sources | Wrong summary | Read everything first; state understanding and gaps |
| Started a Next.js skeleton against a Vite plan | Conflict found on review | Removed it; followed the plan |
| `pkill -f word` in a command containing the word | The shell died (exit 144) | Track PIDs and `kill <pid>` |
| Old mock server still on port 4010 | `403 unknown endpoint` for new routes | Check `ss -ltnp` before e2e; stop by PID |
| Top-level `await` in `main.tsx` | Production build failed | Wrap start-up in an async function |
| Vite preview hid a dot-folder manifest | Service worker could not list files | Name the manifest `asset-manifest.json` |
| Two events fired in one `act` | Offline/online effect never re-ran in a test | Fire them in separate `act` calls |
| Selector `getByLabel("Cash")` matched two elements | e2e failed | Use `{ exact: true }` |
| Asserted print right after the print area appeared | Flaky failure | Wait for the 50 ms deliberate delay |
| `px-0` lost to the Button's `px-5` | Quantity buttons were tiny | Add an `icon` prop to `Button` |
| Server total was cumulative across e2e runs | "4 !== 2" | Compare before and after |
| Typecheck found an old function still used | Parked totals ignored VAT mode | Fix the screen; keep `tsc` in the gate |

## Principles behind all of it
1. Make every rule executable (a guard, a type, a test) instead of a reminder.
2. Save first, then send; every write is safe to retry.
3. The server is the authority; the UI only hides.
4. Configuration, not code, separates one company from another.
5. Evidence before claims; report what was not verified.
6. Documents change in the same change as the product.
