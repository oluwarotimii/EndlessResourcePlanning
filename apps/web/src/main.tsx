import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openStorage } from "@erp/offline";
import tenantJson from "@erp/tenant-config/tenant.json";
import { TenantConfigError, loadTenant } from "@erp/tenant-config";
import "@erp/tokens/tokens.css";
import "./styles.css";
import { App } from "./App";
import { httpApi } from "./api/client";
import { t } from "./i18n";
import { TenantProvider } from "./state/tenant";

const root = createRoot(document.getElementById("root")!);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // Caches the app shell so the till still opens with no network.
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

// Validate the company configuration at start-up, before anything renders.
async function start() {
  try {
    const tenant = loadTenant(tenantJson);
    const storage = await openStorage();
    document.title = `${tenant.brand.name}${tenant.brand.suffix}`;
    root.render(
      <StrictMode>
        <TenantProvider tenant={tenant}><App api={httpApi()} storage={storage} /></TenantProvider>
      </StrictMode>,
    );
  } catch (e) {
    const issues = e instanceof TenantConfigError ? e.issues : [String(e)];
    root.render(
      <main className="mx-auto max-w-xl p-6" role="alert">
        <h1 className="text-2xl font-bold">{t("app.configError.title")}</h1>
        <p className="mt-2 text-text-muted">{t("app.configError.body")}</p>
        <ul className="mt-3 list-disc pl-6">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
      </main>,
    );
  }
}
void start();
