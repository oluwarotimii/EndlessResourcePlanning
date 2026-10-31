// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchSummary, Capabilities, CashUpVarianceReport } from "@erp/api-contract";
import { areasForRoles } from "@erp/permissions";
import { createMemoryStorage, type Storage } from "@erp/offline";
import { loadTenant } from "@erp/tenant-config";
import tenantJson from "@erp/tenant-config/tenant.json";
import { App } from "./App";
import { ApiFailure, type ApiClient } from "./api/client";
import { TenantProvider } from "./state/tenant";

const tenant = loadTenant(tenantJson);
const MANAGER: Capabilities = { user: { id: "u-manager", name: "Tunde Bello" }, roles: ["Branch manager"], areas: areasForRoles(["Branch manager"]), scope: { branch: "Pilot Branch" } };
const SUMMARY: BranchSummary = { asOf: "2026-10-31T12:00:00.000Z", salesCount: 7, salesTotal: 123000, cashTotal: 80000, creditTotal: 20000, returnsTotal: 5000, shortagesCharged: 0, shortagesWaiting: 0, openShifts: 1, pendingApprovals: 3, cashUpsAwaiting: 2 };
const REPORT: CashUpVarianceReport = {
  asOf: "2026-10-31T12:00:00.000Z",
  rows: [
    { cashierId: "u-1", cashierName: "Amaka Obi", shifts: 4, totalVariance: -3500, shortShifts: 2, largestShort: 2500 },
    { cashierId: "u-2", cashierName: "Dayo Kuti", shifts: 3, totalVariance: 0, shortShifts: 0, largestShort: 0 },
    { cashierId: "u-3", cashierName: "Efe Ojo", shifts: 2, totalVariance: 500, shortShifts: 0, largestShort: 0 },
  ],
};

const unused = async () => { throw new Error("not used"); };
function fake(over: Partial<ApiClient> = {}): ApiClient {
  return {
    users: async () => ({ deviceBranch: "Pilot Branch", users: [] }), login: unused, capabilities: async () => MANAGER, tasks: async () => ({ tasks: [] }), logout: async () => undefined,
    products: async () => ({ products: [], asOf: "x" }), customers: async () => ({ customers: [] }), createSale: unused, openShift: unused, closeShift: unused, logPrint: async () => undefined,
    approvals: async () => ({ approvals: [] }), createApproval: unused, decideApproval: unused,
    summary: async () => SUMMARY, cashUpVariance: async () => REPORT, lookupSale: unused, createReturn: unused, stockRequests: unused, createStockRequest: unused, branches: unused, transfers: unused, dispatchTransfer: unused, receiveTransfer: unused, purchaseOrders: unused, raisePurchaseOrder: async () => { throw new Error("not used"); }, receiveGoods: unused, stockLevels: unused, countSheet: async () => { throw new Error("not used"); }, counts: async () => { throw new Error("not used"); }, submitCount: async () => { throw new Error("not used"); }, deliveryOrders: async () => { throw new Error("not used"); }, riders: async () => { throw new Error("not used"); }, assignDelivery: async () => { throw new Error("not used"); }, proveDelivery: async () => { throw new Error("not used"); }, remitCash: async () => { throw new Error("not used"); }, codOutstanding: async () => { throw new Error("not used"); }, requestWriteOff: async () => { throw new Error("not used"); }, inTransitReport: unused, ...over,
  };
}

let storage: Storage;
const mount = (api: ApiClient, path: string) => {
  sessionStorage.setItem("erp.token", "tok");
  sessionStorage.setItem("erp.caps", JSON.stringify(MANAGER));
  const Router = (({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>) as never;
  return render(<TenantProvider tenant={tenant}><App api={api} storage={storage} router={Router} /></TenantProvider>);
};
beforeEach(() => { sessionStorage.clear(); storage = createMemoryStorage(); });
afterEach(cleanup);

describe("branch manager home (A02)", () => {
  it("shows what is waiting for the manager and the day's sales", async () => {
    mount(fake(), "/s/A02");
    expect(await screen.findByTestId("pending-approvals")).toHaveTextContent("3");
    expect(screen.getByTestId("cashups-awaiting")).toHaveTextContent("2");
    expect(screen.getByText("7 sales")).toBeInTheDocument();
    expect(screen.getByText(/123,000/)).toBeInTheDocument();
    expect(screen.getByText(/80,000/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /approvals to decide/i })).toHaveAttribute("href", "/s/A01");
    expect(screen.getByRole("link", { name: /closing balances to approve/i })).toHaveAttribute("href", "/s/Q02");
  });

  it("opens with the saved figures when the server cannot be reached, and says so", async () => {
    await storage.kv.set("report:u-manager:summary", { ...SUMMARY, pendingApprovals: 9 });
    mount(fake({ summary: async () => { throw new ApiFailure("unavailable", "unavailable"); } }), "/s/A02");
    expect(await screen.findByTestId("pending-approvals")).toHaveTextContent("9");
    expect(screen.getByText(/Saved figures from/)).toBeInTheDocument();
  });

  it("with nothing saved and no server, it explains and offers a retry", async () => {
    mount(fake({ summary: async () => { throw new ApiFailure("unavailable", "unavailable"); } }), "/s/A02");
    expect(await screen.findByText("Could not load the figures.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a refusal from the server is shown plainly", async () => {
    mount(fake({ summary: async () => { throw new ApiFailure("forbidden", "no", 403); } }), "/s/A02");
    expect(await screen.findByText("Your role cannot see these figures.")).toBeInTheDocument();
  });
});

describe("closing balance differences report (G01)", () => {
  it("flags short cash with an icon and a word, and shows balanced and over rows", async () => {
    mount(fake(), "/s/G01");
    const short = await screen.findByTestId("variance-u-1");
    expect(within(short).getByText("Cash missing")).toBeInTheDocument();
    expect(within(short).getByText(/3,500/)).toBeInTheDocument();
    expect(within(short).getByText(/2,500/)).toBeInTheDocument();
    expect(within(screen.getByTestId("variance-u-2")).getByText("Balanced")).toBeInTheDocument();
    expect(within(screen.getByTestId("variance-u-3")).getByText("Cash over")).toBeInTheDocument();
  });

  it("says so when no shift has been closed", async () => {
    mount(fake({ cashUpVariance: async () => ({ asOf: "2026-10-31T12:00:00.000Z", rows: [] }) }), "/s/G01");
    expect(await screen.findByText("No shifts have been closed yet.")).toBeInTheDocument();
  });
});
