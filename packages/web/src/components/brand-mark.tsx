// Stand-in mark until the real NMBM logo files (shared as chat images,
// not uploadable assets — see public/branding/README.md) are dropped
// into public/branding/. Reproduces the logo's construction — double
// ring, white mountain range in a filled badge — at the right
// proportions, so layouts can be built against it now. It is not a
// trace of the real art: the brush wordmark isn't reproducible here and
// is set as text alongside this instead.
export function BrandMark({
  size = 56,
  variant = "ink",
}: {
  size?: number;
  // Both logo versions exist: black for standard use, gold for
  // emphasis. See docs/BRANDING.md — default the UI to ink.
  variant?: "ink" | "gold";
}) {
  const stroke = variant === "gold" ? "var(--nmbm-gold)" : "var(--nmbm-ink)";
  const clipId = `nmbm-badge-${variant}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="NMBM">
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="30" />
        </clipPath>
      </defs>

      {/* Double ring — the outer contour of the real badge. */}
      <circle cx="50" cy="50" r="48" fill="none" stroke={stroke} strokeWidth="1.75" />
      <circle cx="50" cy="50" r="44" fill="none" stroke={stroke} strokeWidth="0.9" />

      <circle cx="50" cy="50" r="30" fill={stroke} />

      {/* Peaks read as negative space against the filled badge, the way
          the real mark does. Clipped so the range runs edge to edge. */}
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M14 82 L33 47 L43 61 L57 34 L70 55 L86 82 Z"
          fill="var(--nmbm-paper)"
        />
        {/* Thin cuts that separate the faces, so the silhouette doesn't
            flatten into one triangle at small sizes. */}
        <path d="M57 34 L52 63 L61 52 Z" fill={stroke} opacity="0.9" />
        <path d="M33 47 L30 66 L37 58 Z" fill={stroke} opacity="0.9" />
      </g>
    </svg>
  );
}
