
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { csp: { pine: "#2F6F4F", red: "#dc2626", white: "#f8fafc", gray: "#111213" } },
      borderRadius: { '2xl': '1rem' },
      boxShadow: { glass: "0 8px 30px rgba(0,0,0,0.35)" }
    },
  },
  plugins: [],
};
