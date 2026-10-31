# Glossary (plain words)

The product uses everyday words. Staff should understand every label without training. Internal names in the code and settings are kept as they are (so nothing breaks) and are listed in the table at the end.

- **Opening balance.** The cash a till starts the shift with, so the cashier can give change. Counted and entered when the shift opens.
- **Closing balance.** The end-of-shift cash check. The cashier counts the cash in the drawer; the system works out how much *should* be there (opening balance + cash taken that shift, minus cash refunded; card, transfer and credit sales never put cash in the drawer). If the two differ, the cashier gives a reason. Someone else then **approves** it. It is the daily proof that the cash matches the sales.
- **Difference.** Counted cash minus expected cash. Cash *missing* (short) or cash *over*.
- **Blind count.** The cashier counts before seeing the expected figure, so the count is honest.
- **Approve.** A second person confirms the count, or any other exception, and the reason for any difference. Who that is a setting (`docs/APPROVAL-ROUTING.md`).
- **Deposit.** Taking the counted cash to the bank. The person depositing counts it again; the bank slip is later matched against the closing balance (screen Q03, Sprint 7).
- **Credit sale.** The customer takes the goods and pays later. Recorded as money the customer owes, limited by their credit limit.
- **Approval.** A decision by someone other than the requester for an exception: a discount, a void, a sale over a credit limit, a refund, a closing balance.
- **Refund / return.** A customer gives goods back and gets money (or a reduction of what they owe) back. Needs approval.
- **Purchase order.** An order placed with a supplier for goods to arrive at the warehouse. Raising one is a later screen (R01); it arrives at goods receipt already placed.
- **Goods receipt.** The warehouse scanning and counting what a supplier actually delivered against a purchase order (screen H01). Receiving less than ordered is normal; the rest may come later.
- **Stock request.** A branch asking the warehouse, or a sister branch, for stock (screen H02).
- **Sister branch.** Another branch of the same company that can be asked for stock directly, instead of going through the warehouse.
- **Transfer / dispatch.** The warehouse, or a sister branch, packing and sending the requested stock. While it is on the road it is **in transit**.
- **Receiving.** The branch counting what arrived and confirming it.
- **Shortage.** Items that were sent but not counted at the branch. It is flagged on the transfer.
- **Ruling (missing stock).** A decision by someone independent of the branch on who bears the cost of stock that went missing in transit: the branch, the warehouse, or the transport. Nothing is charged until it is made.
- **Value at cost.** What the missing stock cost the company (not the selling price). Only the people who rule on it see it.
- **Stock count.** Counting what is really on the shelf or in the warehouse. It is **blind**: the counter does not see how many the system expects.
- **Recount.** When items differ, someone else counts them again. The recount is the final figure.
- **Write-off (stock adjustment).** Correcting the system to match what was counted, after someone approves. Nothing changes before approval.
- **Cash on delivery.** The customer pays the rider in cash when the goods arrive. The rider must hand that cash in, and a manager confirms it.
- **Proof of delivery.** The rider's record that the goods were delivered (who received them, a photo, the cash collected) or why they could not be.
- **Variant.** One version of an item (colour, size, power). Variants of the same item are a **family**. Selling the wrong variant is a **mix-up**.
- **Idempotency key.** A unique code on every money action so a retry can never record it twice (technical; never shown to users).
- **Tenant / tenant.json.** One company's settings (brand, VAT, payment methods...). Another company is set up by changing this file only.

## Plain word and internal name
| What users read | Internal name (code, settings, files) |
| --- | --- |
| Opening balance | `openingFloat` (contract), "float" in older notes |
| Closing balance | `cash_up` (approval kind), `cashUp.*` (tenant settings), the area **Cash-up** in the roles matrix |
| Closing balance count (Q01) / approval (Q02) | Cash-up count / sign-off in the Screen-Inventory spreadsheet; titles are overridden by `packages/permissions/src/data/title-overrides.json` |
| Difference | variance |
| Approve | sign off |

**Rule for anyone adding text:** write the plain word in screens and documents; keep the internal name only in code, settings keys and the spreadsheets. New screen titles that differ from the spreadsheet go in `title-overrides.json`.
