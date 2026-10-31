import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSync } from "../../state/sync";
import { useTenant } from "../../state/tenant";
import { SaleDocument } from "./SaleDocument";
import type { PrintDoc } from "./types";

interface PrintApi { print(doc: PrintDoc, opts?: { reprint?: boolean }): void }
const Ctx = createContext<PrintApi | null>(null);
const PAPER = { A5: "A5", A4: "A4", thermal: "80mm auto" } as const;

/**
 * Prints through the browser to the company's normal printer. For no dialog at the till, run the browser in
 * kiosk-printing mode on a machine with a default printer (see docs/PRINTING.md). Reprints are logged.
 */
export function PrintProvider({ children }: { children: ReactNode }) {
  const tenant = useTenant();
  const sync = useSync();
  const [doc, setDoc] = useState<PrintDoc | null>(null);

  const print = useCallback<PrintApi["print"]>((d, opts = {}) => {
    setDoc(d);
    if (opts.reprint) {
      const id = crypto.randomUUID();
      void sync.enqueue({ id, type: "print.log", recordKey: `print:${d.number}`, payload: { idempotencyKey: id, documentType: d.kind, documentNo: d.number, reprint: true, at: new Date().toISOString() } });
    }
  }, [sync]);

  useEffect(() => {
    if (!doc) return;
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark"); // paper is always light
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (wasDark) root.classList.add("dark");
      window.removeEventListener("afterprint", restore);
      setDoc(null);
    };
    window.addEventListener("afterprint", restore);
    const go = setTimeout(() => { if (typeof window.print === "function") window.print(); else restore(); }, 50);
    const failsafe = setTimeout(restore, 60_000);
    return () => { clearTimeout(go); clearTimeout(failsafe); restore(); };
  }, [doc]);

  const value = useMemo(() => ({ print }), [print]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {doc && createPortal(
        <div className="print-area">
          <style>{`@page { size: ${PAPER[tenant.print.paper]}; margin: 8mm; }`}</style>
          <SaleDocument doc={doc} />
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}
export function usePrint(): PrintApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("PrintProvider missing");
  return v;
}
