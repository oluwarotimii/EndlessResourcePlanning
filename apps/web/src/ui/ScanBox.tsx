import { ScanBarcode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

/**
 * A keyboard-wedge scanner types the code and presses Enter, so one input serves scanners and typing.
 * It keeps focus so the next scan lands here.
 */
export function ScanBox({ onCode, autoFocusKey }: { onCode: (code: string) => void; autoFocusKey?: unknown }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [autoFocusKey]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const code = value.trim(); if (code) { onCode(code); setValue(""); } input.current?.focus(); }} className="relative">
      <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-text-muted" aria-hidden="true" />
      <label htmlFor="scan-box" className="sr-only">{t("scan.label")}</label>
      <input id="scan-box" ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("scan.placeholder")} autoComplete="off"
        className="min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-14 pr-4 text-lg font-medium focus:outline-none focus:ring-2 focus:ring-primary" />
    </form>
  );
}
