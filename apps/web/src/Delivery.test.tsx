// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Approval, AssignInput, Capabilities, CodOutstanding, DeliveryOrder, ProofInput, RemitInput } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const who = (id: string, name: string, role: string): Capabilities => ({ user: { id, name }, roles: [role], areas: areasForRoles([role]), scope: { branch: "Pilot Branch" } });
const COORD = who("u-coordinator", "Sade Adeyemi", "Delivery coordinator");
const RIDER = who("u-rider", "Chidi Okafor", "Rider / courier");

const order = (over: Partial<DeliveryOrder> & { id: string }): DeliveryOrder => ({
  customerName: "Ngozi Chukwu", phone: "0803 111 0001", address: "12 Admiralty Way, Lekki", items: [{ productId: "p3", name: "Bluetooth earbuds", qty: 1 }],
  payment: "cash_on_delivery", amountDue: 18500, status: "pending", remitted: false, createdAt: "2026-11-02T07:30:00.000Z", ...over,
});

function fakeServer(me: Capabilities, orders: DeliveryOrder[]) {
  const unused = async () => { throw new Error("not used"); };
  const s = {
    down: false, orders, assigned: [] as Array<{ id: string; input: AssignInput }>, proofs: [] as ProofInput[], remits: [] as RemitInput[],
    outstanding: { asOf: "2026-11-03T10:00:00.000Z", thresholdHours: 24, riders: [] } as CodOutstanding,
  };
  const down = () => { if (s.down) throw new ApiFailure("unavailable", "unavailable"); };
  const mine = () => (me.roles.includes("Rider / courier") ? s.orders.filter((o) => o.riderId === me.user.id) : s.orders);
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => me, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: [], asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    approvals: async () => ({ approvals: [] }), createApproval: unused, decideApproval: unused, summary: unused, cashUpVariance: unused, lookupSale: unused, createReturn: unused,
    stockRequests: unused, createStockRequest: unused, branches: unused, transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, purchaseOrders: unused, returnInspections: async () => { throw new Error("not used"); }, inspectReturn: async () => { throw new Error("not used"); }, correctVariant: async () => { throw new Error("not used"); }, mixupReport: async () => { throw new Error("not used"); }, orders: async () => { throw new Error("not used"); }, createOrder: async () => { throw new Error("not used"); }, cancelOrder: async () => { throw new Error("not used"); }, raisePurchaseOrder: async () => { throw new Error("not used"); }, receiveGoods: unused, stockLevels: unused, inTransitReport: unused,
    countSheet: unused, counts: unused, submitCount: unused, requestWriteOff: unused,
    deliveryOrders: async () => { down(); return { orders: mine() }; },
    riders: async () => ({ riders: [{ id: "u-rider", name: "Chidi Okafor" }, { id: "u-rider2", name: "Femi Adewale" }] }),
    assignDelivery: async (_t, id, input) => {
      down(); s.assigned.push({ id, input });
      const o = s.orders.find((x) => x.id === id)!;
      Object.assign(o, { status: "assigned", riderId: input.riderId, riderName: input.riderId === "u-rider" ? "Chidi Okafor" : "Femi Adewale" });
      return { order: { ...o }, duplicate: false };
    },
    proveDelivery: async (_t, input) => {
      down(); s.proofs.push(input);
      const o = s.orders.find((x) => x.id === input.orderId)!;
      Object.assign(o, { status: input.outcome, cashCollected: input.cashCollected, failedReason: input.failedReason });
      return { order: { ...o }, duplicate: false };
    },
    remitCash: async (_t, input) => {
      s.remits.push(input); down();
      for (const id of input.orderIds) s.orders.find((o) => o.id === id)!.remittanceId = "AP-0900";
      return { approval: { id: "AP-0900", kind: "cash_remittance", status: "pending", amount: 0, limit: 0, unit: "naira", requestedBy: { id: me.user.id, name: me.user.name }, requestedAt: "now" } as Approval, duplicate: false };
    },
    codOutstanding: async () => { down(); return s.outstanding; },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient, me: Capabilities, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(me));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("dispatch board (L01)", () => {
  it("shows orders to assign with how they are paid, and a failed order with its reason", async () => {
    const { api } = fakeServer(COORD, [order({ id: "DO-0001" }), order({ id: "DO-0002", payment: "prepaid", amountDue: 0 }), order({ id: "DO-0003", status: "failed", failedReason: "Customer not reachable", riderId: "u-rider" })]);
    mount(api, COORD, "/s/L01");
    const cod = await screen.findByTestId("order-DO-0001");
    expect(within(cod).getByText("Collect ₦18,500")).toBeInTheDocument();
    expect(within(screen.getByTestId("order-DO-0002")).getByText("Already paid")).toBeInTheDocument();
    const failed = screen.getByTestId("order-DO-0003");
    expect(within(failed).getByText("Failed: Customer not reachable")).toBeInTheDocument();
    expect(within(failed).getByText("Failed")).toBeInTheDocument(); // icon and word
  });

  it("assigns an order to a rider once, and it moves to out for delivery", async () => {
    const { api, s } = fakeServer(COORD, [order({ id: "DO-0001" })]);
    mount(api, COORD, "/s/L01");
    const card = await screen.findByTestId("order-DO-0001");
    const assign = within(card).getByRole("button", { name: "Assign" });
    expect(assign).toBeDisabled();
    await waitFor(() => expect(within(card).getByRole("option", { name: "Femi Adewale" })).toBeInTheDocument());
    fireEvent.change(within(card).getByLabelText("Choose a rider"), { target: { value: "u-rider2" } });
    fireEvent.click(assign);
    await waitFor(() => expect(s.assigned).toHaveLength(1));
    expect(s.assigned[0]).toMatchObject({ id: "DO-0001", input: { riderId: "u-rider2" } });
    const out = await screen.findByRole("region", { name: "Out for delivery" });
    expect(within(out).getByTestId("order-DO-0001")).toHaveTextContent("Rider: Femi Adewale");
  });
});

