import { z } from "zod";
import {
  ApiError, ApprovalResponse, ApprovalsResponse, Capabilities, CustomersResponse, LoginResponse, ProductsResponse, SaleResponse, ShiftResponse, TasksResponse, UsersResponse,
  type ApprovalDecisionInput, type LoginRequest, type PrintLogInput, type SaleInput, type ShiftCloseInput, type ShiftOpenInput,
} from "@erp/api-contract";

/** Screens only ever talk to this interface. Mock today, ERPNext adapter in Sprint 5. */
export interface ApiClient {
  users(): Promise<UsersResponse>;
  login(req: LoginRequest): Promise<LoginResponse>;
  capabilities(token: string): Promise<Capabilities>;
  tasks(token: string): Promise<TasksResponse>;
  logout(token: string): Promise<void>;
  products(token: string): Promise<ProductsResponse>;
  customers(token: string, q: string): Promise<CustomersResponse>;
  /** Writes are safe to retry: each carries an idempotency key. */
  createSale(token: string, input: SaleInput): Promise<SaleResponse>;
  openShift(token: string, input: ShiftOpenInput): Promise<ShiftResponse>;
  closeShift(token: string, input: ShiftCloseInput): Promise<ShiftResponse>;
  logPrint(token: string, input: PrintLogInput): Promise<void>;
  /** Decisions are online-only and idempotent. The server enforces limits and the creator rule. */
  approvals(token: string): Promise<ApprovalsResponse>;
  decideApproval(token: string, id: string, input: ApprovalDecisionInput): Promise<ApprovalResponse>;
}

export class ApiFailure extends Error {
  constructor(public readonly code: ApiError["code"], message: string, public readonly status = 0) {
    super(message);
  }
}

export function httpApi(base = ""): ApiClient {
  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit & { token?: string } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiFailure("unavailable", "unavailable");
    }
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = ApiError.safeParse(body);
      throw err.success ? new ApiFailure(err.data.code, err.data.message, res.status) : new ApiFailure("unavailable", "unavailable", res.status);
    }
    return schema.parse(body);
  }
  return {
    users: () => call("/api/users", UsersResponse),
    login: (req) => call("/api/login", LoginResponse, { method: "POST", body: JSON.stringify(req) }),
    capabilities: (token) => call("/api/capabilities", Capabilities, { token }),
    tasks: (token) => call("/api/tasks", TasksResponse, { token }),
    products: (token) => call("/api/products", ProductsResponse, { token }),
    customers: (token, q) => call(`/api/customers?q=${encodeURIComponent(q)}`, CustomersResponse, { token }),
    createSale: (token, input) => call("/api/sales", SaleResponse, { method: "POST", token, body: JSON.stringify(input) }),
    openShift: (token, input) => call("/api/shifts/open", ShiftResponse, { method: "POST", token, body: JSON.stringify(input) }),
    closeShift: (token, input) => call("/api/shifts/close", ShiftResponse, { method: "POST", token, body: JSON.stringify(input) }),
    logPrint: (token, input) => call("/api/print-log", z.object({}).passthrough(), { method: "POST", token, body: JSON.stringify(input) }).then(() => undefined),
    approvals: (token) => call("/api/approvals", ApprovalsResponse, { token }),
    decideApproval: (token, id, input) => call(`/api/approvals/${encodeURIComponent(id)}/decision`, ApprovalResponse, { method: "POST", token, body: JSON.stringify(input) }),
    logout: (token) => call("/api/logout", z.object({}).passthrough(), { method: "POST", token }).then(() => undefined),
  };
}
