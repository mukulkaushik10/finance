"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Card, CardBody, CardHeader } from "@/components/ui";
import { formatCount, formatDateTime } from "@/lib/format";

interface Result { ok: boolean; checked: number; headSeq: number; headHash: string; verifiedAt: string; problems: { seq: number; recordId: string; problem: string }[] }

export function VerifyChain() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch("/api/audit/verify", { cache: "no-store" });
    setResult(await res.json());
    setBusy(false);
  }
  return (
    <Card>
      <CardHeader title="Verify chain" description="Recompute every record's fingerprint and check that none was changed, removed or reordered." />
      <CardBody className="space-y-3">
        <Button onClick={run} disabled={busy} data-testid="verify-chain">{busy ? "Checking…" : "Verify chain"}</Button>
        {result ? (
          result.ok ? (
            <div className="flex gap-3 rounded-md border border-good/30 bg-good-soft px-4 py-3" data-testid="verify-result" data-ok="true">
              <ShieldCheck className="h-5 w-5 shrink-0 text-good" />
              <div className="text-sm">
                <div className="font-semibold text-good">Passed: no record has been altered</div>
                <div className="text-ink-2">{formatCount(result.checked)} records checked at {formatDateTime(result.verifiedAt)}.</div>
                <div className="mt-1 break-all font-mono text-[11px] text-muted">Latest fingerprint (#{result.headSeq}): {result.headHash}</div>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 rounded-md border border-bad/30 bg-bad-soft px-4 py-3" data-testid="verify-result" data-ok="false">
              <ShieldAlert className="h-5 w-5 shrink-0 text-bad" />
              <div className="text-sm">
                <div className="font-semibold text-bad">Failed: the audit trail has been tampered with</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                  {result.problems.map((p, i) => (
                    <li key={i}><a href={`/audit?eventType=&entity=&page=1#seq-${p.seq}`} className="hover:underline">{p.problem}</a></li>
                  ))}
                </ul>
                <div className="mt-1 text-xs text-muted">{formatCount(result.checked)} records checked at {formatDateTime(result.verifiedAt)}.</div>
              </div>
            </div>
          )
        ) : null}
      </CardBody>
    </Card>
  );
}
