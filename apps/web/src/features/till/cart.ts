import type { Customer, Product, SaleLine } from "@erp/api-contract";

export interface CartLine { productId: string; name: string; unitPrice: number; qty: number }
export interface Cart {
  lines: CartLine[];
  customer?: Pick<Customer, "id" | "name" | "creditLimit" | "balance">;
  /** Set when charging starts so a crash and retry reuses the same idempotency key. Cleared on any edit. */
  chargeKey?: string;
  /** An approved discount for this sale. Any change to the lines clears it; a new request is needed. */
  discount?: { approvalId: string; percent: number };
  /** An approved credit-over-limit request for this customer. Any edit or customer change clears it. */
  creditApproval?: { approvalId: string; customerId: string; amount: number };
}
export const emptyCart = (): Cart => ({ lines: [] });

const edit = (cart: Cart, lines: CartLine[]): Cart => ({ ...cart, lines, chargeKey: undefined, discount: undefined, creditApproval: undefined });

export function addProduct(cart: Cart, p: Pick<Product, "id" | "name" | "price">, qty = 1): Cart {
  const found = cart.lines.find((l) => l.productId === p.id);
  if (found) return edit(cart, cart.lines.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + qty } : l)));
  return edit(cart, [...cart.lines, { productId: p.id, name: p.name, unitPrice: p.price, qty }]);
}
/** A quantity of zero or less removes the line. */
export function setQty(cart: Cart, productId: string, qty: number): Cart {
  if (qty <= 0) return edit(cart, cart.lines.filter((l) => l.productId !== productId));
  return edit(cart, cart.lines.map((l) => (l.productId === productId ? { ...l, qty } : l)));
}
export const lineTotal = (l: Pick<SaleLine, "unitPrice" | "qty">) => l.unitPrice * l.qty;
/** Sum of the lines. What the customer owes (with VAT) comes from computeTotals in the contract. */
export const cartSubtotal = (cart: Cart) => cart.lines.reduce((n, l) => n + lineTotal(l), 0);
export const itemCount = (cart: Cart) => cart.lines.reduce((n, l) => n + l.qty, 0);
