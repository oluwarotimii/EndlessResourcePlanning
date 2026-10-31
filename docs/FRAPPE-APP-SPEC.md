# Frappe custom app: what has to be built on the back end

This is the checklist for the custom Frappe app that sits on ERPNext and serves this front end. Today every endpoint below is a **mock** (`apps/mock-server`). In Sprint 5 each one is replaced by a real ERPNext method behind the same contract (`packages/api-contract`), so no screen changes.

`docs/ERPNEXT-MAPPING.md` says how each concept lives in ERPNext and holds the open questions. **This file is the build list.** `pnpm check:docs` fails if an API path used by the mock is missing from section 6.

## How to read the status words
- **Owner**: named in the owner's documents (the "What ERPNext offers" column of `Screen-Inventory.xlsx`, `Product-Requirements.md`, `Frontend-Plan.md`, the roles matrix notes).
- **Proposal**: my suggestion from general knowledge of Frappe. **It is not verified. Confirm each one on the staging site before building.** Never treat a Proposal as fact.
- The mock is the working specification of behaviour: every rule below is already tested there, and the same tests must pass against ERPNext (contract tests on both adapters).

## 1. Shape of the app
- **One custom app** installed on the owner's ERPNext site. Name is a placeholder: `retail_workspace`.
- **No change to ERPNext core source** (out of scope in the requirements). Everything is custom doctypes, custom fields, workflows, whitelisted methods, reports and print formats added by the app, packaged as fixtures so a second company can install the same app.
- The front end never talks to ERPNext screens. Staff do not use the Desk; admins and finance do.

## 2. Rules the back end must enforce (the front end only hides)
1. **The server is the authority.** Recompute totals, VAT, refunds, expected cash, credit room and limits; reject a mismatch.
2. **Every write is safe to retry.** Each carries an idempotency key; a repeat returns the first result and changes nothing (section 7).
3. **Roles and approvals are workflow steps**, not permissions. The requester never decides; one person never decides two steps; a rejection needs a reason and ends the chain; amount limits apply per approver (section 5).
4. **Cost prices are never sent to the front end.** A loss is valued at cost on the server and the value is shown only to the people who rule on it.
5. **Data is scoped by branch and warehouse** (User Permissions on Company, Branch, Warehouse, Cost Center). A rider sees only their own deliveries.
6. **Queued items replay only under the user who created them.** A replay with another identity is refused.
7. **Money is whole naira** on the contract. ERPNext keeps its own precision; the adapter rounds half up the same way as `computeTotals`.
8. **Audit trail:** who, when and why for every approval, ruling, reprint and adjustment.

## 3. Custom DocTypes to build
| DocType (proposed name) | Purpose | Key fields | Status |
| --- | --- | --- | --- |
| **Cash-up** (shown to users as **Closing Balance**) | The count at shift close and its approval | shift (POS Opening Entry), counted by notes (child table: denomination, count), counted total, expected total, difference, difference reason, approval state | Owner (named in the plan) |
| **Approval Request** | Discount, void, credit over limit, refund and other exceptions that have no ERPNext equivalent | kind, amount, unit, limit, requester, customer, sale reference, note, workflow state, decided by and reason | Owner (inventory: "None") + Proposal for the shape |
| **Shortage Case** | A transfer received short and the ruling on who bears the loss | transfer (Stock Entry), missing lines, value at cost (permission-level protected), bearer (branch, warehouse, transit), resulting Stock Entry | Proposal |
| **Stock Count** with child **Stock Count Line** | Blind physical count, recount, differences | location (warehouse), round, counted by, recounted by, lines: item, counted, expected, difference, needs recount; status | Owner ("Build custom", Stock Reconciliation is not blind) + Proposal |
| **Stock Write-off Request** | Approval before a count's differences adjust stock | stock count, lines, value at cost (protected), workflow state, resulting Stock Reconciliation | Proposal |
| **Proof of Delivery** | Delivered or failed, who received, reason, photo, cash collected | delivery note or order, rider, outcome, recipient, failed reason, photo, cash collected, time | Owner (named in the plan) |
| **Cash Remittance** | A rider handing in cash collected on delivery, confirmed by a manager | rider, delivery proofs, total, workflow state | Owner (inventory: "None") + Proposal |
| **Client Request** | Idempotency store: one row per key with the result | key, user, method, result reference, created | Proposal (section 7) |
| **Print Log** | Reprints are allowed but logged | document, number, reprint flag, user, time | Proposal |
| **Retail Workspace Settings** (Single) | The company settings the front end reads (`tenant.json` fields, section 9) | see section 9 | Proposal |

