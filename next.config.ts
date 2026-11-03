import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg-boss", "@prisma/client", "pdf-lib"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};

export default nextConfig;
