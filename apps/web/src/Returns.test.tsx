// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Approval, type Capabilities, type CreateApprovalInput, type ReturnInput, type Sale } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const CASHIER: Capabilities = { user: { id: "u-cashier", name: "Amaka Obi" }, roles: ["Cashier"], areas: areasForRoles(["Cashier"]), scope: { branch: "Pilot Branch" } };
const SALE: Sale = {
  idempotencyKey: "sale-key-0001", clientCreatedAt: "2026-10-31T09:00:00.000Z", shiftId: "shift-0001-aaaa", customerId: "c1",
  lines: [{ productId: "p1", name: "Phone charger 20W", unitPrice: 6500, qty: 2 }, { productId: "p2", name: "USB-C cable 1m", unitPrice: 2500, qty: 1 }],
  subtotal: 15500, vatMode: "inclusive", vat: 1081, total: 15500, payments: [{ method: "cash", amount: 9500 }, { method: "credit", amount: 6000 }],
  invoiceNo: "INV-000042", cashier: { id: "u-cashier", name: "Amaka Obi" }, postedAt: "2026-10-31T09:00:00.000Z",
};

function fakeServer() {
  const s = {
    approval: null as Approval | null, created: [] as CreateApprovalInput[], returns: [] as ReturnInput[], down: false,
    returned: {} as Record<string, number>,
  };
  const unused = async () => { throw new Error("not used"); };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => CASHIER, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: [], asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    summary: unused, cashUpVariance: unused, stockRequests: unused, createStockRequest: unused, branches: unused, transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, purchaseOrders: unused, returnInspections: async () => { throw new Error("not used"); }, inspectReturn: async () => { throw new Error("not used"); }, correctVariant: async () => { throw new Error("not used"); }, mixupReport: async () => { throw new Error("not used"); }, orders: async () => { throw new Error("not used"); }, createOrder: async () => { throw new Error("not used"); }, cancelOrder: async () => { throw new Error("not used"); }, raisePurchaseOrder: async () => { throw new Error("not used"); }, receiveGoods: unused, stockLevels: unused, countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: unused,
    lookupSale: async (_t, invoiceNo) => {
      if (invoiceNo.toUpperCase() !== "INV-000042") throw new ApiFailure("validation", "No sale found with that invoice number.", 400);
      return { sale: SALE, returned: s.returned };
    },
    createApproval: async (_t, input) => {
      s.created.push(input);
      s.approval = {
        id: "AP-0050", kind: "refund", status: "pending", amount: 6500, limit: 50000, unit: "naira",
        requestedBy: { id: "u-cashier", name: "Amaka Obi" }, requestedAt: "now", requestNote: input.refund?.reason,
        refund: { saleKey: SALE.idempotencyKey, invoiceNo: SALE.invoiceNo, reason: input.refund?.reason ?? "", refundTotal: 6500, lines: [{ productId: "p1", name: "Phone charger 20W", qty: 1, amount: 6500 }] },
        steps: [{ roles: ["Branch manager", "MD / Executive"], status: "pending" }, { roles: ["Cash controller", "MD / Executive"], status: "pending" }],
      };
      return { approval: s.approval, duplicate: false };
    },
    approvals: async () => ({ approvals: s.approval ? [{ ...s.approval }] : [] }),
    decideApproval: unused,
    createReturn: async (_t, input) => {
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      s.returns.push(input);
      return { duplicate: false, ret: { ...input, returnNo: "RET-000001", invoiceNo: SALE.invoiceNo, refundTotal: 6500, refundToBalance: 2500, refundPaid: 4000, cashier: { id: "u-cashier", name: "Amaka Obi" }, postedAt: "2026-10-31T10:00:00.000Z" } };
    },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, path = "/s/T01") => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(CASHIER));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
const seedShift = () => storage.kv.set("shift:u-cashier", { id: "shift-0001-aaaa", status: "open", openingFloat: 20000, openedAt: new Date().toISOString() });
const find = async (no = "INV-000042") => {
  fireEvent.change(await screen.findByLabelText(/invoice number/i), { target: { value: no } });
  fireEvent.click(screen.getByRole("button", { name: "Find the sale" }));
};

beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); window.print = vi.fn(); });
afterEach(cleanup);

