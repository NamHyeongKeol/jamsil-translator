import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mingle/live-demo-core"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
