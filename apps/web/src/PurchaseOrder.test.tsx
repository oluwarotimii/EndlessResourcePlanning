// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capabilities, CreatePurchaseOrderInput, PurchaseOrder } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
// A sales rep who was given the Procurement officer role on top of their own (a permission given to a person).
const GIVEN: Capabilities = { user: { id: "u-rep", name: "Zainab Idris" }, roles: ["Sales rep", "Procurement officer"], areas: areasForRoles(["Sales rep", "Procurement officer"]), scope: { branch: "Pilot Branch" } };
const PLAIN: Capabilities = { user: { id: "u-rep2", name: "Obinna Eke" }, roles: ["Sales rep"], areas: areasForRoles(["Sales rep"]), scope: { branch: "Pilot Branch" } };
const PRODUCTS = [
  { id: "p1", sku: "CHG", barcode: "1", name: "Phone charger 20W", price: 6500, stock: 40 },
  { id: "p2", sku: "CBL", barcode: "2", name: "USB-C cable 1m", price: 2500, stock: 120 },
];

function fakeServer(caps: Capabilities) {
  const unused = async () => { throw new Error("not used"); };
  const s = { sent: [] as CreatePurchaseOrderInput[], list: [] as PurchaseOrder[] };
  const api = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => caps, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: PRODUCTS, asOf: "x" }),
    purchaseOrders: async () => ({ purchaseOrders: s.list }),
    raisePurchaseOrder: async (_t: string, input: CreatePurchaseOrderInput) => {
      s.sent.push(input);
      const purchaseOrder: PurchaseOrder = { id: `PO-000${s.list.length + 1}`, supplierName: input.supplierName, status: "open", createdAt: new Date().toISOString(), raisedBy: { id: caps.user.id, name: caps.user.name },
        lines: input.lines.map((l) => ({ productId: l.productId, name: PRODUCTS.find((p) => p.id === l.productId)!.name, qtyOrdered: l.qty, qtyReceived: 0 })) };
      s.list = [purchaseOrder, ...s.list];
      return { purchaseOrder, duplicate: false };
    },
  } as unknown as ApiClient;
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, caps: Capabilities, path = "/s/R01") => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(caps));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("purchase orders (R01): a permission given to a person", () => {
  it("lets a sales rep who was given the permission raise an order, once, and shows who raised it", async () => {
    const { api, s } = fakeServer(GIVEN);
    mount(api, GIVEN);
    fireEvent.change(await screen.findByLabelText("Supplier"), { target: { value: "Ikeja Wholesale Ltd" } });
    fireEvent.change(await screen.findByLabelText("Item"), { target: { value: "p2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to order" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
    expect(screen.getByText("× 40")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raise purchase order" }));
    await screen.findByText("PO-0001 raised for Ikeja Wholesale Ltd.");
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ supplierName: "Ikeja Wholesale Ltd", lines: [{ productId: "p2", qty: 40 }] });
    expect(within(await screen.findByTestId("po-PO-0001")).getByText(/Raised by Zainab Idris/)).toBeInTheDocument();
  });
  it("asks for a supplier and an item before sending anything", async () => {
    const { api, s } = fakeServer(GIVEN);
    mount(api, GIVEN);
    fireEvent.click(await screen.findByRole("button", { name: "Raise purchase order" }));
    expect(await screen.findByText("Add at least one item.")).toBeInTheDocument();
    expect(s.sent).toHaveLength(0);
  });
  it("hides the screen from a sales rep who was not given the permission", async () => {
    const { api } = fakeServer(PLAIN);
    mount(api, PLAIN);
    await waitFor(() => expect(screen.queryByLabelText("Supplier")).not.toBeInTheDocument());
  });
});
