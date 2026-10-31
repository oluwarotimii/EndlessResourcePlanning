import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Capabilities, LoginRequest } from "@erp/api-contract";
import { buildNavigation, type Navigation } from "@erp/permissions";
import { ApiFailure, type ApiClient } from "../api/client";
import { useTenant } from "./tenant";

type Status = "restoring" | "signedOut" | "signedIn";
interface Session {
  status: Status;
  token: string | null;
  caps: Capabilities | null;
  nav: Navigation | null;
  api: ApiClient;
  idleLocked: boolean;
  signIn(req: LoginRequest): Promise<void>;
  signOut(reason?: "idle"): void;
}
const Ctx = createContext<Session | null>(null);
const KEY = "erp.token";
const CAPS_KEY = "erp.caps";
const store = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (v: string | null) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
  /** Capabilities are cached for this tab so a reload while offline does not sign the cashier out. */
  getCaps: (): Capabilities | null => { try { return JSON.parse(sessionStorage.getItem(CAPS_KEY) ?? "null") as Capabilities | null; } catch { return null; } },
  setCaps: (c: Capabilities | null) => { try { c ? sessionStorage.setItem(CAPS_KEY, JSON.stringify(c)) : sessionStorage.removeItem(CAPS_KEY); } catch { /* ignore */ } },
};

export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const tenant = useTenant();
  const [status, setStatus] = useState<Status>("restoring");
  const [token, setToken] = useState<string | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [idleLocked, setIdleLocked] = useState(false);

  // Restore a session from this tab only. Shared tills never keep a sign-in across restarts.
  useEffect(() => {
    const saved = store.get();
    if (!saved) { setStatus("signedOut"); return; }
    api.capabilities(saved)
      .then((c) => { store.setCaps(c); setToken(saved); setCaps(c); setStatus("signedIn"); })
      .catch((e) => {
        const cached = store.getCaps();
        if (e instanceof ApiFailure && e.code === "unavailable" && cached) { setToken(saved); setCaps(cached); setStatus("signedIn"); return; }
        store.set(null); store.setCaps(null); setStatus("signedOut");
      });
  }, [api]);

  const signOut = useCallback((reason?: "idle") => {
    if (token) void api.logout(token).catch(() => undefined);
    store.set(null); store.setCaps(null); setToken(null); setCaps(null); setStatus("signedOut"); setIdleLocked(reason === "idle");
  }, [api, token]);

  const signIn = useCallback(async (req: LoginRequest) => {
    const res = await api.login(req);
    store.set(res.token); store.setCaps(res.capabilities); setToken(res.token); setCaps(res.capabilities); setIdleLocked(false); setStatus("signedIn");
  }, [api]);

  // Idle lock: shared tills sign out when nobody touches them.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (status !== "signedIn") return;
    const reset = () => { clearTimeout(timer.current); timer.current = setTimeout(() => signOut("idle"), tenant.security.idleLockMinutes * 60_000); };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(timer.current); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [status, signOut, tenant.security.idleLockMinutes]);

  const nav = useMemo(
    () => (caps ? buildNavigation({ caps, taskRoles: tenant.taskRoles, enabledScopes: tenant.enabledScopes }) : null),
    [caps, tenant],
  );
  const value = useMemo<Session>(() => ({ status, token, caps, nav, api, idleLocked, signIn, signOut }), [status, token, caps, nav, api, idleLocked, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}
