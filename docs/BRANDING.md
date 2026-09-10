# Branding kit

Status: **approximated, not final.** The real NMBM logo (a mountain mark in
a circle, black-on-white and a gold-foil variant, "NMBM" in a brush
script, "Make Your Next Move Your Best Move" underneath) was shared as
images in chat, not as files this environment could read from disk — so
nothing here was sampled from the source art. Treat every hex value below
as a placeholder to replace once the real files are available; see
"Finishing this kit" at the bottom.

## Where this lives in code

| What | File |
|---|---|
| Tailwind color tokens | `packages/web/tailwind.config.js` (the `nmbm` color group) |
| CSS custom properties (for anything Tailwind's config can't reach, e.g. an inline SVG fill) | `packages/web/src/theme.css` |
| Stand-in mark | `packages/web/src/components/brand-mark.tsx` |
| Asset drop point + instructions | `packages/web/public/branding/README.md` |

## Palette

| Token | Hex (approximate) | Use |
|---|---|---|
| `nmbm-ink` | `#0A0A0A` | Primary text, the black lockup of the mark, borders |
| `nmbm-gold` | `#B8860B` | Accent — links, active states, the motto text |
| `nmbm-gold-light` | `#F5D576` | Gold-on-gold detail (foil highlight), hover states over dark backgrounds |
| `nmbm-gold-dark` | `#8A6508` | Gold text on light backgrounds, where the base gold doesn't meet contrast |
| `nmbm-paper` | `#FFFFFF` | Page background — the mark is drawn for white, not off-white |

The logo itself is single-color (pure black, or a gold gradient) on a
plain white ground — no secondary or tertiary brand colors were visible
in either version shared. Don't invent one; if the UI needs a state color
(error, warning, success) outside this palette, treat that as a separate,
functional palette rather than an extension of the brand one.

## Typography

The mark pairs a **brush-script wordmark** ("NMBM") with a **small-caps,
wide-tracked sans** for the motto ("MAKE YOUR NEXT MOVE YOUR BEST MOVE").
That split is a logo-only treatment — don't use a script face for UI text.
For the product itself, `tailwind.config.js` currently points `font-display`
at system UI fonts (`Segoe UI` / system-ui) as a neutral placeholder. If
NMBM has a house font for documents or their website, match that instead
of leaving system-ui as the permanent choice.

## Mark usage

- **Circular badge, not a wordmark alone.** Both logo versions are the
  full circular lockup (ring + mountain + NMBM + motto) — there's no
  evidence of a simplified icon-only mark for small spaces like a
  favicon. `brand-mark.tsx`'s stand-in reproduces the badge's
  construction (double ring, white mountain range clipped into a filled
  circle) as that reduction, and takes a `variant` prop for the ink and
  gold versions. The brush wordmark isn't reproducible in SVG here and
  is set as text beside the mark instead.
- **Two color versions, one background.** Black-on-white for standard
  use; the gold-foil version reads as an emphasis/premium variant (the
  kind of thing you'd put on a printed certificate, not a nav bar).
  Default the product UI to the black version; reserve gold for accents,
  not for reproducing the mark itself in gold.
- **Minimum clear space.** Not determinable from a chat image — ask NMBM
  if a brand guideline exists, or default to roughly the height of the
  mountain glyph on all sides once the real asset is available.

## Finishing this kit

1. Get the source logo files from NMBM (vector, if they have it — a
   chat-shared PNG is a rasterized export, not a source file).
2. Drop them into `packages/web/public/branding/` as `logo-black.png`,
   `logo-gold.png`, and a square `favicon.png` — see that folder's
   README for the exact expectation.
3. Sample the real hex values from the files and update the palette
   table above, `tailwind.config.js`, and `theme.css` to match.
4. Replace `<BrandMark />` in `login-page.tsx` / `dashboard-page.tsx`
   with the real asset, or trace it into the SVG if it needs to stay
   inline (e.g. to recolor per theme).
5. Ask NMBM whether a font, minimum clear space, or usage guideline
   exists beyond what's visible in the mark itself.
