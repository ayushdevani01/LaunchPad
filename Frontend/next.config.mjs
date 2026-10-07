import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";

// Load the shared repository environment for local dashboard builds.
// Hosting-provider environment variables retain precedence over file values.
nextEnv.loadEnvConfig(
  fileURLToPath(new URL("../", import.meta.url)),
  process.env.NODE_ENV !== "production",
  console,
  true
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.(".svg")
    );

    config.module.rules.push(
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, 
      },

      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] },
        use: ["@svgr/webpack"],
      }
    );

    fileLoaderRule.exclude = /\.svg$/i;

    return config;
  },
};

export default nextConfig;
