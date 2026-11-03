"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Lock, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import {
  APPROVER_LABEL, APPROVER_OPTIONS, CONDITION_FIELDS, OPERATORS, OPERATORS_BY_KIND, RULE_DEFINITIONS,
  type ConditionField, type Operator,
} from "@/server/rules/definitions";
import { formatMoney, parseMoney } from "@/lib/money";
import type { RuleType } from "@prisma/client";
import { formatDate, formatDateTime } from "@/lib/format";

interface RuleView {
  id: string; name: string; type: RuleType; label: string; description: string; locked: boolean; version: number;
  enabled: boolean; severity: "review" | "block"; params: any; summary: string; updatedAt: string;
  history: { version: number; enabled: boolean; severity: string; summary: string; changeNote: string | null; changedBy: string; createdAt: string }[];
}

const SEVERITY_LABEL = { review: "Send to a person", block: "Stop the invoice" } as const;

export function RulesEditor({ rules, canEdit, workflowId, currency }: { rules: RuleView[]; canEdit: boolean; workflowId: string; currency: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {!canEdit ? <Alert tone="info">You can view rules but not change them.</Alert> : null}
      {rules.map((r) => <RuleCard key={r.id + r.version} rule={r} canEdit={canEdit} currency={currency} />)}
      {canEdit ? (
        adding ? (
          <NewCustomRule workflowId={workflowId} currency={currency} onCancel={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)} data-testid="add-custom-rule"><Plus className="h-4 w-4" /> Add your own rule</Button>
        )
      ) : null}
    </div>
  );
}

