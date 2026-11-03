"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardBody, CardHeader, Field, Textarea } from "@/components/ui";

export function ReviewPanel({ actionId, escalated, spotCheck, failedCount, nextId }: { actionId: string; escalated: boolean; spotCheck: boolean; failedCount: number; nextId: string | null }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [rightToEscalate, setRightToEscalate] = useState(true);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooShort = reason.trim().length < 10;

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    const res = await fetch(`/api/actions/${actionId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason, ...(escalated ? { agentRightToEscalate: rightToEscalate } : {}) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.details?.[0]?.message ?? data?.error?.message ?? "Could not save the decision");
      setBusy(null);
      return;
    }
    if (nextId) router.push(`/review/${nextId}`);
    else router.refresh();
  }

  return (
    <Card className="border-brand/40 ring-1 ring-brand/10" data-testid="review-panel">
      <CardHeader title={spotCheck ? "Spot check this decision" : "Your decision"} description={spotCheck ? "The agent already went ahead (shadow mode). Your answer is recorded as the correct outcome." : undefined} />
      <CardBody className="space-y-4">
        {failedCount > 0 && !spotCheck ? (
          <Alert tone="warn">{failedCount} check{failedCount > 1 ? "s" : ""} failed. Approving overrides {failedCount > 1 ? "them" : "it"} and counts as money at risk.</Alert>
        ) : null}
        <Field label="Reason" hint="Required. The auditor will see this.">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Confirmed price change with the buyer" data-testid="review-reason" />
        </Field>
        {escalated ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={rightToEscalate} onChange={(e) => setRightToEscalate(e.target.checked)} />
            The agent was right to send this to a person
          </label>
        ) : null}
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="good" disabled={tooShort || busy !== null} onClick={() => decide("approve")} data-testid="approve">{busy === "approve" ? "Saving…" : spotCheck ? "Should approve" : "Approve"}</Button>
          <Button variant="secondary" disabled={tooShort || busy !== null} onClick={() => decide("reject")} data-testid="reject">{busy === "reject" ? "Saving…" : spotCheck ? "Should reject" : "Reject"}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
