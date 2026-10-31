import { AlertTriangle, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { StockCount } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { findMixups } from "../features/stock/mixups";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CountStatusBadge } from "../ui/CountStatusBadge";

/**
 * K02. Count differences and the write-off request. A difference never changes stock by itself: it goes for approval first
 * (who approves is a setting), and stock is adjusted only when it is approved. Needs a connection.
 */
export function CountDifferencesPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const offline = sync.state === "offline";
  const { data, failed, retry, update } = useCachedReport<{ counts: StockCount[] }>("counts", (tk) => api.counts(tk));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  /** One key per count, kept across a failed attempt so a retry can never raise two requests. */
  const [keys] = useState(() => new Map<string, string>());

  const waiting = data?.counts.filter((c) => c.status === "review") ?? [];
  const history = data?.counts.filter((c) => c.status === "write_off_requested" || c.status === "adjusted").slice(0, 5) ?? [];

  async function ask(c: StockCount) {
    if (!token || busy || offline) return;
    setBusy(c.id); setError(null);
    try {
      let key = keys.get(c.id);
      if (!key) { key = crypto.randomUUID(); keys.set(c.id, key); }
      const res = await api.requestWriteOff(token, c.id, { idempotencyKey: key, note: notes[c.id]?.trim() || undefined });
      await update((d) => ({ counts: d.counts.map((x) => (x.id === c.id ? res.count : x)) }));
      setAsked(true);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.code === "unavailable" ? t("error.unavailable") : e.message) : t("error.generic"));
    } finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("diff.title")}</h1>
        <p className="text-text-muted">{t("diff.subtitle")}</p>
      </div>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("diff.offline")}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger-subtle p-4 font-medium text-danger-ink">{error}</p>}
      {asked && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("diff.asked")}</p>}
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {data && waiting.length === 0 && <p className="text-text-muted">{t("diff.none")}</p>}

      <ul className="space-y-4">
        {waiting.map((c) => {
          const mixups = findMixups(c.lines);
          return (
          <li key={c.id}>
            <Card className="space-y-3 p-5" data-testid={`diff-${c.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="tabular text-lg font-bold">{c.id} · {t(`count.${c.location}`)}</p>
                <CountStatusBadge status={c.status} />
              </div>
              <table className="w-full text-left">
                <thead><tr className="border-b border-border-strong text-text-muted">
                  <th className="py-2 font-semibold">{t("diff.item")}</th><th className="py-2 text-right font-semibold">{t("diff.system")}</th>
                  <th className="py-2 text-right font-semibold">{t("diff.counted")}</th><th className="py-2 font-semibold">{t("diff.difference")}</th>
                </tr></thead>
                <tbody>
                  {c.lines.filter((l) => (l.difference ?? 0) !== 0).map((l) => {
                    const short = (l.difference ?? 0) < 0;
                    const Icon = short ? AlertTriangle : TrendingUp;
                    return (
                      <tr key={l.productId} className="border-b border-border">
                        <td className="py-2 font-semibold">{l.name}{mixups.get(l.productId) && <p className="mt-1 font-medium text-warning-ink" data-testid={`mixup-${l.productId}`}>{t("diff.mixup", { names: mixups.get(l.productId)!.join(", ") })}</p>}</td>
                        <td className="tabular py-2 text-right">{l.expected}</td>
                        <td className="tabular py-2 text-right">{l.counted}</td>
                        <td className="py-2"><span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold tabular ${short ? "bg-danger-subtle text-danger-ink" : "bg-warning-subtle text-warning-ink"}`}><Icon className="h-4 w-4" aria-hidden="true" />{t(short ? "diff.short" : "diff.over", { n: Math.abs(l.difference ?? 0) })}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <label className="block"><span className="font-semibold">{t("diff.note")}</span>
                <input value={notes[c.id] ?? ""} maxLength={300} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
              </label>
              <Button till className="w-full" disabled={busy === c.id || offline} onClick={() => void ask(c)}>{t("diff.ask")}</Button>
            </Card>
          </li>
          );
        })}
      </ul>

      {history.length > 0 && (
        <section aria-labelledby="hist" className="space-y-2">
          <h2 id="hist" className="text-xl font-bold">{t("diff.history")}</h2>
          <ul className="space-y-2">
            {history.map((c) => <li key={c.id}><Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`hist-${c.id}`}><span className="tabular font-semibold">{c.id}</span><CountStatusBadge status={c.status} /></Card></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