## 4. Custom fields on standard DocTypes
| DocType | Fields to add | Why | Status |
| --- | --- | --- | --- |
| POS Invoice / Sales Invoice | client key, VAT mode, discount approval, credit approval, customer on credit | Idempotent sale, VAT handled per company, single-use approvals | Proposal |
| POS Invoice payments | several payment rows including a credit row | Split and part-credit payments | Proposal (verify one sale can carry several modes) |
| POS Closing Entry | link to Cash-up | Closing balance count and approval | Owner (partial) |
| Sales Invoice (return) | refund approval, reason | A refund is an approved exception | Owner (Sales Return) + Proposal |
| Material Request | client key, requester branch | Branch stock request | Owner |
| Stock Entry (Material Transfer) | client key, shortage, receive note, received by, counted quantities | Dispatch and receive with a flagged shortage; the inventory says the standard entry has "no signature" | Owner + Proposal |
| Item | family, variant label | Variants share a family so a mix-up can be spotted; may use ERPNext Item Variant (template + attributes) instead | Proposal |
| Delivery Note / Sales Order | rider, payment mode, amount to collect | Delivery assignment and cash on delivery | Owner (Delivery Note, Delivery Trip) + Proposal |
| User / Employee | PIN hash, device registration | PIN sign-in on shared tills | Proposal |

## 5. Workflows to configure
Each is an ordered chain of states; the roles per step come from the owner's **approval routing** setting (`packages/permissions/src/data/approval-routing.json`), so a change there must be reflected in the Workflow. Limits come from the approval-limits sheet.

| Approval kind | Document | Default route (placeholders to confirm) | Special rules |
| --- | --- | --- | --- |
| `discount` | Approval Request | Matrix Approve letter on Stores (POS) | Limit per role (cashier 0%, manager 3%, above: MD); applied once before VAT |
| `void` | Approval Request | Matrix Approve letter on Returns | Per-item limit |
| `credit_over_limit` | Approval Request | Matrix Approve letter on Credit sales | Tied to one customer and amount; used once |
| `cash_up` | Cash-up | Branch manager or Cash controller | Requester (cashier) never approves; no naira cap |
| `refund` | Approval Request | Step 1 Branch manager or MD; step 2 Cash controller or MD | Per-item limit; tied to the sale and exact lines; used once |
| `shortage` | Shortage Case | Auditor or MD | The ruler must choose who bears the loss; the receiver cannot rule; stock write-off limit (MD above ₦100,000 at cost) |
| `write_off` | Stock Write-off Request | Step 1 Branch manager or MD; step 2 Auditor or MD | Stock changes only when the last step approves; stock write-off limit |
| `cash_remittance` | Cash Remittance | Branch manager or Cash controller | The rider cannot confirm their own cash |

**Open (verify on staging):** whether Frappe's workflow can enforce "one person never decides two steps" and "the requester never decides" out of the box; if not, enforce in the whitelisted decision method.

## 6. Whitelisted API methods (replace the mock, one for one)
Method names are proposals; the paths and rules are the contract the mock already implements and tests. Every write takes an idempotency key (section 7). `Status` is Proposal throughout unless stated.

