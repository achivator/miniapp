/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Semantic colors backed by Telegram theme variables (see globals.css).
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        fg: "var(--text)",
        hint: "var(--hint)",
        accent: "var(--accent)",
        button: "var(--button)",
        "accent-fg": "var(--accent-text)",
        link: "var(--link)",
        danger: "var(--danger)",
        success: "var(--success)",
        gold: "var(--gold)",
        separator: "var(--separator)",
      },
      borderRadius: {
        card: "18px",
      },
    },
  },
  plugins: [],
};
