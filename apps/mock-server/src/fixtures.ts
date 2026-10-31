import type { Task } from "@erp/api-contract";

export interface MockUser { id: string; name: string; role: string; pin: string; branch: string; warehouse?: string }

/** Demo people for the six pilot roles. PINs are fixtures, not secrets. */
export const USERS: MockUser[] = [
  { id: "u-cashier", name: "Amaka Obi", role: "Cashier", pin: "1111", branch: "Pilot Branch" },
  { id: "u-manager", name: "Tunde Bello", role: "Branch manager", pin: "2222", branch: "Pilot Branch" },
  { id: "u-warehouse", name: "Ngozi Eze", role: "Warehouse officer", pin: "3333", branch: "Pilot Branch", warehouse: "Main Warehouse" },
  { id: "u-stock", name: "Ibrahim Musa", role: "Stock controller", pin: "4444", branch: "Pilot Branch", warehouse: "Main Warehouse" },
  { id: "u-rider", name: "Chidi Okafor", role: "Rider / courier", pin: "5555", branch: "Pilot Branch" },
  { id: "u-coordinator", name: "Sade Adeyemi", role: "Delivery coordinator", pin: "6666", branch: "Pilot Branch" },
  // Extra people so approval chains can be tried (the pilot roles above are the six in the plan).
  { id: "u-md", name: "Kunle Adebayo", role: "MD / Executive", pin: "7777", branch: "Pilot Branch" },
  { id: "u-auditor", name: "Hauwa Bello", role: "Auditor", pin: "8888", branch: "Pilot Branch" },
  { id: "u-cashctl", name: "Ifeoma Nwosu", role: "Cash controller", pin: "9999", branch: "Pilot Branch" },
  { id: "u-rider2", name: "Femi Adewale", role: "Rider / courier", pin: "1212", branch: "Pilot Branch" },
  // A sister branch, so a stock request can be made of another branch, not only the warehouse.
  { id: "u-warehouse2", name: "Bayo Fashola", role: "Warehouse officer", pin: "3334", branch: "Victoria Island Branch" },
];

export const TASKS: Record<string, Task[]> = {
  Cashier: [
    { id: "t1", screenId: "S03", title: "Open your shift", detail: "Count the opening float", status: "pending" },
    { id: "t2", screenId: "S02", title: "2 parked sales waiting", status: "pending" },
    { id: "t3", screenId: "S05", title: "Discount request sent to manager", detail: "Waiting for approval", status: "blocked", amount: 4200, limit: 0, limitUnit: "percent" },
  ],
  "Branch manager": [
    { id: "t4", screenId: "A01", title: "Approve discount", detail: "Over the cashier limit", status: "pending", amount: 4200, limit: 3, limitUnit: "percent", requestedBy: "Amaka Obi" },
    { id: "t5", screenId: "A01", title: "Approve refund", detail: "Per-item limit ₦50,000", status: "pending", amount: 18500, limit: 50000, limitUnit: "naira", requestedBy: "Amaka Obi" },
    { id: "t6", screenId: "Q02", title: "Sign off yesterday's cash-up", detail: "Variance to review", status: "overdue", amount: 1500 },
    { id: "t7", screenId: "G02", title: "1 transfer in transit over 24 hours", status: "overdue" },
  ],
  "Warehouse officer": [
    { id: "t8", screenId: "H03", title: "Pick and pack transfer TR-0412", detail: "To Pilot Branch", status: "pending" },
    { id: "t9", screenId: "H01", title: "Receive purchase delivery", detail: "Scan 24 lines", status: "pending" },
  ],
  "Stock controller": [
    { id: "t10", screenId: "K01", title: "Blind count: Aisle 3, bin 12", status: "pending" },
    { id: "t11", screenId: "K02", title: "2 count variances to review", status: "pending" },
  ],
  "Rider / courier": [
    { id: "t12", screenId: "L02", title: "Trip 1: 4 deliveries", detail: "Start when you are loaded", status: "pending" },
    { id: "t13", screenId: "L04", title: "Remit cash on delivery", detail: "Hand to the branch manager", status: "pending", amount: 36000 },
  ],
  "Delivery coordinator": [
    { id: "t14", screenId: "L01", title: "5 orders to assign to a rider", status: "pending" },
    { id: "t15", screenId: "L05", title: "Cash on delivery outstanding", status: "overdue", amount: 36000 },
  ],
};

