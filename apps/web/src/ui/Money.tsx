import { useMoney } from "../state/tenant";

/** Every money figure is tabular so columns line up. */
export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  const fmt = useMoney();
  return <span className={`tabular font-bold ${className}`}>{fmt(amount)}</span>;
}
