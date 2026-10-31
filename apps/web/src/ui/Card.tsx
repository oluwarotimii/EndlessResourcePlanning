import type { HTMLAttributes } from "react";

export function Card({ className = "", lift = false, ...rest }: HTMLAttributes<HTMLDivElement> & { lift?: boolean }) {
  return <div className={`glass-card rounded-2xl ${lift ? "glass-card-lift" : ""} ${className}`} {...rest} />;
}
