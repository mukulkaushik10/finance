import { defineConfig } from "@playwright/test";

// End-to-end acceptance tests against a production build and the background worker,
// using a separate database (controlroom_e2e) that is reset and seeded before the run.
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://controlroom:controlroom@localhost:5432/controlroom_e2e";
const PORT = 3100;
export const env = {
  DATABASE_URL: E2E_DB,
  APP_URL: `http://localhost:${PORT}`,
  SESSION_SECRET: "e2e-session-secret-that-is-long-enough-123",
  STORAGE_DIR: "/tmp/control-room-e2e-storage",
  NODE_ENV: "production",
  DEMO_MODE: "1",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: env.APP_URL, viewport: { width: 1360, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: `npx next build && npx concurrently -k -n web,worker "npx next start -p ${PORT}" "npx tsx worker/index.ts"`,
    url: `${env.APP_URL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env,
    stdout: "pipe",
  },
});
