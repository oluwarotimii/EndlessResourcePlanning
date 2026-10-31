import { useState } from "react";
import { t } from "../i18n";
import { expectedCash, type LocalShift } from "../features/shift/shift";
import { shiftKey } from "../features/shift/shift";
import { useShift } from "../features/shift/useShift";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

const digits = (v: string) => v.replace(/\D/g, "");

/** Open and close a shift. Works offline: both are queued with idempotency keys and replayed in order. */
export function ShiftPage() {
  const { caps, signOut } = useSession();
  const sync = useSync();
  const money = useMoney();
  const { shift, sales, loaded, reload } = useShift();
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = caps?.user.id ?? "";
  if (!loaded) return <p role="status" className="text-text-muted">{t("app.loading")}</p>;

  const isOpen = shift?.status === "open";
  const expected = shift && isOpen ? expectedCash(shift, sales) : 0;
  const variance = amount === "" ? null : Number(amount) - expected;

  async function open() {
    if (busy || amount === "") return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const next: LocalShift = { id, status: "open", openingFloat: Number(amount), openedAt: new Date().toISOString() };
      await sync.storage.kv.set(shiftKey(userId), next);
      await sync.enqueue({ id: crypto.randomUUID(), type: "shift.open", recordKey: id, payload: { idempotencyKey: crypto.randomUUID(), shiftId: id, openedAt: next.openedAt, openingFloat: next.openingFloat } });
      setAmount(""); await reload();
    } finally { setBusy(false); }
  }

  async function close() {
    if (busy || !shift || amount === "") return;
    setBusy(true);
    try {
      const closedAt = new Date().toISOString();
      const itemId = crypto.randomUUID();
      await sync.storage.kv.set(shiftKey(userId), { ...shift, status: "closed", closedAt, countedCash: Number(amount) } satisfies LocalShift);
      await sync.enqueue({ id: itemId, type: "shift.close", recordKey: shift.id, payload: { idempotencyKey: itemId, shiftId: shift.id, closedAt, countedCash: Number(amount) } });
      await sync.flushNow(); // try to get everything to the server before the till signs out
      signOut(); // shared till: full sign-out at shift close
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t(isOpen ? "shift.close.title" : "shift.open.title")}</h1>
      <Card className="space-y-4 p-5">
        {isOpen && shift ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{t("shift.float")}</dt><dd className="tabular text-lg font-bold">{money(shift.openingFloat)}</dd></div>
              <div className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{t("shift.expected")}</dt><dd className="tabular text-lg font-bold" data-testid="expected">{money(expected)}</dd></div>
            </dl>
            <label className="block"><span className="font-semibold">{t("shift.counted")}</span>
              <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(digits(e.target.value)); setConfirming(false); }} className="tabular mt-1 min-h-till w-full rounded-xl border border-border-strong bg-surface-raised px-4 text-2xl font-bold" />
            </label>
            {variance !== null && (
              <p role="status" className={`rounded-xl p-3 font-semibold tabular ${variance === 0 ? "bg-success-subtle text-success-ink" : "bg-warning-subtle text-warning-ink"}`} data-testid="variance">
                {variance === 0 ? t("shift.variance.none") : t(variance > 0 ? "shift.variance.over" : "shift.variance.short", { amount: money(Math.abs(variance)) })}
              </p>
            )}
            {!confirming ? (
              <Button till className="w-full" disabled={amount === ""} onClick={() => setConfirming(true)}>{t("shift.close.review")}</Button>
            ) : (
              <div className="space-y-2">
                <p className="text-text-muted">{t("shift.close.warn")}</p>
                <Button till className="w-full" disabled={busy} onClick={() => void close()}>{t("shift.close.confirm")}</Button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-text-muted">{t("shift.open.body")}</p>
            <label className="block"><span className="font-semibold">{t("shift.float")}</span>
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(digits(e.target.value))} className="tabular mt-1 min-h-till w-full rounded-xl border border-border-strong bg-surface-raised px-4 text-2xl font-bold" />
            </label>
            <Button till className="w-full" disabled={busy || amount === ""} onClick={() => void open()}>{t("shift.open.confirm")}</Button>
          </>
        )}
      </Card>
    </div>
  );
}
