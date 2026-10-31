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
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const MANAGER: Capabilities = { user: { id: "u-manager", name: "Tunde Bello" }, roles: ["Branch manager"], areas: areasForRoles(["Branch manager"]), scope: { branch: "Pilot Branch" } };

const seed = (): Approval[] => [
  {
    id: "AP-0001", kind: "discount", status: "pending", amount: 2, limit: 3, unit: "percent",
    requestedBy: { id: "u-cashier", name: "Amaka Obi" }, requestedAt: "2026-10-31T09:15:00.000Z",
    requestNote: "Box was already open on the shelf.",
  },
  {
    id: "AP-0004", kind: "discount", status: "pending", amount: 5, limit: 3, unit: "percent",
    requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt: "2026-10-31T10:20:00.000Z",
    requestNote: "Staff purchase.",
  },
];

function fakeServer() {
  const approvals = seed();
  const s = { down: false, decisions: [] as Array<{ id: string; input: ApprovalDecisionInput }> };
  const api: ApiClient = {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }),
    login: async () => { throw new Error("unused"); },
    capabilities: async () => MANAGER,
    tasks: async () => ({ tasks: [] }),
    logout: async () => undefined,
    products: async () => ({ products: [], asOf: "now" }),
    customers: async () => ({ customers: [] }),
    createSale: async () => { throw new Error("not used"); },
    openShift: async () => { throw new Error("not used"); },
    closeShift: async () => { throw new Error("not used"); },
    logPrint: async () => undefined,
    approvals: async () => {
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      return { approvals: approvals.map((a) => ({ ...a })) };
    },
    createApproval: async () => { throw new Error("not used"); },
    decideApproval: async (_t, id, input) => {
      if (s.down) throw new ApiFailure("unavailable", "unavailable");
      s.decisions.push({ id, input });
      const found = approvals.find((a) => a.id === id);
      if (!found) throw new ApiFailure("validation", "missing");
      found.status = input.decision === "approve" ? "approved" : "rejected";
      found.decidedBy = { id: MANAGER.user.id, name: MANAGER.user.name };
      found.decidedAt = "now";
      found.decisionReason = input.reason;
      return { approval: { ...found }, duplicate: false };
    },
  };
  return { api, s };
}

let storage: Storage;
const mount = (api: ApiClient) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(MANAGER));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={["/s/A01"]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};

const hold = async (button: HTMLElement) => {
  fireEvent.pointerDown(button);
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
};

beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("approvals inbox (A01)", () => {
  it("shows who raised it, what it is, the amount and the limit", async () => {
    const { api } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("approval-AP-0001");
    expect(within(card).getByText("Raised by Amaka Obi")).toBeInTheDocument();
    expect(within(card).getByText("Discount")).toBeInTheDocument();
    expect(within(card).getByText("2%")).toBeInTheDocument();
    expect(within(card).getByText("3%")).toBeInTheDocument();
    expect(within(card).getByText(/Box was already open/)).toBeInTheDocument();
  });

  it("a short tap does not approve; holding to confirm approves once", async () => {
    const { api, s } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("approval-AP-0001");
    const button = within(card).getByRole("button", { name: /hold to approve/i });

    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
    expect(s.decisions).toHaveLength(0);
    expect(within(card).getByText("Pending")).toBeInTheDocument();

    await hold(button);
    await waitFor(() => expect(s.decisions).toHaveLength(1));
    expect(s.decisions[0]).toMatchObject({ id: "AP-0001", input: { decision: "approve" } });
    expect(await within(card).findByText("Approved")).toBeInTheDocument();
  });

  it("rejection needs a reason and sends it", async () => {
    const { api, s } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("approval-AP-0001");
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /reject request/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/reason for rejecting/i), { target: { value: "No" } });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/reason for rejecting/i), { target: { value: "Price is already discounted" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(s.decisions).toHaveLength(1));
    expect(s.decisions[0]).toMatchObject({ id: "AP-0001", input: { decision: "reject", reason: "Price is already discounted" } });
    expect(await within(card).findByText("Rejected")).toBeInTheDocument();
    expect(within(card).getByText(/Price is already discounted/)).toBeInTheDocument();
  });

  it("the creator of a request never sees the approve or reject controls", async () => {
    const { api } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("approval-AP-0004");
    expect(within(card).getByText(/You raised this request/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /hold to approve/i })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("offline hides the decision controls and says why", async () => {
    const { api } = fakeServer();
    mount(api);
    await screen.findByTestId("approval-AP-0001");
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect((await screen.findAllByText(/Approvals need a connection/)).length).toBeGreaterThan(0);
    const card = screen.getByTestId("approval-AP-0001");
    expect(within(card).queryByRole("button", { name: /hold to approve/i })).not.toBeInTheDocument();
    await act(async () => { window.dispatchEvent(new Event("online")); });
  });

  it("a failed decision keeps the request pending and says nothing was changed", async () => {
    const { api, s } = fakeServer();
    mount(api);
    const card = await screen.findByTestId("approval-AP-0001");
    s.down = true;
    await hold(within(card).getByRole("button", { name: /hold to approve/i }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(/Nothing was decided/);
    expect(within(card).getByText("Pending")).toBeInTheDocument();
  });
});