describe("rider's deliveries (L02) and proof of delivery (L03)", () => {
  const mineOrders = () => [
    order({ id: "DO-0001", status: "assigned", riderId: "u-rider" }),
    order({ id: "DO-0002", status: "assigned", riderId: "u-rider", payment: "prepaid", amountDue: 0, customerName: "Tosin Balogun" }),
  ];

  it("shows the rider their own deliveries with a call link, and Deliver opens the proof screen", async () => {
    const { api } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L02");
    const card = await screen.findByTestId("order-DO-0001");
    expect(within(card).getByText("Collect ₦18,500")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /call ngozi/i })).toHaveAttribute("href", "tel:08031110001");
    fireEvent.click(within(card).getByRole("button", { name: "Deliver" }));
    expect(await screen.findByRole("heading", { name: "Proof of delivery" })).toBeInTheDocument();
  });

  it("a prepaid delivery is 3 taps: Deliver, Delivered, Confirm; and no cash is asked for", async () => {
    const { api, s } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L03?order=DO-0002");
    fireEvent.click(await screen.findByRole("button", { name: "Delivered" }));
    expect(screen.queryByText("How much cash did you collect?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(s.proofs).toHaveLength(1));
    expect(s.proofs[0]).toMatchObject({ orderId: "DO-0002", outcome: "delivered", recipient: "Tosin Balogun" });
    expect(s.proofs[0]!.cashCollected).toBeUndefined();
    expect(await screen.findByText(/Saved\. If you are offline/)).toBeInTheDocument();
  });

  it("a cash-on-delivery order has the full amount ready; a different amount is refused with the reason", async () => {
    const { api, s } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L03?order=DO-0001");
    fireEvent.click(await screen.findByRole("button", { name: "Delivered" }));
    expect(screen.getByRole("button", { name: "Collected the full ₦18,500" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "A different amount" }));
    fireEvent.change(screen.getByLabelText("How much cash did you collect?"), { target: { value: "10000" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/must collect the full ₦18,500/);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Collected the full ₦18,500" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(s.proofs).toHaveLength(1));
    expect(s.proofs[0]).toMatchObject({ outcome: "delivered", cashCollected: 18500 });
  });

  it("a failed delivery needs a reason from the list", async () => {
    const { api, s } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L03?order=DO-0001");
    fireEvent.click(await screen.findByRole("button", { name: "Could not deliver" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Why could it not be delivered?"), { target: { value: "Wrong address" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(s.proofs).toHaveLength(1));
    expect(s.proofs[0]).toMatchObject({ outcome: "failed", failedReason: "Wrong address" });
  });

  it("offline: the proof is saved on the phone and sent exactly once when the connection returns", async () => {
    const { api, s } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L03?order=DO-0002");
    fireEvent.click(await screen.findByRole("button", { name: "Delivered" }));
    s.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText(/Saved\. If you are offline/);
    await waitFor(async () => expect((await storage.queue.getAll()).map((i) => i.type)).toEqual(["delivery.proof"]));
    const key = (await storage.queue.getAll())[0]!.id;
    s.down = false; s.proofs.length = 0;
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(s.proofs).toHaveLength(1));
    expect(s.proofs[0]!.idempotencyKey).toBe(key);
  });

  it("without a chosen delivery it points the rider back to the list", async () => {
    const { api } = fakeServer(RIDER, mineOrders());
    mount(api, RIDER, "/s/L03");
    expect(await screen.findByText("Choose a delivery from My deliveries first.")).toBeInTheDocument();
  });
});

describe("hand in delivery cash (L04)", () => {
  const delivered = (id: string, cash: number) => order({ id, status: "delivered", riderId: "u-rider", cashCollected: cash, amountDue: cash });

  it("lists the cash to hand in with a total, lets the rider untick one, and sends only the ticked ones", async () => {
    const { api, s } = fakeServer(RIDER, [delivered("DO-0001", 18500), delivered("DO-0003", 22000)]);
    mount(api, RIDER, "/s/L04");
    expect(await screen.findByTestId("cash-total")).toHaveTextContent(/40,500/);
    fireEvent.click(screen.getByRole("checkbox", { name: /DO-0003/ }));
    expect(screen.getByTestId("cash-total")).toHaveTextContent(/18,500/);
    fireEvent.click(screen.getByRole("button", { name: "Hand in ₦18,500" }));
    expect(await screen.findByText(/The manager will confirm they received it/)).toBeInTheDocument();
    expect(s.remits).toHaveLength(1);
    expect(s.remits[0]!.orderIds).toEqual(["DO-0001"]);
    expect(await screen.findByTestId("waiting-DO-0001")).toBeInTheDocument(); // now waiting for the manager
  });

  it("needs a connection, and says so, because a manager must confirm", async () => {
    const { api, s } = fakeServer(RIDER, [delivered("DO-0001", 18500)]);
    mount(api, RIDER, "/s/L04");
    await screen.findByTestId("cash-total");
    s.down = true;
    fireEvent.click(screen.getByRole("button", { name: /Hand in/ }));
    expect(await screen.findByText(/server is not reachable/i)).toBeInTheDocument();
    expect(s.remits).toHaveLength(1);
    s.down = false;
    fireEvent.click(screen.getByRole("button", { name: /Hand in/ }));
    await waitFor(() => expect(s.remits).toHaveLength(2));
    expect(s.remits[0]!.idempotencyKey).toBe(s.remits[1]!.idempotencyKey); // the retry cannot raise a second request
  });

  it("says so when there is nothing to hand in", async () => {
    const { api } = fakeServer(RIDER, [order({ id: "DO-0002", status: "assigned", riderId: "u-rider" })]);
    mount(api, RIDER, "/s/L04");
    expect(await screen.findByText("You have no delivery cash to hand in.")).toBeInTheDocument();
  });
});

describe("delivery cash not handed in (L05)", () => {
  it("lists riders with the amount and hours, and marks overdue with an icon and a word", async () => {
    const { api, s } = fakeServer(COORD, []);
    s.outstanding = { asOf: "2026-11-03T10:00:00.000Z", thresholdHours: 24, riders: [
      { riderId: "u-rider", riderName: "Chidi Okafor", orders: 2, amount: 40500, oldestDeliveredAt: "2026-11-02T08:00:00.000Z", hoursOutstanding: 26, overdue: true },
      { riderId: "u-rider2", riderName: "Femi Adewale", orders: 1, amount: 14500, oldestDeliveredAt: "2026-11-03T08:00:00.000Z", hoursOutstanding: 2, overdue: false },
    ] };
    mount(api, COORD, "/s/L05");
    const late = await screen.findByTestId("cod-u-rider");
    expect(within(late).getByText("Overdue")).toBeInTheDocument();
    expect(within(late).getByText(/40,500/)).toBeInTheDocument();
    expect(within(screen.getByTestId("cod-u-rider2")).getByText("On time")).toBeInTheDocument();
    expect(screen.getByText(/Older than 24 hours is overdue/)).toBeInTheDocument();
  });

  it("says so when everything has been handed in", async () => {
    const { api } = fakeServer(COORD, []);
    mount(api, COORD, "/s/L05");
    expect(await screen.findByText("All delivery cash has been handed in.")).toBeInTheDocument();
  });
});
