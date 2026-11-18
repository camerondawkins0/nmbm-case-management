# Branding assets

The NMBM marks from the NMBM Design System, downscaled for the screen:

- `nmbm-logo-black-on-white-{96,256,640}.png`: light and high-contrast
  themes, print, and the favicon (96).
- `nmbm-logo-gold-on-black-{96,256,640}.png`: dark theme.

`src/components/brand-mark.tsx` picks between them with `srcset`. Use
them as supplied; replace them only with new exports from the design
system. See `docs/BRANDING.md`.
