// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createMemoryStorage } from "@erp/offline";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, type Capabilities, type LoginResponse } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const USERS = [
  { id: "u-cashier", name: "Amaka Obi", role: "Cashier", pin: "1111" },
  { id: "u-manager", name: "Tunde Bello", role: "Branch manager", pin: "2222" },
];
const capsFor = (u: (typeof USERS)[number]): Capabilities => ({ user: { id: u.id, name: u.name }, roles: [u.role], areas: areasForRoles([u.role]), scope: { branch: "Pilot Branch" } });

const fakeApi: ApiClient = {
  users: async () => ({ deviceBranch: "Pilot Branch", users: USERS.map(({ id, name, role }) => ({ id, name, role })) }),
  login: async ({ userId, pin }): Promise<LoginResponse> => {
    const u = USERS.find((x) => x.id === userId);
    if (!u || u.pin !== pin) throw new ApiFailure(ApiError.shape.code.enum.unauthenticated, "That PIN is not right. Try again.", 401);
    return { token: `tok-${u.id}`, capabilities: capsFor(u) };
  },
  capabilities: async (token) => capsFor(USERS.find((u) => `tok-${u.id}` === token)!),
  tasks: async () => ({ tasks: [{ id: "t", screenId: "A01", title: "Approve discount", status: "pending", amount: 4200, limit: 3, limitUnit: "percent", requestedBy: "Amaka Obi" }] }),
  logout: async () => undefined,
  products: async () => ({ products: [], asOf: "x" }),
  customers: async () => ({ customers: [] }),
  createSale: async () => { throw new Error("not used"); },
  openShift: async () => { throw new Error("not used"); },
  closeShift: async () => { throw new Error("not used"); },
  logPrint: async () => undefined,
  approvals: async () => ({ approvals: [] }),
  createApproval: async () => { throw new Error("not used"); },
  decideApproval: async () => { throw new Error("not used"); },
};

const tenant = loadTenant(tenantJson);
const mount = () => render(<TenantProvider tenant={tenant}><App api={fakeApi} storage={createMemoryStorage()} router={MemoryRouter as never} /></TenantProvider>);

async function signIn(name: string, pin: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  const pad = await screen.findByRole("group", { name: /keypad/i });
  for (const d of pin) fireEvent.click(within(pad).getByRole("button", { name: d }));
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(cleanup);

describe("sign-in and permission-driven navigation", () => {
  it("cashier gets task tiles and no menu", async () => {
    mount();
    await signIn("Amaka Obi", "1111");
    expect(await screen.findByRole("heading", { name: /Hello, Amaka/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /main/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Till \(scan and pay\)/)).toBeInTheDocument();
  });

  it("branch manager gets a menu with approvals and sees the approval card with amount and limit", async () => {
    mount();
    await signIn("Tunde Bello", "2222");
    await screen.findByRole("heading", { name: /Hello, Tunde/ });
    expect((await screen.findAllByRole("navigation", { name: /main/i })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Approvals" }).length).toBeGreaterThan(0);
    expect(await screen.findByText("Approve discount")).toBeInTheDocument();
    expect(screen.getByText("3%")).toBeInTheDocument();
  });

  it("a wrong PIN shows a readable error and keeps the chosen person", async () => {
    mount();
    await signIn("Amaka Obi", "9999");
    expect(await screen.findByText(/PIN is not right/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /keypad/i })).toBeInTheDocument();
  });

  it("a guessed URL for a screen the role cannot see is refused", async () => {
    sessionStorage.setItem("erp.token", "tok-u-cashier");
    render(<TenantProvider tenant={tenant}><App api={fakeApi} storage={createMemoryStorage()} router={(({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={["/s/Q02"]}>{children}</MemoryRouter>) as never} /></TenantProvider>);
    expect(await screen.findByText(/cannot open this screen/)).toBeInTheDocument();
  });

  it("shows the offline bar once signed in", async () => {
    mount();
    await signIn("Amaka Obi", "1111");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Online/));
  });
});
