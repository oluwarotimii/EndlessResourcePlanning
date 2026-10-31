/**
 * A likely mix-up: two variants of the same item, one short and one over. The usual cause is that one variant was sold or handed
 * out in place of the other, so the shortage is not theft. This only points people to the sales to check; it decides nothing.
 */
export interface DiffLine { productId: string; name: string; family?: string; difference?: number }

export function findMixups(lines: readonly DiffLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byFamily = new Map<string, DiffLine[]>();
  for (const l of lines) if (l.family && (l.difference ?? 0) !== 0) byFamily.set(l.family, [...(byFamily.get(l.family) ?? []), l]);
  for (const group of byFamily.values()) {
    const short = group.filter((l) => (l.difference ?? 0) < 0);
    const over = group.filter((l) => (l.difference ?? 0) > 0);
    if (short.length === 0 || over.length === 0) continue; // all one way: not a swap
    for (const l of short) out.set(l.productId, over.map((o) => o.name));
    for (const l of over) out.set(l.productId, short.map((o) => o.name));
  }
  return out;
}
