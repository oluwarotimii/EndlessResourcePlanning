// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval, Capabilities, SaleInput } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const CASHIER: Capabilities = { user: { id: "u-cashier", name: "Amaka Obi" }, roles: ["Cashier"], areas: areasForRoles(["Cashier"]), scope: { branch: "Pilot Branch" } };
const VARIANTS = [
  { id: "p5", sku: "CSE-CLR", barcode: "6001000000066", name: "Clear phone case", price: 3000, stock: 75, family: "Phone case", variant: "Clear" },
  { id: "p6", sku: "CSE-BLK", barcode: "6001000000134", name: "Black phone case", price: 3500, stock: 60, family: "Phone case", variant: "Black" },
];
const PRODUCTS = [
  { id: "p1", sku: "CHG-20W", barcode: "6001000000011", name: "Phone charger 20W", price: 6500, stock: 40 },
  { id: "p2", sku: "CBL-USBC", barcode: "6001000000028", name: "USB-C cable 1m", price: 2500, stock: 120 },
];

/** A tiny fake server that is idempotent, like the real one must be. */
function fakeServer() {
  const sales = new Map<string, SaleInput>();
  const approvals: Approval[] = [];
  const s = { down: false, createCalls: [] as string[], opened: [] as string[], closed: [] as number[], closeInputs: [] as Array<{ countedCash: number; denominations?: Record<string, number>; varianceReason?: string }>, printLogs: 0, sales, approvals };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }),
    login: async () => { throw new Error("unused"); },
    capabilities: async () => CASHIER,
    tasks: async () => ({ tasks: [] }),
    logout: async () => undefined,
    products: async () => { if (s.down) throw new ApiFailure("unavailable", "unavailable"); return { products: [...PRODUCTS, ...VARIANTS], asOf: "now" }; },
    customers: async () => ({ customers: [
      { id: "c1", name: "Ade Stores", phone: "0803", creditLimit: 200000, balance: 50000 },
      { id: "c2", name: "Bola Ventures", phone: "0804", creditLimit: 100000, balance: 98000 },
      { id: "c3", name: "Chioma Okeke", phone: "0805" },
    ] }),
    createSale: async (_t, input) => {
      s.createCalls.push(input.idempotencyKey);
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      const duplicate = sales.has(input.idempotencyKey);
      sales.set(input.idempotencyKey, input);
      return { duplicate, sale: { ...input, invoiceNo: "INV-000001", cashier: { id: "u-cashier", name: "Amaka Obi" }, postedAt: "now" } };
    },
    openShift: async (_t, i) => { if (s.down) throw new ApiFailure("unavailable", "unavailable"); s.opened.push(i.shiftId); return { duplicate: false, shift: { id: i.shiftId, status: "open", openingFloat: i.openingFloat, openedAt: i.openedAt } }; },
    closeShift: async (_t, i) => { s.closed.push(i.countedCash); s.closeInputs.push(i); return { duplicate: false, shift: { id: i.shiftId, status: "closed", openingFloat: 0, openedAt: "x" } }; },
    logPrint: async () => { s.printLogs++; },
    summary: async () => { throw new Error("not used"); },
    cashUpVariance: async () => { throw new Error("not used"); },
    lookupSale: async () => { throw new Error("not used"); },
    createReturn: async () => { throw new Error("not used"); },
    stockRequests: async () => { throw new Error("not used"); },
    createStockRequest: async () => { throw new Error("not used"); },
    branches: async () => { throw new Error("not used"); },
    transfers: async () => { throw new Error("not used"); },
    dispatchTransfer: async () => { throw new Error("not used"); },
    receiveTransfer: async () => { throw new Error("not used"); },
    purchaseOrders: async () => { throw new Error("not used"); },
    raisePurchaseOrder: async () => { throw new Error("not used"); }, receiveGoods: async () => { throw new Error("not used"); },
    stockLevels: async () => { throw new Error("not used"); },
    countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: async () => { throw new Error("not used"); },
    approvals: async () => ({ approvals: approvals.map((a) => ({ ...a })) }),
    createApproval: async (_t, input) => {
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      const names: Record<string, string> = { c1: "Ade Stores", c2: "Bola Ventures", c3: "Chioma Okeke" };
      const approval: Approval = {
        id: `AP-${String(approvals.length + 1).padStart(4, "0")}`, kind: input.kind, status: "pending",
        amount: input.amount, limit: input.kind === "credit_over_limit" ? (input.customerId === "c2" ? 100000 : 200000) : 3,
        unit: input.unit, requestedBy: CASHIER.user, requestedAt: "now", requestNote: input.requestNote,
        customerId: input.customerId, customerName: input.customerId ? names[input.customerId] : undefined,
      };
      approvals.push(approval);
      return { approval: { ...approval }, duplicate: false };
    },
    decideApproval: async () => { throw new Error("not used"); },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, path: string, cfg: unknown = tenantJson) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(CASHIER));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={loadTenant(cfg)}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
