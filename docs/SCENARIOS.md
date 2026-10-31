# The open questions, as stories

`docs/DECISIONS.md` lists questions I need you to answer. This file explains each one as a short story with real numbers, so you can see why the system needs a rule. For each story you get: what happens, what goes wrong without a rule, the choices, **my suggestion**, and a line for **your answer**.

You do not need to answer all of them now. Answer the ones that block the next thing we build. Everything marked "placeholder" in the app uses my suggestion until you decide.

---

## 1. The drawer is short at closing (closing balance)
**Story.** Amaka closes her shift. The system says there should be ₦38,500 in her drawer (opening balance ₦20,000 + ₦18,500 of cash sales). She counts ₦37,500. She is ₦1,000 short.

**Without a rule:** nobody knows if it is a counting slip, wrong change, or cash taken. Either it is ignored (small leaks add up) or the cashier is blamed without proof.

**What the app does now:** she counts first without seeing the expected figure, then sees "₦1,000 short", must give a reason, and someone else approves.

**Questions for you**
- a) Who approves the closing balance? (Branch manager, Cash controller, Auditor, or two people in order?)
- b) What are the real reasons staff can choose? (I made up: counting error, change given wrongly, cash taken for an expense, unknown.)
- c) What happens when a difference is approved: nothing, a warning, deduction? (The app only records it for now.)

**My suggestion:** Branch manager or Cash controller approves; an Auditor reviews the report weekly. Keep the reason list short.
**Your answer:** ______________________

## 2. Who confirms the opening balance
**Story.** Every morning Tunde (manager) gives Amaka ₦20,000 to start. If Amaka writes ₦25,000 as her opening balance, her closing numbers will always look short or, worse, hide a theft.

**Choices:** (A) the cashier just records it; (B) the manager must confirm it before the cashier can sell.

**Why B is hard:** if the manager is away or the phone is offline, nobody can sell. We would need a way to confirm on the device itself.

**My suggestion:** A for now, plus the manager sees the opening balance in the morning summary.
**Your answer:** ______________________

## 3. Should the Auditor approve, or only check?
**Story.** The Auditor is meant to be independent: they check the books and the counts but do not run the shop. If the Auditor also approves closing balances, they become part of the process they are supposed to check.

**Choices:** (A) Auditor approves; (B) Auditor only views and writes findings; approval stays with manager and cash controller.

**My suggestion:** B for closing balances; the Auditor may rule on missing stock because the branch cannot rule on its own loss.
**Your answer:** ______________________

## 4. Stock goes missing between the warehouse and the branch
**Story.** The warehouse sends 10 Phone chargers (cost ₦4,550 each). The branch counts 8. Two are missing: ₦9,100 at cost. Who pays?

**It could be:**
1. The warehouse packed 8 but recorded 10.
2. The rider or driver lost or took 2.
3. Someone at the branch took 2 after the box arrived.
4. The branch counted wrong.

**Without a rule:** charging the branch for all four is unfair, and staff would start signing "all received" to avoid a charge. Never charging means theft is free.

**What the app does now:** it flags the shortage and opens a ruling for someone independent (default: Auditor or MD). They choose who bears the loss. Only if they rule against the branch is it charged to the branch. The branch never sees the cost.

**Questions for you**
- a) Who rules? How many hours do they have (now 48, a placeholder)?
- b) If nobody rules in time: leave it open, or charge the branch automatically? (Now it only shows "waiting too long".)
- c) Can the transport (rider or carrier) really be charged?
- d) Are staff ever charged personally? (That is an HR and legal matter in Nigeria, outside the system.)

**My suggestion:** Auditor rules within 48 hours; if nobody rules, stay open but show it in the manager's and MD's morning list; charge the branch's account, not a person's pay.
**Your answer:** ______________________

## 5. The warehouse sends only part of a request
**Story.** The branch asks for 10 chargers and 5 cables. The warehouse only has 3 cables, so it sends 10 chargers and 3 cables.

