// Fails CI when source code bypasses the design system.
// Allowed places for raw colours/sizes: packages/tokens (theme files), generated css, and docs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SCAN = ["apps/web/src", "apps/web/index.html", "apps/web/tailwind.config.ts"];
const EXT = /\.(tsx?|css|html)$/;
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";

const rules = [
  { name: "hex colour", re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb/hsl colour", re: /\b(?:rgb|rgba|hsl|hsla)\(/ },
  { name: "Tailwind palette colour", re: new RegExp(`\\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow)-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?\\b`) },
  { name: "arbitrary colour value", re: /\b(?:bg|text|border|ring)-\[(?:#|rgb|hsl|var\(--color)/ },
  { name: "text smaller than 16px", re: /\btext-\[\d+px\]/ },
  { name: "inline style colour", re: /style=\{\{[^}]*(?:color|background)/ },
];
// The only hex allowed is the manifest/meta theme-color placeholder in index.html (bootstrap value before CSS loads).
const allow = (file, line) => file.endsWith("index.html") && /theme-color/.test(line);

const files = [];
const walk = (p) => {
  const abs = join(root, p);
  if (statSync(abs).isDirectory()) readdirSync(abs).forEach((f) => walk(join(p, f)));
  else if (EXT.test(abs)) files.push(p);
};
SCAN.forEach(walk);

const problems = [];
for (const f of files) {
  readFileSync(join(root, f), "utf8").split("\n").forEach((line, i) => {
    if (allow(f, line)) return;
    for (const r of rules) if (r.re.test(line)) problems.push(`${relative(root, join(root, f))}:${i + 1}  ${r.name}: ${line.trim().slice(0, 100)}`);
  });
}
if (problems.length) {
  console.error(`Design-system violations (${problems.length}). Use tokens from packages/tokens:\n` + problems.join("\n"));
  process.exit(1);
}
console.log(`check-tokens: ${files.length} files clean`);
