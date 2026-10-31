# Does what we are building lead to the cashierless store?

The goal in the owner's **Cashierless-Store-Proposal** is to stop writing orders on paper and re-typing them at a cashier, and to move to a system where the customer or the sales attendant builds the order on a scanner or phone, the customer pays through Paystack, Flutterwave or OPay, a receipt prints when payment is confirmed, and one or two people watch the floor instead of a cashier queue. The online store shares the same back end.

This page says, pillar by pillar, how far the current build gets us, what is missing, and what I recommend building next. It is a **Proposal**. Nothing here is decided until the owner answers the questions at the end.

## Pillar by pillar

| What the proposal asks for | Where we are | What is missing |
| --- | --- | --- |
| Customer scans products on a kiosk, phone or handheld | Scanning works (keyboard-wedge scanners, offline). Variants must be scanned, not tapped. | A customer-facing "scan and pay" mode. Today the till is designed for a cashier. |
| Sales attendant builds the order on their own phone, no paper | Parked sales (S02) and the till already build a cart on a device. A sales rep can already be given till permission, because permissions are given to people. | An **order** that is separate from a **sale**: built on the attendant's phone, then paid on a kiosk or by the customer's phone. |
| The system confirms the order automatically, nothing re-typed | Built: totals, VAT, one write per sale, a retry never posts twice. | Nothing for the pilot. |
| Payment through Paystack, Flutterwave or OPay, no manual amounts | **Not built.** Today the cashier picks the method and types the amount (decision 9: payment is only recorded). Paystack is planned for Sprint 9. | This is the keystone. Without it the till is a faster cashier, not a cashierless store. |
| Receipt prints when payment is confirmed | A5 invoice and receipt printing works. The trigger is the cashier. | Print on payment confirmed (and a QR code on the receipt, see below). |
| Staff watch the floor and check that receipts match what leaves the store | **Not built.** | An **exit check**: scan the receipt QR, see the items, tick them off. |
| One back end for the online and physical stores | ERPNext is the back end. Delivery (cash on delivery, prepaid, rider) is built. | An order intake from the online store, and the payment step above. |

## What helps the cashierless store more than it did before

With no cashier at the door, loss control matters more. These are already built:
- blind stock counts with a recount by a different person, so nobody can see the expected figure;
- the wrong-variant protection (scan, do not tap) and the mix-up warning at counts;
- shortage rulings for stock lost between branches;
- approvals for discounts, voids, refunds and write-offs, with the person who asks never the person who approves;
- permissions given to people, not tied to a job title, so "who may sell" is a setting.

## What shrinks, and what does not
- **Cash-up shrinks** if most sales are paid by card or transfer, but stays for cash sales and cash on delivery.
- **The cashier role becomes a permission.** A sales attendant, a floor monitor or a manager can hold it. We already built roles that way.
- **Offline gets harder.** A payment needs the network. When it is down the store needs a fallback (a till with a card terminal, or cash). We keep the cashier till for exactly this.

## Recommended order of work

1. **Sprint 5, ERPNext adapter** (reads, then writes), as planned. Everything below sits on the same back end.
2. **Order, then sale.** Add an order that can be built on a phone or kiosk, held, and paid. The parked-sale code is the starting point.
3. **Payment confirmation.** A payment request, a Paystack/Flutterwave/OPay confirmation that only the server accepts, and a mock gateway for testing. Move this **ahead of** the planned Sprint 9; it is the heart of the goal.
4. **Receipt on confirmation, with a QR code** that carries the invoice number.
5. **Exit check screen.** Scan the receipt QR, tick the items, flag a mismatch. Mismatches go to the same reports as stock differences.
6. **Customer self-scan mode** (large type, no staff controls) on a kiosk or phone.
7. **Online order intake.** Same order object, with delivery as already built.

Steps 2 to 5 give a store where an attendant builds the order on a phone, the customer pays on their own phone, the receipt prints, and one person checks the bag. That is a first cashierless store without a customer self-scan mode.

## Risks to plan for
- **Leakage at the door.** Self-scan stores lose stock to items not scanned. The exit check, random bag checks and the stock count with mix-up detection are the controls.
- **Pay-then-take-more.** Scenario 18 in `docs/SCENARIOS.md`.
- **Payment confirmed twice, or never.** Gateways resend messages. Confirmations must be safe to receive twice (same idea as our retry keys) and a missed one must be found by a reconciliation job.
- **Network down.** A sale cannot be confirmed without the gateway. The cashier till stays as the fallback.
- **Hardware.** Barcode labels per variant, a label printer, a receipt printer that works with the browser, and a few scanners or tablets. Not a software risk but the most common reason this fails.

## Questions for the owner
1. Is a first version with **attendants building orders on phones**, and customers paying on their phones, enough, or must customers scan themselves from day one?
2. Which gateway first: Paystack, Flutterwave or OPay?
3. Should the Pilot Branch keep a cashier till as a fallback? (I recommend yes.)
4. Who does the exit check, and may a manager waive a mismatch?

When these are answered, record them in `docs/DECISIONS.md` and add the work to `docs/source/Frontend-Plan.md` (Amendments).
