// Smoke test: upload the seed CSV, replay both mock agents inline, print the headline numbers.
import { readFileSync } from "node:fs";
import { seedBase, DEMO } from "../src/server/seed/demo";
import { createDataset, startComparison, runReplay } from "../src/server/replay/service";
import { computeComparison } from "../src/server/replay/report";
import { forOrg } from "../src/server/db/dal";
import { rawPrisma } from "../src/server/db/client";
import { formatMoney } from "../src/lib/money";

const ctx = { organisationId: DEMO.orgId, user: { ...DEMO.users.controller } };
const t0 = Date.now();
if (process.argv.includes("--reseed")) await seedBase();
const csv = readFileSync("seed/invoices.csv", "utf8");
const up = await createDataset(ctx, DEMO.workflowId, { name: "Seed invoices", csvText: csv });
console.log("imported", up.imported, "skipped", up.skipped, up.mix, up.warnings.slice(0, 3));
const runs: string[] = [];
const cmp = await startComparison(ctx, { datasetId: up.dataset.id, agentIds: [DEMO.agents.cautious.id, DEMO.agents.fastpay.id] }, { enqueueRun: async (id) => runs.push(id) });
await Promise.all(runs.map(runReplay));
const res = await computeComparison(forOrg(DEMO.orgId), cmp.id);
for (const r of res!.reports) {
  console.log(`\n${r.agent.name}: accuracy ${(r.accuracy! * 100).toFixed(1)}%  GL ${(r.glAccuracy! * 100).toFixed(1)}%`);
  console.log("  by decision", Object.fromEntries(Object.entries(r.byDecision).map(([k, v]) => [k, `${v.correct}/${v.total}`])));
  console.log("  confusion", JSON.stringify(r.confusion));
  console.log(`  mis-approved ${r.money.misApprovedCount} = ${formatMoney(r.money.misApprovedMinor, "USD")}; after rules ${r.money.misApprovedAfterRulesCount} = ${formatMoney(r.money.misApprovedAfterRulesMinor, "USD")}`);
  console.log(`  wrongly blocked ${r.money.wronglyBlockedCount} = ${formatMoney(r.money.wronglyBlockedMinor, "USD")}; unnecessary escalations ${r.money.unnecessaryEscalationCount}`);
  console.log("  worst:", r.worstErrors.slice(0, 3).map((w) => `${w.invoiceId} ${w.kind} ${formatMoney(w.amountMinor, "USD")} rules:${w.whatTheRulesFound[0] ?? "-"}`));
}
console.log(`\nTotal ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await rawPrisma.$disconnect();
