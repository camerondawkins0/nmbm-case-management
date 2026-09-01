// Stand-in mark until the real NMBM logo files (shared as chat images,
// not uploadable assets — see public/branding/README.md) are dropped
// into public/branding/. Reproduces the mountain-in-a-circle shape and
// the gold/ink palette so layouts can be built against the right
// proportions now.
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="NMBM"
    >
      <circle cx="50" cy="50" r="48" fill="none" stroke="var(--nmbm-ink)" strokeWidth="2" />
      <circle cx="50" cy="35" r="22" fill="var(--nmbm-ink)" />
      <path
        d="M32 40 L42 26 L50 36 L58 24 L68 40 Z"
        fill="var(--nmbm-paper)"
      />
    </svg>
  );
}
