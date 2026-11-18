// Turns the NMBM design system's tokens.json (copied into
// design-system/ from the "NMBM" Design System artifact) into CSS custom
// properties for each theme. Run after re-copying tokens.json:
//   node packages/web/scripts/tokens-to-css.mjs
// The output, src/design/tokens.css, is generated: never edit it by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tokens = JSON.parse(readFileSync(here("../design-system/tokens.json"), "utf8"));
const themes = tokens.color.themes.map((t) => t.id);
const first = themes[0];

const valueFor = (token, theme) => (typeof token.value === "string" ? token.value : token.value[theme] ?? token.value[first]);
// "#rrggbb" -> "r g b", so Tailwind can add an opacity: rgb(var(--x-rgb) / 0.5).
const channels = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(" ");
};

function block(theme) {
  const lines = [];
  for (const t of tokens.color.tokens) {
    const v = valueFor(t, theme);
    lines.push(`  --${t.name}: ${v};`);
    if (/^#[0-9a-f]{3,8}$/i.test(v)) lines.push(`  --${t.name}-rgb: ${channels(v)};`);
  }
  for (const t of tokens.shadow.tokens) lines.push(`  --${t.name}: ${valueFor(t, theme)};`);
  return lines.join("\n");
}

const fixed = [
  ...tokens.spacing.tokens.map((t) => `  --${t.name}: ${t.value};`),
  ...tokens.radius.tokens.map((t) => `  --${t.name}: ${t.value};`),
  ...Object.entries(tokens.type.families).map(([k, v]) => `  --font-${k}: ${v};`),
].join("\n");

const css = `/* GENERATED from design-system/tokens.json by scripts/tokens-to-css.mjs.
   Do not edit; change the design system and regenerate. */

:root,
[data-theme="${first}"] {
${fixed}
${block(first)}
  color-scheme: light;
}
${themes
  .slice(1)
  .map((t) => `\n[data-theme="${t}"] {\n${block(t)}\n  color-scheme: ${t === "dark" ? "dark" : "light"};\n}`)
  .join("\n")}

/* Paper is white whatever the screen theme, so print puts the light colors
   back; otherwise a dark-theme printout is pale text on a white page. */
@media print {
  ${themes.slice(1).map((t) => `[data-theme="${t}"]`).join(",\n  ")} {
${block(first)
  .split("\n")
  .map((l) => "  " + l)
  .join("\n")}
    color-scheme: light;
  }
}
`;
writeFileSync(here("../src/design/tokens.css"), css);
console.log(`tokens.css: ${themes.length} themes, ${tokens.color.tokens.length} colors`);
