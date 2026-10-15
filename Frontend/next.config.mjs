import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";

// Reuse the repository-level environment file so the dashboard and the API
// server agree on hostnames during local development.
const uiPreview = process.env.LAUNCHPAD_UI_PREVIEW === "1";
if (
  process.env.NODE_ENV === "production" &&
  (uiPreview || process.env.NEXT_PUBLIC_UI_PREVIEW === "1")
) {
  throw new Error("The local UI preview cannot be used in a production build.");
}
if (!uiPreview)
  nextEnv.loadEnvConfig(
    fileURLToPath(new URL("../", import.meta.url)),
    process.env.NODE_ENV !== "production",
    console,
    true,
  );

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: uiPreview ? ".next-preview" : ".next",
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
