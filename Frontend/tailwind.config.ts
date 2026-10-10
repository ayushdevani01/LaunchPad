import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        hover: "rgb(var(--hover) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        mint: "rgb(var(--mint) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
      },
      letterSpacing: {
        tightest: "-0.045em",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        hairline: "inset 0 1px 0 0 rgb(255 255 255 / 0.05)",
        lift: "0 20px 50px -24px rgb(0 0 0 / 0.9)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.35), 0 12px 40px -12px rgb(var(--accent) / 0.25)",
      },
      keyframes: {
        "marquee-x": {
          from: { transform: "translate3d(0,0,0)" },
          to: { transform: "translate3d(-50%,0,0)" },
        },
        "caret-blink": {
          "0%, 45%": { opacity: "1" },
          "46%, 100%": { opacity: "0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.7)", opacity: "0.7" },
          "80%, 100%": { transform: "scale(1.9)", opacity: "0" },
        },
        "sweep": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(220%)" },
        },
        "rise": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        marquee: "marquee-x 42s linear infinite",
        caret: "caret-blink 1.1s steps(2, start) infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.24, 0.6, 0.35, 1) infinite",
        sweep: "sweep 2.8s ease-in-out infinite",
        rise: "rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
