import { useEffect, useRef, useState } from "react";
import type { Approval, ApprovalUnit } from "@erp/api-contract";
import { mayDecideApproval, withinApprovalLimitFor } from "@erp/permissions";
import { ApiFailure } from "../api/client";
import { t, type TextKey } from "../i18n";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { ApprovalStatusBadge } from "../ui/ApprovalStatusBadge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { HoldToConfirm } from "../ui/HoldToConfirm";
import { Money } from "../ui/Money";

function Figure({ value, unit }: { value: number; unit: ApprovalUnit }) {
  if (unit === "percent") return <span className="tabular font-bold">{value}%</span>;
  return <Money amount={value} />;
}

const decisionMessage = (e: unknown): string => {
  if (!(e instanceof ApiFailure)) return t("approval.error.generic");
  if (e.code === "unavailable") return t("approval.error.unavailable");
  if (e.code === "forbidden") return t("approval.error.forbidden");
  if (e.code === "validation") return t("approval.error.validation");
  return t("approval.error.generic");
};

/** A01. The approvals inbox: who, what, the amount and the limit; a deliberate hold to approve; a reason to reject. */
export function ApprovalsPage() {
  const { api, token, caps } = useSession();
  const { state: connection } = useSync();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [error, setError] = useState<"unavailable" | "generic" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{ id: string; message: string } | null>(null);
  /** One key per action, kept across a failed attempt so a retry can never decide twice. */
  const keys = useRef(new Map<string, string>());
  const offline = connection === "offline";

  useEffect(() => {
    if (!token) return;
    let live = true;
    setError(null);
    api.approvals(token)
      .then((r) => { if (live) setApprovals(r.approvals); })
      .catch((e) => { if (live) setError(e instanceof ApiFailure && e.code === "unavailable" ? "unavailable" : "generic"); });
    return () => { live = false; };
  }, [api, token, attempt]);

  if (!caps) return null;

  const decide = async (approval: Approval, decision: "approve" | "reject", why?: string) => {
    const slot = `${approval.id}:${decision}`;
    let idempotencyKey = keys.current.get(slot);
    if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); keys.current.set(slot, idempotencyKey); }
    setBusy(approval.id);
    setDecisionError(null);
    try {
      const res = await api.decideApproval(token ?? "", approval.id, { idempotencyKey, decision, reason: why });
      keys.current.delete(slot);
      setApprovals((list) => list?.map((a) => (a.id === res.approval.id ? res.approval : a)) ?? null);
      setRejecting(null);
      setReason("");
    } catch (e) {
      setDecisionError({ id: approval.id, message: decisionMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const openReject = (approval: Approval) => {
    setReason("");
    setDecisionError(null);
    setRejecting(approval);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("approval.title")}</h1>
        <p className="text-text-muted">{t("approval.subtitle")}</p>
      </div>

      {offline && (
        <p role="status" className="rounded-xl bg-warning-subtle p-4 text-warning-ink">{t("approval.offline")}</p>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(error === "unavailable" ? "approval.error.unavailable" : "approval.loadFailed")}</span>
          <Button variant="subtle" onClick={() => setAttempt((n) => n + 1)}>{t("approval.retry")}</Button>
        </div>
      )}

      {!approvals && !error && <p role="status" className="text-text-muted">{t("app.loading")}</p>}
      {approvals?.length === 0 && <p className="text-text-muted">{t("approval.empty")}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {approvals?.map((a) => {
          const canDecide = mayDecideApproval(caps, a.kind, a.requestedBy.id);
          const withinLimit = withinApprovalLimitFor(caps, a.kind, a.amount);
          const ownRequest = a.requestedBy.id === caps.user.id;
          return (
            <Card key={a.id} className="p-4 sm:p-5" data-testid={`approval-${a.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-primary-ink">{t(`approval.kind.${a.kind}` as TextKey)}</p>
                  <p className="text-text-muted">{t("approval.requestedBy", { name: a.requestedBy.name })}</p>
                </div>
                <ApprovalStatusBadge status={a.status} />
              </div>

              <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-fill p-3">
                  <dt className="text-text-muted">{t("approval.amount")}</dt>
                  <dd><Figure value={a.amount} unit={a.unit} /></dd>
                </div>
                <div className="rounded-xl bg-fill p-3">
                  <dt className="text-text-muted">{t("approval.limit")}</dt>
                  <dd><Figure value={a.limit} unit={a.unit} /></dd>
                </div>
                {a.customerName && (
                  <div className="rounded-xl bg-fill p-3 sm:col-span-2">
                    <dt className="text-text-muted">{t("approval.customer")}</dt>
                    <dd className="font-semibold">{a.customerName}</dd>
                  </div>
                )}
              </dl>

              {a.requestNote && <p className="mt-3"><span className="text-text-muted">{t("approval.note")}: </span>{a.requestNote}</p>}
              {a.status !== "pending" && a.decidedBy && (
                <p className="mt-2 text-text-muted">
                  {t("approval.decidedBy", { name: a.decidedBy.name })}
                  {a.decisionReason ? ` · ${a.decisionReason}` : ""}
                </p>
              )}

              {a.status === "pending" && (
                <div className="mt-4">
                  {offline ? (
                    <p className="rounded-xl bg-warning-subtle p-3 text-warning-ink">{t("approval.offline")}</p>
                  ) : canDecide && withinLimit ? (
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                      <HoldToConfirm
                        label={t("approval.hold")}
                        hint={t("approval.holdHint")}
                        disabled={busy === a.id}
                        onConfirm={() => void decide(a, "approve")}
                      />
                      <Button variant="subtle" disabled={busy === a.id} onClick={() => openReject(a)}>{t("approval.reject")}</Button>
                    </div>
                  ) : (
                    <p className="text-text-muted">{ownRequest ? t("approval.own") : canDecide ? t("approval.aboveLimit") : t("approval.notYours")}</p>
                  )}
                </div>
              )}

              {decisionError?.id === a.id && !rejecting && (
                <p role="alert" className="mt-3 rounded-xl bg-danger-subtle p-3 text-danger-ink">{decisionError.message}</p>
              )}
            </Card>
          );
        })}
      </div>

      {rejecting && (
        <div className="scrim fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="glass-panel w-full max-w-lg rounded-2xl p-5">
            <h2 id="reject-title" className="text-2xl font-bold">{t("approval.reject.title")}</h2>
            <p className="mt-1 text-text-muted">{t("approval.reject.body")}</p>
            <label htmlFor="reject-reason" className="mt-4 block font-semibold">{t("approval.reject.reason")}</label>
            <p className="text-text-muted">{t("approval.reject.reasonHint")}</p>
            <textarea
              id="reject-reason"
              autoFocus
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-2 min-h-touch w-full rounded-xl border border-border bg-fill p-3 text-text"
            />
            {reason.trim().length < 3 && <p className="mt-1 text-warning-ink">{t("approval.reject.required")}</p>}
            {decisionError?.id === rejecting.id && (
              <p role="alert" className="mt-2 rounded-xl bg-danger-subtle p-3 text-danger-ink">{decisionError.message}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="subtle" onClick={() => { setRejecting(null); setDecisionError(null); }}>{t("approval.cancel")}</Button>
              <Button
                variant="secondary"
                disabled={reason.trim().length < 3 || busy === rejecting.id}
                onClick={() => void decide(rejecting, "reject", reason.trim())}
              >
                {t("approval.reject.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
