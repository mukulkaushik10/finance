// Background jobs run in the page instead of a separate worker process (same job functions).
export const QUEUES = { replayRun: "replay-run", reviewCallback: "review-callback" } as const;
export async function getBoss() { return null as any; }
export async function enqueue(queue: string, data: any) {
  setTimeout(async () => {
    try {
      if (queue === QUEUES.replayRun) { const { runReplay } = await import("@/server/replay/service"); await runReplay(data.runId); }
      if (queue === QUEUES.reviewCallback) { const { deliverReviewCallback } = await import("@/server/review/callback"); await deliverReviewCallback(data.organisationId, data.actionId); }
    } catch (e) { console.error("[jobs]", e); }
    (globalThis as any).__crRefreshSoon?.();
  }, 50);
  return "job";
}