const seedShift = () => storage.kv.set("shift:u-cashier", { id: "shift-0001-aaaa", status: "open", openingFloat: 20000, openedAt: new Date().toISOString() });
const scan = (code: string) => {
  const box = screen.getByLabelText(/scan a barcode/i);
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form")!);
};

beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); window.print = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("till: scan, pay, offline and retry", () => {
  it("a scanned barcode adds the item and a cash payment syncs with one sale", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Phone charger 20W");
    scan("6001000000011"); scan("6001000000011"); scan("6001000000028");
    expect(await screen.findByTestId("total")).toHaveTextContent(/15,500/);
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    expect(await screen.findByText("Sale recorded")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Synced")).toBeInTheDocument());
    expect(s.sales.size).toBe(1);
    expect([...s.sales.values()][0]?.lines).toHaveLength(2);
  });

  it("an unknown code says so and keeps what was typed", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Phone charger 20W");
    scan("0000");
    expect(await screen.findByText(/No item found for 0000/)).toBeInTheDocument();
    expect(screen.getByLabelText(/scan a barcode/i)).toHaveValue("0000");
  });

  it("with the server down the sale is saved, queued and printed as a COPY, then replays once with the same key", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Phone charger 20W");
    s.down = true;
    scan("6001000000011");
    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    expect(await screen.findByText("Sale recorded")).toBeInTheDocument();
    expect(screen.getByText(/Saved on this device/)).toBeInTheDocument();
    expect(await screen.findByText(/1 waiting to sync/)).toBeInTheDocument();
    expect(s.sales.size).toBe(0);

    // Offline receipt carries the COPY label.
    fireEvent.click(screen.getByRole("button", { name: /print receipt/i }));
    await waitFor(() => expect(document.querySelector(".print-area")).not.toBeNull());
    expect(within(document.querySelector(".print-area") as HTMLElement).getByText("COPY")).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalled());

    // Network returns: the same sale replays and the server records it once.
    s.down = false;
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(s.sales.size).toBe(1));
    await waitFor(() => expect(screen.getByText("Synced")).toBeInTheDocument());
    expect(new Set(s.createCalls).size).toBe(1); // every attempt used the same idempotency key
    expect(await screen.findByText(/Everything is saved/)).toBeInTheDocument();
  });

  it("parking clears the cart and resuming is refused while another sale is in progress", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Phone charger 20W");
    scan("6001000000011");
    fireEvent.click(screen.getByRole("button", { name: /park this sale/i }));
    expect(await screen.findByText(/Sale parked/)).toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent(/₦0/);
    const parked = await storage.kv.list("parked:u-cashier:");
    expect(parked).toHaveLength(1);
  });

  it("without an open shift the till asks you to open one", async () => {
    const { api } = fakeServer();
    mount(api, "/s/S01");
    expect(await screen.findByText(/Open your shift to start selling/)).toBeInTheDocument();
  });

  it("a cart survives a reload (crash safe)", async () => {
    const { api } = fakeServer();
    await seedShift();
    const first = mount(api, "/s/S01");
    await screen.findByText("Phone charger 20W");
    scan("6001000000011");
    await waitFor(async () => expect(((await storage.kv.get("cart:u-cashier")) as { lines: unknown[] } | undefined)?.lines).toHaveLength(1));
    first.unmount();
    mount(api, "/s/S01");
    expect(await screen.findByTestId("total")).toHaveTextContent(/6,500/);
  });
});