import type { Approval, Customer, DeliveryOrder, Product, PurchaseOrder } from "@erp/api-contract";

/**
 * Work waiting in the approvals inbox. AP-0004 was raised by the branch manager,
 * so only the MD may decide it: the creator never approves their own request.
 */
export const APPROVALS: Approval[] = [
  {
    id: "AP-0001", kind: "discount", status: "pending", amount: 2, limit: 3, unit: "percent",
    requestedBy: { id: "u-cashier", name: "Amaka Obi" }, requestedAt: "2026-10-31T09:15:00.000Z",
    requestNote: "Box was already open on the shelf.",
  },
  {
    id: "AP-0002", kind: "void", status: "pending", amount: 18500, limit: 50000, unit: "naira",
    requestedBy: { id: "u-cashier", name: "Amaka Obi" }, requestedAt: "2026-10-31T09:40:00.000Z",
    requestNote: "Customer changed their mind before paying.",
  },
  {
    id: "AP-0003", kind: "credit_over_limit", status: "pending", amount: 13000, limit: 100000, unit: "naira",
    requestedBy: { id: "u-cashier", name: "Amaka Obi" }, requestedAt: "2026-10-31T10:05:00.000Z",
    customerId: "c2", customerName: "Bola Ventures", requestNote: "Regular customer; promises to pay on Friday.",
  },
  {
    id: "AP-0004", kind: "discount", status: "pending", amount: 5, limit: 3, unit: "percent",
    requestedBy: { id: "u-manager", name: "Tunde Bello" }, requestedAt: "2026-10-31T10:20:00.000Z",
    requestNote: "Staff purchase. The MD must approve this one.",
  },
];

/** Prices are whole naira, VAT-inclusive. Barcodes are fixtures for the demo scanner. */
export const PRODUCTS: Product[] = [
  { id: "p1", sku: "CHG-20W", barcode: "6001000000011", name: "Phone charger 20W", price: 6500, stock: 40, category: "Accessories", family: "Phone charger", variant: "20W" },
  { id: "p2", sku: "CBL-USBC", barcode: "6001000000028", name: "USB-C cable 1m", price: 2500, stock: 120, category: "Accessories" },
  { id: "p3", sku: "EAR-BT", barcode: "6001000000035", name: "Bluetooth earbuds", price: 18500, stock: 25, category: "Audio" },
  { id: "p4", sku: "PWR-10K", barcode: "6001000000042", name: "Power bank 10,000mAh", price: 14000, stock: 18, category: "Accessories" },
  { id: "p5", sku: "SCR-GLS", barcode: "6001000000059", name: "Screen protector", price: 1500, stock: 200, category: "Accessories" },
  { id: "p6", sku: "CSE-CLR", barcode: "6001000000066", name: "Clear phone case", price: 3000, stock: 75, category: "Accessories", family: "Phone case", variant: "Clear" },
  { id: "p7", sku: "SPK-MINI", barcode: "6001000000073", name: "Mini speaker", price: 22000, stock: 12, category: "Audio" },
  { id: "p8", sku: "MEM-64", barcode: "6001000000080", name: "Memory card 64GB", price: 7500, stock: 60, category: "Storage" },
  { id: "p9", sku: "USB-32", barcode: "6001000000097", name: "USB flash drive 32GB", price: 4500, stock: 80, category: "Storage" },
  { id: "p10", sku: "MOU-WL", barcode: "6001000000103", name: "Wireless mouse", price: 8500, stock: 30, category: "Computing" },
  { id: "p11", sku: "KBD-USB", barcode: "6001000000110", name: "USB keyboard", price: 11000, stock: 22, category: "Computing" },
  { id: "p13", sku: "CSE-BLK", barcode: "6001000000134", name: "Black phone case", price: 3500, stock: 60, category: "Accessories", family: "Phone case", variant: "Black" },
  { id: "p14", sku: "CHG-30W", barcode: "6001000000141", name: "Phone charger 30W", price: 8500, stock: 30, category: "Accessories", family: "Phone charger", variant: "30W" },
  { id: "p12", sku: "ADP-HDMI", barcode: "6001000000127", name: "HDMI adapter", price: 5500, stock: 35, category: "Computing" },
];

