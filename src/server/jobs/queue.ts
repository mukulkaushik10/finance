import PgBoss from "pg-boss";

// Background jobs on Postgres (pg-boss): no extra infrastructure, jobs survive restarts.
// The web app only sends; the worker process (worker/index.ts) does the work.

export const QUEUES = { replayRun: "replay-run", reviewCallback: "review-callback" } as const;

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

export function getBoss(): Promise<PgBoss> {
  if (!g.__boss) {
    g.__boss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schedule: false, supervise: false });
      boss.on("error", (e) => console.error("[jobs]", e));
      await boss.start();
      for (const q of Object.values(QUEUES)) await boss.createQueue(q).catch(() => {});
      return boss;
    })();
  }
  return g.__boss;
}

export async function enqueue(queue: string, data: object) {
  const boss = await getBoss();
  return boss.send(queue, data, { retryLimit: 2, retryDelay: 5, expireInSeconds: 60 * 30 });
}
