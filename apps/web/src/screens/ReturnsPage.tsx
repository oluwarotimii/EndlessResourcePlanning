import { CheckCircle2, Minus, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";
import { creditOf, refundFor, type Approval, type PaymentMethod, type SaleLookupResponse } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { refundKey, type LocalRefund } from "../features/shift/shift";
import { useShift } from "../features/shift/useShift";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { ApprovalStatusBadge } from "../ui/ApprovalStatusBadge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type Step = "find" | "choose" | "approval" | "done";
const errorText = (e: unknown) => (e instanceof ApiFailure ? (e.code === "unavailable" ? t("error.unavailable") : e.message) : t("error.generic"));

/**
 * T01. Customer return, in three steps: find the sale by its invoice number, choose what is coming back, then a manager approves
 * the refund and the return is completed. The refund is what the customer actually paid for those lines. Needs a connection,
 * because a refund must be approved by someone else.
 */
export function ReturnsPage() {
  const { api, token } = useSession();
  const tenant = useTenant();
  const money = useMoney();
  const sync = useSync();
  const { shift, loaded, reload } = useShift();
  const offline = sync.state === "offline";

  const [step, setStep] = useState<Step>("find");
  const [invoice, setInvoice] = useState("");
  const [found, setFound] = useState<SaleLookupResponse | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<Exclude<PaymentMethod, "credit">>("cash");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [done, setDone] = useState<LocalRefund | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Keys are kept across a failed attempt so a retry can never raise two requests or refund twice. */
  const keys = useRef({ approval: "", ret: "" });

  if (!loaded) return <p role="status" className="text-text-muted">{t("app.loading")}</p>;
  const methods = tenant.till.paymentMethods.filter((m): m is Exclude<PaymentMethod, "credit"> => m !== "credit");

  const selected = found ? Object.entries(qty).filter(([, n]) => n > 0).map(([productId, n]) => ({ productId, qty: n })) : [];
  const preview = found ? refundFor(found.sale, selected) : null;
  const creditShare = found && found.sale.total > 0 ? creditOf(found.sale.payments) / found.sale.total : 0;

  async function find() {
    if (!token || busy || !invoice.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await api.lookupSale(token, invoice.trim());
      setFound(res); setQty({}); setReason(""); setStep("choose");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  async function askManager() {
    if (!token || !found || !preview || busy || !reason) return;
    setBusy(true); setError(null);
    try {
      keys.current.approval ||= crypto.randomUUID();
      const res = await api.createApproval(token, {
        idempotencyKey: keys.current.approval, kind: "refund", amount: Math.max(1, preview.largestItem), unit: "naira",
        refund: { saleKey: found.sale.idempotencyKey, lines: selected, reason }, requestNote: reason,
      });
      setApproval(res.approval); setStep("approval");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  async function checkAgain() {
    if (!token || !approval || busy) return;
    setBusy(true); setError(null);
    try {
      const latest = (await api.approvals(token)).approvals.find((a) => a.id === approval.id);
      if (latest) setApproval(latest);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  async function complete() {
    if (!token || !found || !approval || !shift || shift.status !== "open" || busy) return;
    setBusy(true); setError(null);
    try {
      keys.current.ret ||= crypto.randomUUID();
      const res = await api.createReturn(token, {
        idempotencyKey: keys.current.ret, clientCreatedAt: new Date().toISOString(), shiftId: shift.id, saleKey: found.sale.idempotencyKey,
        lines: selected, reason, refundMethod: method, approvalId: approval.id,
      });
      const local: LocalRefund = {
        key: res.ret.idempotencyKey, shiftId: shift.id, invoiceNo: res.ret.invoiceNo, returnNo: res.ret.returnNo, refundTotal: res.ret.refundTotal,
        refundPaid: res.ret.refundPaid, refundToBalance: res.ret.refundToBalance, method: res.ret.refundMethod, at: res.ret.postedAt,
      };
      await sync.storage.kv.set(refundKey(res.ret.cashier.id, local.key), local); // a cash refund lowers the expected closing balance
      await reload();
      setDone(local); setStep("done");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const reset = () => {
    keys.current = { approval: "", ret: "" };
    setStep("find"); setInvoice(""); setFound(null); setQty({}); setReason(""); setApproval(null); setDone(null); setError(null);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("returns.title")}</h1>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("returns.offline")}</p>}
      {(!shift || shift.status !== "open") && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("returns.noShift")}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger-subtle p-4 font-medium text-danger-ink">{error}</p>}

      {step === "find" && (
        <Card className="space-y-3 p-5">
          <label htmlFor="invoice" className="block font-semibold">{t("returns.find.label")}</label>
          <form onSubmit={(e) => { e.preventDefault(); void find(); }} className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input id="invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="INV-000123" autoComplete="off"
              className="tabular min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-12 pr-4 text-lg" />
          </form>
          <Button till className="w-full" disabled={busy || offline || !invoice.trim()} onClick={() => void find()}>{t("returns.find.cta")}</Button>
        </Card>
      )}

      {step === "choose" && found && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="tabular text-xl font-bold">{found.sale.invoiceNo}</p>
            <p className="tabular text-text-muted">{new Date(found.sale.postedAt).toLocaleString()} · {money(found.sale.total)}</p>
          </div>
          <ul className="divide-y divide-border">
            {found.sale.lines.map((l) => {
              const left = l.qty - (found.returned[l.productId] ?? 0);
              const n = qty[l.productId] ?? 0;
              return (
                <li key={l.productId} className="flex items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name}</p>
                    <p className="tabular text-text-muted">{t("returns.sold", { sold: l.qty, left })}</p>
                  </div>
                  <Button variant="subtle" icon disabled={n <= 0} aria-label={t("returns.less", { name: l.name })} onClick={() => setQty((q) => ({ ...q, [l.productId]: n - 1 }))}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-8 text-center text-lg font-bold" aria-label={t("returns.qty", { name: l.name, n })}>{n}</span>
                  <Button variant="subtle" icon disabled={n >= left} aria-label={t("returns.more", { name: l.name })} onClick={() => setQty((q) => ({ ...q, [l.productId]: n + 1 }))}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
          <label className="block"><span className="font-semibold">{t("returns.reason")}</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg">
              <option value="">{t("returns.reason.choose")}</option>
              {tenant.returns.reasons.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block"><span className="font-semibold">{t("returns.method")}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as Exclude<PaymentMethod, "credit">)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg">
              {methods.map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
            </select>
          </label>
          <div className="rounded-xl bg-fill p-3">
            <p className="flex justify-between text-xl font-bold"><span>{t("returns.refund")}</span><span className="tabular" data-testid="refund">{money(preview?.total ?? 0)}</span></p>
            {creditShare > 0 && (preview?.total ?? 0) > 0 && <p className="mt-1 text-text-muted">{t("returns.creditNote")}</p>}
          </div>
          <div className="flex gap-2">
            <Button till className="flex-1" disabled={busy || offline || selected.length === 0 || !reason || !shift || shift.status !== "open"} onClick={() => void askManager()}>{t("returns.ask")}</Button>
            <Button till variant="ghost" onClick={reset}>{t("returns.startAgain")}</Button>
          </div>
        </Card>
      )}

      {step === "approval" && approval && (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xl font-bold">{t("returns.approval.title")}</p>
            <ApprovalStatusBadge status={approval.status} />
          </div>
          {approval.refund && <p className="tabular">{t("returns.approval.summary", { invoice: approval.refund.invoiceNo, amount: money(approval.refund.refundTotal) })}</p>}
          {approval.steps && (
            <ol className="space-y-2" aria-label={t("approval.chain")}>
              {approval.steps.map((st, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-fill p-3">
                  <span className="font-semibold">{t("approval.step", { n: i + 1, total: approval.steps!.length, roles: st.roles.join(" or ") })}</span>
                  <ApprovalStatusBadge status={st.status} />
                  {st.decidedBy && <span className="text-text-muted">{t("approval.decidedBy", { name: st.decidedBy.name })}</span>}
                </li>
              ))}
            </ol>
          )}
          {approval.status === "pending" && (
            <>
              <p className="text-text-muted">{t("returns.approval.waiting")}</p>
              <Button till className="w-full" disabled={busy || offline} onClick={() => void checkAgain()}>{t("returns.approval.check")}</Button>
            </>
          )}
          {approval.status === "approved" && (
            <Button till className="w-full" disabled={busy || offline || !shift || shift.status !== "open"} onClick={() => void complete()}>{t("returns.complete", { amount: money(approval.refund?.refundTotal ?? 0) })}</Button>
          )}
          {approval.status === "rejected" && (
            <>
              <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">{t("returns.rejected", { reason: approval.decisionReason ?? "" })}</p>
              <Button till variant="subtle" className="w-full" onClick={reset}>{t("returns.startAgain")}</Button>
            </>
          )}
        </Card>
      )}

      {step === "done" && done && (
        <Card className="space-y-2 p-5" role="status">
          <p className="flex items-center gap-2 text-2xl font-bold text-success-ink"><CheckCircle2 className="h-7 w-7" aria-hidden="true" />{t("returns.done", { no: done.returnNo })}</p>
          {done.refundPaid > 0 && <p className="tabular text-lg font-semibold">{t("returns.done.paid", { amount: money(done.refundPaid), method: t(`pay.${done.method}`) })}</p>}
          {done.refundToBalance > 0 && <p className="tabular text-lg font-semibold">{t("returns.done.balance", { amount: money(done.refundToBalance) })}</p>}
          <Button till className="mt-2 w-full" onClick={reset}>{t("returns.another")}</Button>
        </Card>
      )}
    </div>
  );
}
