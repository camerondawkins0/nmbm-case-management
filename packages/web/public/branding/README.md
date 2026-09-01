# Branding assets

The NMBM logo (two versions — black-on-white and a gold-foil variant, both
a mountain mark in a circle with "NMBM" and "Make Your Next Move Your Best
Move") was shared as images in chat, not as files this environment can
read from disk. `tailwind.config.js` and `theme.css` carry an approximated
palette (`#0a0a0a` ink, `#b8860b`/`#f5d576` gold, white) and
`src/components/brand-mark.tsx` is a stand-in SVG at the right
proportions.

To finish branding:

1. Drop the real logo files here as `logo-black.png`, `logo-gold.png`,
   and a square `favicon.png` derived from either.
2. Sample their exact hex values and update the `nmbm` colors in
   `../../tailwind.config.js` and the custom properties in
   `../../src/theme.css`.
3. Replace `<BrandMark />` usages with an `<img>` tag pointing at the
   real file, or trace the actual mark into the SVG.
