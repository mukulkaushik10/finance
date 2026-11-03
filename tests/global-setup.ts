import { execSync } from "node:child_process";

// Apply migrations to the dedicated test database (non-destructive). Each test file then
// clears data itself with TRUNCATE via resetDatabase()/seedBase().
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://controlroom:controlroom@localhost:5432/controlroom_test";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
