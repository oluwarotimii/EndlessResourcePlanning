# Who approves what (approval routing)

Who may decide each kind of approval is a **setting**, not code. It lives in `packages/permissions/src/data/approval-routing.json` and is read by both the screens and the mock server (the real server, ERPNext, does the same with workflow steps in Sprint 5). Change the file, restart, and the next request follows the new route. `pnpm check:docs` fails if a kind of approval is missing from this document.

## How it works
- A kind of approval lists **ordered steps**. Each step names the **roles** allowed to decide it, using the exact role names from the roles matrix.
- Steps are decided **in order**. Anyone in the current step's roles may decide it; the others see "waiting for ... to decide first".
- The **requester never decides** any step of their own request.
- **One person never decides two steps** of the same request, even if their role is allowed in both (two different people are needed).
- **A rejection at any step ends the request.** A rejection needs a reason.
- The amount **limits** still apply to each approver (for example a Branch manager cannot approve a refund above their per-item limit; the MD can). Limits come from the approval-limits spreadsheet.
- A kind that is **not listed** in the file falls back to the Approve letter in the roles matrix (the behaviour before routing existed).
- Approvals are blocked offline, as before.
- **Name the MD in a step if large amounts must be possible.** A role above its limit cannot decide (for example a Branch manager cannot approve a refund line above their per-item limit), so a step that names only the manager would be stuck for large refunds. The default refund route therefore names the MD in both steps.

## The kinds of approval
| Kind | Raised when | Default today |
| --- | --- | --- |
| `discount` | A cashier asks for a discount at the till (S05) | Matrix Approve letter on Stores (POS) |
| `void` | A cashier asks to void the current sale (S05) | Matrix Approve letter on Returns |
| `credit_over_limit` | A credit sale would go over the customer's limit | Matrix Approve letter on Credit sales |
| `cash_up` | A shift is closed with a cash count (Q01) | One step: Branch manager or Cash controller |
| `refund` | A cashier asks to refund returned goods (T01) | Two steps: Branch manager or MD, then Cash controller or MD (a placeholder to confirm). The per-item limit applies to each approver. |
| `shortage` | A transfer is received with items missing (H04). Raised by the system, never by a person. | One step: Auditor or MD (**a placeholder to confirm**). The ruler must choose who bears the loss. The Auditor is limited by the stock write-off limit (₦100,000 at cost); above it the MD must rule. |
| `write_off` | A Stock controller asks to adjust stock after a count found differences (K02). | Two steps: Branch manager or MD, then Auditor or MD (**placeholders to confirm**). Limit: stock write-off ₦100,000 at cost, above it the MD. The counter does not see the cost. |
| `cash_remittance` | A rider records cash collected on delivery to hand in (L04). | One step: Branch manager or Cash controller (**a placeholder to confirm**). The rider cannot confirm their own cash. Rejecting (with a reason) frees the cash so the rider can hand it in again. |

## Shortage rulings
A shortage is **never charged automatically**. When a transfer is received short, the system opens a ruling. The person who received the stock (the branch) is the requester, so they can never rule on it, and they do not see the cost value. The ruler chooses who bears the loss: the branch that received it, the warehouse that packed it, or the transport. Only a ruling against the branch is charged to the branch's figures. A rejection (needs a reason) charges nothing, for example when the items were found. The time limit before a ruling is marked overdue is the setting `stock.shortageRulingHours`.

## Write-offs after a stock count
A difference found by a count never changes stock by itself. The Stock controller asks for approval; stock is adjusted only when the last step approves. A rejection (needs a reason) adjusts nothing and closes the count. The person who counted and asked cannot approve and does not see the cost.

## Examples
Make the Auditor approve the closing balance instead of the manager:
```json
{ "cash_up": [ { "roles": ["Auditor"] } ] }
```
Closing balance checked by the manager, then verified by the Auditor (two different people, in order):
```json
{ "cash_up": [ { "roles": ["Branch manager"] }, { "roles": ["Auditor"] } ] }
```
Refund approved by the manager only (one step):
```json
{ "refund": [ { "roles": ["Branch manager", "MD / Executive"] } ] }
```
Over-limit credit approved by the manager, then by the MD:
```json
{ "credit_over_limit": [ { "roles": ["Branch manager"] }, { "roles": ["MD / Executive"] } ] }
```

## Things to know
- **Role names must match the matrix exactly.** A test fails if a name in the file is not a role in the matrix.
- Naming the **Auditor** as an approver is allowed, but the matrix treats the Auditor as independent and read-only. Making the Auditor approve (rather than only count and report findings) is a control decision for the owner.
- This file is the temporary home for the setting. A screen for admins to edit it (the config console) is planned for Sprint 10.
- Where the matrix and this file disagree, **this file wins** for the kinds it lists.