| Mock path | Proposed method | What it must do |
| --- | --- | --- |
| `/api/users` | `get_device_users` | Staff registered to this device (id, name, role). |
| `/api/login` | `pin_login` | Check the PIN, lock after repeated failures, return a token and the capabilities. |
| `/api/logout` | `logout` | End the session. |
| `/api/capabilities` | `get_capabilities` | Read-only: roles, area permission letters (V, C, E, A), branch and warehouse scope. Owner (plan: "read-only capabilities method"). |
| `/api/tasks` | `get_tasks` | The role home task queue (workflow actions, pending items). |
| `/api/products` | `get_products` | Items for the till and counts: name, SKU, barcode, price, shelf stock, family and variant. **No cost.** |
| `/api/customers` | `search_customers` | Name, phone, credit limit, balance. |
| `/api/shift/current` | `get_open_shift` | The cashier's open shift, if any. |
| `/api/shifts/open` | `open_shift` | Create a POS Opening Entry with the opening balance. |
| `/api/shifts/close` | `close_shift` | Close with the counted notes; recompute expected cash (opening balance + cash payments − cash refunds); require a reason when it differs; raise the Cash-up approval. |
| `/api/sales` | `create_sale` | Create the POS Invoice; recompute totals, VAT and discount; payments must add up; credit needs a customer with room (or an approval); decrement stock. |
| `/api/sales/lookup` | `lookup_sale` | Find a sale by invoice number with what is already returned. |
| `/api/returns` | `create_return` | Needs an approved refund tied to the sale and lines; refund by share of what was paid; reduce the customer's balance first for the credit share; lower expected cash for cash refunds. |
| `/api/print-log` | `log_print` | Record a reprint. |
| `/api/approvals` | `list_approvals` / `create_approval` | List what the user may see (cost hidden unless they rule on it); raise a request (the server recomputes amounts). |
| `/api/approvals/:id/decision` | `decide_approval` | Approve or reject; enforce the chain, requester, one-person-one-step, limits, reason, outcome (shortage), and the effects (adjust stock, charge a loss, confirm cash). |
| `/api/summary` | `get_branch_summary` | Sales, cash vs credit, refunds, open shifts, what is waiting for this user, shortages charged. |
| `/api/reports/cashup-variance` | `report_closing_balance_differences` | Differences by cashier, worst first. |
| `/api/reports/in-transit` | `report_in_transit` | Transfers on the road longer than the setting. |
| `/api/stock-requests` | `list_stock_requests` / `create_stock_request` | Material Requests from a branch. |
| `/api/transfers` | `list_transfers` / `dispatch_transfer` | Stock Entry (Material Transfer) with Add to Transit; the dispatcher cannot be the requester; cannot send more than asked or held. Owner + Seen. |
| `/api/transfers/:id/receive` | `receive_transfer` | Receiving Stock Entry from the in-transit entry; counted quantities; flag a shortage and open a ruling; the receiver cannot be the dispatcher; cannot receive more than sent. Seen (flow), Proposal (shortage). |
| `/api/stock` | `get_stock_levels` | Shelf and warehouse quantities from Bin. |
| `/api/count-sheet` | `get_count_sheet` | Items to count **without quantities** (blind). |
| `/api/counts` | `list_counts` / `submit_count` | Round 1 and the recount; the recount by a different person (setting); expected quantity hidden until final. |
| `/api/counts/:id/write-off` | `request_write_off` | Raise the write-off approval for a final count with differences; hide the cost from the counter. |
| `/api/delivery/orders` | `list_deliveries` | A rider sees only their own; others see all. |
| `/api/delivery/riders` | `list_riders` | Riders available to assign. |
| `/api/delivery/orders/:id/assign` | `assign_delivery` | Assign or reassign a pending or failed order to a rider. |
| `/api/delivery/proof` | `record_proof_of_delivery` | Only the assigned rider; cash on delivery needs the full amount; prepaid takes no cash; a failure needs a reason. |
| `/api/delivery/remit` | `remit_cash` | Raise the Cash Remittance approval for delivered cash-on-delivery orders that are the rider's own and not already handed in. |
| `/api/delivery/outstanding` | `report_cod_outstanding` | Cash collected and not handed in, by rider, with overdue by the setting. |
| `/api/_debug/state` | none | Mock only: never built. |

## 7. Idempotency (how every write is made safe to retry)
- The device generates a unique key per business event and sends it with the write. If the connection drops after the server saved it, the retry sends the same key.
- **Proposal:** a unique `client_key` custom field on each document type, or the **Client Request** doctype, and one wrapper that looks the key up first and returns the original result with `duplicate: true`.
- Keys are also used by the offline queue: replay is in order per record (for example per shift) and only under the original user.
- **Verify on staging:** the cleanest way to do this without breaking standard ERPNext behaviour.