function RuleCard({ rule, canEdit, currency }: { rule: RuleView; canEdit: boolean; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [params, setParams] = useState<any>(rule.params);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState(rule.severity);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const def = RULE_DEFINITIONS[rule.type];
  const preview = useMemo(() => {
    const p = def.paramsSchema.safeParse(params);
    return p.success ? def.summarize(p.data) : null;
  }, [params, def]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/rules/${rule.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params, enabled, severity, changeNote: note }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const details = data?.error?.details?.map((d: { message: string }) => d.message).join("; ");
      setError(details || data?.error?.message || "Could not save");
      return;
    }
    setEditing(false);
    setNote("");
    router.refresh();
  }

  return (
    <Card data-testid={`rule-${rule.type}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{rule.name}</h3>
            {rule.enabled ? <Badge tone="good">On</Badge> : <Badge tone="neutral">Off</Badge>}
            <Badge tone={rule.severity === "block" ? "bad" : "warn"}>{SEVERITY_LABEL[rule.severity]}</Badge>
            {rule.locked ? <Badge tone="info"><Lock className="h-3 w-3" /> Mandatory control</Badge> : null}
          </div>
          <p className="mt-1.5 text-sm text-ink" data-testid="rule-summary">{rule.summary}</p>
          <p className="mt-1 text-xs text-muted">
            Version {rule.version} · changed by {rule.history[0]?.changedBy} on {formatDate(rule.updatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowHistory((s) => !s)}><History className="h-4 w-4" /> History</Button>
          {canEdit && !editing ? <Button variant="secondary" size="sm" onClick={() => setEditing(true)} data-testid="edit-rule">Edit</Button> : null}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4 border-t border-border bg-surface-2/40 px-5 py-4">
          <ParamsEditor type={rule.type} params={params} onChange={setParams} currency={currency} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="When this rule fails">
              <Select value={severity} onChange={(e) => setSeverity(e.target.value as "review" | "block")} className="w-full">
                <option value="review">Send to a person</option>
                <option value="block">Stop the invoice</option>
              </Select>
            </Field>
            <Field label="Status" hint={rule.locked ? "This control can be tuned but not switched off." : undefined}>
              <Select value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")} disabled={rule.locked} className="w-full">
                <option value="on">On</option>
                <option value="off">Off</option>
              </Select>
            </Field>
          </div>
          {preview ? (
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <span className="text-muted">The rule will read: </span>{preview}
            </div>
          ) : null}
          <Field label="Reason for this change" hint="Required. Kept in the audit trail.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Policy update approved by CFO on 3 Nov" data-testid="change-note" />
          </Field>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || note.trim().length < 3} data-testid="save-rule">Save as version {rule.version + 1}</Button>
            <Button variant="ghost" onClick={() => { setEditing(false); setParams(rule.params); setEnabled(rule.enabled); setSeverity(rule.severity); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {showHistory ? (
        <div className="border-t border-border px-5 py-3">
          <ol className="space-y-2.5">
            {rule.history.map((h) => (
              <li key={h.version} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Version {h.version}</span>
                  <span className="text-xs text-muted">{formatDateTime(h.createdAt)} · {h.changedBy}</span>
                  {!h.enabled ? <Badge>Off</Badge> : null}
                </div>
                <div className="text-ink-2">{h.summary}</div>
                {h.changeNote ? <div className="text-xs text-muted">“{h.changeNote}”</div> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- per-rule editors

function ParamsEditor({ type, params, onChange, currency }: { type: RuleType; params: any; onChange: (p: any) => void; currency: string }) {
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });
  switch (type) {
    case "three_way_match":
      return (
        <Sentence>
          Hold for review when the invoice differs from the PO by more than
          <PercentInput bps={params.amountToleranceBps} onChange={(v) => set("amountToleranceBps", v)} testId="tolerance" />,
          or goods received are more than
          <PercentInput bps={params.quantityToleranceBps} onChange={(v) => set("quantityToleranceBps", v)} />
          short of the PO quantity.
          <Check checked={params.requirePo} onChange={(v) => set("requirePo", v)} label="Invoices must have a PO" />
        </Sentence>
      );
    case "approval_limit":
      return <ApprovalBands params={params} onChange={onChange} />;
    case "duplicate_invoice":
      return (
        <Sentence>
          Hold for review when the same vendor bills the same amount within
          <NumberInput value={params.windowDays} onChange={(v) => set("windowDays", v)} suffix="days" />.
          <Check checked={params.fuzzyInvoiceNumber} onChange={(v) => set("fuzzyInvoiceNumber", v)} label="Also catch invoice numbers that only differ in formatting (INV-0123 vs 123A)" />
        </Sentence>
      );
    case "bank_details_change":
      return (
        <Sentence>
          Always send to a person when the vendor’s bank details changed in the last
          <NumberInput value={params.lookbackDays} onChange={(v) => set("lookbackDays", v)} suffix="days" />
          or don’t match the vendor record.
          <Check checked={params.reviewNewVendors} onChange={(v) => set("reviewNewVendors", v)} label="Also review the first payment to a new vendor" />
        </Sentence>
      );
    case "blocked_vendor":
      return (
        <Field label="Extra blocked vendor names (one per line)" hint="Vendors flagged as blocked in the vendor master are always stopped. Manage them under Settings → Vendors.">
          <Textarea rows={3} value={params.additionalBlockedNames.join("\n")} onChange={(e) => set("additionalBlockedNames", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
        </Field>
      );
    case "custom_condition":
      return <CustomConditionEditor params={params} onChange={onChange} currency={currency} />;
  }
}

function Sentence({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm leading-8">{children}</div>;
}

function PercentInput({ bps, onChange, testId }: { bps: number; onChange: (bps: number) => void; testId?: string }) {
  const [text, setText] = useState((bps / 100).toString());
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        className="h-8 w-20 text-right"
        inputMode="decimal"
        value={text}
        data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(e.target.value.trim());
          if (m) onChange(Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")));
        }}
      />
      %
    </span>
  );
}

function NumberInput({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input className="h-8 w-20 text-right" inputMode="numeric" value={String(value)} onChange={(e) => onChange(parseInt(e.target.value || "0", 10) || 0)} />
      {suffix}
    </span>
  );
}

function MoneyInput({ minor, currency, onChange, testId }: { minor: number; currency: string; onChange: (minor: number | null) => void; testId?: string }) {
  const [text, setText] = useState(formatMoney(BigInt(minor), currency).replace(/[^\d.,]/g, ""));
  const [bad, setBad] = useState(false);
  return (
    <Input
      className={`h-8 w-32 text-right ${bad ? "border-bad" : ""}`}
      inputMode="decimal"
      value={text}
      data-testid={testId}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const v = parseMoney(e.target.value, currency);
          setBad(v <= 0n);
          onChange(v > 0n ? Number(v) : null);
        } catch {
          setBad(true);
          onChange(null);
        }
      }}
    />
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex w-full items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function ApprovalBands({ params, onChange }: { params: any; onChange: (p: any) => void }) {
  const bands: { upToMinor: number | null; approver: string }[] = params.bands;
  const update = (i: number, patch: Partial<{ upToMinor: number | null; approver: string }>) =>
    onChange({ ...params, bands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const remove = (i: number) => onChange({ ...params, bands: bands.filter((_, j) => j !== i) });
  const add = () => {
    const last = bands[bands.length - 1];
    const prevLimit = bands.length > 1 ? bands[bands.length - 2].upToMinor ?? 0 : 0;
    onChange({ ...params, bands: [...bands.slice(0, -1), { upToMinor: prevLimit * 2 || 100_000, approver: "controller" }, last] });
  };
  return (
    <div className="space-y-2" data-testid="approval-bands">
      <div className="text-sm font-medium text-ink-2">Who must approve, by invoice amount ({params.currency})</div>
      {bands.map((b, i) => {
        const isLast = i === bands.length - 1;
        const lower = i === 0 ? 0 : bands[i - 1].upToMinor ?? 0;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            {isLast ? (
              <span className="w-56">Above {formatMoney(BigInt(lower), params.currency)}</span>
            ) : (
              <span className="flex w-56 items-center gap-2">
                Up to <MoneyInput minor={b.upToMinor ?? 0} currency={params.currency} onChange={(v) => v !== null && update(i, { upToMinor: v })} testId={`band-limit-${i}`} />
              </span>
            )}
            <span className="text-muted">→</span>
            <Select value={b.approver} onChange={(e) => update(i, { approver: e.target.value })}>
              {APPROVER_OPTIONS.map((o) => <option key={o} value={o}>{APPROVER_LABEL[o]}</option>)}
            </Select>
            {!isLast && bands.length > 2 ? <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label="Remove band"><Trash2 className="h-4 w-4" /></Button> : null}
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={add}><Plus className="h-4 w-4" /> Add a band</Button>
    </div>
  );
}

function CustomConditionEditor({ params, onChange, currency }: { params: any; onChange: (p: any) => void; currency: string }) {
  const conditions: { field: ConditionField; operator: Operator; value: string }[] = params.conditions;
  const setCond = (i: number, patch: Partial<{ field: ConditionField; operator: Operator; value: string }>) =>
    onChange({ ...params, conditions: conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        When
        <Select value={params.match} onChange={(e) => onChange({ ...params, match: e.target.value })}>
          <option value="all">all</option>
          <option value="any">any</option>
        </Select>
        of these are true:
      </div>
      {conditions.map((c, i) => {
        const kind = CONDITION_FIELDS[c.field].kind;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={c.field} onChange={(e) => {
              const field = e.target.value as ConditionField;
              const k = CONDITION_FIELDS[field].kind;
              setCond(i, { field, operator: OPERATORS_BY_KIND[k][0], value: k === "boolean" ? "true" : k === "decision" ? "approve" : "" });
            }}>
              {Object.entries(CONDITION_FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </Select>
            <Select value={c.operator} onChange={(e) => setCond(i, { operator: e.target.value as Operator })}>
              {OPERATORS_BY_KIND[kind].map((o) => <option key={o} value={o}>{OPERATORS[o]}</option>)}
            </Select>
            {kind === "money" ? (
              <MoneyInput minor={Number(c.value || 0)} currency={currency} onChange={(v) => setCond(i, { value: v === null ? "" : String(v) })} />
            ) : kind === "boolean" ? (
              <Select value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>
                <option value="true">yes</option><option value="false">no</option>
              </Select>
            ) : kind === "decision" ? (
              <Select value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}>
                <option value="approve">approve</option><option value="reject">reject</option><option value="escalate">escalate</option>
              </Select>
            ) : (
              <Input className="h-9 w-48" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={kind === "percent" ? "e.g. 90" : c.operator === "in" ? "comma separated" : ""} />
            )}
            {conditions.length > 1 ? (
              <Button variant="ghost" size="sm" aria-label="Remove condition" onClick={() => onChange({ ...params, conditions: conditions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            ) : null}
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => onChange({ ...params, conditions: [...conditions, { field: "vendor_name", operator: "eq", value: "" }] })}><Plus className="h-4 w-4" /> Add condition</Button>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Message shown to the reviewer">
          <Input value={params.message} onChange={(e) => onChange({ ...params, message: e.target.value })} />
        </Field>
        <Field label="Must be approved by">
          <Select className="w-full" value={params.requiredApprover ?? ""} onChange={(e) => onChange({ ...params, requiredApprover: e.target.value || null })}>
            <option value="">Anyone who can review</option>
            <option value="reviewer">a reviewer or above</option>
            <option value="controller">a controller or above</option>
            <option value="admin">the CFO / admin</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}

function NewCustomRule({ workflowId, currency, onCancel }: { workflowId: string; currency: string; onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState<"review" | "block">("review");
  const [params, setParams] = useState<any>(RULE_DEFINITIONS.custom_condition.defaultParams);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setError(null);
    const res = await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowId, name, severity, params }) });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.details?.map((d: { message: string }) => d.message).join("; ") || data?.error?.message || "Could not create rule");
      return;
    }
    onCancel();
    router.refresh();
  }
  return (
    <Card className="space-y-4 px-5 py-4">
      <div className="font-semibold">New rule</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing spend over $20,000" /></Field>
        <Field label="When this rule fails">
          <Select className="w-full" value={severity} onChange={(e) => setSeverity(e.target.value as "review" | "block")}>
            <option value="review">Send to a person</option><option value="block">Stop the invoice</option>
          </Select>
        </Field>
      </div>
      <CustomConditionEditor params={params} onChange={setParams} currency={currency} />
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button onClick={create} disabled={name.trim().length < 2}>Create rule</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}
