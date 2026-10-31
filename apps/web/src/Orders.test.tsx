// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capabilities, CreateOrderInput, SalesOrder } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const REP: Capabilities = { user: { id: "u-rep2", name: "Obinna Eke" }, roles: ["Sales rep"], areas: areasForRoles(["Sales rep"]), scope: { branch: "Pilot Branch" } };
const CASHIER: Capabilities = { user: { id: "u-cashier", name: "Amaka Obi" }, roles: ["Cashier"], areas: areasForRoles(["Cashier"]), scope: { branch: "Pilot Branch" } };
const PRODUCTS = [
  { id: "p1", sku: "CHG", barcode: "1", name: "Phone charger 20W", price: 6500, stock: 40, family: "Phone charger", variant: "20W" },
  { id: "p2", sku: "CBL", barcode: "2", name: "USB-C cable 1m", price: 2500, stock: 120 },
];


function fakeServer(caps: Capabilities, seed: SalesOrder[] = []) {
  const unused = async () => { throw new Error("not used"); };
  const s = { sent: [] as CreateOrderInput[], list: seed };
  const api = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => caps, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: PRODUCTS, asOf: "x" }), customers: async () => ({ customers: [] }),
    returnInspections: async () => { throw new Error("not used"); }, inspectReturn: async () => { throw new Error("not used"); }, correctVariant: async () => { throw new Error("not used"); }, mixupReport: async () => { throw new Error("not used"); }, orders: async () => ({ orders: s.list }),
    cancelOrder: async (_t: string, id: string) => { const o = s.list.find((x) => x.id === id)!; const c = { ...o, status: "cancelled" as const }; s.list = s.list.map((x) => (x.id === id ? c : x)); return { order: c, duplicate: false }; },
    createOrder: async (_t: string, input: CreateOrderInput) => {
      s.sent.push(input);
      const order: SalesOrder = { id: `SO-000${s.list.length + 1}`, status: "open", createdAt: new Date().toISOString(), createdBy: { id: caps.user.id, name: caps.user.name }, note: input.note,
        lines: input.lines.map((l) => { const p = PRODUCTS.find((x) => x.id === l.productId)!; return { productId: p.id, name: p.name, unitPrice: p.price, qty: l.qty }; }) };
      s.list = [order, ...s.list];
      return { order, duplicate: false };
    },
  } as unknown as ApiClient;
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, caps: Capabilities, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(caps));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("orders built on the floor (S06) and picked up by the cashier", () => {
  it("an attendant scans an item, adds another by search, sends the order once, and sees it waiting", async () => {
    const { api, s } = fakeServer(REP);
    mount(api, REP, "/s/S06");
    fireEvent.change(await screen.findByLabelText("Scan a barcode or search for an item"), { target: { value: "cable" } });
    fireEvent.click(await screen.findByRole("button", { name: /USB-C cable 1m/ }));
    fireEvent.click(screen.getByRole("button", { name: "One more USB-C cable 1m" }));
    expect(screen.getByLabelText("2 USB-C cable 1m")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Note for the cashier/), { target: { value: "Gift wrap" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the cashier" }));
    await screen.findByText("Order SO-0001 sent. Tell the customer to go to the cashier.");
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ lines: [{ productId: "p2", qty: 2 }], note: "Gift wrap" });
    expect(within(await screen.findByTestId("my-order-SO-0001")).getByText("Waiting for the cashier")).toBeInTheDocument();
  });
  it("items that come in variants cannot be tapped in; they have to be scanned", async () => {
    const { api } = fakeServer(REP);
    mount(api, REP, "/s/S06");
    fireEvent.change(await screen.findByLabelText("Scan a barcode or search for an item"), { target: { value: "charger" } });
    const tile = await screen.findByRole("button", { name: /Phone charger 20W/ });
    expect(tile).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(tile);
    expect(screen.getByText("Nothing added yet. Scan or search for an item.")).toBeInTheDocument();
  });
  it("the cashier sees the waiting order with its lines and total, and takes payment: the till gets the lines and the order", async () => {
    const order: SalesOrder = { id: "SO-0007", status: "open", createdAt: new Date().toISOString(), createdBy: { id: "u-rep2", name: "Obinna Eke" }, lines: [{ productId: "p1", name: "Phone charger 20W", unitPrice: 6500, qty: 2 }] };
    const { api } = fakeServer(CASHIER, [order]);
    mount(api, CASHIER, "/s/S02");
    const card = await screen.findByTestId("order-SO-0007");
    expect(within(card).getByText("2 × Phone charger 20W")).toBeInTheDocument();
    expect(within(card).getByText(/Built by Obinna Eke/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Take payment" }));
    await waitFor(async () => {
      const cart = await storage.kv.get<{ orderId?: string; lines: Array<{ qty: number }> }>("cart:u-cashier");
      expect(cart?.orderId).toBe("SO-0007");
      expect(cart?.lines[0]?.qty).toBe(2);
    });
  });
});
