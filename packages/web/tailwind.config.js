/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // From the NMBM mark: black-on-white primary lockup, a gold
        // (foil) variant for emphasis. Approximated from the logo
        // images shared in chat — swap for exact hex once the source
        // files are available (see public/branding/README.md).
        nmbm: {
          ink: "#0a0a0a",
          gold: {
            DEFAULT: "#b8860b",
            light: "#f5d576",
            dark: "#8a6508",
          },
          paper: "#ffffff",
        },
        // Functional, not brand. The logo is a two-colour mark and
        // inventing brand colours to signal "overdue" would misrepresent
        // it — docs/BRANDING.md says to keep state colours separate.
        state: {
          alert: "#b91c1c",
          "alert-bg": "#fef2f2",
          warn: "#b45309",
          "warn-bg": "#fffbeb",
          ok: "#15803d",
          "ok-bg": "#f0fdf4",
        },
      },
      fontFamily: {
        display: ["'Segoe UI'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