export const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Ade Stores", phone: "0803 000 0001", creditLimit: 200000, balance: 50000 },
  { id: "c2", name: "Bola Ventures", phone: "0803 000 0002", creditLimit: 100000, balance: 95000 },
  { id: "c3", name: "Chioma Okeke", phone: "0803 000 0003" }, // no credit terms: cash customer only
];

/**
 * Cost prices, kept on the server only. The screens never receive them: cost prices are hidden from most roles.
 * A shortage is valued at cost and that value is shown only to the people who rule on it.
 */
export const COST_PRICE: Record<string, number> = Object.fromEntries(PRODUCTS.map((p) => [p.id, Math.round(p.price * 0.7)]));

/** Stock held by sister branches, who may dispatch a stock request the same way the warehouse does. */
export const BRANCH_STOCK: Record<string, Record<string, number>> = {
  "Victoria Island Branch": { p1: 10, p3: 15, p7: 8 },
};

/**
 * Purchase orders waiting to be received at the warehouse (H01). In ERPNext these are Purchase Orders; raising one is a
 * later screen (R01), so they arrive here already open.
 */
export const PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: "PO-0001", supplierName: "Lagos Electronics Distributors", reference: "INV-88213", status: "open",
    lines: [
      { productId: "p1", name: "Phone charger 20W", qtyOrdered: 50, qtyReceived: 0 },
      { productId: "p2", name: "USB-C cable 1m", qtyOrdered: 100, qtyReceived: 0 },
    ],
    createdAt: "2026-10-30T09:00:00.000Z",
  },
  {
    id: "PO-0002", supplierName: "Lekki Gadget Hub", reference: "INV-44120", status: "partially_received",
    lines: [{ productId: "p3", name: "Bluetooth earbuds", qtyOrdered: 20, qtyReceived: 12 }],
    createdAt: "2026-10-29T09:00:00.000Z",
  },
];

/** Online orders waiting to be delivered (in ERPNext these come from Sales Orders and Delivery Notes). */
export const DELIVERY_ORDERS: DeliveryOrder[] = [
  { id: "DO-0001", customerName: "Ngozi Chukwu", phone: "0803 111 0001", address: "12 Admiralty Way, Lekki, Lagos", items: [{ productId: "p3", name: "Bluetooth earbuds", qty: 1 }], payment: "cash_on_delivery", amountDue: 18500, status: "pending", remitted: false, createdAt: "2026-11-02T07:30:00.000Z" },
  { id: "DO-0002", customerName: "Tosin Balogun", phone: "0803 111 0002", address: "5 Allen Avenue, Ikeja, Lagos", items: [{ productId: "p1", name: "Phone charger 20W", qty: 2 }, { productId: "p2", name: "USB-C cable 1m", qty: 2 }], payment: "prepaid", amountDue: 0, status: "pending", remitted: false, createdAt: "2026-11-02T07:45:00.000Z" },
  { id: "DO-0003", customerName: "Emeka Obi", phone: "0803 111 0003", address: "20 Ogunlana Drive, Surulere, Lagos", items: [{ productId: "p7", name: "Mini speaker", qty: 1 }], payment: "cash_on_delivery", amountDue: 22000, status: "pending", remitted: false, createdAt: "2026-11-02T08:00:00.000Z" },
  { id: "DO-0004", customerName: "Aisha Bello", phone: "0803 111 0004", address: "8 Herbert Macaulay Way, Yaba, Lagos", items: [{ productId: "p10", name: "Wireless mouse", qty: 1 }], payment: "prepaid", amountDue: 0, status: "pending", remitted: false, createdAt: "2026-11-02T08:10:00.000Z" },
];
