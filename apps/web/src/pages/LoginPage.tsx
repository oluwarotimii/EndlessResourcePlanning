import { Delete } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { RegisteredUser, UsersResponse } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { useSession } from "../state/session";
import { useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function LoginPage() {
  const { api, status, signIn, idleLocked } = useSession();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<RegisteredUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(() => {
    setLoadError(false);
    api.users().then(setUsers).catch(() => setLoadError(true));
  }, [api]);
  useEffect(loadUsers, [loadUsers]);

  const submit = useCallback(async (user: RegisteredUser, value: string) => {
    setBusy(true); setError(null);
    try {
      await signIn({ userId: user.id, pin: value });
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiFailure && e.code !== "unavailable" ? e.message : t("error.unavailable"));
      setPin(""); // keep the selected person, clear only the wrong PIN
    } finally { setBusy(false); }
  }, [signIn, navigate]);

  const press = useCallback((digit: string) => {
    if (!picked || busy) return;
    setError(null);
    setPin((p) => {
      if (p.length >= 4) return p;
      const next = p + digit;
      if (next.length === 4) void submit(picked, next);
      return next;
    });
  }, [picked, busy, submit]);

  // Hardware keyboards and number pads work too.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked, press]);

  if (status === "signedIn") return <Navigate to="/" replace />;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">{tenant.brand.name}<span className="font-normal text-text-muted">{tenant.brand.suffix}</span></h1>
        <p className="mt-1 text-text-muted">{t("login.device", { branch: users?.deviceBranch ?? tenant.branch.name })}</p>
      </div>
      {idleLocked && <p role="status" className="mb-4 rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("shell.idle")}</p>}

      {!picked ? (
        <Card className="p-5">
          <h2 className="mb-4 text-xl font-bold">{t("login.title")}</h2>
          {loadError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
              <span className="font-medium">{t("login.loadFailed")}</span>
              <Button variant="subtle" onClick={loadUsers}>{t("login.retry")}</Button>
            </div>
          )}
          {!users && !loadError && <p role="status">{t("app.loading")}</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {users?.users.map((u) => (
              <li key={u.id}>
                <button onClick={() => { setPicked(u); setPin(""); setError(null); }} className="btn-spring glass-card glass-card-lift flex min-h-till w-full items-center gap-4 rounded-xl p-3 text-left">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-subtle font-bold text-primary-ink" aria-hidden="true">{initials(u.name)}</span>
                  <span className="leading-tight"><span className="block font-semibold">{u.name}</span><span className="text-text-muted">{u.role}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="p-5">
          <h2 className="text-xl font-bold">{t("login.pin")}</h2>
          <p className="text-text-muted">{t("login.pinHint", { name: picked.name, role: picked.role })}</p>
          <div className="my-6 flex justify-center gap-3" role="img" aria-label={t("login.digits", { n: pin.length })}>
            {[0, 1, 2, 3].map((i) => <span key={i} className={`h-4 w-4 rounded-full border-2 border-primary ${i < pin.length ? "bg-primary" : "bg-transparent"}`} />)}
          </div>
          <p role="alert" className={`mb-3 min-h-[1.75rem] text-center font-medium text-danger-ink`}>{busy ? t("login.signingIn") : error}</p>
          <div role="group" aria-label={t("login.keypad")} className="mx-auto grid max-w-xs grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} till variant="subtle" className="text-2xl tabular" onClick={() => press(d)} disabled={busy}>{d}</Button>
            ))}
            <span />
            <Button till variant="subtle" className="text-2xl tabular" onClick={() => press("0")} disabled={busy}>0</Button>
            <Button till variant="ghost" aria-label={t("login.delete")} onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy}><Delete className="h-6 w-6" aria-hidden="true" /></Button>
          </div>
          <div className="mt-6 text-center"><Button variant="ghost" onClick={() => { setPicked(null); setPin(""); setError(null); }}>{t("login.back")}</Button></div>
        </Card>
      )}
    </div>
  );
}
