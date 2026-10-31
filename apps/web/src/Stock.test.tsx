// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capabilities, DispatchInput, InTransitReport, ReceiveInput, StockLevel, StockRequest, Transfer } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const caps = (id: string, name: string, role: string): Capabilities => ({ user: { id, name }, roles: [role], areas: areasForRoles([role]), scope: { branch: "Pilot Branch" } });
const WAREHOUSE = caps("u-warehouse", "Ngozi Eze", "Warehouse officer");
const MANAGER = caps("u-manager", "Tunde Bello", "Branch manager");
const PRODUCTS = [
  { id: "p1", sku: "CHG-20W", barcode: "6001000000011", name: "Phone charger 20W", price: 6500, stock: 40 },
  { id: "p2", sku: "CBL-USBC", barcode: "6001000000028", name: "USB-C cable 1m", price: 2500, stock: 120 },
];

function fakeServer(who: Capabilities) {
  const unused = async () => { throw new Error("not used"); };
  const s = {
    down: false, dispatched: [] as DispatchInput[], received: [] as Array<{ id: string; input: ReceiveInput }>,
    requests: [{ id: "SR-0001", status: "requested", lines: [{ productId: "p1", name: "Phone charger 20W", qty: 4 }, { productId: "p2", name: "USB-C cable 1m", qty: 3 }], note: "Weekend rush", requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt: new Date(Date.now() - 3_600_000).toISOString() }] as StockRequest[],
    transfers: [{ id: "TR-0001", requestId: "SR-0001", status: "in_transit", lines: [{ productId: "p1", name: "Phone charger 20W", qtySent: 4 }, { productId: "p2", name: "USB-C cable 1m", qtySent: 3 }], dispatchedBy: { id: "u-warehouse", name: "Ngozi Eze" }, dispatchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), shortage: 0 }] as Transfer[],
    levels: [{ productId: "p1", name: "Phone charger 20W", sku: "CHG-20W", barcode: "6001000000011", branch: 3, warehouse: 120 }, { productId: "p2", name: "USB-C cable 1m", sku: "CBL-USBC", barcode: "6001000000028", branch: 80, warehouse: 360 }] as StockLevel[],
    report: { asOf: "2026-11-02T10:00:00.000Z", thresholdHours: 24, rows: [{ transferId: "TR-0009", dispatchedBy: "Ngozi Eze", dispatchedAt: "2026-11-01T08:00:00.000Z", hoursInTransit: 26, units: 12 }] } as InTransitReport,
    levelQueries: [] as string[],
  };
  const down = () => { if (s.down) throw new ApiFailure("unavailable", "unavailable"); };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => who, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: PRODUCTS, asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    approvals: async () => ({ approvals: [] }), createApproval: unused, decideApproval: unused, summary: unused, cashUpVariance: unused, lookupSale: unused, createReturn: unused, createStockRequest: unused,
    stockRequests: async () => { down(); return { requests: s.requests }; },
    transfers: async () => { down(); return { transfers: s.transfers }; },
    dispatchTransfer: async (_t, input) => {
      down(); s.dispatched.push(input);
      const request = s.requests.find((r) => r.id === input.requestId)!;
      request.status = "dispatched";
      const transfer: Transfer = { id: "TR-0002", requestId: request.id, status: "in_transit", lines: input.lines.map((l) => ({ productId: l.productId, name: PRODUCTS.find((p) => p.id === l.productId)!.name, qtySent: l.qty })), dispatchedBy: { id: who.user.id, name: who.user.name }, dispatchedAt: new Date().toISOString(), shortage: 0 };
      return { transfer, duplicate: false };
    },
    receiveTransfer: async (_t, id, input) => {
      down(); s.received.push({ id, input });
      const transfer = s.transfers.find((x) => x.id === id)!;
      const shortage = transfer.lines.reduce((n, l) => n + l.qtySent - (input.lines.find((x) => x.productId === l.productId)?.qty ?? 0), 0);
      Object.assign(transfer, { status: "received", shortage });
      return { transfer, duplicate: false };
    },
    stockLevels: async (_t, q = "") => { down(); s.levelQueries.push(q); return { asOf: "now", levels: s.levels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase())) }; },
    countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: async () => { down(); return s.report; },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, who: Capabilities, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(who));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
