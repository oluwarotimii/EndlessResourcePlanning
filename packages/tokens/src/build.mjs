// Compiles a theme JSON (primitive -> semantic -> component) into CSS variables.
// Swapping the design system later means replacing the theme file only.

export const REQUIRED_SEMANTIC = [
  "primary", "primary-ink", "secondary", "secondary-ink", "surface", "surface-raised", "surface-overlay",
  "border", "border-strong", "text", "text-muted", "fill", "fill-hover", "bg-start", "bg-end", "scrim",
  "success", "success-ink", "warning", "warning-ink", "danger", "danger-ink", "info", "info-ink",
  "shadow-card", "shadow-lift",
];
export const REQUIRED_COMPONENT = [
  "font-sans", "radius-sm", "radius-md", "radius-lg", "radius-xl", "radius-full", "touch-min", "touch-till",
  "glass-blur", "scrim-blur", "duration-fast", "duration-spatial", "ease-snap", "ease-spatial", "press-scale", "lift-distance",
];
const STATUS = ["success", "warning", "danger", "info"];

export function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
export const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);

/** Same idea as the demonstrator: hover = 15% darker. */
export const darken = (hex, factor = 0.85) => {
  const c = hexToRgb(hex);
  return toHex({ r: c.r * factor, g: c.g * factor, b: c.b * factor });
};
export const alpha = (hex, a) => {
  const c = hexToRgb(hex);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
};
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => { const { r, g, b } = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Readable text on a filled accent: whichever of white/black contrasts more. */
export const onAccent = (hex) => (contrast(hex, "#FFFFFF") >= contrast(hex, "#000000") ? "#FFFFFF" : "#000000");

function resolve(value, primitive, where) {
  return value.replace(/\{([\w-]+)\}/g, (_, k) => {
    if (!(k in primitive)) throw new Error(`${where}: unknown primitive {${k}}`);
    return primitive[k];
  });
}

/** Returns { light: {name: value}, dark: {...}, component: {...} } with derived tokens filled in. */
export function resolveTheme(theme) {
  const out = { name: theme.name, component: {}, modes: {} };
  for (const k of REQUIRED_COMPONENT) {
    if (!(k in theme.component)) throw new Error(`${theme.name}: missing component token "${k}"`);
    out.component[k] = theme.component[k];
  }
  for (const mode of ["light", "dark"]) {
    const src = theme.semantic[mode];
    const t = {};
    for (const k of REQUIRED_SEMANTIC) {
      if (!(k in src)) throw new Error(`${theme.name}/${mode}: missing semantic token "${k}"`);
      t[k] = resolve(src[k], theme.primitive, `${theme.name}/${mode}/${k}`);
    }
    for (const accent of ["primary", "secondary"]) {
      if (!isHex(t[accent])) throw new Error(`${theme.name}/${mode}: ${accent} must be a hex colour`);
      t[`${accent}-hover`] = darken(t[accent]);
      t[`${accent}-subtle`] = alpha(t[accent], accent === "primary" ? 0.1 : 0.12);
      t[`${accent}-text`] = onAccent(t[accent]);
    }
    for (const s of STATUS) {
      if (!isHex(t[s])) throw new Error(`${theme.name}/${mode}: ${s} must be a hex colour`);
      t[`${s}-subtle`] = alpha(t[s], 0.12);
    }
    out.modes[mode] = t;
  }
  return out;
}

const decl = (obj, prefix) =>
  Object.entries(obj).map(([k, v]) => `  --${k.startsWith("shadow-") ? "" : prefix}${k}: ${v};`).join("\n");

export function buildThemeCss(theme) {
  const r = resolveTheme(theme);
  const sel = `:root[data-theme="${r.name}"]`;
  return [
    `/* theme: ${r.name} */`,
    `${sel} {\n  color-scheme: light;\n${decl(r.modes.light, "color-")}\n${decl(r.component, "")}\n}`,
    `${sel}.dark {\n  color-scheme: dark;\n${decl(r.modes.dark, "color-")}\n}`,
  ].join("\n");
}