describe("customer return (T01)", () => {
  it("finds the sale by invoice number and says so plainly when there is no such sale", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api);
    await find("INV-999999");
    expect(await screen.findByText("No sale found with that invoice number.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/invoice number/i), { target: { value: "inv-000042" } });
    fireEvent.click(screen.getByRole("button", { name: "Find the sale" }));
    expect(await screen.findByText("Sold 2, 2 left to return")).toBeInTheDocument();
    expect(screen.getByText("Sold 1, 1 left to return")).toBeInTheDocument();
  });

  it("only offers what is left to return, and needs a reason before asking for approval", async () => {
    const { api } = fakeServer();
    await seedShift();
    mount(api);
    await find();
    const more = await screen.findByRole("button", { name: "Return one more Phone charger 20W" });
    fireEvent.click(more); fireEvent.click(more);
    expect(more).toBeDisabled(); // sold 2, so no third
    fireEvent.click(screen.getByRole("button", { name: "Return one fewer Phone charger 20W" }));
    expect(screen.getByTestId("refund")).toHaveTextContent(/6,500/);
    expect(screen.getByRole("button", { name: "Ask for approval" })).toBeDisabled(); // no reason yet
    fireEvent.change(screen.getByLabelText(/why is it coming back/i), { target: { value: "Faulty item" } });
    expect(screen.getByRole("button", { name: "Ask for approval" })).toBeEnabled();
    expect(screen.getByText(/reduces what the customer owes/i)).toBeInTheDocument(); // part of the sale was on credit
  });

  it("asks for approval, waits for every step, then completes the refund once and lowers the expected cash", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api);
    await find();
    fireEvent.click(await screen.findByRole("button", { name: "Return one more Phone charger 20W" }));
    fireEvent.change(screen.getByLabelText(/why is it coming back/i), { target: { value: "Faulty item" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for approval" }));
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
    expect(s.created[0]).toMatchObject({ kind: "refund", amount: 6500, refund: { saleKey: SALE.idempotencyKey, lines: [{ productId: "p1", qty: 1 }], reason: "Faulty item" } });
    expect(screen.getByText(/Step 1 of 2: Branch manager or MD \/ Executive/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete the return/i })).not.toBeInTheDocument(); // not approved yet

    // the managers approve both steps
    s.approval = { ...s.approval!, status: "approved", steps: s.approval!.steps!.map((st) => ({ ...st, status: "approved" as const, decidedBy: { id: "u-x", name: "Tunde Bello" } })) };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    const complete = await screen.findByRole("button", { name: "Complete the return and refund ₦6,500" });
    fireEvent.click(complete);
    expect(await screen.findByText("Return RET-000001 recorded")).toBeInTheDocument();
    expect(screen.getByText("Give the customer ₦4,000 by Cash")).toBeInTheDocument();
    expect(screen.getByText("Taken off what the customer owes: ₦2,500")).toBeInTheDocument();
    expect(s.returns[0]).toMatchObject({ approvalId: "AP-0050", refundMethod: "cash", saleKey: SALE.idempotencyKey, lines: [{ productId: "p1", qty: 1 }] });
    // cash that left the drawer is remembered for the closing balance count
    const kept = await storage.kv.list<{ refundPaid: number; method: string }>("refund:u-cashier:");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ refundPaid: 4000, method: "cash" });
  });

  it("a rejected refund shows the reason and lets the cashier start again", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api);
    await find();
    fireEvent.click(await screen.findByRole("button", { name: "Return one more USB-C cable 1m" }));
    fireEvent.change(screen.getByLabelText(/why is it coming back/i), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for approval" }));
    await screen.findByText("Waiting for approval");
    s.approval = { ...s.approval!, status: "rejected", decisionReason: "Past the 7 day window" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText(/The refund was not approved\. Past the 7 day window/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(await screen.findByLabelText(/invoice number/i)).toBeInTheDocument();
  });

  it("a failed completion keeps the same key, so trying again can never refund twice", async () => {
    const { api, s } = fakeServer();
    await seedShift();
    mount(api);
    await find();
    fireEvent.click(await screen.findByRole("button", { name: "Return one more Phone charger 20W" }));
    fireEvent.change(screen.getByLabelText(/why is it coming back/i), { target: { value: "Faulty item" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for approval" }));
    await screen.findByText("Waiting for approval");
    s.approval = { ...s.approval!, status: "approved" };
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    const complete = await screen.findByRole("button", { name: /complete the return/i });
    s.down = true;
    fireEvent.click(complete);
    expect(await screen.findByText(/server is not reachable/i)).toBeInTheDocument();
    s.down = false;
    fireEvent.click(screen.getByRole("button", { name: /complete the return/i }));
    await screen.findByText("Return RET-000001 recorded");
    expect(s.returns).toHaveLength(1);
    expect(s.created).toHaveLength(1);
  });

  it("without an open shift the cashier is told, and cannot ask for approval", async () => {
    const { api } = fakeServer();
    mount(api);
    await find();
    expect(await screen.findByText(/Open a shift first/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Return one more Phone charger 20W" }));
    fireEvent.change(screen.getByLabelText(/why is it coming back/i), { target: { value: "Faulty item" } });
    expect(screen.getByRole("button", { name: "Ask for approval" })).toBeDisabled();
  });
});

describe("a cash refund lowers the expected closing balance", () => {
  it("expected = opening balance - cash refunded (and only cash)", async () => {
    const { api } = fakeServer();
    await seedShift();
    const refund = (key: string, method: string, paid: number) => ({ key, shiftId: "shift-0001-aaaa", invoiceNo: "INV-1", returnNo: "RET-1", refundTotal: paid, refundPaid: paid, refundToBalance: 0, method, at: "x" });
    await storage.kv.set("refund:u-cashier:r1", refund("r1", "cash", 4000));
    await storage.kv.set("refund:u-cashier:r2", refund("r2", "card", 9999)); // not cash: never leaves the drawer
    mount(api, "/s/Q01");
    fireEvent.change(await screen.findByLabelText("Number of ₦1,000 notes"), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    expect(await screen.findByTestId("expected")).toHaveTextContent(/16,000/); // 20,000 - 4,000
    expect(screen.getByTestId("variance")).toHaveTextContent(/Matches exactly/);
    expect(within(screen.getByTestId("variance")).queryByText(/short/)).toBeNull();
  });
});
