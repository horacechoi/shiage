/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [],
  theme: {
    extend: {
      // Mirrors the v4 fixture's custom token, so the same tests prove version-agnostic mapping.
      colors: {
        brand: '#ff5500',
      },
    },
  },
}
