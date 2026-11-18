/** @type {import('tailwindcss').Config} */
// Every color, face and corner here is a token from the NMBM design system
// (src/design/tokens.css, generated from design-system/tokens.json), so a
// utility class follows the light, dark and high-contrast themes.
const token = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic: what components and pages use.
        ds: {
          surface: token("surface"),
          raised: token("surface-raised"),
          subtle: token("surface-subtle"),
          ink: token("ink"),
          secondary: token("ink-secondary"),
          muted: token("ink-muted"),
          accent: token("accent-text"),
          border: token("border"),
          control: token("border-control"),
        },
        // Brand: the logo's own colors, the same in every theme.
        nmbm: {
          ink: token("ink"),
          paper: token("surface"),
          gold: { DEFAULT: token("gold"), light: token("gold-light"), dark: token("accent-text") },
        },
        // Functional, not brand: case state only, never decoration.
        state: {
          alert: token("state-alert"),
          "alert-bg": token("state-alert-bg"),
          warn: token("state-warn"),
          "warn-bg": token("state-warn-bg"),
          ok: token("state-ok"),
          "ok-bg": token("state-ok-bg"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        display: ["var(--font-serif)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
    },
  },
  plugins: [],
};
