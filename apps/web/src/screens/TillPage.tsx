import { CheckCircle2, Minus, PauseCircle, Plus, Printer, ScanBarcode, Search, ShieldCheck, UserRound, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { computeTotals, creditOf, discountAmount, type Customer, type Payment, type PaymentMethod, type Product, type SaleInput } from "@erp/api-contract";
import { t } from "../i18n";
import { addProduct, cartSubtotal, emptyCart, itemCount, lineTotal, setQty, type Cart } from "../features/till/cart";
import { cacheCatalog, findExact, loadCachedCatalog, search } from "../features/till/catalog";
import { availableCredit, searchCustomers } from "../features/till/customers";
import { saleBlock } from "../features/till/limits";
import { NeedsManagerDialog } from "../features/till/NeedsManagerDialog";
import { provisionalNumber, saleKey, type LocalSale } from "../features/shift/shift";
import { useShift } from "../features/shift/useShift";
import { usePrint } from "../features/print/PrintProvider";
import type { PrintDoc } from "../features/print/types";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export const toPrintDoc = (s: LocalSale, kind: PrintDoc["kind"], synced: boolean): PrintDoc => ({
  kind, number: s.invoiceNo ?? s.provisionalNo, copy: !synced, date: new Date(s.createdAt).toLocaleString(),
  cashier: s.cashierName, customer: s.customerName, lines: s.lines,
  subtotal: s.subtotal, discount: s.discount, discountPercent: s.discountPercent,
  vatMode: s.vatMode, vat: s.vat, total: s.total, payments: s.payments,
});

const digits = (v: string) => v.replace(/\D/g, "");

export function TillPage() {
  const { api, token, caps } = useSession();
  const tenant = useTenant();
  const money = useMoney();
  const sync = useSync();
  const { print } = usePrint();
  const { shift, sales, loaded, reload } = useShift();
  const userId = caps?.user.id ?? "";
  const kv = sync.storage.kv;
  const cartKey = `cart:${userId}`;
  const offline = sync.state === "offline";

  const [products, setProducts] = useState<Product[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "missing">("loading");
  const [cart, setCart] = useState<Cart>(emptyCart());
  const [cartLoaded, setCartLoaded] = useState(false);
  const [term, setTerm] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState("");
  const [done, setDone] = useState<LocalSale | null>(null);
  const [custTerm, setCustTerm] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [custStale, setCustStale] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [split, setSplit] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Catalogue: show the cached copy at once, refresh from the server when reachable.
  useEffect(() => {
    let live = true;
    void (async () => {
      const cached = await loadCachedCatalog(sync.storage);
      if (live && cached) { setProducts(cached.products); setCatalogState("ready"); }
      if (!token || offline) { if (live && !cached) setCatalogState("missing"); return; }
      try {
        const fresh = await api.products(token);
        await cacheCatalog(sync.storage, fresh);
        if (live) { setProducts(fresh.products); setCatalogState("ready"); }
      } catch { if (live && !cached) setCatalogState("missing"); }
    })();
    return () => { live = false; };
  }, [api, token, sync.storage, offline]);

  // The cart survives reloads and crashes.
  useEffect(() => { void kv.get<Cart>(cartKey).then((c) => { if (c) setCart(c); setCartLoaded(true); }); }, [kv, cartKey]);
  useEffect(() => { if (cartLoaded) void kv.set(cartKey, cart); }, [cart, cartLoaded, kv, cartKey]);
  useEffect(() => { input.current?.focus(); }, [loaded, done]);

  // An approved discount comes off the gross subtotal before VAT; the server checks both again.
  const grossSubtotal = cartSubtotal(cart);
  const discount = cart.discount ? discountAmount(grossSubtotal, cart.discount.percent) : 0;
  const totals = computeTotals(grossSubtotal - discount, tenant.tax.mode, tenant.tax.vatRate);
  const rate = String(+(tenant.tax.vatRate * 100).toFixed(2));
  const block = saleBlock(sync.queue, tenant.offline);
  const results = useMemo(() => search(products, term).slice(0, 24), [products, term]);

  const add = useCallback((p: Product) => {
    setNotice(null); setDone(null);
    setCart((c) => addProduct(c, p));
    setTerm("");
    input.current?.focus();
  }, []);

  // A scanner types the code and presses Enter. Exact barcode or SKU adds the item; one search hit adds it too.
  const onEnter = () => {
    const exact = findExact(products, term);
    if (exact) return add(exact);
    if (results.length === 1 && term.trim()) return add(results[0]!);
    if (term.trim()) setNotice(t("till.notFound", { code: term.trim() }));
  };

  /** Why this much on credit is not allowed, or null when it is fine. The server checks again when the sale syncs. */
  function creditProblem(amount: number): string | null {
    if (amount <= 0) return null;
    if (!cart.customer) return t("till.credit.needCustomer");
    const available = availableCredit(cart.customer);
    if (available === undefined) return t("till.credit.noTerms", { name: cart.customer.name });
    if (amount > available) return t("till.credit.over", { name: cart.customer.name, available: money(available) });
    return null;
  }

  async function charge(payments: Payment[]) {
    const total = totals.total;
    const credit = creditOf(payments);
    if (busy || !shift || shift.status !== "open" || cart.lines.length === 0 || block || !caps) return;
    if (payments.reduce((n, p) => n + p.amount, 0) !== total || creditProblem(credit)) return;
    setBusy(true);
    try {
      // Reuse the key if a previous attempt was interrupted, so the server can never post two sales.
      const key = cart.chargeKey ?? crypto.randomUUID();
      const now = new Date().toISOString();
      const payload: SaleInput = {
        idempotencyKey: key, clientCreatedAt: now, shiftId: shift.id, customerId: cart.customer?.id,
        lines: cart.lines, subtotal: grossSubtotal, vatMode: tenant.tax.mode, vat: totals.vat, total,
        discountApprovalId: cart.discount?.approvalId, payments,
      };
      await kv.set(cartKey, { ...cart, chargeKey: key });
      const local: LocalSale = {
        key, shiftId: shift.id, lines: cart.lines, subtotal: grossSubtotal, discount: discount || undefined,
        discountPercent: cart.discount?.percent, discountApprovalId: cart.discount?.approvalId,
        vatMode: tenant.tax.mode, vat: totals.vat, total, payments,
        customerName: cart.customer?.name, cashierName: caps.user.name, createdAt: now, provisionalNo: provisionalNumber(key), synced: false,
      };
      await kv.set(saleKey(userId, key), local);
      await sync.enqueue({ id: key, type: "sale.create", recordKey: shift.id, payload });
      setCart(emptyCart()); setReceived(""); setSplit({}); setSplitOpen(false); setDone(local);
      await reload();
      if (tenant.print.autoPrint) print(toPrintDoc(local, "receipt", false));
    } finally { setBusy(false); }
  }

  function applyDiscount(percent: number, approvalId: string) {
    setCart((c) => ({ ...c, discount: { approvalId, percent }, chargeKey: undefined }));
    setNotice(t("till.discountApproved", { rate: percent }));
  }

  function applyVoid() {
    setCart(emptyCart()); setReceived(""); setSplit({}); setSplitOpen(false);
    setNotice(t("till.voidApproved"));
  }

  async function park() {
    if (cart.lines.length === 0) return;
    const id = crypto.randomUUID();
    await kv.set(`parked:${userId}:${id}`, { id, savedAt: new Date().toISOString(), cart: { ...cart, chargeKey: undefined } });
    setCart(emptyCart()); setNotice(t("till.parked"));
  }

  async function findCustomers(q: string) {
    setCustTerm(q);
    if (!token) return;
    const r = await searchCustomers(api, token, sync.storage, q, !offline);
    setCustResults(r.customers); setCustStale(r.fromCache);
  }
  useEffect(() => { if (custOpen) void findCustomers(custTerm); }, [custOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneSale = done ? sales.find((s) => s.key === done.key) ?? done : null;
  const doneSynced = doneSale ? !sync.queue.some((i) => i.id === doneSale.key) : false;
  const change = Number(received) > totals.total ? Number(received) - totals.total : 0;

  // Split payment bookkeeping
  const methods = tenant.till.paymentMethods;
  const splitPayments: Payment[] = methods.flatMap((m) => (Number(split[m] ?? 0) > 0 ? [{ method: m, amount: Number(split[m]) }] : []));
  const entered = splitPayments.reduce((n, p) => n + p.amount, 0);
  const remaining = totals.total - entered;
  const splitCreditProblem = creditProblem(creditOf(splitPayments));

  if (!loaded || !cartLoaded) return <p role="status" className="text-text-muted">{t("app.loading")}</p>;

  if (!shift || shift.status !== "open") {
    return (
      <Card className="mx-auto max-w-xl p-6 text-center">
        <h1 className="text-2xl font-bold">{t("till.noShift.title")}</h1>
        <p className="mt-1 text-text-muted">{t("till.noShift.body")}</p>
        <Link to="/s/S03" className="btn-spring mt-4 inline-flex min-h-till items-center rounded-xl bg-primary px-6 font-semibold text-primary-text hover:bg-primary-hover">{t("till.noShift.cta")}</Link>
      </Card>
    );
  }

  const payDisabled = busy || cart.lines.length === 0 || !!block;
  const wholeCreditProblem = cart.lines.length > 0 && methods.includes("credit") ? creditProblem(totals.total) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
      <section aria-label={t("till.find")} className="space-y-4">
        <h1 className="sr-only">{t("till.title")}</h1>
        <form onSubmit={(e) => { e.preventDefault(); onEnter(); }} className="relative">
          <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <label htmlFor="scan" className="sr-only">{t("till.scanLabel")}</label>
          <input
            id="scan" ref={input} value={term} onChange={(e) => { setTerm(e.target.value); setNotice(null); }} autoComplete="off" autoFocus
            placeholder={t("till.scanPlaceholder")}
            className="min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-14 pr-4 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </form>
        <p role="status" className={`min-h-[1.5rem] font-medium ${notice ? "text-danger-ink" : "text-text-muted"}`}>
          {notice ?? (catalogState === "missing" ? t("till.catalogMissing") : catalogState === "loading" ? t("app.loading") : "")}
        </p>
        {block && (
          <p role="alert" className="flex items-center gap-2 rounded-xl bg-warning-subtle p-4 font-semibold text-warning-ink">
            <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />{t(block === "cap" ? "till.block.cap" : "till.block.window")}
          </p>
        )}
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {results.map((p) => (
            <li key={p.id}>
              <button onClick={() => add(p)} className="btn-spring glass-card glass-card-lift flex min-h-till w-full flex-col items-start rounded-xl p-3 text-left">
                <span className="font-semibold leading-tight">{p.name}</span>
                <span className="tabular font-bold text-primary-ink">{money(p.price)}</span>
              </button>
            </li>
          ))}
        </ul>
        {results.length === 0 && catalogState === "ready" && <p className="text-text-muted">{t("till.noResults")}</p>}
      </section>

      <aside aria-label={t("till.cart")} className="space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{t("till.cart")}</h2>
            <span className="tabular text-text-muted">{t("till.items", { n: itemCount(cart) })}</span>
          </div>
          {cart.lines.length === 0 ? (
            <p className="py-6 text-center text-text-muted">{t("till.empty")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {cart.lines.map((l) => (
                <li key={l.productId} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{l.name}</p><p className="tabular text-text-muted">{money(l.unitPrice)}</p></div>
                  <Button variant="subtle" icon aria-label={t("till.less", { name: l.name })} onClick={() => setCart((c) => setQty(c, l.productId, l.qty - 1))}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-8 text-center text-lg font-bold" aria-label={t("till.qty", { n: l.qty })}>{l.qty}</span>
                  <Button variant="subtle" icon aria-label={t("till.more", { name: l.name })} onClick={() => setCart((c) => setQty(c, l.productId, l.qty + 1))}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-24 text-right font-bold">{money(lineTotal(l))}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-3 space-y-1 border-t border-border-strong pt-3">
            {tenant.tax.mode === "exclusive" && (
              <div className="flex justify-between text-text-muted"><dt>{t("till.subtotal")}</dt><dd className="tabular" data-testid="subtotal">{money(grossSubtotal)}</dd></div>
            )}
            {discount > 0 && cart.discount && (
              <div className="flex justify-between text-text-muted">
                <dt>{t("till.discount", { rate: cart.discount.percent })}</dt>
                <dd className="tabular" data-testid="discount">-{money(discount)}</dd>
              </div>
            )}
            {tenant.tax.mode !== "none" && (
              <div className="flex justify-between text-text-muted"><dt>{t(tenant.tax.mode === "exclusive" ? "till.vat.exclusive" : "till.vat.inclusive", { rate })}</dt><dd className="tabular" data-testid="vat">{money(totals.vat)}</dd></div>
            )}
            <div className="flex justify-between text-2xl font-bold"><dt>{t("till.total")}</dt><dd className="tabular" data-testid="total">{money(totals.total)}</dd></div>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-xl font-bold">{t("till.pay")}</h2>
          {!splitOpen ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {methods.map((m) => (
                  <Button key={m} till disabled={payDisabled || (m === "credit" && !!wholeCreditProblem)} onClick={() => void charge([{ method: m, amount: totals.total }])}>{t(`pay.${m}`)}</Button>
                ))}
              </div>
              {wholeCreditProblem && <p className="mt-2 text-text-muted" data-testid="credit-hint">{wholeCreditProblem}</p>}
              <label className="mt-3 block">
                <span className="text-text-muted">{t("till.received")}</span>
                <input inputMode="numeric" value={received} onChange={(e) => setReceived(digits(e.target.value))} className="tabular mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg" />
              </label>
              {change > 0 && <p className="mt-2 font-bold tabular" role="status">{t("till.change", { amount: money(change) })}</p>}
              {tenant.till.allowSplitPayments && (
                <Button variant="subtle" className="mt-3 w-full" disabled={cart.lines.length === 0} onClick={() => setSplitOpen(true)}>{t("till.split")}</Button>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-text-muted">{t("till.splitHint")}</p>
              {methods.map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <label htmlFor={`split-${m}`} className="w-24 font-semibold">{t(`pay.${m}`)}</label>
                  <input
                    id={`split-${m}`} inputMode="numeric" value={split[m] ?? ""}
                    onChange={(e) => setSplit((s) => ({ ...s, [m]: digits(e.target.value) }))}
                    className="tabular min-h-touch min-w-0 flex-1 rounded-xl border border-border-strong bg-surface-raised px-3 text-lg"
                  />
                  <Button variant="subtle" aria-label={t("till.restFor", { method: t(`pay.${m}`) })} disabled={remaining <= 0} onClick={() => setSplit((s) => ({ ...s, [m]: String(Number(s[m] ?? 0) + remaining) }))}>{t("till.rest")}</Button>
                </div>
              ))}
              <dl className="space-y-1 rounded-xl bg-fill p-3">
                <div className="flex justify-between"><dt>{t("till.paid")}</dt><dd className="tabular font-bold">{money(entered)}</dd></div>
                <div className="flex justify-between"><dt>{t(remaining < 0 ? "till.over" : "till.remaining")}</dt><dd className={`tabular font-bold ${remaining === 0 ? "text-success-ink" : "text-warning-ink"}`} data-testid="remaining">{money(Math.abs(remaining))}</dd></div>
                {creditOf(splitPayments) > 0 && <div className="flex justify-between"><dt>{t("till.onCreditLabel")}</dt><dd className="tabular font-bold">{money(creditOf(splitPayments))}</dd></div>}
              </dl>
              {splitCreditProblem && <p role="alert" className="font-medium text-danger-ink">{splitCreditProblem}</p>}
              <div className="flex gap-2">
                <Button till className="flex-1" disabled={payDisabled || remaining !== 0 || entered === 0 || !!splitCreditProblem} onClick={() => void charge(splitPayments)}>{t("till.confirmSplit")}</Button>
                <Button till variant="ghost" onClick={() => { setSplitOpen(false); setSplit({}); }}>{t("till.splitClose")}</Button>
              </div>
            </div>
          )}
          {!offline && (
            <Button variant="subtle" className="mt-2 w-full" disabled={payDisabled} onClick={() => setManagerOpen(true)}>
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />{t("till.needsManager")}
            </Button>
          )}
          <Button variant="ghost" className="mt-2 w-full" disabled={cart.lines.length === 0} onClick={() => void park()}>
            <PauseCircle className="h-5 w-5" aria-hidden="true" />{t("till.park")}
          </Button>
        </Card>

        <Card className="p-4">
          <button onClick={() => setCustOpen((o) => !o)} className="btn-spring flex min-h-touch w-full items-center gap-2 rounded-xl text-left font-semibold">
            <UserRound className="h-5 w-5" aria-hidden="true" />
            {cart.customer ? cart.customer.name : t("till.walkIn")}
            <span className="ml-auto text-primary-ink">{t("till.customer")}</span>
          </button>
          {cart.customer && availableCredit(cart.customer) !== undefined && (
            <p className="tabular text-text-muted">{t("customers.credit", { available: money(availableCredit(cart.customer) ?? 0), limit: money(cart.customer.creditLimit ?? 0) })}</p>
          )}
          {custOpen && (
            <div className="mt-2 space-y-2">
              <label className="relative block">
                <span className="sr-only">{t("till.customerSearch")}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <input value={custTerm} onChange={(e) => void findCustomers(e.target.value)} placeholder={t("till.customerSearch")} className="min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised pl-10 pr-3" />
              </label>
              {custStale && <p className="text-text-muted">{t("till.customerStale")}</p>}
              <ul>
                <li><button className="btn-spring min-h-touch w-full rounded-lg px-2 text-left hover:bg-fill" onClick={() => { setCart((c) => ({ ...c, customer: undefined, chargeKey: undefined })); setCustOpen(false); }}>{t("till.walkIn")}</button></li>
                {custResults.map((c) => (
                  <li key={c.id}>
                    <button className="btn-spring min-h-touch w-full rounded-lg px-2 text-left hover:bg-fill" onClick={() => { setCart((c0) => ({ ...c0, chargeKey: undefined, customer: { id: c.id, name: c.name, creditLimit: c.creditLimit, balance: c.balance } })); setCustOpen(false); }}>
                      {c.name} <span className="text-text-muted">{c.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {doneSale && (
          <Card className="border-success p-4" role="status">
            <p className="flex items-center gap-2 text-xl font-bold text-success-ink"><CheckCircle2 className="h-6 w-6" aria-hidden="true" />{t("till.done")}</p>
            <p className="tabular font-semibold">{doneSale.invoiceNo ?? doneSale.provisionalNo} · {money(doneSale.total)}</p>
            {creditOf(doneSale.payments) > 0 && <p className="tabular font-semibold">{t("till.onCredit", { amount: money(creditOf(doneSale.payments)) })}</p>}
            <p className="text-text-muted">{t(doneSynced ? "till.synced" : "till.savedLocal")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="subtle" onClick={() => print(toPrintDoc(doneSale, "receipt", doneSynced))}><Printer className="h-5 w-5" aria-hidden="true" />{t("till.printReceipt")}</Button>
              <Button variant="subtle" onClick={() => print(toPrintDoc(doneSale, "invoice", doneSynced))}><Printer className="h-5 w-5" aria-hidden="true" />{t("till.printInvoice")}</Button>
            </div>
          </Card>
        )}
        {cart.lines.length === 0 && sales.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-2 text-xl font-bold">{t("till.recent")}</h2>
            <ul className="divide-y divide-border">
              {sales.slice(0, 5).map((s) => {
                const synced = !sync.queue.some((i) => i.id === s.key);
                return (
                  <li key={s.key} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1"><span className="tabular block font-semibold">{s.invoiceNo ?? s.provisionalNo}</span><span className="tabular text-text-muted">{money(s.total)}</span></span>
                    <Button variant="subtle" onClick={() => print(toPrintDoc(s, "receipt", synced), { reprint: true })}>{t("till.reprint")}</Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </aside>

      <NeedsManagerDialog
        open={managerOpen}
        total={totals.total}
        discounted={!!cart.discount}
        onClose={() => setManagerOpen(false)}
        onDiscount={applyDiscount}
        onVoid={applyVoid}
      />
    </div>
  );
}
