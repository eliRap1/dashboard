import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["'JetBrains Mono'", "ui-monospace", "monospace"] },
      animation: { "tama-pulse": "tamaPulse 1.4s ease-in-out infinite" },
      keyframes: {
        tamaPulse: {
          "0%,100%": { boxShadow: "4px 4px 0 #1f2937" },
          "50%":     { boxShadow: "4px 4px 0 #16a34a" }
        }
      }
    }
  },
  plugins: []
};
export default config;
