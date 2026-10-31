import { useState } from "react";
import { Link } from "react-router-dom";
import { t } from "../i18n";
import { shiftKey, type LocalShift } from "../features/shift/shift";
import { useShift } from "../features/shift/useShift";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

const digits = (v: string) => v.replace(/\D/g, "");

/**
 * S03. Opening a shift works offline (queued with an idempotency key).
 * Closing a shift is the cash-up count (Q01): the cashier counts first, then sees the variance.
 */
export function ShiftPage() {
  const { caps } = useSession();
  const sync = useSync();
  const money = useMoney();
  const { shift, loaded, reload } = useShift();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const userId = caps?.user.id ?? "";
  if (!loaded) return <p role="status" className="text-text-muted">{t("app.loading")}</p>;

  const isOpen = shift?.status === "open";

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

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t(isOpen ? "shift.close.title" : "shift.open.title")}</h1>
      <Card className="space-y-4 p-5">
        {isOpen && shift ? (
          <>
            <dl className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{t("shift.float")}</dt><dd className="tabular text-lg font-bold">{money(shift.openingFloat)}</dd></dl>
            <p className="text-text-muted">{t("shift.close.body")}</p>
            <Link to="/s/Q01" className="btn-spring inline-flex min-h-till w-full items-center justify-center rounded-xl bg-primary px-5 font-semibold text-primary-text shadow-card hover:bg-primary-hover">{t("shift.close.cta")}</Link>
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