**Without a rule:** the 2 missing cables are forgotten, and the branch keeps asking by phone.

**Choices:** (A) the missing part is lost, branch asks again; (B) the system keeps the 2 cables as "still owed" and lists them for the warehouse.

**My suggestion:** B. Today it is A.
**Your answer:** ______________________

## 6. A customer returns something
**Story.** A customer brings back a charger bought 12 days ago (₦6,500). The shop sold it with a 10% discount, so they paid ₦5,850.

**Without a rule:** staff refund ₦6,500 (the shelf price) and the shop loses ₦650, or they refuse for no reason.

**What the app does now:** refunds what was actually paid (₦5,850); a manager approves (default two people); the cash leaves the drawer record.

**Questions for you**
- a) How many days after a sale may a return be accepted?
- b) Does the returned item go back on the shelf, or to a "check first" area? (The app does not put it back yet.)
- c) The real list of return reasons (mine is made up).
- d) Who approves refunds? (Default: manager, then cash controller or MD.)

**My suggestion:** 7 days for change of mind, 30 days for faulty; faulty items go to a check area first.
**Your answer:** ______________________

## 7. A customer wants to buy on credit
**Story.** Bola Ventures has a credit limit of ₦100,000 and already owes ₦95,000. They want ₦13,000 of goods on credit. That is ₦8,000 over the limit.

**Without a rule:** the cashier says yes to a regular customer, and the debt grows until nobody can collect it.

**What the app does now:** the till blocks it; the cashier asks a manager; the approval is for that customer and amount and works once.

**Questions for you**
- a) Real credit limits per customer, and who sets them.
- b) May a cashier sell on credit at all, or only a manager?
- c) Is a deposit needed (for example half in cash)?

**My suggestion:** managers approve any over-limit sale; limits are set by the credit controller and approved by the MD.
**Your answer:** ______________________

## 8. VAT: in the price, or added on top?
**Story.** A charger is on the shelf at ₦6,500.
- **Included:** the customer pays ₦6,500 and ₦453 of it is VAT.
- **Added on top:** the customer pays ₦6,500 + ₦488 VAT = ₦6,988.
- **None:** the company does not charge VAT.

**Why it matters:** a wrong choice means every receipt is wrong and the tax return does not match.
**Choose:** included, added on top, or none; and the rate (7.5% is a placeholder). **Ask your accountant.**
**Your answer:** ______________________

## 9. The power goes off and a cashier needs to sign in
**Story.** The till restarts after a power cut and the network is down. The cashier must enter a PIN, but the PIN is checked by the server, which cannot be reached.

**Choices:** (A) nobody can sign in until the network returns (a signed-in cashier keeps working); (B) the till keeps a protected copy of the PIN check so it works offline.

**Why B needs care:** a stored PIN check on a shared device is a security risk if the device is stolen.
**My suggestion:** A for now; decide B if outages are common at the pilot branch.
**Your answer:** ______________________

## 10. The price changed while the till was offline
**Story.** The till is offline for 3 hours. Head office raises the charger from ₦6,500 to ₦7,000. The till sells 5 chargers at the old price.

**Choices:** (A) accept the old price; (B) send the difference to a manager.

**My suggestion:** A, but show it in a report so you can see how often it happens.
**Your answer:** ______________________

## 11. Counting stock while the shop is still selling
**Story.** Efe starts counting Phone chargers at 10:00 (system says 40). At 10:05 the shop sells 3. At 10:10 she finishes counting and finds 37. The system now says 37 too, so it matches. But if she counted before the sale and the system is compared after, she would show 3 "over".

**Why it matters:** counts during busy hours create false differences and false suspicion.
**Choices:** (A) count when the shop is quiet (early morning or closed); (B) freeze sales of those items during the count; (C) the system remembers the quantity at the moment counting started and accounts for movements since.

**My suggestion:** A now, C later with the Frappe app.
**Your answer:** ______________________