## 8. Roles, permissions and sign-in
- **Roles:** the 20 roles in the matrix, created as ERPNext Roles. The front end reads them at sign-in and never keeps its own list.
- **Permissions:** Role Permission rules per doctype from the matrix letters; **User Permissions** to scope by Company, Branch, Warehouse and Cost Center (the matrix "Data scope" sheet).
- **Field-level protection** (permission levels) on valuation rate, value at cost and any cost fields. Proposal.
- **PIN sign-in** on shared tills: a PIN per user, device registered to a branch, lockout after repeated failures, idle lock handled by the front end, short-lived token. ERPNext has no PIN login, so this is custom. Proposal.
- **Admin cannot grant themselves access**; the MD holds a break-glass admin account (requirements).

## 9. The settings the front end reads (Single doctype)
Everything in `packages/tenant-config/tenant.json` (see `docs/TENANT-CONFIG.md`) must be readable from ERPNext so a second company is set up without code: brand, theme, locale, currency, branch, task roles, enabled scopes, print paper and company details, **VAT mode and rate**, **payment methods**, split payments, **variant scan rule**, closing balance note values and difference reasons, return reasons, delivery failed reasons and cash hand-in time, stock alert and ruling times, recount rule, offline limits, idle lock, touch sizes. Reason lists are placeholders until the business supplies them.

## 10. Reports and print formats
- **Script Reports:** closing balance differences by cashier, transfers in transit too long, delivery cash outstanding, branch summary, shortages and write-offs by branch, mix-ups by cashier (planned).
- **Print Formats (A5):** sales invoice, receipt (with COPY label), customer statement, delivery note, transfer note, payout advice. Paper size comes from the settings.

## 11. Background jobs and notifications (Proposal)
- Mark overdue: transfers in transit, shortage rulings waiting, delivery cash not handed in. (The mock computes these on read; the real system may also notify.)
- Notify approvers when something is waiting; notify the manager when delivery cash is overdue.

## 12. Later (not needed for the pilot)
Paystack reconciliation and payee whitelist, payout batch and GAPS export, VAT returns, repair jobs, referrals and loyalty, asset register and counts, audit findings, customer app and online orders feed, **migration from Busy**.

### Added from the owner's answers (Proposal, not built)
- **Return rule** doctype (company default, category, item; days for change of mind and for faulty; most specific wins). The `create_approval` method for kind `refund` must refuse a request outside the window (the mock already does, see `returnDaysFor` in the contract).
- **Return inspection**: faulty returns land in a quarantine warehouse; a Stock Entry moves them to the shelf or to an RMA warehouse; the inspector is a permission, not a fixed role.
- **Credit partner** (a Customer group or a Customer flagged as partner) and a custom field **Bill to** on Sales Invoice; item-level allowed party list.
- **Credit approval workflow** per account: approver and limit on the Customer or partner; the Credit control officer role holds the permission.

## 13. Testing the back end
- The **contract tests** in the front-end repo must pass against both the mock adapter and the ERPNext adapter.
- Seed the staging site with the same demo data (products, customers, users with PINs, orders).
- Test the awkward cases the mock already covers: wrong PIN and lockout, duplicate key, closed shift, over credit limit, over refund limit, the same person trying two steps, a shortage, a recount by the same person, a rider delivering someone else's order, a cash short-pay.

## 14. Suggested build order (Sprint 5 onward)
1. **Read side first:** `get_capabilities`, products, customers, stock levels, lists. Same screens show real data.
2. **Writes with idempotency:** shifts, sales, returns, print log. Then the offline queue replays against ERPNext.
3. **Approvals engine as Workflows:** Approval Request and the rest of section 5, then the effects of each decision.
4. **Stock:** requests, transfers with Add to Transit, receiving, shortage cases, counts, write-offs.
5. **Delivery:** orders, assignment, proof of delivery, remittance.
6. **Reports and print formats**, then settings from the Single doctype.
7. **Hardening:** field-level cost protection, scoping, slow-connection tests, the second-company install.

## 15. Open questions for the staging site
They live at the end of `docs/ERPNEXT-MAPPING.md`. The ones that decide the design: where the remainder sits after a partial receipt; whether workflows can enforce dual control; how several payment modes and the closing notes are stored; how to make writes retry-safe; how to hide cost fields; the pinned ERPNext version.
