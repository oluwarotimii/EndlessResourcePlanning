// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Approval, Capabilities, CountSubmitInput, StockCount, WriteOffRequestInput } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const who = (id: string, name: string, role: string): Capabilities => ({ user: { id, name }, roles: [role], areas: areasForRoles([role]), scope: { branch: "Pilot Branch" } });
const CONTROLLER = who("u-stock", "Ibrahim Musa", "Stock controller");
const WAREHOUSE = who("u-warehouse", "Ngozi Eze", "Warehouse officer");
const ITEMS = [
  { productId: "p1", name: "Phone charger 20W", sku: "CHG-20W", barcode: "6001000000011" },
  { productId: "p2", name: "USB-C cable 1m", sku: "CBL-USBC", barcode: "6001000000028" },
  { productId: "p3", name: "Bluetooth earbuds", sku: "EAR-BT", barcode: "6001000000035" },
];

function fakeServer(me: Capabilities, counts: StockCount[] = []) {
  const unused = async () => { throw new Error("not used"); };
  const s = { down: false, counts, submitted: [] as CountSubmitInput[], writeOffs: [] as Array<{ id: string; input: WriteOffRequestInput }> };
  const down = () => { if (s.down) throw new ApiFailure("unavailable", "unavailable"); };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => me, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: [], asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    approvals: async () => ({ approvals: [] }), createApproval: unused, decideApproval: unused, summary: unused, cashUpVariance: unused, lookupSale: unused, createReturn: unused,
    stockRequests: unused, createStockRequest: unused, transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, stockLevels: unused, inTransitReport: unused,
    countSheet: async (_t, location) => { down(); return { location, asOf: "now", items: ITEMS }; },
    counts: async () => { down(); return { counts: s.counts }; },
    submitCount: async (_t, input) => {
      down(); s.submitted.push(input);
      const count: StockCount = { id: "SC-0099", location: input.location, status: "needs_recount", round: 1, countedBy: { id: me.user.id, name: me.user.name }, countedAt: input.countedAt, lines: [], note: input.note };
      return { count, duplicate: false };
    },
    deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async (_t, id, input) => {
      down(); s.writeOffs.push({ id, input });
      const c = s.counts.find((x) => x.id === id)!; c.status = "write_off_requested";
      const approval = { id: "AP-0300", kind: "write_off", status: "pending", amount: 0, limit: 100000, unit: "naira", requestedBy: { id: me.user.id, name: me.user.name }, requestedAt: "now" } as Approval;
      return { count: { ...c }, approval, duplicate: false };
    },
  };
  return { api, s };
}

const stockCount = (over: Partial<StockCount>): StockCount => ({
  id: "SC-0001", location: "branch", status: "needs_recount", round: 1, countedBy: { id: "u-stock", name: "Ibrahim Musa" }, countedAt: new Date(Date.now() - 3_600_000).toISOString(),
  lines: [{ productId: "p1", name: "Phone charger 20W", counted: 7, needsRecount: true }, { productId: "p2", name: "USB-C cable 1m", counted: 5, needsRecount: false }], ...over,
});