const scan = (code: string) => { const box = screen.getByLabelText(/scan an item/i); fireEvent.change(box, { target: { value: code } }); fireEvent.submit(box.closest("form")!); };
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("pack and send stock (H03)", () => {
  it("lists the requests waiting, opens one, and counts each scanned item (never above what was asked)", async () => {
    const { api } = fakeServer(WAREHOUSE);
    mount(api, WAREHOUSE, "/s/H03");
    const card = await screen.findByTestId("request-SR-0001");
    expect(within(card).getByText(/4 × Phone charger 20W/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Pack this request" }));
    await screen.findByText("0 of 4 packed");
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // the item list loads for scanning
    scan("6001000000011"); scan("6001000000011");
    expect(await screen.findByText(/2 of 4 packed/)).toBeInTheDocument();
    expect(screen.getByText(/2 short of what was asked/)).toBeInTheDocument();
    scan("6001000000011"); scan("6001000000011");
    scan("6001000000011");
    expect(await screen.findByText("Already counted all of Phone charger 20W.")).toBeInTheDocument();
    scan("0000");
    expect(await screen.findByText(/That code is not on this list: 0000/)).toBeInTheDocument();
  });

  it("sends only what was packed (it may be less than asked), once, and the request leaves the list", async () => {
    const { api, s } = fakeServer(WAREHOUSE);
    mount(api, WAREHOUSE, "/s/H03");
    fireEvent.click(await screen.findByRole("button", { name: "Pack this request" }));
    expect(screen.getByRole("button", { name: /send to the branch \(0\)/i })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Pack one more Phone charger 20W" }));
    fireEvent.click(screen.getByRole("button", { name: "Pack one more Phone charger 20W" }));
    fireEvent.click(screen.getByRole("button", { name: "Pack one more USB-C cable 1m" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the branch (3)" }));
    expect(await screen.findByText(/The branch will count it when it arrives/)).toBeInTheDocument();
    await waitFor(() => expect(s.dispatched).toHaveLength(1));
    expect(s.dispatched[0]).toMatchObject({ requestId: "SR-0001", lines: [{ productId: "p1", qty: 2 }, { productId: "p2", qty: 1 }] });
    expect(screen.queryByTestId("request-SR-0001")).not.toBeInTheDocument();
    expect(screen.getByText("No requests are waiting to be packed.")).toBeInTheDocument();
  });

  it("offline: the dispatch is saved in the queue and sent exactly once when the connection returns", async () => {
    const { api, s } = fakeServer(WAREHOUSE);
    mount(api, WAREHOUSE, "/s/H03");
    fireEvent.click(await screen.findByRole("button", { name: "Pack this request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pack one more USB-C cable 1m" }));
    s.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Send to the branch (1)" }));
    await screen.findByText(/If you are offline, it is sent/);
    await waitFor(async () => expect((await storage.queue.getAll()).map((i) => i.type)).toEqual(["transfer.dispatch"]));
    const key = (await storage.queue.getAll())[0]!.id;
    s.down = false;
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(s.dispatched).toHaveLength(1));
    expect(s.dispatched[0]!.idempotencyKey).toBe(key);
    await waitFor(async () => expect(await storage.queue.getAll()).toHaveLength(0));
  });
});

describe("receive stock (H04)", () => {
  it("counts what arrived by scanning, shows what is missing, and flags the shortage on the transfer", async () => {
    const { api, s } = fakeServer(MANAGER);
    mount(api, MANAGER, "/s/H04");
    const card = await screen.findByTestId("transfer-TR-0001");
    expect(within(card).getByText(/Sent by Ngozi Eze/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Count this transfer" }));
    await screen.findByText("0 of 4 counted · 4 missing");
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    for (let i = 0; i < 4; i++) scan("6001000000011");
    scan("6001000000028"); scan("6001000000028"); // only 2 of the 3 cables came out of the box
    expect(await screen.findByTestId("missing")).toHaveTextContent("Items missing: 1. This will be flagged on the transfer.");
    fireEvent.change(screen.getByLabelText(/note \(optional\)/i), { target: { value: "Box was torn" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm what arrived" }));
    await waitFor(() => expect(s.received).toHaveLength(1));
    expect(s.received[0]).toMatchObject({ id: "TR-0001", input: { lines: [{ productId: "p1", qty: 4 }, { productId: "p2", qty: 2 }], note: "Box was torn" } });
    expect(await screen.findByText(/Someone independent will rule on who bears the loss/)).toBeInTheDocument();
    const done = await screen.findByTestId("received-TR-0001");
    expect(within(done).getByText("Shortage: 1")).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-TR-0001")).not.toBeInTheDocument();
  });

  it("an item nobody counted is sent as zero, so nothing is silently assumed to have arrived", async () => {
    const { api, s } = fakeServer(MANAGER);
    mount(api, MANAGER, "/s/H04");
    fireEvent.click(await screen.findByRole("button", { name: "Count this transfer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Count one more Phone charger 20W" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm what arrived" }));
    await waitFor(() => expect(s.received).toHaveLength(1));
    expect(s.received[0]!.input.lines).toEqual([{ productId: "p1", qty: 1 }, { productId: "p2", qty: 0 }]);
  });

  it("cannot count more than was sent, and when everything is there it says so", async () => {
    const { api } = fakeServer(MANAGER);
    mount(api, MANAGER, "/s/H04");
    fireEvent.click(await screen.findByRole("button", { name: "Count this transfer" }));
    const more = await screen.findByRole("button", { name: "Count one more USB-C cable 1m" });
    fireEvent.click(more); fireEvent.click(more); fireEvent.click(more);
    expect(more).toBeDisabled();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Count one more Phone charger 20W" }));
    expect(screen.getByTestId("missing")).toHaveTextContent("Everything arrived.");
  });
});

describe("stock lookup (H05) and in-transit report (G02)", () => {
  it("shows shelf and warehouse quantities, flags low stock, and searches", async () => {
    const { api, s } = fakeServer(WAREHOUSE);
    mount(api, WAREHOUSE, "/s/H05");
    const low = await screen.findByTestId("level-p1");
    expect(within(low).getByText("Low")).toBeInTheDocument();
    expect(within(screen.getByTestId("level-p2")).queryByText("Low")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: "cable" } });
    await waitFor(() => expect(screen.queryByTestId("level-p1")).not.toBeInTheDocument());
    expect(s.levelQueries).toContain("cable");
  });

  it("opens from the saved list when the server cannot be reached", async () => {
    const { api, s } = fakeServer(WAREHOUSE);
    mount(api, WAREHOUSE, "/s/H05");
    await screen.findByTestId("level-p1"); // the full list is saved
    cleanup();
    s.down = true;
    mount(api, WAREHOUSE, "/s/H05");
    expect(await screen.findByTestId("level-p2")).toBeInTheDocument();
    expect(screen.getByText(/saved on this device/i)).toBeInTheDocument();
  });

  it("the report lists late transfers with their hours, and says so when there are none", async () => {
    const { api, s } = fakeServer(MANAGER);
    mount(api, MANAGER, "/s/G02");
    const row = await screen.findByTestId("late-TR-0009");
    expect(within(row).getByText("26")).toBeInTheDocument();
    expect(screen.getByText(/more than 24 hours/i)).toBeInTheDocument();
    cleanup();
    s.report = { ...s.report, rows: [] };
    mount(api, MANAGER, "/s/G02");
    expect(await screen.findByText("Nothing has been on the road too long.")).toBeInTheDocument();
  });
});
