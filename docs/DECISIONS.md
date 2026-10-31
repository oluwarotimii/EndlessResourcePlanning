# Decisions and open questions

Current state only. When a decision changes, edit it here and add a line to `docs/PRODUCT-CHANGELOG.md`.

## Decisions made (confirm or change)
1. **Save first, then send.** Every sale is written to the device and queued before any network call. The receipt prints from local data. Offline selling and crash recovery are the same code path.
2. **Idempotency key per write, generated on the device.** An interrupted charge keeps its key so a retry cannot create a second sale. The server answers `duplicate: true` for a repeated key and changes nothing.
3. **Order is guaranteed per shift.** `shift.open`, sales and `shift.close` share the shift as record key and replay in order. If one fails for good, later items of that shift wait; other shifts continue.
4. **Identity rule.** Queued items replay only under the user who created them. If someone else signs in on the same till, the tray shows "waiting for <name> to sign in".
5. **Closing a shift signs the cashier out** (shared till). It first tries to sync; if offline, the closing waits in the queue for that cashier's next sign-in.
6. **Money is whole naira.** VAT handling is a company setting (`tax.mode`: inclusive, exclusive, none), rounded half up, one shared function. The server is the authority and rejects a mismatch.
7. **A sale has a list of payments.** They must add up to the total. `credit` needs a customer with credit terms and room under the limit. Only the `cash` portion counts toward expected cash in the drawer.
8. **Credit limit is enforced twice.** On the device from the last customer data it saw (may be stale offline) and by the server when the sale syncs. If the server rejects it after the goods left, the item shows as failed in the sync tray for a manager.
9. **Payment is only recorded for now.** Transfer and card are recorded at the till. Live confirmation arrives with Paystack (Sprint 9), so the "confirmation within 10 seconds" target cannot be tested yet.
10. **Failed money items are never discarded** by the cashier. The resolution workflow is a Sprint 3 question.
11. **Own contract, not raw ERPNext records.** The ERPNext adapter (Sprint 5) maps to our contract.
12. **Approvals are an online, deliberate decision.** The inbox shows the requester, the exception, the amount, the limit and the customer; approval needs a hold-to-confirm, rejection needs a reason. Every decision carries an idempotency key, the creator can never decide their own request, and the server checks the approve letter on the relevant area (`Stores (POS)` for discounts, `Returns` for voids, `Credit sales` for over-limit credit). Approvals are blocked offline. Limits are read from configuration, not from code.

## Open questions for the business
- **VAT:** which `tax.mode`, what rate, and who confirms it (accountant)? Are some items VAT-exempt (not supported yet; the mode applies to the whole sale)?
- **Credit:** real credit limits per customer and who sets them; whether the cashier or the manager may sell on credit; whether credit needs a deposit. The approvals inbox can now receive an over-limit request; raising it from the till is the next Sprint 3 increment.
- **Offline prices:** a sale made offline uses the price the till last saw. If the real price changed meanwhile, accept or send to a manager? The mock accepts the till's price.
- **Offline sign-in:** signing in needs a connection (the PIN is checked by the server). A cashier already signed in keeps working offline, including after a reload. Do tills need to sign in offline (for example after a power cut)? That needs a locally stored PIN check and a security decision.
- Cash-up variance **reason codes** (requirements, open question 6) are not captured; shift close shows the variance only.
- Offline limits (50 unsynced sales, 12 hours) are placeholders.
- Which payment methods appear at the till (requirements, open question 5): five are available; the real list goes in `till.paymentMethods`.
- The pilot branch, real approval limits, the A5 printer and whether silent printing works on the till computer (requirements, open questions 1, 2, 8).
- **Approval expiry and visibility:** how long a pending request stays valid, and whether approvers should see requests outside their branch. The mock keeps requests until decided and shows the role everything it may decide.

## Problems found in the source documents (not yet corrected there)
1. **Cash-up sign-off.** In `Roles-and-Access-Matrix.xlsx` the Branch manager has `VCE` on Cash-up (no Approve), but the journeys and screen Q02 have the manager signing off the cash-up. Only Cash controller has `A` there. One of them needs correcting.
2. **Rider screens.** The inventory lists "Rider" for L02 and L03; the matrix role is "Rider / courier". The importer maps it.
3. **Screen counts.** The Screens sheet has 97 rows but the Summary says 93. The build uses the 93 actual screens.

## Known gaps
- The approvals inbox is built, but the till and returns screens do not raise requests yet; the mock seeds them. S05 and the manager-approval half of CR01 are next.
- Camera barcode scanning is not built; keyboard-wedge scanners work.
- Silent printing is documented but not verified on real hardware.
- The e2e test is a script, not yet in CI (CI has no browser installed).
- Mock-only: PIN sign-in, capabilities, every endpoint. Nothing talks to ERPNext yet.
