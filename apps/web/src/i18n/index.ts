import { en, type TextKey } from "./en";

export type { TextKey };
export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
