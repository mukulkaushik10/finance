"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";

interface Props {
  workflowId: string;
  level: number;
  canChange: boolean;
  promotion: { eligible: boolean; nextLevel: number | null; reason: string };
  settings: { autoApproveLimitMinor: number; currency: string; confidenceThresholdBps: number; promotionWindow: number; promotionTargetBps: number };
}

export function AutonomyControls({ workflowId, level, canChange, promotion, settings }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"promote" | "demote" | "settings" | null>(null);
  const [toLevel, setToLevel] = useState(Math.max(0, level - 1));
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState(formatMoney(BigInt(settings.autoApproveLimitMinor), settings.currency).replace(/[^\d.,]/g, ""));
  const [conf, setConf] = useState(String(settings.confidenceThresholdBps / 100));
  const [win, setWin] = useState(String(settings.promotionWindow));
  const [target, setTarget] = useState(String(settings.promotionTargetBps / 100));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(url: string, method: string, body: unknown) {
    setBusy(true); setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.details?.[0]?.message ?? data?.error?.message ?? "Could not save");
      return;
    }
    setMode(null); setReason("");
    router.refresh();
  }

  if (!canChange) {
    return (
      <Card>
        <CardHeader title="Change level" />
        <CardBody><p className="text-sm text-muted">Only controllers and admins can change the autonomy level.</p></CardBody>
      </Card>
    );
  }

  const saveSettings = () => {
    let limitMinor: number;
    try { limitMinor = Number(parseMoney(limit, settings.currency)); } catch { setError("Enter the limit as an amount, e.g. 5,000"); return; }
    send(`/api/workflows/${workflowId}`, "PATCH", {
      autoApproveLimitMinor: limitMinor,
      confidenceThresholdBps: Math.round(Number(conf) * 100),
      promotionWindow: Number(win),
      promotionTargetBps: Math.round(Number(target) * 100),
      reason,
    });
  };

  return (
    <Card>
      <CardHeader title="Change level" />
      <CardBody className="space-y-3">
        {promotion.nextLevel !== null && promotion.eligible ? (
          <Alert tone="good" title={`Ready for Level ${promotion.nextLevel}`}>{promotion.reason}. A person must confirm.</Alert>
        ) : null}
        {mode === null ? (
          <div className="flex flex-col gap-2">
            {promotion.nextLevel !== null ? (
              <Button onClick={() => setMode("promote")} disabled={!promotion.eligible} data-testid="promote"><ArrowUp className="h-4 w-4" /> Move up to Level {promotion.nextLevel}</Button>
            ) : null}
            {level > 0 ? <Button variant="secondary" onClick={() => setMode("demote")} data-testid="demote"><ArrowDown className="h-4 w-4" /> Move down</Button> : null}
            <Button variant="ghost" onClick={() => setMode("settings")}>Limits and targets</Button>
          </div>
        ) : null}

        {mode === "promote" || mode === "demote" ? (
          <div className="space-y-3">
            {mode === "demote" ? (
              <Field label="Move to">
                <Select className="w-full" value={toLevel} onChange={(e) => setToLevel(Number(e.target.value))}>
                  {Array.from({ length: level }, (_, i) => <option key={i} value={i}>Level {i}</option>)}
                </Select>
              </Field>
            ) : <p className="text-sm">You are confirming that the agent may do more without a person, from the next invoice onwards.</p>}
            <Field label="Reason" hint="Required. Kept in the audit trail.">
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="level-reason" />
            </Field>
            {error ? <Alert tone="bad">{error}</Alert> : null}
            <div className="flex gap-2">
              <Button disabled={busy || reason.trim().length < 10} onClick={() => send(`/api/workflows/${workflowId}/autonomy`, "POST", { toLevel: mode === "promote" ? promotion.nextLevel : toLevel, reason })} data-testid="confirm-level">
                Confirm {mode === "promote" ? `Level ${promotion.nextLevel}` : `Level ${toLevel}`}
              </Button>
              <Button variant="ghost" onClick={() => { setMode(null); setError(null); }}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {mode === "settings" ? (
          <div className="space-y-3">
            <Field label="Auto-approve limit (Level 2)"><Input value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="auto-limit" /></Field>
            <Field label="Minimum agent confidence (%)"><Input value={conf} onChange={(e) => setConf(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Track record over (invoices)"><Input value={win} onChange={(e) => setWin(e.target.value)} /></Field>
              <Field label="Accuracy target (%)"><Input value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            </div>
            <Field label="Reason" hint="Required. Kept in the audit trail."><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {error ? <Alert tone="bad">{error}</Alert> : null}
            <div className="flex gap-2">
              <Button disabled={busy || reason.trim().length < 10} onClick={saveSettings}>Save</Button>
              <Button variant="ghost" onClick={() => { setMode(null); setError(null); }}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
