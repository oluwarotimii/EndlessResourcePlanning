import type { Product, ProductsResponse } from "@erp/api-contract";
import type { Storage } from "@erp/offline";

const KEY = "catalog";

export async function loadCachedCatalog(s: Storage): Promise<ProductsResponse | undefined> {
  return s.kv.get<ProductsResponse>(KEY);
}
export async function cacheCatalog(s: Storage, c: ProductsResponse): Promise<void> {
  await s.kv.set(KEY, c);
}

/** Exact barcode or SKU first (a scanner types the code and presses Enter), otherwise search by name. */
export function findExact(products: readonly Product[], code: string): Product | undefined {
  const c = code.trim().toLowerCase();
  return c ? products.find((p) => p.barcode === c || p.sku.toLowerCase() === c) : undefined;
}
export function search(products: readonly Product[], term: string): Product[] {
  const q = term.trim().toLowerCase();
  if (!q) return [...products];
  return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q));
}
