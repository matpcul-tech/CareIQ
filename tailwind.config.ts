import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./middleware.ts",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // The "ink" family is the foreground text scale. It now reads as
        // off-white / light-gray on dark navy, so existing utility usages
        // (`text-ink`, `text-ink-soft`, `text-ink-mute`) auto-redirect to
        // the sovereign aesthetic without per-component edits.
        ink: {
          DEFAULT: "#eef2f8",
          soft: "#a3b5cc",
          mute: "#7a9bbf",
        },
        // Sovereign Health OS palette. Matches the inline-CSS palette used
        // inside CareIQHealthOS.tsx so the landing page, onboarding,
        // dashboard, and clinical OS all read as one product.
        sov: {
          bg: "#07101f",        // dark navy page background
          card: "#0d1a30",      // dark navy card background
          panel: "#11243d",     // slightly lifted panel
          border: "#1e3a5f",    // subtle navy border
          gold: "#d4a843",      // primary accent
          goldDark: "#b8902f",  // gold on hover / pressed
          teal: "#00d4b8",      // secondary accent
          tealDark: "#00b89e",  // teal on hover
          violet: "#8060cc",
          green: "#4ade80",
          rose: "#e8526e",
          accent: "#d4a843",
          link: "#00d4b8",
        },
      },
      fontFamily: {
        // Playfair Display for headings, Outfit for body, DM Mono for code.
        // Loaded via Google Fonts in layout.tsx; falls back to system fonts
        // if blocked by CSP or offline.
        display: [
          "Playfair Display",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
        sans: [
          "Outfit",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "DM Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.25)",
        cardLg: "0 1px 3px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.35)",
        gold: "0 0 0 1px rgba(212,168,67,0.25), 0 4px 18px rgba(212,168,67,0.15)",
        teal: "0 0 0 1px rgba(0,212,184,0.25), 0 4px 18px rgba(0,212,184,0.15)",
      },
      borderRadius: {
        xl2: "1rem",
      },
      keyframes: {
        sovPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
      animation: {
        "sov-pulse": "sovPulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
