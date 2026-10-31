import { createContext, useContext, type ReactNode } from "react";
import { formatMoney, type TenantConfig } from "@erp/tenant-config";

const Ctx = createContext<TenantConfig | null>(null);
export const TenantProvider = ({ tenant, children }: { tenant: TenantConfig; children: ReactNode }) => (
  <Ctx.Provider value={tenant}>{children}</Ctx.Provider>
);
export function useTenant(): TenantConfig {
  const v = useContext(Ctx);
  if (!v) throw new Error("TenantProvider missing");
  return v;
}
export const useMoney = () => {
  const tenant = useTenant();
  return (n: number) => formatMoney(tenant, n);
};
