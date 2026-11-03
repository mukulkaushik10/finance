import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

// Tenancy guard: only the data-access layer and a few infrastructure modules may use the
// unscoped Prisma client. Everything else must go through forOrg(organisationId).
const RAW_CLIENT_ALLOWED = [
  "src/server/db/**",
  "src/server/audit/chain.ts",
  "src/server/audit/evidence.ts",
  "src/server/auth/session.ts",
  "src/server/auth/login.ts",
  "src/server/agents/keys.ts",
  "src/server/replay/service.ts",
  "src/server/seed/**",
  "src/app/(app)/layout.tsx",
  "src/app/api/mock-agents/**",
  "scripts/**",
  "prisma/**",
  "tests/**",
  "e2e/**",
  "worker/**",
];

export default [
  { ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["**/db/client", "@/server/db/client"], message: "Use forOrg(organisationId) from the data-access layer (src/server/db/dal.ts) so every query is tenant-scoped." }],
      }],
    },
  },
  { files: RAW_CLIENT_ALLOWED, rules: { "no-restricted-imports": "off" } },
];
