// Background worker: runs replay jobs and agent callbacks from the Postgres-backed queue.
// Start with `npm run worker` (also started by `npm run dev`).
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { getBoss, QUEUES } = await import("../src/server/jobs/queue");
const { runReplay } = await import("../src/server/replay/service");
const { deliverReviewCallback } = await import("../src/server/review/callback");

const boss = await getBoss();

await boss.work<{ runId: string }>(QUEUES.replayRun, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
  const t0 = Date.now();
  console.log(`[replay] run ${job.data.runId} started`);
  await runReplay(job.data.runId);
  console.log(`[replay] run ${job.data.runId} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
});

await boss.work<{ actionId: string; organisationId: string }>(QUEUES.reviewCallback, { batchSize: 5, pollingIntervalSeconds: 2 }, async (jobs) => {
  for (const job of jobs) await deliverReviewCallback(job.data.organisationId, job.data.actionId);
});

console.log("[worker] ready: listening for replay runs and review callbacks");

const stop = async () => { await boss.stop({ graceful: true }); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
