import { z } from "zod";

/**
 * One validated tenant.json per company. Brand, modules, labels, currency and limits come from here.
 * Rule: no record names, colours or user-facing text hard-coded outside this file, the tokens and the dictionary.
 */
export const TenantConfig = z.object({
  brand: z.object({ name: z.string().min(1), suffix: z.string().default(""), tagline: z.string().default("") }),
  theme: z.object({
    default: z.string().min(1),
    available: z.array(z.string()).min(1),
    defaultMode: z.enum(["light", "dark"]),
  }),
  locale: z.string().min(2),
  currency: z.string().length(3),
  branch: z.object({ name: z.string().min(1) }),
  /** Roles that get task screens with no menu (cashier, rider, technician). */
  taskRoles: z.array(z.string()),
  /** Which screen scopes are switched on (MVP now; Later as sprints land). */
  enabledScopes: z.array(z.enum(["MVP", "Later"])).min(1),
  print: z.object({
    paper: z.enum(["A5", "A4", "thermal"]),
    copyLabel: z.string(),
    autoPrint: z.boolean(),
    company: z.object({ legalName: z.string(), address: z.string(), phone: z.string() }),
    bank: z.object({ name: z.string(), accountName: z.string(), accountNumber: z.string() }),
  }),
  /**
   * mode "inclusive": prices already contain VAT. "exclusive": VAT is added on top at the till. "none": no VAT.
   * The rate must be confirmed with the accountant.
   */
  tax: z.object({ mode: z.enum(["inclusive", "exclusive", "none"]), vatRate: z.number().min(0).max(1), vatNumber: z.string() }),
  till: z.object({
    paymentMethods: z.array(z.enum(["cash", "transfer", "card", "credit", "other"])).min(1),
    /** Let one sale be paid with more than one method (for example part cash, part credit). */
    allowSplitPayments: z.boolean(),
  }),
  offline: z.object({
    maxOfflineSalesPerTill: z.number().int().positive(),
    syncWindowHours: z.number().int().positive(),
  }),
  security: z.object({ idleLockMinutes: z.number().int().positive() }),
  touch: z.object({ minPx: z.number().int().min(48), tillPx: z.number().int().min(56) }),
}).refine((t) => t.theme.available.includes(t.theme.default), {
  message: "theme.default must be one of theme.available",
  path: ["theme", "default"],
});
export type TenantConfig = z.infer<typeof TenantConfig>;

export class TenantConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid tenant.json:\n- ${issues.join("\n- ")}`);
  }
}

/** Validate at start-up. Throws a readable error instead of failing later in some screen. */
export function loadTenant(raw: unknown): TenantConfig {
  const parsed = TenantConfig.safeParse(raw);
  if (!parsed.success) {
    throw new TenantConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  return parsed.data;
}

export function formatMoney(tenant: Pick<TenantConfig, "locale" | "currency">, amount: number): string {
  return new Intl.NumberFormat(tenant.locale, {
    style: "currency",
    currency: tenant.currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
