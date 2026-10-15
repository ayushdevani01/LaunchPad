import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import { UI_PREVIEW } from "@/lib/api";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LaunchPad — ship frontends from GitHub",
    template: "%s · LaunchPad",
  },
  description:
    "Connect a repository, pick a folder, and LaunchPad builds it, streams the logs, and serves it on your own subdomain.",
  metadataBase: new URL("https://launch-pad.dev"),
  openGraph: {
    title: "LaunchPad — ship frontends from GitHub",
    description:
      "Deploy Next.js apps and static websites from GitHub. Live build logs, your own subdomain.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="min-h-screen bg-ink text-fg">
        {UI_PREVIEW ? (
          <aside
            aria-label="Local preview mode"
            className="fixed inset-x-3 bottom-3 z-[100] mx-auto w-fit max-w-[calc(100%-24px)] rounded-lg border border-accent/30 bg-ink/95 px-3 py-2 text-center text-[11px] text-accent shadow-lg"
          >
            Local UI preview · Sample data · No AWS deployments
          </aside>
        ) : null}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
