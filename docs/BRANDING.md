# Branding and the design system

The app's look comes from the **NMBM Design System**, kept as a Design
System artifact on claude.ai (the `project/` files: `tokens.json`,
`bundle.css`, the type and component guidelines, the logo files). This
repository carries a copy of the parts the app needs. When the design
system changes, re-copy them; nothing here is the source of truth for a
color or a size.

## Where it lives in code

| What | File | Edited by hand? |
|---|---|---|
| Tokens, copied from the design system | `packages/web/design-system/tokens.json` | No: re-copy it |
| The tokens as CSS variables, per theme | `packages/web/src/design/tokens.css` | No: `node packages/web/scripts/tokens-to-css.mjs` regenerates it |
| Typefaces (`@font-face`) | `packages/web/src/design/fonts.css`, files in `public/fonts/` | Rarely |
| Component classes (`.nmbm-btn`, `.nmbm-card`, …) and the app's additions (`.ds-*`) | `packages/web/src/design/components.css` | Only below the "app additions" line; above it is the design system's `bundle.css` verbatim |
| The order Tailwind and the design system load in | `packages/web/src/theme.css` | Rarely: see "Load order" |
| Tailwind's names for the tokens | `packages/web/tailwind.config.js` | When a token is added |
| Theme choice (light, dark, high contrast) | `packages/web/src/lib/theme.ts`, the picker in `components/app-shell.tsx` | |
| The logo | `components/brand-mark.tsx`, files in `public/branding/` | |

## Using it

Reach for a design-system class before a Tailwind utility. Tailwind
stays for layout (`flex`, `grid`, `gap-*`, `mt-*`, `sm:` breakpoints);
anything that carries the look comes from the system.

| Need | Use |
|---|---|
| Page title | `ds-display` |
| Section title | `ds-section-heading` |
| Field label, small heading | `ds-field` (a `<label>` around its control), `nmbm-label` |
| Text box, select, text area | `nmbm-control` (selects and text areas pick up their treatment from the element) |
| The one main action on a view | `nmbm-btn nmbm-btn--primary` (gold). **One per view.** |
| Other actions | `nmbm-btn--dark`, `--secondary`, `--quiet`, `--danger`, plus `--sm` or `--md` |
| A panel | `nmbm-card` (`nmbm-card--dense` for record sections) |
| A list of rows | `ds-list`; a lone row `ds-row`; an inline form inside a card `ds-inset` |
| A message | `nmbm-alert nmbm-alert--alert`, `--warn`, `--ok` or `--info` |
| A status | `<Pill tone=…>` in `components/flags.tsx`, which renders `nmbm-pill` |
| A participant's name | `ds-person` (serif) |
| A number, date or ID set apart | `ds-num` (mono) |

Colors in Tailwind come from the theme, never fixed values:
`text-ds-ink`, `text-ds-secondary`, `text-ds-muted`, `border-ds-border`,
`border-ds-control`, `bg-ds-raised`, `bg-ds-subtle`, `text-ds-accent`,
and `state-alert`, `state-warn`, `state-ok` plus `-bg` for each. They
are defined as `rgb(var(--token-rgb) / <alpha-value>)`, so an opacity
modifier still follows the theme. `nmbm-ink`, `nmbm-paper` and
`nmbm-gold` are kept as aliases of the same variables. A hex value in a
class name will be wrong in dark or high-contrast mode, so the only ones
left are on Google's sign-in button (`.ds-google`), whose colors Google's
branding terms fix.

The design system's own rules that matter most here:

- One gold primary button per view.
- Nothing smaller than 12px.
- Text color comes from a theme token. `ink/50` (#808080) fails contrast
  and is not for text.
- The logo is used as supplied: not redrawn, recolored or set in type
  beside itself. The mark already carries "NMBM" and the line beneath it.

## Themes

`data-theme` on `<html>` picks light, dark or high contrast.
`lib/theme.ts` reads the person's choice from `localStorage` before the
first render, so there is no flash of the wrong theme, and it falls back
to light when storage is unavailable. The choice is per browser, not
per account. Print always uses the light colors, and the logo is forced
to the black version on paper.

## Load order

Tailwind's preflight resets `button` and `input`, so it must load
*before* the component classes, and Tailwind's utilities *after* them
so `mt-4` still wins over a component's margin. That is why `theme.css`
imports `tailwind-base.css`, then `components.css`, then
`tailwind-utilities.css`, instead of putting the three `@tailwind`
lines together.

## Typefaces

Public Sans (interface), Source Serif 4 (people's names, page titles,
their own words) and IBM Plex Mono (IDs, dates, figures) are served from
`public/fonts/`, not a font CDN, so a participant's record page makes no
request to a third party. All three are under the SIL Open Font License.

## The logo

`public/branding/` holds the black-on-white and gold-on-black marks at
96, 256 and 640 pixels, downscaled from the design system's logo files.
`BrandMark` serves the black one in light and high contrast and the gold
one in dark. The 96px black mark is the favicon. The printable
participation record goes to a probation officer or a court, so print it
after any change to the logo.