describe("shift open and close", () => {
  it("opens with a counted float and queues it", async () => {
    const { api, s } = fakeServer();
    mount(api, "/s/S03");
    fireEvent.change(await screen.findByLabelText(/opening balance/i), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "Open shift" }));
    expect(await screen.findByRole("heading", { name: "Close shift" })).toBeInTheDocument();
    await waitFor(() => expect(s.opened).toHaveLength(1));
  });

  it("closing goes through the cash-up count: S03 offers the count and never shows the expected cash", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S03");
    expect(await screen.findByRole("link", { name: /count the cash and close/i })).toBeInTheDocument();
    expect(screen.queryByTestId("expected")).not.toBeInTheDocument();
  });
});

describe("closing balance count (Q01)", () => {
  const notes = (n: string) => screen.getByLabelText(`Number of ${n} notes`);

  it("is a blind count: the expected cash appears only after counting, then a short count needs a reason", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/Q01");
    expect(await screen.findByRole("heading", { name: "Closing balance count" })).toBeInTheDocument();
    expect(screen.queryByTestId("expected")).not.toBeInTheDocument(); // blind
    fireEvent.change(notes("₦1,000"), { target: { value: "19" } });
    expect(screen.getByTestId("counted")).toHaveTextContent(/19,000/);
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    expect(await screen.findByTestId("expected")).toHaveTextContent(/20,000/);
    expect(screen.getByTestId("variance")).toHaveTextContent(/1,000 short/);
    const confirm = screen.getByRole("button", { name: /close shift and sign out/i });
    expect(confirm).toBeDisabled(); // a mismatch needs a reason
    fireEvent.change(screen.getByLabelText(/why does the count not match/i), { target: { value: "Counting error" } });
    fireEvent.change(screen.getByLabelText(/note \(optional\)/i), { target: { value: "Miscounted the 500s" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(s.closeInputs).toHaveLength(1));
    expect(s.closeInputs[0]).toMatchObject({ countedCash: 19000, denominations: { "1000": 19 }, varianceReason: "Counting error: Miscounted the 500s" });
    expect(await screen.findByText(/Who is signing in/)).toBeInTheDocument();
  });

  it("an exact count needs no reason", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/Q01");
    fireEvent.change(await screen.findByLabelText("Number of ₦1,000 notes"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    expect(await screen.findByTestId("variance")).toHaveTextContent(/Matches exactly/);
    expect(screen.queryByLabelText(/why does the count not match/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close shift and sign out/i }));
    await waitFor(() => expect(s.closeInputs).toHaveLength(1));
    expect(s.closeInputs[0]?.varianceReason).toBeUndefined();
  });

  it("the + and - buttons count notes, and you can go back to recount", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/Q01");
    await screen.findByRole("heading", { name: "Closing balance count" });
    fireEvent.click(screen.getByRole("button", { name: "One more ₦500 note" }));
    fireEvent.click(screen.getByRole("button", { name: "One more ₦500 note" }));
    fireEvent.click(screen.getByRole("button", { name: "One fewer ₦500 note" }));
    expect(screen.getByTestId("counted")).toHaveTextContent(/₦500/);
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    fireEvent.click(await screen.findByRole("button", { name: "Count again" }));
    expect(await screen.findByTestId("counted")).toBeInTheDocument();
  });

  it("without an open shift there is nothing to count", async () => {
    const { api } = fakeServer();
    mount(api, "/s/Q01");
    expect(await screen.findByText("No shift to count")).toBeInTheDocument();
  });
});

