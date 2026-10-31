import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTenant } from "./tenant";

type Mode = "light" | "dark";
interface ThemeState { theme: string; mode: Mode; themes: string[]; setTheme(t: string): void; toggleMode(): void }
const Ctx = createContext<ThemeState | null>(null);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage can be blocked */ } };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const [theme, setThemeState] = useState(() => {
    const saved = read("erp.theme");
    return saved && tenant.theme.available.includes(saved) ? saved : tenant.theme.default;
  });
  const [mode, setMode] = useState<Mode>(() => (read("erp.mode") as Mode | null) ?? tenant.theme.defaultMode);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", mode === "dark");
  }, [theme, mode]);

  const setTheme = useCallback((t: string) => { setThemeState(t); write("erp.theme", t); }, []);
  const toggleMode = useCallback(() => setMode((m) => { const n = m === "light" ? "dark" : "light"; write("erp.mode", n); return n; }), []);
  const value = useMemo(() => ({ theme, mode, themes: tenant.theme.available, setTheme, toggleMode }), [theme, mode, tenant, setTheme, toggleMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("ThemeProvider missing");
  return v;
}
