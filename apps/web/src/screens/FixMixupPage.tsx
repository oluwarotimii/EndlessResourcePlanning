import { useEffect, useState } from "react";
import type { MixupSettlement, Product, SaleLookupResponse } from "@erp/api-contract";
import { t } from "../i18n";
import { ApiFailure } from "../api/client";
import { useSession } from "../state/session";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/**
 * T04. Fix a sale where the till said one version (Clear case) and the customer took another (Black case). A manager
 * finds the sale, picks the item that was sold and the one really taken, and says how the price difference was settled.
 * Both stocks are corrected and the fix is recorded against the cashier. The person who made the sale cannot fix it.
 */
export function FixMixupPage() {
  const { api, token } = useSession();
  const money = useMoney();
  const [products, setProducts] = useState<Product[]>([]);
  const [invoice, setInvoice] = useState("");
  const [found, setFound] = useState<SaleLookupResponse | null>(null);
  const [wrongId, setWrongId] = useState("");
  const [rightId, setRightId] = useState("");
  const [qty, setQty] = useState(1);
  const [settlement, setSettlement] = useState<MixupSettlement>("collected");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!token) return;
    let live = true;
    void api.products(token).then((r) => { if (live) setProducts(r.products); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, token]);

  const soldLine = found?.sale.lines.find((l) => l.productId === wrongId);
  const wrong = products.find((p) => p.id === wrongId);
  const siblings = wrong?.family ? products.filter((p) => p.family === wrong.family && p.id !== wrong.id) : [];
  const right = products.find((p) => p.id === rightId);
  const difference = soldLine && right ? (right.price - soldLine.unitPrice) * qty : 0;
  const options: MixupSettlement[] = difference > 0 ? ["collected", "shop_covers"] : difference < 0 ? ["refunded", "shop_covers"] : ["collected", "refunded", "shop_covers"];

  async function find() {
    if (!token || !invoice.trim()) return;
    setMessage(null); setFound(null); setWrongId(""); setRightId("");
    try { setFound(await api.lookupSale(token, invoice.trim())); } catch (e) { setMessage({ ok: false, text: e instanceof ApiFailure ? e.message : t("report.loadFailed") }); }
  }
  async function confirm() {
    if (!token || !found || !wrongId || !rightId || busy) return;
    setBusy(true);
    try {
      const res = await api.correctVariant(token, { idempotencyKey: key, saleKey: found.sale.idempotencyKey, wrongProductId: wrongId, rightProductId: rightId, qty, settlement: options.includes(settlement) ? settlement : options[0]!, note: note.trim() });
      setMessage({ ok: true, text: t("fix.done", { id: res.correction.id }) });
      setFound(null); setWrongId(""); setRightId(""); setQty(1); setNote(""); setInvoice(""); setKey(crypto.randomUUID());
    } catch (e) { setMessage({ ok: false, text: e instanceof ApiFailure ? e.message : t("report.loadFailed") }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("fix.title")}</h1>
        <p className="text-text-muted">{t("fix.subtitle")}</p>
      </div>
      {message && <p role="status" className={`rounded-xl p-4 font-semibold ${message.ok ? "bg-success-subtle text-success-ink" : "bg-danger-subtle text-danger-ink"}`}>{message.text}</p>}
      <Card className="space-y-3 p-5">
        <label className="block"><span className="font-semibold">{t("fix.invoice")}</span>
          <input value={invoice} onChange={(e) => setInvoice(e.target.value)} className="tabular mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        <Button till className="w-full" disabled={!invoice.trim()} onClick={() => void find()}>{t("fix.find")}</Button>
      </Card>
      {found && (
        <Card className="space-y-4 p-5">
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t("fix.sold")}</legend>
            {found.sale.lines.map((l) => (
              <label key={l.productId} className="flex min-h-touch items-center gap-3">
                <input type="radio" name="wrong" checked={wrongId === l.productId} onChange={() => { setWrongId(l.productId); setRightId(""); setQty(1); }} className="h-6 w-6" />
                <span>{l.qty} × {l.name} <span className="tabular text-text-muted">{money(l.unitPrice)}</span></span>
              </label>
            ))}
          </fieldset>
          {wrongId && siblings.length === 0 && <p className="font-medium text-warning-ink">{t("fix.noSibling")}</p>}
          {siblings.length > 0 && (
            <label className="block"><span className="font-semibold">{t("fix.taken")}</span>
              <select value={rightId} onChange={(e) => setRightId(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3">
                <option value="">{t("fix.choose")}</option>
                {siblings.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}
              </select>
            </label>
          )}
          {rightId && soldLine && (
            <>
              <label className="block"><span className="font-semibold">{t("fix.qty")}</span>
                <input type="number" min={1} max={soldLine.qty} value={qty} onChange={(e) => setQty(Math.min(soldLine.qty, Math.max(1, Math.floor(Number(e.target.value) || 1))))} className="tabular mt-1 min-h-touch w-28 rounded-xl border border-border-strong bg-surface-raised px-3" />
              </label>
              <p className="rounded-xl bg-fill p-3 text-lg font-bold tabular" data-testid="difference">{difference > 0 ? t("fix.owes", { amount: money(difference) }) : difference < 0 ? t("fix.dueBack", { amount: money(-difference) }) : t("fix.same")}</p>
              <fieldset className="space-y-1">
                <legend className="font-semibold">{t("fix.settled")}</legend>
                {options.map((o) => (
                  <label key={o} className="flex min-h-touch items-center gap-3"><input type="radio" name="settle" checked={(options.includes(settlement) ? settlement : options[0]) === o} onChange={() => setSettlement(o)} className="h-6 w-6" /><span>{t(`fix.settle.${o}`)}</span></label>
                ))}
              </fieldset>
              <label className="block"><span className="font-semibold">{t("fix.note")}</span>
                <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
              </label>
              <Button till className="w-full" disabled={busy || note.trim().length < 2} onClick={() => void confirm()}>{t("fix.confirm")}</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
