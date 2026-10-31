import { creditOf } from "@erp/api-contract";
import { t } from "../../i18n";
import { useMoney, useTenant } from "../../state/tenant";
import type { PrintDoc } from "./types";

/**
 * A5 sales invoice and receipt. Paper size lives in tenant.json; the layout is fluid so A4 or a thermal roll work too.
 * Tokens only, like every other screen.
 */
export function SaleDocument({ doc }: { doc: PrintDoc }) {
  const tenant = useTenant();
  const money = useMoney();
  const { company, bank, copyLabel } = tenant.print;
  const isInvoice = doc.kind === "invoice";
  return (
    <article className="print-doc relative mx-auto w-full max-w-[148mm] bg-surface-raised p-6 text-text" aria-label={t(isInvoice ? "doc.invoice" : "doc.receipt")}>
      {doc.copy && (
        <span className="absolute right-6 top-6 rounded-md border-2 border-text px-3 py-1 text-lg font-bold tracking-widest">{copyLabel}</span>
      )}
      <header className="border-b border-border-strong pb-3">
        <h2 className="text-2xl font-bold tracking-tight">{company.legalName}</h2>
        <p>{company.address}</p>
        <p>{company.phone}</p>
        <p>{t("doc.vatNo", { vat: tenant.tax.vatNumber })}</p>
      </header>

      <h3 className="mt-3 text-xl font-bold">{t(isInvoice ? "doc.invoice" : "doc.receipt")}</h3>
      <dl className="mt-1 grid grid-cols-2 gap-x-4">
        <div><dt className="text-text-muted">{t("doc.number")}</dt><dd className="tabular font-semibold">{doc.number}</dd></div>
        <div><dt className="text-text-muted">{t("doc.date")}</dt><dd className="tabular font-semibold">{doc.date}</dd></div>
        <div><dt className="text-text-muted">{t("doc.cashier")}</dt><dd className="font-semibold">{doc.cashier}</dd></div>
        <div><dt className="text-text-muted">{t("doc.customer")}</dt><dd className="font-semibold">{doc.customer ?? t("doc.walkIn")}</dd></div>
      </dl>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-border-strong text-left text-text-muted">
            <th className="py-1 pr-2 font-semibold">{t("doc.item")}</th>
            <th className="py-1 px-2 text-right font-semibold">{t("doc.qty")}</th>
            {isInvoice && <th className="py-1 px-2 text-right font-semibold">{t("doc.unit")}</th>}
            <th className="py-1 pl-2 text-right font-semibold">{t("doc.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-1 pr-2">{l.name}</td>
              <td className="tabular px-2 text-right">{l.qty}</td>
              {isInvoice && <td className="tabular px-2 text-right">{money(l.unitPrice)}</td>}
              <td className="tabular py-1 pl-2 text-right">{money(l.unitPrice * l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-3 ml-auto w-3/5 space-y-1">
        {doc.vatMode === "exclusive" && (
          <div className="flex justify-between"><dt className="text-text-muted">{t("doc.subtotal")}</dt><dd className="tabular">{money(doc.subtotal)}</dd></div>
        )}
        {doc.vatMode !== "none" && (
          <div className="flex justify-between">
            <dt className="text-text-muted">{t(doc.vatMode === "exclusive" ? "doc.vatAdded" : "doc.vatIncluded", { rate: String(+(tenant.tax.vatRate * 100).toFixed(2)) })}</dt>
            <dd className="tabular">{money(doc.vat)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border-strong pt-1 text-xl font-bold"><dt>{t("doc.total")}</dt><dd className="tabular">{money(doc.total)}</dd></div>
        {doc.payments.map((p, i) => (
          <div key={i} className="flex justify-between"><dt className="text-text-muted">{t("doc.paidBy", { method: t(`pay.${p.method}`) })}</dt><dd className="tabular font-semibold">{money(p.amount)}</dd></div>
        ))}
        {creditOf(doc.payments) > 0 && (
          <div className="flex justify-between border-t border-border-strong pt-1 font-bold"><dt>{t("doc.balanceDue")}</dt><dd className="tabular">{money(creditOf(doc.payments))}</dd></div>
        )}
      </dl>

      {isInvoice && (
        <section className="mt-4 rounded-md border border-border p-2">
          <h4 className="font-semibold">{t("doc.bank")}</h4>
          <p>{bank.name} · {bank.accountName}</p>
          <p className="tabular">{bank.accountNumber}</p>
        </section>
      )}
      <footer className="mt-4 text-center text-text-muted">{t("doc.thanks")}</footer>
    </article>
  );
}
