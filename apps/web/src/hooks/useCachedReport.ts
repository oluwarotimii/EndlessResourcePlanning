import { useEffect, useState } from "react";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";

/**
 * Read-only figures from the server. The last good copy is kept on the device, so the screen still opens offline
 * (marked as saved figures). The server computes everything; the screen only displays it.
 */
export function useCachedReport<T extends object>(key: string, fetcher: (token: string) => Promise<T>) {
  const { token, caps } = useSession();
  const { storage, state } = useSync();
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState<"forbidden" | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cacheKey = `report:${caps?.user.id ?? ""}:${key}`;
  const offline = state === "offline";

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const cached = await storage.kv.get<T>(cacheKey);
      if (live && cached) { setData(cached); setStale(true); }
      if (offline) { if (live && !cached) setFailed("error"); return; }
      try {
        const fresh = await fetcher(token);
        await storage.kv.set(cacheKey, fresh);
        if (live) { setData(fresh); setStale(false); setFailed(null); }
      } catch (e) {
        const forbidden = e instanceof Error && "code" in e && (e as { code?: string }).code === "forbidden";
        if (live && forbidden) { setData(null); setFailed("forbidden"); }
        else if (live && !cached) setFailed("error");
      }
    })();
    return () => { live = false; };
  }, [token, storage, cacheKey, offline, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Change the saved copy after something done on this device (for example a transfer dispatched offline). */
  const update = async (fn: (current: T) => T) => {
    if (!data) return;
    const next = fn(data);
    setData(next);
    await storage.kv.set(cacheKey, next);
  };
  return { data, stale, failed, retry: () => setAttempt((n) => n + 1), update };
}
