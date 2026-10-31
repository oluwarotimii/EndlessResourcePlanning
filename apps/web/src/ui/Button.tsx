import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "subtle" | "ghost" | "secondary";
const styles: Record<Variant, string> = {
  primary: "bg-primary text-primary-text hover:bg-primary-hover shadow-card",
  secondary: "bg-secondary text-secondary-text hover:bg-secondary-hover shadow-card",
  subtle: "bg-fill text-text hover:bg-fill-hover border border-border",
  ghost: "text-primary-ink hover:bg-primary-subtle",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; till?: boolean; /** Square icon-only button (needs an aria-label). */ icon?: boolean }

/** 48px touch target (56px at the till), spring press, tokens only. */
export function Button({ variant = "primary", till = false, icon = false, className = "", type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      className={`btn-spring inline-flex items-center justify-center gap-2 rounded-xl font-semibold disabled:opacity-50 disabled:pointer-events-none ${icon ? (till ? "min-w-till px-0" : "min-w-touch px-0") : "px-5"} ${till ? "min-h-till" : "min-h-touch"} ${styles[variant]} ${className}`}
      {...rest}
    />
  );
}