## 12. Counting differences and writing them off
**Story.** The count finds 3 Wireless mice missing (cost ₦17,850). Before the system changes the stock, someone must agree. If the system just adjusted itself, theft would disappear into the numbers.

**What the app does now:** blind count, a different person recounts the items that differ, then two people approve the adjustment (default: manager then Auditor; above ₦100,000 the MD). Stock changes only after that.

**Questions for you**
- a) Who approves write-offs? How often are counts done, and which items (everything, or a category each week)?
- b) If the recount still differs, is there an investigation?

**My suggestion:** weekly count of the fastest-moving items, monthly full count; the Auditor reviews all write-offs.
**Your answer:** ______________________

## 13. The wrong variant is sold (your example)
**Story.** The shop has two phone cases: **Black (₦3,500)** and **Clear (₦3,000)**. System stock: Black 10, Clear 10.
- A customer picks up a **Black** case. The cashier taps **Clear** on the till by mistake. The customer pays ₦3,000.
- The system now says: Clear 9, Black 10. In reality: Clear 10, Black 9.
- That is ₦500 less cash than the Black case was worth, and the numbers are now wrong in two places.

**What shows up later:** at the next stock count, **Black is 1 short** and **Clear is 1 over**. It looks like a Black case was stolen. Staff may "fix" it by adjusting the numbers by hand, which hides the real cause and means nobody learns. If it happens daily, the shop quietly loses the ₦500 each time.

**What we want:** stop it happening, and when it does, find it and correct it properly.

**What is built now**
1. **Scan, do not tap, for items with variants.** The till will not add a variant item from a tile. The cashier must scan the barcode on the item in the customer's hand, and the big word on the tile shows which variant it is. (Setting: `till.scanRequiredForVariants`.)
2. **The stock count spots it.** When one variant is short and its sibling is over, the screen says "Possible mix-up with Clear phone case… check the sales before treating this as missing stock", for the person counting and for the approvers, so it is not treated as theft.

**What is planned (not built yet)**
3. **"Fix a mix-up" on a sale.** A manager-approved correction that changes the sale from Clear to Black: the price difference (₦500) is collected or refunded, both stocks are corrected, and the reason and who did it are recorded.
4. **A report of mix-ups by cashier**, to coach staff and spot patterns.
5. **Different barcodes per variant on the shelf labels** (they should already be, so each scan is unambiguous).

**Questions for you**
- a) Should a mix-up correction need approval, and from whom?
- b) If the customer already left, who covers the ₦500?
- c) Do all variant items have their own barcode on the item itself?

**My suggestion:** manager approves the correction; the cashier is not charged for a first honest mistake, but repeats appear in the report.
**Your answer:** ______________________

## 14. Delivery: a failed drop and unpaid cash
**Story A.** The rider cannot reach the customer. The order is marked failed with a reason and goes back to the coordinator to send again.

**Story B.** The rider collects ₦18,500 cash on delivery on Monday and has not handed it in by Wednesday. The coordinator sees "Overdue" on the outstanding list (placeholder: after 24 hours).

**Story C.** A customer only has ₦10,000 of the ₦18,500. The app does not let the rider hand over the goods; they must collect the full amount or mark the delivery as failed.

**Questions for you**
- a) The real failed-delivery reasons (mine are made up).
- b) How many hours may a rider hold cash?
- c) Who confirms the cash handed in? (Default: manager or cash controller.)
- d) If a customer short-pays, may the rider leave the goods anyway with the difference recorded as owed?

**My suggestion:** same-day hand-in; confirmed by the manager; never leave goods unpaid unless the manager approves.
**Your answer:** ______________________

## 15. Your answers so far (2 Nov)
Stories 1 to 12 and 14: use my suggestions as placeholders; reason lists must be extendable; the Cash controller is a role; the MD and Auditor may rule on losses (leave it); who approves is a permission. These are recorded as decisions 39 to 44. Story 2 is read as A (confirm).

