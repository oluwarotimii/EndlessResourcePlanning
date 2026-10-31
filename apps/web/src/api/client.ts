import { z } from "zod";
import {
  BranchesResponse, BranchSummary, CodOutstanding, DeliveryOrderResponse, DeliveryOrdersResponse, RemitResponse, RidersResponse, CountResponse, CountSheet, CountsResponse, WriteOffRequestResponse, InTransitReport, PurchaseOrderResponse, PurchaseOrdersResponse, StockLevelsResponse, TransferResponse, TransfersResponse, StockRequestResponse, StockRequestsResponse, ReturnResponse, SaleLookupResponse, CashUpVarianceReport, ApiError, ApprovalResponse, ApprovalsResponse, Capabilities, CustomersResponse, LoginResponse, ProductsResponse, SaleResponse, ShiftResponse, TasksResponse, UsersResponse,
  type AssignInput, type ProofInput, type RemitInput, type CountSubmitInput, type WriteOffRequestInput, type DispatchInput, type GoodsReceiptInput, type ReceiveInput, type CreateStockRequestInput, type ReturnInput, type ApprovalDecisionInput, type CreateApprovalInput, type LoginRequest, type PrintLogInput, type SaleInput, type ShiftCloseInput, type ShiftOpenInput,
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
  summary(token: string): Promise<BranchSummary>;
  deliveryOrders(token: string): Promise<DeliveryOrdersResponse>;
  riders(token: string): Promise<RidersResponse>;
  assignDelivery(token: string, orderId: string, input: AssignInput): Promise<DeliveryOrderResponse>;
  /** Proof of delivery or of a failed delivery. Safe to retry; works offline. */
  proveDelivery(token: string, input: ProofInput): Promise<DeliveryOrderResponse>;
  /** Hand in cash collected on delivery; a manager confirms it. Safe to retry. */
  remitCash(token: string, input: RemitInput): Promise<RemitResponse>;
  codOutstanding(token: string): Promise<CodOutstanding>;
  /** The sheet to count from. It has no system quantities: the count is blind. */
  countSheet(token: string, location: "branch" | "warehouse"): Promise<CountSheet>;
  counts(token: string): Promise<CountsResponse>;
  /** Submit a count (round 1) or the recount of the items that differ (round 2). Safe to retry. */
  submitCount(token: string, input: CountSubmitInput): Promise<CountResponse>;
  /** Put a finished count's differences up for approval. Safe to retry. */
  requestWriteOff(token: string, countId: string, input: WriteOffRequestInput): Promise<WriteOffRequestResponse>;
  transfers(token: string): Promise<TransfersResponse>;
  /** Send what the branch asked for. Safe to retry (idempotency key). */
  dispatchTransfer(token: string, input: DispatchInput): Promise<TransferResponse>;
  /** Count what arrived. Safe to retry (idempotency key). */
  receiveTransfer(token: string, transferId: string, input: ReceiveInput): Promise<TransferResponse>;
  /** Purchase orders waiting to be received from a supplier (H01). */
  purchaseOrders(token: string): Promise<PurchaseOrdersResponse>;
  /** Record what arrived from a supplier against a purchase order. Safe to retry (idempotency key). */
  receiveGoods(token: string, purchaseOrderId: string, input: GoodsReceiptInput): Promise<PurchaseOrderResponse>;
  stockLevels(token: string, q?: string): Promise<StockLevelsResponse>;
  inTransitReport(token: string): Promise<InTransitReport>;
  stockRequests(token: string): Promise<StockRequestsResponse>;
  /** Ask the warehouse, or a sister branch, for stock. Safe to retry (idempotency key). */
  createStockRequest(token: string, input: CreateStockRequestInput): Promise<StockRequestResponse>;
  /** Sister branches that may be asked for stock. */
  branches(token: string): Promise<BranchesResponse>;
  /** Find a sale by invoice number so goods can be returned against it. */
  lookupSale(token: string, invoiceNo: string): Promise<SaleLookupResponse>;
  /** Record a return under an approved refund. Safe to retry (idempotency key). */
  createReturn(token: string, input: ReturnInput): Promise<ReturnResponse>;
  cashUpVariance(token: string): Promise<CashUpVarianceReport>;
  /** Decisions are online-only and idempotent. The server enforces limits and the creator rule. */
  approvals(token: string): Promise<ApprovalsResponse>;
  createApproval(token: string, input: CreateApprovalInput): Promise<ApprovalResponse>;
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
    lookupSale: (token, invoiceNo) => call(`/api/sales/lookup?invoiceNo=${encodeURIComponent(invoiceNo)}`, SaleLookupResponse, { token }),
    createReturn: (token, input) => call("/api/returns", ReturnResponse, { method: "POST", token, body: JSON.stringify(input) }),
    stockRequests: (token) => call("/api/stock-requests", StockRequestsResponse, { token }),
    createStockRequest: (token, input) => call("/api/stock-requests", StockRequestResponse, { method: "POST", token, body: JSON.stringify(input) }),
    branches: (token) => call("/api/branches", BranchesResponse, { token }),
    transfers: (token) => call("/api/transfers", TransfersResponse, { token }),
    dispatchTransfer: (token, input) => call("/api/transfers", TransferResponse, { method: "POST", token, body: JSON.stringify(input) }),
    receiveTransfer: (token, transferId, input) => call(`/api/transfers/${encodeURIComponent(transferId)}/receive`, TransferResponse, { method: "POST", token, body: JSON.stringify(input) }),
    purchaseOrders: (token) => call("/api/purchase-orders", PurchaseOrdersResponse, { token }),
    receiveGoods: (token, purchaseOrderId, input) => call(`/api/purchase-orders/${encodeURIComponent(purchaseOrderId)}/receive`, PurchaseOrderResponse, { method: "POST", token, body: JSON.stringify(input) }),
    stockLevels: (token, q = "") => call(`/api/stock?q=${encodeURIComponent(q)}`, StockLevelsResponse, { token }),
    inTransitReport: (token) => call("/api/reports/in-transit", InTransitReport, { token }),
    countSheet: (token, location) => call(`/api/count-sheet?location=${location}`, CountSheet, { token }),
    counts: (token) => call("/api/counts", CountsResponse, { token }),
    submitCount: (token, input) => call("/api/counts", CountResponse, { method: "POST", token, body: JSON.stringify(input) }),
    requestWriteOff: (token, countId, input) => call(`/api/counts/${encodeURIComponent(countId)}/write-off`, WriteOffRequestResponse, { method: "POST", token, body: JSON.stringify(input) }),
    deliveryOrders: (token) => call("/api/delivery/orders", DeliveryOrdersResponse, { token }),
    riders: (token) => call("/api/delivery/riders", RidersResponse, { token }),
    assignDelivery: (token, orderId, input) => call(`/api/delivery/orders/${encodeURIComponent(orderId)}/assign`, DeliveryOrderResponse, { method: "POST", token, body: JSON.stringify(input) }),
    proveDelivery: (token, input) => call("/api/delivery/proof", DeliveryOrderResponse, { method: "POST", token, body: JSON.stringify(input) }),
    remitCash: (token, input) => call("/api/delivery/remit", RemitResponse, { method: "POST", token, body: JSON.stringify(input) }),
    codOutstanding: (token) => call("/api/delivery/outstanding", CodOutstanding, { token }),
    summary: (token) => call("/api/summary", BranchSummary, { token }),
    cashUpVariance: (token) => call("/api/reports/cashup-variance", CashUpVarianceReport, { token }),
    logPrint: (token, input) => call("/api/print-log", z.object({}).passthrough(), { method: "POST", token, body: JSON.stringify(input) }).then(() => undefined),
    approvals: (token) => call("/api/approvals", ApprovalsResponse, { token }),
    createApproval: (token, input) => call("/api/approvals", ApprovalResponse, { method: "POST", token, body: JSON.stringify(input) }),
    decideApproval: (token, id, input) => call(`/api/approvals/${encodeURIComponent(id)}/decision`, ApprovalResponse, { method: "POST", token, body: JSON.stringify(input) }),
    logout: (token) => call("/api/logout", z.object({}).passthrough(), { method: "POST", token }).then(() => undefined),
  };
}
