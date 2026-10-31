// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capabilities, CreateStockRequestInput, StockLevel, StockRequest } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const MANAGER: Capabilities = { user: { id: "u-manager", name: "Tunde Bello" }, roles: ["Branch manager"], areas: areasForRoles(["Branch manager"]), scope: { branch: "Pilot Branch" } };
const PRODUCTS = [
  { id: "p1", sku: "CHG", barcode: "1", name: "Phone charger 20W", price: 6500, stock: 40 },
  { id: "p2", sku: "CBL", barcode: "2", name: "USB-C cable 1m", price: 2500, stock: 120 },
];

function fakeServer() {
  const unused = async () => { throw new Error("not used"); };
  const s = {
    sent: [] as CreateStockRequestInput[],
    list: [{ id: "SR-0001", status: "dispatched", lines: [{ productId: "p2", name: "USB-C cable 1m", qty: 20 }], requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt: "2026-10-30T09:00:00.000Z" }] as StockRequest[],
    down: false,
    branches: ["Victoria Island Branch"],
    levels: [{ productId: "p1", name: "Phone charger 20W", sku: "CHG", barcode: "1", branch: 40, warehouse: 60, branches: { "Victoria Island Branch": 10 } }, { productId: "p2", name: "USB-C cable 1m", sku: "CBL", barcode: "2", branch: 120, warehouse: 200, branches: { "Victoria Island Branch": 0 } }] as StockLevel[],
  };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => MANAGER, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: PRODUCTS, asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    approvals: async () => ({ approvals: [] }), createApproval: unused, decideApproval: unused, summary: unused, cashUpVariance: unused, lookupSale: unused, createReturn: unused,
    stockRequests: async () => ({ requests: s.list }),
    branches: async () => ({ branches: s.branches }),
    stockLevels: async () => ({ asOf: "now", levels: s.levels }),
    transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, purchaseOrders: unused, returnInspections: async () => { throw new Error("not used"); }, inspectReturn: async () => { throw new Error("not used"); }, correctVariant: async () => { throw new Error("not used"); }, mixupReport: async () => { throw new Error("not used"); }, orders: async () => { throw new Error("not used"); }, createOrder: async () => { throw new Error("not used"); }, cancelOrder: async () => { throw new Error("not used"); }, raisePurchaseOrder: async () => { throw new Error("not used"); }, receiveGoods: unused, countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: unused,
    createStockRequest: async (_t, input) => {
      s.sent.push(input);
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      const request: StockRequest = { id: `SR-000${s.list.length + 1}`, status: "requested", lines: input.lines.map((l) => ({ ...l, name: PRODUCTS.find((p) => p.id === l.productId)!.name })), note: input.note, requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt: "2026-10-31T10:00:00.000Z", fromBranch: input.fromBranch };
      s.list = [request, ...s.list];
      return { request, duplicate: false };
    },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(MANAGER));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={["/s/H02"]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("branch stock request (H02)", () => {
  it("shows earlier requests with their status as icon and word", async () => {
    const { api } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("request-SR-0001");
    expect(within(card).getByText("On its way")).toBeInTheDocument();
    expect(within(card).getByText(/20 × USB-C cable 1m/)).toBeInTheDocument();
  });

  it("builds a request by searching, changes quantities, sends it once, and shows it as requested", async () => {
    const { api, s } = fakeServer();
    mount(api);
    fireEvent.change(await screen.findByPlaceholderText(/search for an item/i), { target: { value: "charger" } });
    fireEvent.click(await screen.findByRole("button", { name: "Phone charger 20W" }));
    fireEvent.click(screen.getByRole("button", { name: "Request one more Phone charger 20W" }));
    fireEvent.click(screen.getByRole("button", { name: "Request one more Phone charger 20W" }));
    expect(screen.getByLabelText("3 of Phone charger 20W requested")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/note for the warehouse/i), { target: { value: "Weekend rush" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Request sent to the warehouse.")).toBeInTheDocument();
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ lines: [{ productId: "p1", qty: 3 }], note: "Weekend rush" });
    expect(await screen.findByTestId("request-SR-0002")).toHaveTextContent("Requested");
  });

  it("can ask a sister branch instead of the warehouse, seeing what it holds first", async () => {
    const { api, s } = fakeServer();
    mount(api);
    await screen.findByTestId("request-SR-0001");
    fireEvent.click(screen.getByRole("button", { name: "Victoria Island Branch" }));
    fireEvent.change(screen.getByPlaceholderText(/search for an item/i), { target: { value: "charger" } });
    expect(await screen.findByText("10 at Victoria Island Branch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Phone charger 20W/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Request sent to Victoria Island Branch.")).toBeInTheDocument();
    expect(s.sent[0]).toMatchObject({ lines: [{ productId: "p1", qty: 1 }], fromBranch: "Victoria Island Branch" });
  });

  it("cannot send an empty request; a failed send keeps the same key so a retry cannot raise two", async () => {
    const { api, s } = fakeServer();
    mount(api);
    const send = await screen.findByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/search for an item/i), { target: { value: "cable" } });
    fireEvent.click(await screen.findByRole("button", { name: "USB-C cable 1m" }));
    s.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/server is not reachable/i)).toBeInTheDocument();
    s.down = false;
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.getByText("Request sent to the warehouse.")).toBeInTheDocument());
    expect(s.sent).toHaveLength(2);
    expect(s.sent[0]!.idempotencyKey).toBe(s.sent[1]!.idempotencyKey);
  });
});
