import { CheckCircle2, Clock, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product, ReturnRecord } from "@erp/api-contract";
import { t } from "../i18n";
import { ApiFailure } from "../api/client";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/**
 * T03. Faulty goods that customers brought back wait here. Whoever holds the stock-control permission decides for each:
 * back on the shelf, or sent back to the supplier (RMA). The person who took the return cannot decide it. Needs a connection.
 */
export function ReturnInspectionPage() {
  const { api, token } = useSession();
  const { data, failed, retry, update } = useCachedReport<{ returns: ReturnRecord[] }>("return-inspections", (tk) => api.returnInspections(tk));
  const [names, setNames] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void api.products(token).then((r) => { if (live) setNames(Object.fromEntries(r.products.map((p: Product) => [p.id, p.name]))); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, token]);

  const waiting = data?.returns.filter((r) => r.inspection?.status === "pending") ?? [];
  const decided = data?.returns.filter((r) => r.inspection && r.inspection.status !== "pending").slice(0, 6) ?? [];

  async function decide(r: ReturnRecord, outcome: "restock" | "rma") {
    if (!token || busy) return;
    setBusy(r.returnNo);
    try {
      const res = await api.inspectReturn(token, r.returnNo, { idempotencyKey: crypto.randomUUID(), outcome, note: notes[r.returnNo]?.trim() || undefined });
      await update((d) => ({ returns: d.returns.map((x) => (x.returnNo === r.returnNo ? res.ret : x)) }));
      setMessage({ ok: true, text: t(outcome === "restock" ? "inspect.restocked" : "inspect.rma", { no: r.returnNo }) });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiFailure ? e.message : t("report.loadFailed") });
    } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("inspect.title")}</h1>
        <p className="text-text-muted">{t("inspect.subtitle")}</p>
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {message && <p role="status" className={`rounded-xl p-4 font-semibold ${message.ok ? "bg-success-subtle text-success-ink" : "bg-danger-subtle text-danger-ink"}`}>{message.text}</p>}
      {data && waiting.length === 0 && <p className="text-text-muted">{t("inspect.none")}</p>}
      <ul className="space-y-3">
        {waiting.map((r) => (
          <li key={r.returnNo}>
            <Card className="space-y-3 p-4" data-testid={`inspect-${r.returnNo}`}>
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="tabular text-lg font-bold">{r.returnNo}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-warning-subtle px-3 py-1 font-semibold text-warning-ink"><Clock className="h-5 w-5" aria-hidden="true" />{t("inspect.pending")}</span>
              </p>
              <p className="text-text-muted">{t("inspect.from", { invoice: r.invoiceNo, name: r.cashier.name, ago: ago(r.postedAt) })} · {r.reason}</p>
              <ul className="tabular">{r.lines.map((l) => <li key={l.productId}>{l.qty} × {names[l.productId] ?? l.productId}</li>)}</ul>
              <label className="block"><span className="font-semibold">{t("inspect.note")}</span>
                <input value={notes[r.returnNo] ?? ""} maxLength={300} onChange={(e) => setNotes((n) => ({ ...n, [r.returnNo]: e.target.value }))} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button till disabled={busy === r.returnNo} onClick={() => void decide(r, "restock")}>{t("inspect.restock")}</Button>
                <Button till variant="subtle" disabled={busy === r.returnNo} onClick={() => void decide(r, "rma")}>{t("inspect.sendBack")}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {decided.length > 0 && (
        <section aria-labelledby="decided" className="space-y-2">
          <h2 id="decided" className="text-xl font-bold">{t("inspect.decided")}</h2>
          <ul className="space-y-2">
            {decided.map((r) => (
              <li key={r.returnNo}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`inspected-${r.returnNo}`}>
                  <span className="tabular font-semibold">{r.returnNo}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-success-subtle px-3 py-1 font-semibold text-success-ink">
                    {r.inspection?.status === "restocked" ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Undo2 className="h-5 w-5" aria-hidden="true" />}
                    {t(r.inspection?.status === "restocked" ? "inspect.status.restocked" : "inspect.status.rma")}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
