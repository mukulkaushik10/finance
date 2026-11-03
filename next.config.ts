import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg-boss", "@prisma/client", "pdf-lib"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  // Let the dev server be used through GitHub Codespaces' forwarded-port URLs.
  allowedDevOrigins: ["*.app.github.dev"],
};

export default nextConfig;
