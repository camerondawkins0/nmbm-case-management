// The NMBM logo, from the NMBM design system's Logos group, used as
// supplied (resized only): black on white, and gold on black for the
// dark theme. The wordmark is part of the art — never retype it.
// Printed pages always get the black version.
const SIZES = [96, 256, 640];

function srcSet(name: string) {
  return SIZES.map((s) => `/branding/${name}-${s}.png ${s}w`).join(", ");
}

export function BrandMark({ size = 56 }: { size?: number }) {
  const common = { width: size, height: size, sizes: `${size}px`, alt: "NMBM", draggable: false } as const;
  return (
    <span className="ds-logo" style={{ width: size, height: size }}>
      <img {...common} className="ds-logo__light" src={`/branding/nmbm-logo-black-on-white-96.png`} srcSet={srcSet("nmbm-logo-black-on-white")} />
      <img {...common} className="ds-logo__dark" src={`/branding/nmbm-logo-gold-on-black-96.png`} srcSet={srcSet("nmbm-logo-gold-on-black")} alt="" aria-hidden="true" />
    </span>
  );
}
