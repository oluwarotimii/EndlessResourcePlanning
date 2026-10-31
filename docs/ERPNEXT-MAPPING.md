# ERPNext (Frappe) mapping

ERPNext is the back end. Every build must say how what it adds will live in ERPNext, so the adapter (Sprint 5) is not a surprise. This document is that map. **Add or update a row in the same change as any new screen, approval kind, queued action or stored record.** `pnpm check:docs` fails if an approval kind or queued action is missing here.

## How to read the status column
- **Owner**: taken from the owner's own documents (`Screen-Inventory.xlsx` column "What ERPNext offers", `Product-Requirements.md`, `Frontend-Plan.md`, the roles matrix notes).
- **Seen**: confirmed from ERPNext documentation search results in this project (only the in-transit transfer flow and its partial-receipt cap, so far).
- **Proposal**: my suggestion from general knowledge of Frappe. **It is not verified. Confirm on the staging site before building the adapter.** Never treat a Proposal as fact.

## The map
| Our concept | ERPNext / Frappe | Status | What the adapter must do |
| --- | --- | --- | --- |
| Sale at the till (`sale.create`) | POS Invoice with a POS Profile; credit sale as a Sales Invoice | Owner | Map lines, VAT, payments, customer. Split payments as several payment rows: Proposal. |
| Idempotency key on every write | Needs a custom field (for example a unique client key) and a whitelisted method that returns the existing document on a repeat | Owner (plan: "safe-to-retry write endpoints") + Proposal for the how | One method per write; a repeated key returns the first result and changes nothing. |
| Shift open and close (`shift.open`, `shift.close`) | POS Opening Entry and POS Closing Entry | Owner | Opening balance and counted cash map to the entries. |
| Closing balance count and approval (`cash_up`) | POS Closing Entry (partial) plus the custom doctype **Cash-up** (named in the plan) | Owner | Notes counted by denomination and the difference reason need custom fields: Proposal. Approval is a workflow step on Cash-up: Proposal. |
| Approval inbox and routing | Workflow and Workflow Action (inbox from Workflow Action / ToDo) | Owner | Our ordered steps become workflow states with the allowed roles: Proposal. "One person never decides two steps" and "requester never decides" must be checked: whether Frappe's workflow can enforce this out of the box is unverified. |
| Discount and void requests (`discount`, `void`) | No ERPNext equivalent ("Build custom") | Owner | A custom doctype for the request plus a workflow: Proposal. |
| Customer credit and over-limit approval (`credit_over_limit`) | Customer credit limit; Sales Invoice | Owner | Balance from the customer's outstanding receivable: Proposal. The approval is tied to one customer and amount and is used once (checked against the Sales Invoice's client key, like a discount approval): Proposal. |
| Customer return and refund (`refund`) | Sales Return (a return Sales Invoice) | Owner | The refund share by lines (`refundFor`) must match what ERPNext computes; approval via workflow: Proposal. |
| Branch stock request | Material Request (material transfer) | Owner | One request, many lines, status follows the transfer. |
| Branch-to-branch stock request (a request addressed to a sister branch, not the warehouse) | Material Request against another Branch's own default Warehouse; Stock Entry (Material Transfer) between two warehouses, same as the warehouse flow | Proposal | Not in the owner's documents; each branch's stock pool maps to its own Warehouse doctype in ERPNext, so the dispatch/receive mechanics are identical to H03/H04, just between two branch warehouses instead of warehouse-and-branch. Confirm the real list of branches and their warehouses on staging. |
| Transfer dispatch (`transfer.dispatch`) | Stock Entry (Material Transfer) with **Add to Transit** turned on; Pick List for picking | Owner + Seen | Dispatch moves stock out of the warehouse into the goods-in-transit warehouse. |
| Transfer receipt (`transfer.receive`) | A second Stock Entry (Material Transfer) that points back to the outward in-transit entry | Seen | Our per-item counted quantity becomes the received quantity. The inventory notes the standard entry has no signature or shortage flag, so those need custom fields: Owner. |
| Faulty return inspection (`/api/returns/:id/inspect`) | Stock Entry (Material Receipt) back to the shelf warehouse, or into an RMA warehouse; the pending state is a custom field on the Sales Return | Proposal | A change-of-mind return goes straight back on the shelf (placeholder). The inspector is anyone with the Stock control permission. |
| Fix a wrong-variant sale (`/api/sales/correct-variant`) | Credit note against the sale and a new Sales Invoice with the right item; a custom **Sale Correction** doctype records who, why and the settlement | Proposal | The mock only moves stock and records the difference; the real document correction is for the adapter. |
| Credit partner billed instead of the buyer | Customer (group "Credit partner") on the Sales Invoice as the billed party, buyer kept as a custom field | Proposal | Approvers per account: a list of Roles on the Customer, read by the workflow. Staging question: bill-to party on a POS Invoice. |
| Raise a purchase order, R01 (`POST /api/purchase-orders`) | Purchase Order (docstatus draft or submitted); who may is a Role on the User | Owner (Procurement officer named in the inventory) + Proposal | Permission = the Procurement area of the matrix; a Sales rep given the Procurement officer role can raise one. Approval of the order before it goes out: Proposal. |
| A permission given to one person (`extraRoles`) | A second Role assigned to the User | Seen | Standard Frappe: a User holds many Roles; permissions are the union. |
| Seven demo branches, each with stock, a manager and a stock officer | One Warehouse per Branch (a Branch is a Company or a Warehouse group, to be decided) and Users with a default Warehouse | Proposal | Demo data only; the real list comes from ERPNext. See the staging questions. |
| Goods receipt from a supplier, H01 (`purchase-orders` / `receive_goods`) | Purchase Order; Purchase Receipt made against it, which raises warehouse stock on submission (standard ERPNext Buying, not the two-step in-transit flow used for branch transfers) | Owner (Purchase Receipt named in the inventory) + Proposal (general Frappe Buying-module knowledge, not yet confirmed on staging) | Receiving less than ordered is normal (partial receipts); more than ordered plus the "Over Receipt Allowance" (our `stock.overReceiptAllowancePercent`) is refused. Raising and approving the Purchase Order is R01 (not built); confirm its workflow before H01 is adapted. An accepted/rejected (quality inspection) split exists in ERPNext but is not built here. |
| Shortage after a partial receipt | A partial receipt is capped at the quantity still in transit (release note v15.123.0). **What happens to the remainder is not confirmed.** | Seen (cap) / Proposal (remainder) | Proposal: the remainder stays in the in-transit warehouse until someone posts a further Stock Entry. **Test on staging first.** |
| Shortage ruling (`shortage`) | Proposal: a custom doctype for the case plus a workflow; when approved, a Stock Entry (Material Issue) from the in-transit warehouse to a stock-loss expense account with the cost centre of whoever bears the loss. If found, receive the remainder instead. | Proposal | The ruling's bearer (branch, warehouse, transit) chooses the cost centre. Cost value uses the item valuation rate. |
| Cost price hidden from most roles | Item valuation rate and stock value fields; hiding them needs field-level permissions (permission levels) | Proposal | Screens never receive cost; only rulers see the value at cost. |
| Physical stock count (`count.submit`) | Stock Reconciliation (the standard one is **not blind**, so the blind sheet and the recount round are a custom layer: "Build custom" in the inventory) | Owner + Proposal | The blind sheet is the item list without quantities. The count's expected quantity is the Bin quantity at submit time: Proposal. A count taken while stock is moving needs a cut-off rule (posting date and time): Proposal. |
| Recount by a different person | Proposal: custom fields on the count (round, recounted by) and a check that the second counter is another user | Proposal | The setting `stock.recountByDifferentPerson` decides whether it is required. |
| Stock write-off after a count (`write_off`) | Stock Reconciliation posts the adjustment against a difference (stock adjustment) account with a cost centre. Approval is a workflow step before it is submitted. | Owner (inventory: "None dedicated") + Proposal | Stock changes only when the approved reconciliation is submitted. The value at cost uses the valuation rate and stays hidden from the counter. |
| Stock levels | Bin and the Stock Balance report | Owner | Shelf and warehouse quantities from the two warehouses. |
| Transfers on the road too long | Proposal: a report on stock sitting in the in-transit warehouse by age | Proposal | Threshold from the `stock.inTransitAlertHours` setting. |
| Delivery orders and assignment | Sales Order with Delivery Note; Delivery Trip (basic) per the inventory | Owner | Assign or reassign an order to a rider. A rider sees only their own (data scope: own trips). |
| Proof of delivery (`delivery.proof`) | The custom doctype **Proof of Delivery** named in the plan | Owner | Delivered or failed with a reason, recipient, photo, cash collected; a retry never records it twice. Works offline. |
| Cash on delivery handed in (`cash_remittance`) | Inventory says "None" (Build custom): a custom **Cash Remittance** with a workflow step for the manager | Owner + Proposal | The rider's collected cash becomes a payment against the invoice only when the manager confirms: Proposal. |
| Delivery cash not handed in | Proposal: a report over unconfirmed remittances by rider and age | Proposal | Threshold from `delivery.codRemitHours`. |
| Item variants | Proposal: ERPNext Item Variant (template item plus attributes), or a family field | Proposal | Each variant has its own barcode so a scan is unambiguous. |
| Fixing a variant mix-up on a sale | Not in the inventory. Proposal: a custom correction document with approval that changes the sale line and moves stock for both variants | Proposal | Planned, not built. |
| Roles, areas, Approve letter | Role and Role Permission; data scope by User Permission on Company, Branch, Warehouse, Cost Center | Owner (matrix notes) | The front end reads roles at sign-in and never keeps its own copy. |
| Branch and cost centre | Branch, Cost Center, Warehouse | Owner (matrix notes) | A loss is charged to a cost centre. |
| Print documents | Print Format | Owner | A5 invoice and receipt templates. |
| Company settings (`tenant.json`) | Proposal: a Single doctype read by the front end | Proposal | Brand, VAT mode, payment methods, limits. |
| Print log (`print.log`) | Proposal: a small custom doctype or the Activity Log | Proposal | Reprints are logged. |

## Questions to answer on the staging site (collect here, answer before Sprint 5)
1. After a partial receipt, where does the remainder sit, and what is the cleanest way to write it off to a cost centre?
2. Can a workflow stop the same person approving two steps, and the requester approving their own request? If not, where do we enforce it?
3. How are the notes counted at closing and the difference reason stored on POS Closing Entry?
4. Can a POS Invoice carry several payment methods in one sale, including credit?
5. How do we make writes safe to retry (the client key) without breaking standard behaviour?
6. Which fields can be hidden from which roles (valuation rate), and does that survive reports?
7. Which ERPNext version will be pinned (the partial-receipt behaviour changed across versions)?
8. On a Stock Reconciliation, how do we record the first count and the recount, and who counted each?
9. While a count is open, how do we treat sales and transfers that happen during it (cut-off)?
10. On Purchase Receipt, is the "Over Receipt Allowance" a global Stock Settings value or set per item, and what should the real percentage be? Are Accepted Qty / Rejected Qty used without Quality Inspection turned on?
11. What is the real list of branches, and does each one get its own ERPNext Warehouse for a branch-to-branch stock request to draw from?