let storage: Storage;
const mount = (api: ApiClient, me: Capabilities, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(me));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
const scan = (code: string) => { const box = screen.getByLabelText(/scan an item/i); fireEvent.change(box, { target: { value: code } }); fireEvent.submit(box.closest("form")!); };
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("physical stock count (K01)", () => {
  it("is blind: the sheet lists items with no system quantity, and counts progress as you scan and type", async () => {
    const { api } = fakeServer(CONTROLLER);
    mount(api, CONTROLLER, "/s/K01");
    fireEvent.click(await screen.findByRole("button", { name: "Begin counting" }));
    expect(await screen.findByText("Phone charger 20W")).toBeInTheDocument();
    expect(screen.getAllByText("Not counted yet")).toHaveLength(3);
    expect(screen.getByTestId("progress")).toHaveTextContent("Items counted: 0 of 3");
    scan("6001000000011"); scan("6001000000011");
    expect(screen.getByLabelText("Counted Phone charger 20W")).toHaveValue("2");
    fireEvent.change(screen.getByLabelText("Counted USB-C cable 1m"), { target: { value: "0" } }); // an explicit zero
    expect(screen.getByTestId("progress")).toHaveTextContent("Items counted: 2 of 3");
    scan("0000");
    expect(await screen.findByText(/That code is not on this list: 0000/)).toBeInTheDocument();
  });

  it("finishing sends only what was counted, once, with the zero kept", async () => {
    const { api, s } = fakeServer(CONTROLLER);
    mount(api, CONTROLLER, "/s/K01");
    fireEvent.click(await screen.findByRole("button", { name: "Begin counting" }));
    await screen.findByText("Phone charger 20W");
    expect(screen.getByRole("button", { name: "Finish counting" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Counted Phone charger 20W"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Counted USB-C cable 1m"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    expect(await screen.findByText(/Items that differ come back for a recount/)).toBeInTheDocument();
    await waitFor(() => expect(s.submitted).toHaveLength(1));
    expect(s.submitted[0]).toMatchObject({ location: "branch", lines: [{ productId: "p1", counted: 7 }, { productId: "p2", counted: 0 }] });
    expect(s.submitted[0]!.countId).toBeUndefined();
  });

  it("offline: the count is saved in the queue and sent exactly once when the connection returns", async () => {
    const { api, s } = fakeServer(CONTROLLER);
    mount(api, CONTROLLER, "/s/K01");
    fireEvent.click(await screen.findByRole("button", { name: "Begin counting" }));
    await screen.findByText("Phone charger 20W");
    fireEvent.change(screen.getByLabelText("Counted Phone charger 20W"), { target: { value: "4" } });
    s.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Finish counting" }));
    await screen.findByText(/Count saved/);
    await waitFor(async () => expect((await storage.queue.getAll()).map((i) => i.type)).toEqual(["count.submit"]));
    const key = (await storage.queue.getAll())[0]!.id;
    s.down = false; s.submitted.length = 0;
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(s.submitted).toHaveLength(1));
    expect(s.submitted[0]!.idempotencyKey).toBe(key);
  });

  it("a recount shows ONLY the items that differ, still without quantities, and is sent against the same count", async () => {
    const { api, s } = fakeServer(WAREHOUSE, [stockCount({})]);
    mount(api, WAREHOUSE, "/s/K01");
    const card = await screen.findByTestId("count-SC-0001");
    expect(within(card).getByText("Recount needed")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Recount these items" }));
    expect(await screen.findByText("Phone charger 20W")).toBeInTheDocument();
    expect(screen.queryByText("USB-C cable 1m")).not.toBeInTheDocument(); // it matched
    expect(screen.getByTestId("progress")).toHaveTextContent("Items counted: 0 of 1");
    fireEvent.change(screen.getByLabelText("Counted Phone charger 20W"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the recount" }));
    await waitFor(() => expect(s.submitted).toHaveLength(1));
    expect(s.submitted[0]).toMatchObject({ countId: "SC-0001", lines: [{ productId: "p1", counted: 6 }] });
  });

  it("the person who did the first count cannot recount (the setting), and is told so", async () => {
    const { api } = fakeServer(CONTROLLER, [stockCount({})]);
    mount(api, CONTROLLER, "/s/K01");
    const card = await screen.findByTestId("count-SC-0001");
    expect(within(card).getByText("A different person must recount these items.")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Recount these items" })).not.toBeInTheDocument();
  });
});

describe("count differences and write-off request (K02)", () => {
  const reviewed = stockCount({
    id: "SC-0002", status: "review", round: 2,
    lines: [{ productId: "p1", name: "Phone charger 20W", counted: 7, needsRecount: false, expected: 10, difference: -3 }, { productId: "p2", name: "USB-C cable 1m", counted: 5, needsRecount: false, expected: 5, difference: 0 }],
  });

  it("shows only the items that differ, with system, counted and short/over as icon and words", async () => {
    const { api } = fakeServer(CONTROLLER, [reviewed]);
    mount(api, CONTROLLER, "/s/K02");
    const card = await screen.findByTestId("diff-SC-0002");
    expect(within(card).getByText("Phone charger 20W")).toBeInTheDocument();
    expect(within(card).queryByText("USB-C cable 1m")).not.toBeInTheDocument(); // it matched
    expect(within(card).getByText("Short 3")).toBeInTheDocument();
    expect(within(card).getByText("Differences found")).toBeInTheDocument();
  });

  it("asks for approval once (a failed send keeps the same key); stock is not changed by the screen", async () => {
    const { api, s } = fakeServer(CONTROLLER, [reviewed]);
    mount(api, CONTROLLER, "/s/K02");
    const card = await screen.findByTestId("diff-SC-0002");
    fireEvent.change(within(card).getByLabelText(/why do you think it differs/i), { target: { value: "Stolen from the shelf" } });
    s.down = true;
    fireEvent.click(within(card).getByRole("button", { name: "Ask for approval to adjust stock" }));
    expect(await screen.findByText(/server is not reachable/i)).toBeInTheDocument();
    s.down = false;
    fireEvent.click(within(card).getByRole("button", { name: "Ask for approval to adjust stock" }));
    expect(await screen.findByText(/Stock stays as it is until it is approved/)).toBeInTheDocument();
    expect(s.writeOffs).toHaveLength(1);
    expect(s.writeOffs[0]).toMatchObject({ id: "SC-0002", input: { note: "Stolen from the shelf" } });
    expect(await screen.findByTestId("hist-SC-0002")).toHaveTextContent("Waiting for approval");
    expect(screen.queryByTestId("diff-SC-0002")).not.toBeInTheDocument();
  });

  it("flags a likely mix-up: one variant short and its sibling over, so it is not read as theft", async () => {
    const swap = stockCount({
      id: "SC-0003", status: "review", round: 2,
      lines: [
        { productId: "p13", name: "Black phone case", family: "Phone case", counted: 9, needsRecount: false, expected: 10, difference: -1 },
        { productId: "p6", name: "Clear phone case", family: "Phone case", counted: 11, needsRecount: false, expected: 10, difference: 1 },
        { productId: "p9", name: "USB flash drive", counted: 4, needsRecount: false, expected: 6, difference: -2 },
      ],
    });
    const { api } = fakeServer(CONTROLLER, [swap]);
    mount(api, CONTROLLER, "/s/K02");
    const card = await screen.findByTestId("diff-SC-0003");
    expect(within(card).getByTestId("mixup-p13")).toHaveTextContent(/Possible mix-up with Clear phone case/);
    expect(within(card).getByTestId("mixup-p6")).toHaveTextContent(/Possible mix-up with Black phone case/);
    expect(within(card).queryByTestId("mixup-p9")).not.toBeInTheDocument(); // an ordinary shortage
  });

  it("says so when no count is waiting", async () => {
    const { api } = fakeServer(CONTROLLER, []);
    mount(api, CONTROLLER, "/s/K02");
    expect(await screen.findByText("No counts are waiting for a decision.")).toBeInTheDocument();
  });
});
