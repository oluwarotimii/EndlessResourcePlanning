// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capabilities, InspectReturnInput, MixupCorrectionInput, ReturnRecord, Sale } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const MANAGER: Capabilities = { user: { id: "u-manager", name: "Tunde Bello" }, roles: ["Branch manager"], areas: areasForRoles(["Branch manager"]), scope: { branch: "Pilot Branch" } };
const STOCK: Capabilities = { user: { id: "u-stock", name: "Ibrahim Musa" }, roles: ["Stock controller"], areas: areasForRoles(["Stock controller"]), scope: { branch: "Pilot Branch" } };
const PRODUCTS = [
  { id: "p6", sku: "CSE-CLR", barcode: "6", name: "Clear phone case", price: 3000, stock: 75, family: "Phone case", variant: "Clear" },
  { id: "p13", sku: "CSE-BLK", barcode: "13", name: "Black phone case", price: 3500, stock: 60, family: "Phone case", variant: "Black" },
  { id: "p2", sku: "CBL", barcode: "2", name: "USB-C cable 1m", price: 2500, stock: 120 },
];
const SALE: Sale = { idempotencyKey: "sale-key-0001", clientCreatedAt: "x", shiftId: "s", lines: [{ productId: "p6", name: "Clear phone case", unitPrice: 3000, qty: 1 }], subtotal: 3000, vatMode: "inclusive", vat: 209, total: 3000, payments: [{ method: "cash", amount: 3000 }], invoiceNo: "INV-000042", cashier: { id: "u-cashier", name: "Amaka Obi" }, postedAt: "2026-11-05T09:00:00.000Z" };

const base = (caps: Capabilities) => ({
  users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: async () => { throw new Error("x"); }, capabilities: async () => caps, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
  products: async () => ({ products: PRODUCTS, asOf: "x" }),
});
let storage: Storage;
const mount = (api: unknown, caps: Capabilities, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(caps));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api as ApiClient} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("check returned goods (T03)", () => {
  it("an inspector puts a faulty item back on the shelf, and it moves to the checked list", async () => {
    const ret = { returnNo: "RET-000001", invoiceNo: "INV-000042", lines: [{ productId: "p2", qty: 1 }], reason: "Faulty item", cashier: { id: "u-cashier", name: "Amaka Obi" }, postedAt: new Date().toISOString(), faulty: true, inspection: { status: "pending" } } as unknown as ReturnRecord;
    const sent: InspectReturnInput[] = [];
    let list = [ret];
    const api = { ...base(STOCK), returnInspections: async () => ({ returns: list }), inspectReturn: async (_t: string, _no: string, input: InspectReturnInput) => { sent.push(input); const done = { ...ret, inspection: { status: "restocked" as const } }; list = [done]; return { ret: done, duplicate: false }; } };
    mount(api, STOCK, "/s/T03");
    const card = await screen.findByTestId("inspect-RET-000001");
    expect(within(card).getByText("1 × USB-C cable 1m")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Put back on the shelf" }));
    await screen.findByText("RET-000001 is back on the shelf.");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ outcome: "restock" });
    expect(within(await screen.findByTestId("inspected-RET-000001")).getByText("Back on the shelf")).toBeInTheDocument();
  });
});

describe("fix a mix-up (T04)", () => {
  it("a manager finds the sale, picks what was really taken, sees the ₦500 owed, and fixes it once", async () => {
    const sent: MixupCorrectionInput[] = [];
    const api = { ...base(MANAGER), lookupSale: async () => ({ sale: SALE, returned: {} }), correctVariant: async (_t: string, input: MixupCorrectionInput) => { sent.push(input); return { correction: { ...input, id: "MX-0001" }, duplicate: false }; } };
    mount(api, MANAGER, "/s/T04");
    fireEvent.change(await screen.findByLabelText("Invoice number"), { target: { value: "INV-000042" } });
    fireEvent.click(screen.getByRole("button", { name: "Find the sale" }));
    fireEvent.click(await screen.findByLabelText(/Clear phone case/));
    fireEvent.change(await screen.findByLabelText("What the customer really took"), { target: { value: "p13" } });
    expect((await screen.findByTestId("difference")).textContent).toContain("500");
    fireEvent.change(screen.getByLabelText("What happened"), { target: { value: "Took the black one" } });
    fireEvent.click(screen.getByRole("button", { name: "Fix the sale" }));
    await screen.findByText("Fixed (MX-0001). Stock is corrected and the fix is recorded.");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ saleKey: "sale-key-0001", wrongProductId: "p6", rightProductId: "p13", qty: 1, settlement: "collected" });
  });
});

describe("mix-ups by cashier (G11)", () => {
  it("shows each cashier's count and net difference", async () => {
    const api = { ...base(MANAGER), mixupReport: async () => ({ rows: [{ cashier: { id: "u-cashier", name: "Amaka Obi" }, count: 2, units: 3, netDifference: 1500 }], corrections: [] }) };
    mount(api, MANAGER, "/s/G11");
    const row = await screen.findByTestId("mixup-row-u-cashier");
    expect(within(row).getByText(/2 fixed, 3 items/)).toBeInTheDocument();
  });
});
