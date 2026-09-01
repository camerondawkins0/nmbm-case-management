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
      },
      fontFamily: {
        display: ["'Segoe UI'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
