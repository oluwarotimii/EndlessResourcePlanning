import { Camera } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DeliveryOrder } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PaymentBadge, itemsText } from "../ui/DeliveryBadges";

const MAX_PHOTO = 500_000;

/**
 * L03. Proof of delivery in 3 taps: Delivered, collect the cash if it is cash on delivery, Confirm. Or "Could not deliver", a reason, Confirm.
 * It is saved on the phone and sent when there is a connection, so it works offline.
 */
export function ProofOfDeliveryPage() {
  const { api } = useSession();
  const tenant = useTenant();
  const money = useMoney();
  const sync = useSync();
  const [params] = useSearchParams();
  const list = useCachedReport<{ orders: DeliveryOrder[] }>("delivery-orders", (tk) => api.deliveryOrders(tk));
  const order = list.data?.orders.find((o) => o.id === params.get("order"));
  const [outcome, setOutcome] = useState<"delivered" | "failed" | null>(null);
  const [cashChoice, setCashChoice] = useState<"full" | "other">("full");
  const [other, setOther] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const back = <Link to="/s/L02" className="btn-spring inline-flex min-h-touch items-center rounded-xl px-3 font-semibold text-primary-ink hover:bg-primary-subtle">{t("deliv.proof.back")}</Link>;
  if (!order || order.status !== "assigned") {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">{t("deliv.proof.title")}</h1>
        {done ? <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("deliv.proof.saved")}</p> : <p className="text-text-muted">{t("deliv.proof.pick")}</p>}
        {back}
      </div>
    );
  }

  const cod = order.payment === "cash_on_delivery";
  const collected = cashChoice === "full" ? order.amountDue : Number(other || 0);
  const cashOk = !cod || collected === order.amountDue;
  const ready = outcome === "delivered" ? cashOk : outcome === "failed" ? reason.length >= 2 : false;

  const onPhoto = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_PHOTO) { setPhotoMsg(t("deliv.proof.photoBig")); setPhoto(undefined); return; }
    setPhotoMsg(null);
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  async function confirm() {
    if (!ready || busy || !outcome) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      await sync.enqueue({
        id, type: "delivery.proof", recordKey: `delivery:${order!.id}`,
        payload: outcome === "delivered"
          ? { idempotencyKey: id, orderId: order!.id, outcome, recipient: (recipient ?? order!.customerName).trim(), cashCollected: cod ? collected : undefined, photo, at }
          : { idempotencyKey: id, orderId: order!.id, outcome, failedReason: reason, photo, at },
      });
      // Reflect it on this phone at once so the same delivery is never recorded twice.
      await list.update((d) => ({ orders: d.orders.map((o) => (o.id === order!.id ? { ...o, status: outcome, deliveredAt: at, failedReason: outcome === "failed" ? reason : undefined, cashCollected: outcome === "delivered" && cod ? collected : undefined } : o)) }));
      setDone(true);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("deliv.proof.title")}</h1>
      <Card className="space-y-2 p-4">
        <p className="tabular text-lg font-bold">{order.id} · {order.customerName}</p>
        <p>{order.address}</p>
        <p className="tabular text-text-muted">{itemsText(order)}</p>
        <PaymentBadge order={order} />
      </Card>

      {!outcome && (
        <div className="grid gap-3">
          <Button till className="w-full" onClick={() => setOutcome("delivered")}>{t("deliv.proof.delivered")}</Button>
          <Button till variant="subtle" className="w-full" onClick={() => setOutcome("failed")}>{t("deliv.proof.failed")}</Button>
        </div>
      )}

      {outcome === "delivered" && (
        <Card className="space-y-4 p-4">
          {cod && (
            <div className="space-y-2">
              <p className="font-semibold">{t("deliv.proof.cashAsk")}</p>
              <Button till variant={cashChoice === "full" ? "primary" : "subtle"} aria-pressed={cashChoice === "full"} className="w-full" onClick={() => setCashChoice("full")}>{t("deliv.proof.cashFull", { amount: money(order.amountDue) })}</Button>
              <Button variant={cashChoice === "other" ? "primary" : "subtle"} aria-pressed={cashChoice === "other"} className="w-full" onClick={() => setCashChoice("other")}>{t("deliv.proof.cashOther")}</Button>
              {cashChoice === "other" && <input aria-label={t("deliv.proof.cashAsk")} inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value.replace(/\D/g, ""))} className="tabular min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg" />}
              {!cashOk && <p role="alert" className="font-medium text-danger-ink">{t("deliv.proof.cashMust", { amount: money(order.amountDue) })}</p>}
            </div>
          )}
          <label className="block"><span className="font-semibold">{t("deliv.proof.recipient")}</span>
            <input value={recipient ?? order.customerName} onChange={(e) => setRecipient(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg" />
          </label>
          <label className="btn-spring inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-xl border border-border bg-fill px-4 font-semibold hover:bg-fill-hover">
            <Camera className="h-5 w-5" aria-hidden="true" />{t("deliv.proof.photo")}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
          {photoMsg && <p role="alert" className="font-medium text-danger-ink">{photoMsg}</p>}
          <Button till className="w-full" disabled={!ready || busy} onClick={() => void confirm()}>{t("deliv.proof.confirm")}</Button>
        </Card>
      )}

      {outcome === "failed" && (
        <Card className="space-y-4 p-4">
          <label className="block"><span className="font-semibold">{t("deliv.proof.reason")}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg">
              <option value="">{t("deliv.proof.reason.choose")}</option>
              {tenant.delivery.failedReasons.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Button till className="w-full" disabled={!ready || busy} onClick={() => void confirm()}>{t("deliv.proof.confirm")}</Button>
        </Card>
      )}
      {outcome && <Button variant="ghost" onClick={() => setOutcome(null)}>{t("deliv.proof.change")}</Button>}
    </div>
  );
}
