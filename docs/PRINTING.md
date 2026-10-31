# Printing (A5)

Documents print through the browser to the company's existing printers. Layout and paper come from `tenant.json` (`print.paper`: `A5`, `A4` or `thermal`), so another company can use A4 or a thermal roll without code changes.

- Built: sales invoice and receipt (VAT shown per `tax.mode`: included, added on top with a subtotal, or not shown; each payment is listed and "Balance on credit" appears when part or all of the sale is on credit) (`apps/web/src/features/print/SaleDocument.tsx`), preview at screen P06.
- Not built yet: customer statement, delivery note, transfer note, payout advice (their sprints).
- Paper is always printed in the light theme, even when the screen is dark.
- A sale not yet synced prints with a COPY label and a provisional number (`OFF-xxxxxx`). After sync the real invoice number is used.
- Reprints are allowed and logged (queued with an idempotency key, then recorded by the server).
- Verified in `e2e/till-offline.cjs`: the print output is one A5 page (148 x 210 mm).

## Silent printing at the till (not yet verified on your hardware)

Set `print.autoPrint` to `true` in `tenant.json` to print right after payment. To avoid the print dialog, run Chrome on the till computer in kiosk-printing mode with a default printer set:

```
chrome --kiosk-printing --app=https://your-till-url
```

A tablet may not support this; the cashier would then confirm the print each time. **Test early on the real printer and computer** (open risk in the requirements). Ask the printer to use A5 or print two-up on A4.