## 16. A return window that depends on the product, and what happens to the item
**Story.** A customer brings back a charger after 20 days and a phone case after 20 days. Chargers are sold with 30 days for faulty goods, cases with 7 days for change of mind.

**Without a rule:** one number for everything is wrong for some products; staff argue at the till.

**What you asked for:** the days are a setting per category, and per product when needed. A faulty item goes to a check area. The inspector (Stock controller or Auditor, set by permission or by name) decides: **RMA** (back to the supplier for credit) or **back on the shelf**.

**Questions**
- a) Which days for which categories? (Placeholder: 7 for change of mind, 30 for faulty.)
- b) Who inspects, by default?
- c) What happens to the money if RMA is refused by the supplier?

**My suggestion:** company default 7 days; faulty 30; Stock controller inspects; the Auditor reviews RMA monthly.
**Your answer:** ______________________

## 17. Selling on credit to a credit partner
**Story.** A customer buys a ₦120,000 phone through Credit Direct. The shop does not wait for the customer to pay; **Credit Direct is billed**. A smaller sale, a ₦6,500 charger, goes on the customer's own account.

**Without a rule:** the sale is booked to the customer, who never pays, while Credit Direct is never invoiced.

**What you asked for:** each credit sale has a "bill to" party: the customer or a credit partner. Some items may be billed to any party, some only to certain ones. A Credit control officer approves, depending on the account (each account has its own approver and limit), and anybody holding that permission may approve.

**Questions**
- a) The list of credit partners and their limits.
- b) Which items may be billed to a partner?
- c) What does the shop do if the partner rejects the claim later?

**My suggestion:** partners are accounts like customers, with a limit and a named approver; the Credit control officer approves over-limit sales; rejected claims go back to the customer as a normal debt after a manager decides.
**Your answer:** ______________________

## 18. The customer pays on their phone, then walks out with one more item
**Story.** In the cashierless store, Ada scans three items herself: a ₦6,500 charger, a ₦2,500 cable and a ₦3,000 phone case. She pays ₦12,000 on her phone and the receipt prints. At the door she also carries a ₦1,500 screen protector she did not scan.

**Without a rule:** nothing catches it. The system says the screen protector is still on the shelf. At the next stock count it is one short and looks like theft, and across a month the shop loses ₦1,500 many times over.

**What we plan:** an **exit check**. The floor person scans the QR on Ada's receipt and sees the three items. They look in the bag, find four, and flag a mismatch. The extra item is added to the sale and Ada pays ₦1,500 on the spot, or puts it back.

**Questions**
- a) Do you check every customer, or a sample (for example one in five)?
- b) If a customer has already left with an unpaid item, who covers it?
- c) Does a repeat customer get a warning, or are they asked to pay and nothing more?

**My suggestion:** check everyone at first, then a sample once the numbers settle; the shop covers a first-time honest mistake; repeats are reported to the manager.
**Your answer:** ______________________

## 19. Where each question lives
| Story | Section in `docs/DECISIONS.md` | Where it will matter in the app |
| --- | --- | --- |
| 1, 2, 3 | Closing balance and cash-up questions; decisions 13 to 16 | Closing balance count and approval |
| 4 | Shortage rulings; decisions 26, 27 | Receiving stock, approvals |
| 5 | Transfers questions | Stock requests |
| 6 | Returns questions | Customer return |
| 7 | Credit | Till, approvals |
| 8 | VAT | Till, documents |
| 9, 10 | Offline sign-in, offline prices | Sign-in, till |
| 11, 12 | Stock counts; decisions 30 to 33 | Count stock, differences |
| 13 | Variants (new) | Till, count differences |
| 14 | Delivery (new) | Dispatch board, rider screens |
| 16 | Decisions 40, 41 | Customer return (not built) |
| 17 | Decisions 42, 43 | Till, approvals (not built) |
| 18 | `docs/CASHIERLESS-ALIGNMENT.md` | Exit check (not built) |
