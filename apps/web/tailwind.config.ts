import type { Config } from "tailwindcss";

// Every colour, radius, size and motion value is a token. Hard-coded values are banned by scripts/check-tokens.mjs.
const v = (name: string) => `var(--${name})`;
const accent = (n: string) => ({
  DEFAULT: v(`color-${n}`), hover: v(`color-${n}-hover`), subtle: v(`color-${n}-subtle`), text: v(`color-${n}-text`), ink: v(`color-${n}-ink`),
});
const status = (n: string) => ({ DEFAULT: v(`color-${n}`), subtle: v(`color-${n}-subtle`), ink: v(`color-${n}-ink`) });

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    // 16px minimum text everywhere (requirements: non-functional / accessibility).
    fontSize: { xs: "1rem", sm: "1rem", base: "1rem", lg: "1.125rem", xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem", "4xl": "2.25rem" },
    extend: {
      fontFamily: { sans: v("font-sans") },
      colors: {
        primary: accent("primary"), secondary: accent("secondary"),
        success: status("success"), warning: status("warning"), danger: status("danger"), info: status("info"),
        surface: { DEFAULT: v("color-surface"), raised: v("color-surface-raised"), overlay: v("color-surface-overlay") },
        border: { DEFAULT: v("color-border"), strong: v("color-border-strong") },
        text: { DEFAULT: v("color-text"), muted: v("color-text-muted") },
        fill: { DEFAULT: v("color-fill"), hover: v("color-fill-hover") },
        scrim: v("color-scrim"),
      },
      borderColor: { DEFAULT: v("color-border") },
      borderRadius: { sm: v("radius-sm"), md: v("radius-md"), lg: v("radius-lg"), xl: v("radius-xl"), "2xl": v("radius-xl"), full: v("radius-full") },
      minHeight: { touch: v("touch-min"), till: v("touch-till") },
      minWidth: { touch: v("touch-min"), till: v("touch-till") },
      height: { touch: v("touch-min"), till: v("touch-till") },
      width: { touch: v("touch-min"), till: v("touch-till") },
      boxShadow: { card: v("shadow-card"), lift: v("shadow-lift") },
      transitionDuration: { fast: v("duration-fast"), spatial: v("duration-spatial") },
      transitionTimingFunction: { snap: v("ease-snap"), spatial: v("ease-spatial") },
    },
  },
} satisfies Config;
