import { execSync } from "node:child_process";

// Migrate and seed the dedicated e2e database (non-destructive migrate + TRUNCATE-based seed).
export default function globalSetup() {
  const env = {
    ...process.env,
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://controlroom:controlroom@localhost:5432/controlroom_e2e",
    STORAGE_DIR: "/tmp/control-room-e2e-storage",
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
