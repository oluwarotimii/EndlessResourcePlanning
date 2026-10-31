import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { Storage } from "@erp/offline";
import type { ApiClient } from "./api/client";
import { PrintProvider } from "./features/print/PrintProvider";
import { DestinationPage } from "./pages/DestinationPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ScreenPage } from "./pages/ScreenPage";
import { Shell } from "./shell/Shell";
import { SessionProvider } from "./state/session";
import { SyncProvider } from "./state/sync";
import { ThemeProvider } from "./state/theme";

export function App({ api, storage, router: Router = BrowserRouter }: { api: ApiClient; storage: Storage; router?: typeof BrowserRouter }) {
  return (
    <ThemeProvider>
      <SessionProvider api={api}>
        <SyncProvider storage={storage}>
          <PrintProvider>
            <Router>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<Shell />}>
                  <Route index element={<HomePage />} />
                  <Route path="d/:key" element={<DestinationPage />} />
                  <Route path="s/:id" element={<ScreenPage />} />
                </Route>
              </Routes>
            </Router>
          </PrintProvider>
        </SyncProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
