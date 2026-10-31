# tenant.json reference

One validated file per company: `packages/tenant-config/tenant.json` (schema in `packages/tenant-config/src/index.ts`). It is checked when the app starts; a bad file shows a readable error screen. Another company is set up by changing this file only. `pnpm check:docs` fails if a setting exists here but is not described below.

| Setting | Values | What it does |
| --- | --- | --- |
| `brand.name` | text | Company name shown in the header and on the login screen. |
| `brand.suffix` | text | Lighter second half of the name (for example "Retail"). |
| `brand.tagline` | text | Short line under the brand (not shown yet). |
| `theme.default` | a name in `theme.available` | Design theme used at first start. |
| `theme.available` | list of theme names | Themes the user can switch between. Each needs a JSON file in `packages/tokens/src/themes/`. |
| `theme.defaultMode` | `light` or `dark` | Colour mode at first start. |
| `locale` | for example `en-NG` | Number and date formatting. |
| `currency` | 3-letter code, for example `NGN` | Currency for every money figure. Amounts are whole units. |
| `branch.name` | text | Branch shown before a device is registered. |
| `taskRoles` | list of ERPNext role names | Roles that get big task tiles and no menu (cashier, rider, technician). |
| `enabledScopes` | `MVP`, `Later` | Which screens are switched on. Turn `Later` on as sprints land. |
| `print.paper` | `A5`, `A4`, `thermal` | Paper size for invoices and receipts. |
| `print.copyLabel` | text | Label printed on a document whose sale has not reached the server yet. |
| `print.autoPrint` | true or false | Print the receipt right after payment. Needs kiosk printing to avoid a dialog (see `docs/PRINTING.md`). |
| `print.company.legalName` | text | Company name on documents. |
| `print.company.address` | text | Address on documents. |
| `print.company.phone` | text | Phone on documents. |
| `print.bank.name` | text | Bank shown on invoices. |
| `print.bank.accountName` | text | Account name shown on invoices. |
| `print.bank.accountNumber` | text | Account number shown on invoices. |
| `tax.mode` | `inclusive`, `exclusive`, `none` | **How VAT is handled.** `inclusive`: prices already contain VAT, the customer pays the price and VAT is the portion inside it. `exclusive`: VAT is added on top, the customer pays price plus VAT. `none`: no VAT is charged or shown. Applies to the till, parked sales, documents and the server's check. |
| `tax.vatRate` | 0 to 1 (0.075 is 7.5%) | VAT rate. Confirm with the accountant. |
| `tax.vatNumber` | text | VAT or tax number printed on documents. |
| `till.paymentMethods` | any of `cash`, `transfer`, `card`, `credit`, `other` | Payment buttons at the till, in this order. Remove a method to switch it off. `credit` means pay later and needs a customer with credit terms. |
| `till.allowSplitPayments` | true or false | Allow one sale to be paid with several methods, including part credit. |
| `cashUp.denominations` | list of whole numbers | Note values counted at closing balance, largest first. |
| `cashUp.varianceReasons` | list of text | Reasons a cashier can pick when the count does not match. **Placeholders until the business supplies its real reason codes.** |
| `returns.reasons` | list of text | Reasons a cashier can pick when goods are returned. **Placeholders until the business supplies its real reasons.** |
| `returns.rules.defaultDays` | whole number | Days after a sale that a change-of-mind return is accepted, for any product without its own rule. **Placeholder (7).** |
| `returns.rules.faultyDays` | whole number | Days a faulty item may be returned. **Placeholder (30).** |
| `returns.rules.faultyReasons` | list of text | Which of the return reasons count as faulty (they use the faulty days). Must match the wording in `returns.reasons`. |
| `returns.rules.byCategory` | map: category to `{days, faultyDays}` | Own days for a whole category (for example Audio: 3). Either number may be left out. The most specific rule wins: product, then category, then default. |
| `returns.rules.byProduct` | map: product id to `{days, faultyDays}` | Own days for one product. |
| `delivery.failedReasons` | list of text | Reasons a rider can pick when a delivery fails. **Placeholders until the business supplies its real reasons.** |
| `delivery.codRemitHours` | whole number | Cash a rider collected on delivery must be handed in within this many hours; later it shows as overdue (L05). **A placeholder until the owner decides.** |
| `stock.inTransitAlertHours` | whole number | A transfer that has been on the road longer than this many hours appears in the in-transit report (G02). |
| `stock.shortageRulingHours` | whole number | A shortage still waiting for a ruling after this many hours is marked overdue in the approvals inbox. **A placeholder until the owner decides the real time limit.** |
| `stock.recountByDifferentPerson` | true or false | When a stock count finds differences, the items that differ must be counted again by a **different person** than the first counter. |
| `stock.overReceiptAllowancePercent` | whole or decimal number (percent) | A goods receipt (H01) may accept this much more than a purchase order's line asked for (ERPNext's "Over Receipt Allowance"). **A placeholder (0: none) until the owner decides.** |
| `till.scanRequiredForVariants` | true or false | Items that come in variants (colour, size, power) must be added by **scanning the barcode**, not by tapping a tile, so the wrong variant is not sold by mistake. |
| `offline.maxOfflineSalesPerTill` | whole number | Most unsynced sales a till may hold before it blocks new sales. |
| `offline.syncWindowHours` | whole number | How long a sale may wait to sync before the till blocks new sales. |
| `security.idleLockMinutes` | whole number | Minutes without touch before a till signs out. |
| `touch.minPx` | at least 48 | Minimum touch target (pixels). |
| `touch.tillPx` | at least 56 | Minimum touch target at the till (pixels). |

## Rules for changing this file
- A new setting needs: the schema entry, a value in `tenant.json`, a row above, a line in `docs/PRODUCT-CHANGELOG.md`, and a test.
- No colour, record name or user-facing text may be hard-coded outside this file, the token files, the dictionary (`apps/web/src/i18n/en.ts`) and the adapter.