describe("sync tray and templates", () => {
  it("shows a failed item with its reason and a retry button; never drops it", async () => {
    const { api } = fakeServer();
    await storage.queue.put({ id: "bad-item-0001", type: "shift.close", recordKey: "r", userId: "u-cashier", userName: "Amaka Obi", payload: {}, status: "failed", attempts: 2, createdAt: Date.now(), lastError: "Shift is closed" });
    await storage.queue.put({ id: "other-0001", type: "shift.open", recordKey: "r2", userId: "u-manager", userName: "Tunde Bello", payload: {}, status: "pending", attempts: 0, createdAt: Date.now() });
    mount(api, "/s/P03");
    expect(await screen.findByText("Shift is closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText(/Waiting for Tunde Bello to sign in/)).toBeInTheDocument();
  });

  it("previews the A5 invoice with bank details and VAT, and the receipt without them", async () => {
    const { api } = fakeServer();
    mount(api, "/s/P06");
    expect(await screen.findByText("Bank details")).toBeInTheDocument();
    expect(screen.getByText(/VAT included \(7.5%\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(screen.queryByText("Bank details")).not.toBeInTheDocument();
  });
});

describe("VAT handling is configurable", () => {
  const cfg = (tax: Record<string, unknown>) => ({ ...tenantJson, tax: { ...tenantJson.tax, ...tax } });
  async function sellCharger(c: unknown) {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/S01", c);
    await screen.findByText("Phone charger 20W");
    scan("6001000000011");
    return { s };
  }
  it("inclusive: the price already contains VAT, the customer pays 6,500", async () => {
    await sellCharger(cfg({ mode: "inclusive" }));
    expect(await screen.findByTestId("total")).toHaveTextContent(/6,500/);
    expect(screen.getByText(/VAT included \(7.5%\)/)).toBeInTheDocument();
    expect(screen.getByTestId("vat")).toHaveTextContent(/453/);
    expect(screen.queryByTestId("subtotal")).not.toBeInTheDocument();
  });
  it("exclusive: VAT is added on top and the customer pays 6,988", async () => {
    const { s } = await sellCharger(cfg({ mode: "exclusive" }));
    expect(await screen.findByTestId("subtotal")).toHaveTextContent(/6,500/);
    expect(screen.getByText(/VAT added \(7.5%\)/)).toBeInTheDocument();
    expect(screen.getByTestId("vat")).toHaveTextContent(/488/);
    expect(screen.getByTestId("total")).toHaveTextContent(/6,988/);
    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    await waitFor(() => expect(s.sales.size).toBe(1));
    const sent = [...s.sales.values()][0]!;
    expect(sent).toMatchObject({ vatMode: "exclusive", subtotal: 6500, vat: 488, total: 6988, payments: [{ method: "cash", amount: 6988 }] });
  });
  it("none: no VAT line at all", async () => {
    await sellCharger(cfg({ mode: "none" }));
    expect(await screen.findByTestId("total")).toHaveTextContent(/6,500/);
    expect(screen.queryByTestId("vat")).not.toBeInTheDocument();
  });
});

describe("payment methods, credit and split payments", () => {
  async function ready(cfg: unknown = tenantJson) {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api, "/s/S01", cfg);
    await screen.findByText("Phone charger 20W");
    scan("6001000000011"); scan("6001000000011"); // 13,000
    expect(await screen.findByTestId("total")).toHaveTextContent(/13,000/);
    return { s };
  }
  async function attach(name: string) {
    fireEvent.click(screen.getByRole("button", { name: /customer/i }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  }

  it("offers every method the company configured, including credit and other", async () => {
    await ready();
    for (const m of ["Cash", "Transfer", "Card", "Credit", "Other"]) expect(screen.getByRole("button", { name: m })).toBeInTheDocument();
  });
  it("a company can switch methods off in tenant.json", async () => {
    await ready({ ...tenantJson, till: { ...tenantJson.till, paymentMethods: ["cash", "transfer"], allowSplitPayments: false } });
    expect(screen.queryByRole("button", { name: "Credit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Split payment" })).not.toBeInTheDocument();
  });
  it("credit alone needs a customer, and then records the whole sale on credit", async () => {
    const { s } = await ready();
    expect(screen.getByRole("button", { name: "Credit" })).toBeDisabled();
    expect(screen.getByTestId("credit-hint")).toHaveTextContent(/needs a customer/i);
    await attach("Ade Stores");
    await waitFor(() => expect(screen.getByRole("button", { name: "Credit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Credit" }));
    await waitFor(() => expect(s.sales.size).toBe(1));
    expect([...s.sales.values()][0]).toMatchObject({ customerId: "c1", payments: [{ method: "credit", amount: 13000 }] });
    expect(await screen.findByText(/On credit: ₦13,000/)).toBeInTheDocument();
  });
  it("a customer with no credit terms, or too little room, cannot be sold to on credit", async () => {
    await ready();
    await attach("Chioma Okeke");
    expect(await screen.findByTestId("credit-hint")).toHaveTextContent(/no credit terms/i);
    expect(screen.getByRole("button", { name: "Credit" })).toBeDisabled();
    await attach("Bola Ventures"); // limit 100,000, owes 98,000, 2,000 left
    expect(await screen.findByTestId("credit-hint")).toHaveTextContent(/₦2,000 more on credit/);
  });
  it("part credit: 5,000 cash + the rest on credit, in one tap on Rest", async () => {
    const { s } = await ready();
    await attach("Ade Stores");
    fireEvent.click(screen.getByRole("button", { name: "Split payment" }));
    fireEvent.change(screen.getByLabelText("Cash"), { target: { value: "5000" } });
    expect(screen.getByTestId("remaining")).toHaveTextContent(/8,000/);
    expect(screen.getByRole("button", { name: /confirm split payment/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Put the rest on Credit" }));
    expect(screen.getByTestId("remaining")).toHaveTextContent(/₦0/);
    fireEvent.click(screen.getByRole("button", { name: /confirm split payment/i }));
    await waitFor(() => expect(s.sales.size).toBe(1));
    expect([...s.sales.values()][0]?.payments).toEqual([{ method: "cash", amount: 5000 }, { method: "credit", amount: 8000 }]);
  });
  it("split payments that do not add up cannot be confirmed; cash + transfer works without a customer", async () => {
    const { s } = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Split payment" }));
    fireEvent.change(screen.getByLabelText("Cash"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Transfer"), { target: { value: "7000" } });
    expect(screen.getByRole("button", { name: /confirm split payment/i })).toBeDisabled(); // 12,000 of 13,000
    fireEvent.change(screen.getByLabelText("Transfer"), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm split payment/i }));
    await waitFor(() => expect(s.sales.size).toBe(1));
  });
  it("part credit is blocked in the split panel when there is no customer", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Split payment" }));
    fireEvent.change(screen.getByLabelText("Cash"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Credit"), { target: { value: "10000" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/Credit needs a customer/);
    expect(screen.getByRole("button", { name: /confirm split payment/i })).toBeDisabled();
  });
  it("a discount is applied only after a manager approves it, and the sale carries the approval", async () => {
    const { s } = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Ask a manager" }));
    expect(await screen.findByRole("heading", { name: "Ask a manager" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask for a discount" }));
    fireEvent.change(screen.getByLabelText("Discount (%)"), { target: { value: "2" } });
    expect(screen.getByText(/New total after discount: ₦12,740/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to manager" }));
    expect(await screen.findByRole("heading", { name: "Waiting for a manager" })).toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent(/13,000/); // nothing changes before approval

    s.approvals[0]!.status = "approved";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("total")).toHaveTextContent(/12,740/);
    expect(screen.getByTestId("discount")).toHaveTextContent(/260/);

    fireEvent.click(screen.getByRole("button", { name: "Cash" }));
    await waitFor(() => expect(s.sales.size).toBe(1));
    expect([...s.sales.values()][0]).toMatchObject({ subtotal: 13000, total: 12740, discountApprovalId: "AP-0001" });
  });

  it("a void clears the cart only after a manager approves it", async () => {
    const { s } = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Ask a manager" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to void this sale" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to manager" }));
    expect(await screen.findByRole("heading", { name: "Waiting for a manager" })).toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent(/13,000/);

    s.approvals[0]!.status = "approved";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("The sale was voided. The cart is empty.")).toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent(/₦0/);
    expect(s.sales.size).toBe(0);
  });

  it("a credit sale over the limit needs a manager approval before it can be paid", async () => {
    const { s } = await ready();
    await attach("Bola Ventures"); // limit 100,000, owes 98,000: 2,000 left, sale is 13,000
    expect(screen.getByRole("button", { name: "Credit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ask a manager" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask to sell on credit over the limit" }));
    expect(screen.getByText(/over their available credit by ₦11,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to manager" }));
    expect(await screen.findByRole("heading", { name: "Waiting for a manager" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credit" })).toBeDisabled(); // nothing changes before approval

    s.approvals[0]!.status = "approved";
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Credit over the limit approved for Bola Ventures.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credit" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Credit" }));
    await waitFor(() => expect(s.sales.size).toBe(1));
    expect([...s.sales.values()][0]).toMatchObject({ customerId: "c2", creditApprovalId: "AP-0001", payments: [{ method: "credit", amount: 13000 }] });
  });

  it("the receipt shows each payment and the balance on credit", async () => {
    await ready();
    await attach("Ade Stores");
    fireEvent.click(screen.getByRole("button", { name: "Split payment" }));
    fireEvent.change(screen.getByLabelText("Cash"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Credit"), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm split payment/i }));
    fireEvent.click(await screen.findByRole("button", { name: /print invoice/i }));
    await waitFor(() => expect(document.querySelector(".print-area")).not.toBeNull());
    const doc = within(document.querySelector(".print-area") as HTMLElement);
    expect(doc.getByText(/Paid: Cash/)).toBeInTheDocument();
    expect(doc.getByText(/Paid: Credit/)).toBeInTheDocument();
    expect(doc.getByText("Balance on credit")).toBeInTheDocument();
  });
});

describe("variants must be scanned, so the wrong colour is not sold by mistake", () => {
  it("a variant tile cannot be tapped into the cart; it says Scan to add and sends the cashier back to the scan box", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Clear phone case");
    const clear = screen.getByRole("button", { name: /Clear phone case/ });
    expect(clear).toHaveAttribute("aria-disabled", "true");
    expect(within(clear).getByText("Scan to add")).toBeInTheDocument();
    expect(within(clear).getByText("Clear")).toBeInTheDocument(); // the variant is shown big
    fireEvent.click(clear);
    expect(screen.getByTestId("total")).toHaveTextContent(/₦0/); // nothing was added
    expect(screen.getByLabelText(/scan a barcode/i)).toHaveFocus();
  });

  it("scanning the barcode of the right variant adds exactly that variant", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Black phone case");
    scan("6001000000134");
    expect(await screen.findByTestId("total")).toHaveTextContent(/3,500/);
  });

  it("typing a name that matches only one variant does not add it on Enter (a barcode or SKU does)", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    await screen.findByText("Black phone case");
    scan("black");
    expect(screen.getByTestId("total")).toHaveTextContent(/₦0/);
    scan("CSE-BLK");
    expect(await screen.findByTestId("total")).toHaveTextContent(/3,500/);
  });

  it("an item without variants can still be tapped", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01");
    fireEvent.click(await screen.findByRole("button", { name: /Phone charger 20W/ }));
    expect(await screen.findByTestId("total")).toHaveTextContent(/6,500/);
  });

  it("a company can switch the rule off", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api, "/s/S01", { ...tenantJson, till: { ...tenantJson.till, scanRequiredForVariants: false } });
    fireEvent.click(await screen.findByRole("button", { name: /Clear phone case/ }));
    expect(await screen.findByTestId("total")).toHaveTextContent(/3,000/);
  });
});
