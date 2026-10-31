import { t } from "../../i18n";

/** "5 min ago", "3 h ago", "2 days ago" in plain words. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return t("ago.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? t("ago.hours", { n: hours }) : t("ago.days", { n: Math.floor(hours / 24) });
}
