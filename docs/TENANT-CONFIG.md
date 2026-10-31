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
| `offline.maxOfflineSalesPerTill` | whole number | Most unsynced sales a till may hold before it blocks new sales. |
| `offline.syncWindowHours` | whole number | How long a sale may wait to sync before the till blocks new sales. |
| `security.idleLockMinutes` | whole number | Minutes without touch before a till signs out. |
| `touch.minPx` | at least 48 | Minimum touch target (pixels). |
| `touch.tillPx` | at least 56 | Minimum touch target at the till (pixels). |

## Rules for changing this file
- A new setting needs: the schema entry, a value in `tenant.json`, a row above, a line in `docs/PRODUCT-CHANGELOG.md`, and a test.
- No colour, record name or user-facing text may be hard-coded outside this file, the token files, the dictionary (`apps/web/src/i18n/en.ts`) and the adapter.
