# How this build follows the AURA design system

Source: `docs/source/Design-System-Demonstrator.html`. Implemented as `packages/tokens` (JSON theme -> CSS variables) and `apps/web/tailwind.config.ts`.

| Demonstrator rule | Where it is enforced |
| --- | --- |
| No hard-coded colours; semantic tokens only | `scripts/check-tokens.mjs` (CI) fails on hex, rgb/hsl, Tailwind palette classes and inline colour styles |
| Two accents (primary, secondary) with derived hover / subtle / text | Derived at build time in `packages/tokens/src/build.mjs` (hover = 15% darker, subtle = 10-12% alpha, text = best of white/black) |
| Light, dark and brand themes via variables | `data-theme` + `.dark` class; `aura` and a neutral `wireframe` theme ship; swap proves the pipeline |
| Layered translucent surfaces, frosted glass | `.glass-panel`, `.glass-card`, `--color-surface*`, `--glass-blur` |
| Spring press on buttons (`scale .96`, 150ms) | `.btn-spring` on every `<Button>`; `--press-scale`, `--duration-fast`, `--ease-snap` |
| Spatial transitions (300ms, apple ease) | `--duration-spatial`, `--ease-spatial` |
| Tabular numerals for money and counts | `.tabular`, `<Money>` |
| Blur behind overlays | `.scrim` (`--scrim-blur`) |

## Deliberate deviations (the requirements win where they conflict)

1. **No hard-coded status colours.** The demonstrator uses raw emerald/amber/rose/blue. We add `success`, `warning`, `danger`, `info` tokens (solid, `-ink`, `-subtle`) per theme.
2. **16px minimum text, 48px / 56px touch targets** (requirements), not the demonstrator's 10-12px text and small buttons. Tailwind's text scale is overridden so `text-xs` is 16px.
3. **Readable accent text.** The demonstrator's secondary text colour is black, unreadable in dark mode. We add `primary-ink` / `secondary-ink` per mode, contrast-tested at 4.5:1 (`packages/tokens/src/tokens.test.ts`).
4. **Status is icon + word + colour**, never colour alone.
5. **No CDN.** Tailwind is compiled and icons (Lucide) are bundled and pinned, so screens stay small and work offline.
6. **Brand text comes from `tenant.json`**, not "AURA ERP".
7. The Inter font is not downloaded; the stack falls back to system fonts so the app works offline. Self-host Inter in Sprint 2 if wanted.
