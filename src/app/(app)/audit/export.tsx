"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";

const pad = (n: number) => String(n).padStart(2, "0");

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

export function ExportEvidence({ defaults }: { defaults: { from?: string; to?: string; vendor?: string } }) {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  const [mode, setMode] = useState<"month" | "range" | "action">(defaults.from ? "range" : "month");
  const [month, setMonth] = useState(thisMonth);
  const [from, setFrom] = useState(defaults.from ?? `${thisMonth}-01`);
  const [to, setTo] = useState(defaults.to ?? now.toISOString().slice(0, 10));
  const [vendor, setVendor] = useState(defaults.vendor ?? "");
  const [actionId, setActionId] = useState("");

  const href = (() => {
    if (mode === "action") return actionId ? `/api/audit/export?actionId=${encodeURIComponent(actionId.trim())}` : null;
    const r = mode === "month" ? monthRange(month) : { from, to };
    const p = new URLSearchParams({ from: r.from, to: r.to, ...(vendor ? { vendor } : {}) });
    return `/api/audit/export?${p}`;
  })();

  return (
    <Card>
      <CardHeader title="Export evidence pack" description="A ZIP with a PDF summary, CSVs of every action, rule result and decision, and the tamper check result." />
      <CardBody className="space-y-3">
        <Field label="What to export">
          <Select className="w-full" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} data-testid="export-mode">
            <option value="month">One month</option>
            <option value="range">A date range</option>
            <option value="action">A single action</option>
          </Select>
        </Field>
        {mode === "month" ? <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="export-month" /></Field> : null}
        {mode === "range" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        ) : null}
        {mode !== "action" ? <Field label="Vendor (optional)"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Name or code, e.g. V-0042" /></Field> : null}
        {mode === "action" ? <Field label="Action ID" hint="Shown on every invoice page; or use the Evidence pack button there."><Input value={actionId} onChange={(e) => setActionId(e.target.value)} /></Field> : null}
        {href ? (
          <a href={href} download data-testid="export-download">
            <Button type="button"><Download className="h-4 w-4" /> Download evidence pack</Button>
          </a>
        ) : <Button disabled><Download className="h-4 w-4" /> Download evidence pack</Button>}
      </CardBody>
    </Card>
  );
}
