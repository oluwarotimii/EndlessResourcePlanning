// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval, ApprovalDecisionInput, Capabilities } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import type { ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const AUDITOR: Capabilities = { user: { id: "u-auditor", name: "Hauwa Bello" }, roles: ["Auditor"], areas: areasForRoles(["Auditor"]), scope: { branch: "Pilot Branch" } };
const old = new Date(Date.now() - 60 * 3_600_000).toISOString(); // 60 hours ago: past the 48 hour ruling time
const fresh = new Date(Date.now() - 2 * 3_600_000).toISOString();

const shortage = (id: string, requestedAt: string): Approval => ({
  id, kind: "shortage", status: "pending", amount: 9100, limit: 100000, unit: "naira",
  requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt, requestNote: "Box was open",
  shortage: { transferId: "TR-0007", valueAtCost: 9100, receiverNote: "Box was open", lines: [{ productId: "p1", name: "Phone charger 20W", qtyMissing: 2 }] },
  steps: [{ roles: ["Auditor", "MD / Executive"], status: "pending" }],
});

function fakeServer(list: Approval[]) {
  const unused = async () => { throw new Error("not used"); };
  const s = { decisions: [] as Array<{ id: string; input: ApprovalDecisionInput }> };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => AUDITOR, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: [], asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    createApproval: unused, summary: unused, cashUpVariance: unused, lookupSale: unused, createReturn: unused, stockRequests: unused, createStockRequest: unused,
    transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, stockLevels: unused, countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: unused,
    approvals: async () => ({ approvals: list.map((a) => ({ ...a })) }),
    decideApproval: async (_t, id, input) => {
      s.decisions.push({ id, input });
      const a = list.find((x) => x.id === id)!;
      a.status = input.decision === "approve" ? "approved" : "rejected";
      a.decidedBy = { id: AUDITOR.user.id, name: AUDITOR.user.name }; a.decisionReason = input.reason;
      if (a.shortage && input.outcome) a.shortage.bearer = input.outcome;
      return { approval: { ...a }, duplicate: false };
    },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(AUDITOR));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={["/s/A01"]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
const hold = async (button: HTMLElement) => { fireEvent.pointerDown(button); await act(async () => { await new Promise((r) => setTimeout(r, 800)); }); };
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("shortage ruling in the inbox", () => {
  it("the Auditor sees the inbox, what is missing and its value at cost", async () => {
    const { api } = fakeServer([shortage("AP-0100", fresh)]);
    mount(api);
    const card = await screen.findByTestId("approval-AP-0100");
    expect(within(card).getByText("Missing stock")).toBeInTheDocument();
    const detail = within(card).getByTestId("shortage-AP-0100");
    expect(within(detail).getByText("Transfer TR-0007 was received short")).toBeInTheDocument();
    expect(within(detail).getByText("2 × Phone charger 20W missing")).toBeInTheDocument();
    expect(within(detail).getByText(/9,100/)).toBeInTheDocument();
    expect(within(detail).getByText(/Box was open/)).toBeInTheDocument();
    expect(within(card).queryByText("Waiting too long")).not.toBeInTheDocument();
  });

  it("must choose who bears the loss before the ruling can be confirmed, then sends that choice", async () => {
    const { api, s } = fakeServer([shortage("AP-0100", fresh)]);
    mount(api);
    const card = await screen.findByTestId("approval-AP-0100");
    const confirm = within(card).getByRole("button", { name: /hold to approve/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(card).getByLabelText(/who bears the loss/i), { target: { value: "warehouse" } });
    expect(confirm).toBeEnabled();
    await hold(confirm);
    await waitFor(() => expect(s.decisions).toHaveLength(1));
    expect(s.decisions[0]).toMatchObject({ id: "AP-0100", input: { decision: "approve", outcome: "warehouse" } });
    expect(await within(card).findByText(/Ruled: charged to The warehouse that packed it/)).toBeInTheDocument();
  });

  it("a shortage waiting longer than the ruling time is marked overdue, with an icon and words", async () => {
    const { api } = fakeServer([shortage("AP-0101", old)]);
    mount(api);
    const card = await screen.findByTestId("approval-AP-0101");
    expect(within(card).getByText("Waiting too long")).toBeInTheDocument();
  });

  it("rejecting still needs a reason, and sends no bearer", async () => {
    const { api, s } = fakeServer([shortage("AP-0102", fresh)]);
    mount(api);
    const card = await screen.findByTestId("approval-AP-0102");
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for rejecting/i), { target: { value: "Items found in the other box" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /reject/i, hidden: false }));
    await waitFor(() => expect(s.decisions).toHaveLength(1));
    expect(s.decisions[0]!.input).toMatchObject({ decision: "reject", reason: "Items found in the other box" });
    expect(s.decisions[0]!.input.outcome).toBeUndefined();
  });
});

describe("write-off in the inbox", () => {
  it("an approver sees what the count found and its value at cost, and does not need to choose a bearer", async () => {
    const writeOff: Approval = {
      id: "AP-0200", kind: "write_off", status: "pending", amount: 17850, limit: 100000, unit: "naira",
      requestedBy: { id: "u-stock", name: "Ibrahim Musa" }, requestedAt: fresh, requestNote: "Stolen from the shelf",
      writeOff: { countId: "SC-0004", location: "branch", valueAtCost: 17850, note: "Stolen from the shelf", lines: [{ productId: "p10", name: "Wireless mouse", expected: 30, counted: 27, difference: -3 }] },
      steps: [{ roles: ["Auditor", "MD / Executive"], status: "pending" }],
    };
    const { api } = fakeServer([writeOff]);
    mount(api);
    const card = await screen.findByTestId("approval-AP-0200");
    expect(within(card).getByText("Stock write-off")).toBeInTheDocument();
    const detail = within(card).getByTestId("writeoff-AP-0200");
    expect(within(detail).getByText("Count SC-0004 (The shelf (this branch))")).toBeInTheDocument();
    expect(within(detail).getByText("Wireless mouse: system 30, counted 27")).toBeInTheDocument();
    expect(within(detail).getByText(/17,850/)).toBeInTheDocument();
    expect(within(card).queryByLabelText(/who bears the loss/i)).not.toBeInTheDocument(); // that is for shortages only
    expect(within(card).getByRole("button", { name: /hold to approve/i })).toBeEnabled();
  });
});
