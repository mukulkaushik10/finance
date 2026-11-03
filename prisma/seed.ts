import { seedBase, DEMO } from "../src/server/seed/demo";
import { rawPrisma } from "../src/server/db/client";

async function main() {
  const t0 = Date.now();
  const base = await seedBase();
  let live: Record<string, number> = {};
  try {
    const mod = await import("../src/server/seed/live-history");
    live = await mod.seedLiveHistory();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw e;
  }
  console.log("Seeded Control Room demo data in", ((Date.now() - t0) / 1000).toFixed(1) + "s");
  console.table({ ...base.counts, ...live });
  console.log(`Replay CSV written to ${base.csvPath}`);
  console.log("\nSign in (password for all: %s):", DEMO.password);
  for (const u of Object.values(DEMO.users)) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
  console.log("\nAgent API keys (demo only):");
  for (const a of Object.values(DEMO.agents)) console.log(`  ${a.name.padEnd(24)} ${a.apiKey}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => rawPrisma.$disconnect());
