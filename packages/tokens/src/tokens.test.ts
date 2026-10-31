import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module
import { themes, resolveTheme, contrast, buildThemeCss } from "./index.mjs";

const names = Object.keys(themes) as Array<keyof typeof themes>;

describe("design tokens", () => {
  it("ships at least the AURA theme and a neutral throwaway theme", () => {
    expect(names).toEqual(expect.arrayContaining(["aura", "wireframe"]));
  });

  it.each(names)("%s resolves every required token in light and dark", (name) => {
    const r = resolveTheme(themes[name]);
    for (const mode of ["light", "dark"]) {
      expect(Object.keys(r.modes[mode]).length).toBeGreaterThan(30);
    }
  });

  it.each(names)("%s: text on filled accents and status ink meet WCAG AA (4.5:1)", (name) => {
    const r = resolveTheme(themes[name]);
    for (const mode of ["light", "dark"] as const) {
      const t = r.modes[mode];
      expect(contrast(t.primary, t["primary-text"]), `${name}/${mode} primary on text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.secondary, t["secondary-text"]), `${name}/${mode} secondary on text`).toBeGreaterThanOrEqual(4.5);
      for (const k of ["primary-ink", "secondary-ink", "success-ink", "warning-ink", "danger-ink", "info-ink", "text", "text-muted"]) {
        expect(contrast(t[k], t["surface-raised"]), `${name}/${mode} ${k} on surface-raised`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("rejects a theme with a missing token", () => {
    const broken = structuredClone(themes.aura);
    delete broken.semantic.light["text-muted"];
    expect(() => buildThemeCss(broken)).toThrow(/text-muted/);
  });

  it("emits a selector per theme and a .dark override", () => {
    const css = buildThemeCss(themes.aura);
    expect(css).toContain(':root[data-theme="aura"] {');
    expect(css).toContain(':root[data-theme="aura"].dark {');
  });
});
