import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";
import { expectedCash, shiftKey, type LocalShift } from "../features/shift/shift";
import { useShift } from "../features/shift/useShift";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/**
 * Q01. Cash-up count at shift close, as a blind count: count the notes first, then see the expected cash and the variance.
 * A count that does not match needs a reason. Closing queues the shift close (works offline) and signs the cashier out.
 * A manager signs the cash-up off in Q02.
 */
export function CashUpPage() {
  const { signOut } = useSession();
  const { caps } = useSession();
  const tenant = useTenant();
  const money = useMoney();
  const sync = useSync();
  const { shift, sales, refunds, loaded } = useShift();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"count" | "review">("count");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const userId = caps?.user.id ?? "";

  const counted = useMemo(() => tenant.cashUp.denominations.reduce((n, d) => n + d * (counts[String(d)] ?? 0), 0), [counts, tenant]);
  if (!loaded) return <p role="status" className="text-text-muted">{t("app.loading")}</p>;
  if (!shift || shift.status !== "open") {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center">
        <h1 className="text-2xl font-bold">{t("cashup.noShift.title")}</h1>
        <p className="mt-1 text-text-muted">{t("cashup.noShift.body")}</p>
        <Link to="/s/S03" className="btn-spring mt-4 inline-flex min-h-till items-center rounded-xl bg-primary px-6 font-semibold text-primary-text hover:bg-primary-hover">{t("till.noShift.cta")}</Link>
      </Card>
    );
  }

  const expected = expectedCash(shift, sales, refunds);
  const variance = counted - expected;
  const needsReason = variance !== 0;
  const varianceReason = needsReason ? [reason, note.trim()].filter(Boolean).join(": ") : undefined;
  const bump = (d: number, by: number) => setCounts((c) => ({ ...c, [String(d)]: Math.max(0, (c[String(d)] ?? 0) + by) }));
  const typed = (d: number, v: string) => setCounts((c) => ({ ...c, [String(d)]: Number(v.replace(/\D/g, "")) || 0 }));

  async function confirm() {
    if (busy || !shift || (needsReason && !reason)) return;
    setBusy(true);
    try {
      const closedAt = new Date().toISOString();
      const itemId = crypto.randomUUID();
      const denominations = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
      await sync.storage.kv.set(shiftKey(userId), { ...shift, status: "closed", closedAt, countedCash: counted } satisfies LocalShift);
      await sync.enqueue({ id: itemId, type: "shift.close", recordKey: shift.id, payload: { idempotencyKey: itemId, shiftId: shift.id, closedAt, countedCash: counted, denominations, varianceReason } });
      await sync.flushNow(); // try to reach the server before the till signs out
      signOut(); // shared till: full sign-out at shift close
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("cashup.title")}</h1>

      {step === "count" ? (
        <Card className="space-y-4 p-5">
          <p className="text-text-muted">{t("cashup.count.body")}</p>
          <ul className="divide-y divide-border">
            {tenant.cashUp.denominations.map((d) => {
              const n = counts[String(d)] ?? 0;
              return (
                <li key={d} className="flex items-center gap-2 py-2">
                  <span className="tabular w-24 text-lg font-semibold">{money(d)}</span>
                  <Button variant="subtle" icon aria-label={t("cashup.less", { note: money(d) })} onClick={() => bump(d, -1)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <input
                    aria-label={t("cashup.notes", { note: money(d) })} inputMode="numeric" value={n === 0 ? "" : String(n)} placeholder="0"
                    onChange={(e) => typed(d, e.target.value)}
                    className="tabular min-h-touch w-20 rounded-xl border border-border-strong bg-surface-raised px-2 text-center text-lg font-bold"
                  />
                  <Button variant="subtle" icon aria-label={t("cashup.more", { note: money(d) })} onClick={() => bump(d, 1)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular ml-auto font-bold">{money(d * n)}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-border-strong pt-3 text-2xl font-bold">
            <span>{t("cashup.counted")}</span><span className="tabular" data-testid="counted">{money(counted)}</span>
          </div>
          <Button till className="w-full" onClick={() => setStep("review")}>{t("cashup.review")}</Button>
        </Card>
      ) : (
        <Card className="space-y-4 p-5">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{t("shift.expected")}</dt><dd className="tabular text-lg font-bold" data-testid="expected">{money(expected)}</dd></div>
            <div className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{t("cashup.counted")}</dt><dd className="tabular text-lg font-bold">{money(counted)}</dd></div>
          </dl>
          <p role="status" data-testid="variance" className={`tabular rounded-xl p-3 font-semibold ${variance === 0 ? "bg-success-subtle text-success-ink" : "bg-warning-subtle text-warning-ink"}`}>
            {variance === 0 ? t("shift.variance.none") : t(variance > 0 ? "shift.variance.over" : "shift.variance.short", { amount: money(Math.abs(variance)) })}
          </p>
          {needsReason && (
            <div className="space-y-3">
              <label className="block">
                <span className="font-semibold">{t("cashup.reason")}</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg">
                  <option value="">{t("cashup.reason.choose")}</option>
                  {tenant.cashUp.varianceReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-semibold">{t("cashup.note")}</span>
                <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
              </label>
            </div>
          )}
          <p className="text-text-muted">{t("shift.close.warn")}</p>
          <div className="flex gap-2">
            <Button till className="flex-1" disabled={busy || (needsReason && !reason)} onClick={() => void confirm()}>{t("shift.close.confirm")}</Button>
            <Button till variant="ghost" disabled={busy} onClick={() => setStep("count")}>{t("cashup.recount")}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
