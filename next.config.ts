import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
