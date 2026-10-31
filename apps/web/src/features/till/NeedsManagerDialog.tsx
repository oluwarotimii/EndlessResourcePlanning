import { useEffect, useState } from "react";
import { ArrowLeft, Send, ShieldCheck, UserRoundCog } from "lucide-react";
import { CreateApprovalInput, discountAmount, type Approval } from "@erp/api-contract";
import { ApiFailure } from "../../api/client";
import { t, type TextKey } from "../../i18n";
import { useSession } from "../../state/session";
import { useSync } from "../../state/sync";
import { useMoney } from "../../state/tenant";
import { ApprovalStatusBadge } from "../../ui/ApprovalStatusBadge";
import { Button } from "../../ui/Button";

type Mode = "choose" | "discount" | "void";

const failureText = (e: unknown): string => {
  if (e instanceof ApiFailure && e.code === "unavailable") return t("till.manager.offline");
  return t("till.manager.error");
};

/**
 * S05. A cashier asks a manager for a discount or a void. Nothing changes on the till until
 * an approval comes back; the server, not this screen, decides who may approve and how much.
 */
export function NeedsManagerDialog({
  open, total, discounted, onClose, onDiscount, onVoid,
}: {
  open: boolean;
  /** The sale total after any discount already applied. */
  total: number;
  /** A discount is already on the cart, so only a void can be requested now. */
  discounted: boolean;
  onClose(): void;
  onDiscount(percent: number, approvalId: string): void;
  onVoid(): void;
}) {
  const { api, token, caps } = useSession();
  const { state: connection } = useSync();
  const money = useMoney();
  const [mode, setMode] = useState<Mode>("choose");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [request, setRequest] = useState<Approval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offline = connection === "offline";

  useEffect(() => {
    if (!open) return;
    setMode("choose"); setPercent(""); setNote(""); setRequest(null); setError(null); setBusy(false);
  }, [open]);

  if (!open || !caps) return null;

  const value = Number(percent);
  const validPercent = Number.isInteger(value) && value >= 1 && value <= 100;
  const preview = mode === "discount" && validPercent ? discountAmount(total, value) : 0;

  async function send(kind: "discount" | "void") {
    if (!token || offline || busy) return;
    const parsed = CreateApprovalInput.safeParse({
      idempotencyKey: crypto.randomUUID(),
      kind,
      amount: kind === "discount" ? value : total,
      unit: kind === "discount" ? "percent" : "naira",
      requestNote: note.trim() || undefined,
    });
    if (!parsed.success) {
      setError(t(kind === "discount" ? "till.manager.badAmount" : "till.manager.error"));
      return;
    }
    setBusy(true); setError(null);
    try {
      const res = await api.createApproval(token, parsed.data);
      setRequest(res.approval);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!token || !request || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.approvals(token);
      const found = res.approvals.find((a) => a.id === request.id);
      if (!found) {
        setError(t("till.manager.error"));
        return;
      }
      setRequest(found);
      if (found.status === "approved") {
        if (found.kind === "discount") onDiscount(found.amount, found.id);
        else onVoid();
        onClose();
      }
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  }

  const title = request
    ? t("till.manager.waiting")
    : mode === "discount" ? t("till.manager.discountTitle") : mode === "void" ? t("till.manager.voidTitle") : t("till.manager.title");

  const noteField = (
    <>
      <label htmlFor="manager-note" className="block font-semibold">{t("till.manager.note")}</label>
      <textarea
        id="manager-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
        className="min-h-touch w-full rounded-xl border border-border bg-fill p-3 text-text"
      />
    </>
  );

  return (
    <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="manager-title" className="glass-panel w-full max-w-lg rounded-2xl p-5">
        <h2 id="manager-title" className="text-2xl font-bold">{title}</h2>

        {request ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-primary-ink">{t(`approval.kind.${request.kind}` as TextKey)}</p>
                <p className="tabular text-text-muted">{request.unit === "percent" ? `${request.amount}%` : money(request.amount)}</p>
              </div>
              <ApprovalStatusBadge status={request.status} />
            </div>
            <p className="text-text-muted">{t("till.manager.requested", { id: request.id })}</p>
            {request.requestNote && <p><span className="text-text-muted">{t("approval.note")}: </span>{request.requestNote}</p>}

            {request.status === "pending" && (offline ? (
              <p className="rounded-xl bg-warning-subtle p-3 text-warning-ink">{t("till.manager.offline")}</p>
            ) : (
              <Button till className="w-full" disabled={busy} onClick={() => void check()}>
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />{t(busy ? "till.manager.checking" : "till.manager.check")}
              </Button>
            ))}

            {request.status === "rejected" && (
              <div className="space-y-2">
                <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">
                  {t("till.manager.rejected")}{request.decisionReason ? ` · ${request.decisionReason}` : ""}
                </p>
                <Button till className="w-full" onClick={() => { setRequest(null); setMode("choose"); }}>{t("till.manager.askAgain")}</Button>
              </div>
            )}

            {error && <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">{error}</p>}
            <Button variant="subtle" className="w-full" onClick={onClose}>{t("till.manager.close")}</Button>
          </div>
        ) : mode === "choose" ? (
          <div className="mt-3 space-y-2">
            <p className="text-text-muted">{t("till.manager.choose")}</p>
            {!discounted && (
              <Button till className="w-full" onClick={() => setMode("discount")}>
                <UserRoundCog className="h-5 w-5" aria-hidden="true" />{t("till.manager.discountOption")}
              </Button>
            )}
            <Button till variant="subtle" className="w-full" onClick={() => setMode("void")}>{t("till.manager.voidOption")}</Button>
            <Button variant="ghost" className="w-full" onClick={onClose}>{t("till.manager.close")}</Button>
          </div>
        ) : mode === "discount" ? (
          <div className="mt-3 space-y-3">
            <p className="text-text-muted">{t("till.manager.discountBody")}</p>
            <label htmlFor="manager-percent" className="block font-semibold">{t("till.manager.percent")}</label>
            <input
              id="manager-percent" inputMode="numeric" autoFocus value={percent}
              onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className="tabular min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg"
            />
            <p className="tabular text-text-muted">{t("till.manager.saleTotal")}: {money(total)}</p>
            {preview > 0 && <p className="tabular font-semibold">{t("till.manager.newTotal", { amount: money(total - preview) })}</p>}
            {noteField}
            {offline ? (
              <p className="rounded-xl bg-warning-subtle p-3 text-warning-ink">{t("till.manager.offline")}</p>
            ) : (
              <Button till className="w-full" disabled={busy || !validPercent} onClick={() => void send("discount")}>
                <Send className="h-5 w-5" aria-hidden="true" />{t(busy ? "till.manager.sending" : "till.manager.send")}
              </Button>
            )}
            {error && <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">{error}</p>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => { setMode("choose"); setError(null); }}>
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />{t("till.manager.back")}
              </Button>
              <Button variant="subtle" onClick={onClose}>{t("till.manager.close")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-text-muted">{t("till.manager.voidBody")}</p>
            <p className="tabular font-bold">{t("till.manager.saleTotal")}: {money(total)}</p>
            {noteField}
            {offline ? (
              <p className="rounded-xl bg-warning-subtle p-3 text-warning-ink">{t("till.manager.offline")}</p>
            ) : (
              <Button till className="w-full" disabled={busy} onClick={() => void send("void")}>
                <Send className="h-5 w-5" aria-hidden="true" />{t(busy ? "till.manager.sending" : "till.manager.send")}
              </Button>
            )}
            {error && <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">{error}</p>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => { setMode("choose"); setError(null); }}>
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />{t("till.manager.back")}
              </Button>
              <Button variant="subtle" onClick={onClose}>{t("till.manager.close")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
