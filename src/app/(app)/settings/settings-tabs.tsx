"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

interface Props {
  initialTab: string; canEdit: boolean; appUrl: string; currentUserId: string; q: string;
  workflow: { id: string; erpConnector: string }; connectors: Record<string, string>;
  data: { agents: any[]; vendors: any[]; users: any[]; bankAccounts: any[] };
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.details?.[0]?.message ?? data?.error?.message ?? "Could not save");
  return data;
}

export function SettingsTabs(p: Props) {
  const [tab, setTab] = useState(p.initialTab);
  const tabs = [["agents", "Agents"], ["erp", "System of record"], ["vendors", "Vendors"], ["bank", "Bank accounts"], ["users", "Users & roles"]];
  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("px-3 py-2 text-sm font-medium", tab === k ? "border-b-2 border-brand text-ink" : "text-muted hover:text-ink")}>{label}</button>
        ))}
      </div>
      {!p.canEdit ? <Alert tone="info" className="mb-4">Only admins can change settings.</Alert> : null}
      {tab === "agents" ? <Agents {...p} /> : null}
      {tab === "erp" ? <Erp {...p} /> : null}
      {tab === "vendors" ? <Vendors {...p} /> : null}
      {tab === "bank" ? <BankAccounts {...p} /> : null}
      {tab === "users" ? <Users {...p} /> : null}
    </>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted">{label}</div>
      <code className="block break-all rounded bg-surface px-2 py-1 font-mono text-xs" data-testid="secret">{value}</code>
    </div>
  );
}

function Agents({ data, canEdit, appUrl }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", vendorName: "", kind: "webhook", endpointUrl: "", callbackUrl: "", profile: "cautious", errorRate: "7" });
  const [issued, setIssued] = useState<{ name: string; apiKey: string; signingSecret?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const body: any = { name: form.name, vendorName: form.vendorName || undefined, kind: form.kind };
      if (form.kind === "webhook") { body.endpointUrl = form.endpointUrl; if (form.callbackUrl) body.callbackUrl = form.callbackUrl; }
      else body.mockConfig = { profile: form.profile, errorRate: Number(form.errorRate) / 100, seed: `${form.name}-${Date.now()}` };
      const res = await send("/api/agents", "POST", body);
      setIssued({ name: res.agent.name, apiKey: res.apiKey, signingSecret: res.signingSecret });
      setAdding(false);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
  }
  async function rotate(id: string, name: string) {
    if (!confirm(`Issue a new API key for ${name}? The old key stops working immediately.`)) return;
    const res = await send(`/api/agents/${id}`, "PATCH", { rotateKey: true });
    setIssued({ name, apiKey: res.apiKey });
    router.refresh();
  }
  async function setRate(a: any, pct: string) {
    const v = Number(pct);
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    await send(`/api/agents/${a.id}`, "PATCH", { mockConfig: { ...a.mockConfig, errorRate: v / 100 } });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {issued ? (
        <Alert tone="good" title={`Credentials for ${issued.name}`}>
          <p className="mb-2">Copy these now. They won’t be shown again.</p>
          <div className="space-y-2">
            <Secret label="API key (agent → Control Room)" value={issued.apiKey} />
            {issued.signingSecret ? <Secret label="Signing secret (Control Room → agent)" value={issued.signingSecret} /> : null}
          </div>
        </Alert>
      ) : null}
      <Card>
        <CardHeader title="Connected agents" description="Agents call POST /v1/actions/evaluate with their API key before acting. For replays, Control Room calls the agent's endpoint." action={canEdit && !adding ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Connect agent</Button> : null} />
        <Table>
          <thead><tr><Th>Agent</Th><Th>Type</Th><Th>API key</Th><Th>Endpoint / profile</Th><Th>Cost per action</Th><Th /></tr></thead>
          <tbody>
            {data.agents.map((a) => (
              <tr key={a.id}>
                <Td><div className="font-medium text-ink">{a.name}</div><div className="text-xs text-muted">{a.vendorName ?? "In-house"} · v{a.version}</div></Td>
                <Td>{a.kind === "mock" ? <Badge>Demo agent</Badge> : <Badge tone="info">Webhook</Badge>}</Td>
                <Td className="font-mono text-xs">{a.apiKeyPrefix}…</Td>
                <Td className="text-xs">
                  {a.kind === "mock" ? (
                    <span className="flex items-center gap-2">
                      {a.mockConfig.profile === "cautious" ? "Cautious" : "Fast payer"}, error rate
                      <Input className="h-7 w-16 text-right" defaultValue={String(Math.round(a.mockConfig.errorRate * 100))} disabled={!canEdit}
                        onBlur={(e) => e.target.value !== String(Math.round(a.mockConfig.errorRate * 100)) && setRate(a, e.target.value)} data-testid={`error-rate-${a.id}`} />%
                    </span>
                  ) : <span className="break-all">{a.endpointUrl}</span>}
                </Td>
                <Td className="tabular">{formatMoney(a.costPerActionMinor, a.costCurrency)}</Td>
                <Td>{canEdit ? <Button size="sm" variant="ghost" onClick={() => rotate(a.id, a.name)}><KeyRound className="h-4 w-4" /> New key</Button> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {adding ? (
          <CardBody className="space-y-3 border-t border-border bg-surface-2/40">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Built by"><Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} placeholder="Vendor or team" /></Field>
              <Field label="Type">
                <Select className="w-full" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="webhook">Webhook (your agent)</option>
                  <option value="mock">Demo agent</option>
                </Select>
              </Field>
            </div>
            {form.kind === "webhook" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Endpoint for replays" hint={`Try ${appUrl}/api/mock-agents/agt_fastpay/decide`}><Input value={form.endpointUrl} onChange={(e) => setForm({ ...form, endpointUrl: e.target.value })} placeholder="https://agent.example.com/decide" /></Field>
                <Field label="Callback when a person decides (optional)"><Input value={form.callbackUrl} onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })} /></Field>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Error profile">
                  <Select className="w-full" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                    <option value="cautious">Cautious: over-escalates, rarely approves risk</option>
                    <option value="fast_pay">Fast payer: approves quickly, misses duplicates</option>
                  </Select>
                </Field>
                <Field label="Error rate (%)"><Input value={form.errorRate} onChange={(e) => setForm({ ...form, errorRate: e.target.value })} /></Field>
              </div>
            )}
            {error ? <Alert tone="bad">{error}</Alert> : null}
            <div className="flex gap-2"><Button onClick={create} disabled={form.name.trim().length < 2}>Connect</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}

function Erp({ workflow, connectors, canEdit }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(workflow.erpConnector);
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="System of record" description="Where Control Room looks up vendors, purchase orders and goods received, and where approved invoices are posted." />
      <CardBody className="space-y-3">
        <Field label="Connector" hint="The MVP uses demo data behind each connector. Real write-back comes later.">
          <Select className="w-80" value={value} disabled={!canEdit} onChange={(e) => { setValue(e.target.value); setSaved(false); }}>
            {Object.entries(connectors).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {canEdit ? <Button disabled={value === workflow.erpConnector} onClick={async () => { await send(`/api/workflows/${workflow.id}/connector`, "PUT", { erpConnector: value }); setSaved(true); router.refresh(); }}>Save</Button> : null}
        {saved ? <Alert tone="good">Saved.</Alert> : null}
      </CardBody>
    </Card>
  );
}

function Vendors({ data, canEdit, q }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function act(v: any, body: any) {
    const reason = prompt(body.blocked ? `Why block ${v.name}?` : body.bankDetailsChanged ? `Why record a bank detail change for ${v.name}?` : `Why unblock ${v.name}?`);
    if (!reason) return;
    try { await send(`/api/vendors/${v.id}`, "PATCH", { ...body, ...(body.blocked ? { blockedReason: reason } : {}), reason }); router.refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <Card>
      <CardHeader title="Vendors" description="Blocked vendors are always stopped. Vendors whose bank details changed recently always go to a person." action={
        <form method="get" className="flex gap-2"><input type="hidden" name="tab" value="vendors" /><Input name="q" defaultValue={q} placeholder="Search vendors" className="w-48" /><Button variant="secondary" type="submit">Search</Button></form>
      } />
      {error ? <Alert tone="bad" className="mx-5 mt-3">{error}</Alert> : null}
      <Table>
        <thead><tr><Th>Vendor</Th><Th>Category</Th><Th>Status</Th><Th>Bank details changed</Th><Th /></tr></thead>
        <tbody>
          {data.vendors.map((v) => (
            <tr key={v.id}>
              <Td><div className="font-medium text-ink">{v.name}</div><div className="text-xs text-muted">{v.code}</div></Td>
              <Td className="text-xs">{v.category} · GL {v.defaultGlCode}</Td>
              <Td>{v.blocked ? <Badge tone="bad">Blocked: {v.blockedReason}</Badge> : <Badge tone="good">Active</Badge>}</Td>
              <Td className="text-xs">{v.bankChangedAt ? formatDate(v.bankChangedAt) : "—"}</Td>
              <Td className="whitespace-nowrap">
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => act(v, { blocked: !v.blocked })}>{v.blocked ? "Unblock" : "Block"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(v, { bankDetailsChanged: true })}>Bank changed</Button>
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Users({ data, canEdit, currentUserId }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", role: "reviewer", password: "" });
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Users & roles" description="Admins manage settings. Controllers set policy and approve. Reviewers approve within their limit. Auditors can see and export everything but change nothing." />
      <Table>
        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th></tr></thead>
        <tbody>
          {data.users.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium text-ink">{u.name}</Td>
              <Td>{u.email}</Td>
              <Td>
                <Select value={u.role} disabled={!canEdit || u.id === currentUserId} onChange={async (e) => { try { await send(`/api/users/${u.id}`, "PATCH", { role: e.target.value }); router.refresh(); } catch (err) { setError((err as Error).message); } }}>
                  <option value="admin">Admin</option><option value="controller">Controller</option><option value="reviewer">Reviewer</option><option value="auditor">Auditor (read-only)</option>
                </Select>
              </Td>
              <Td>{u.active ? <Badge tone="good">Active</Badge> : <Badge>Disabled</Badge>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {canEdit ? (
        <CardBody className="space-y-3 border-t border-border">
          <div className="text-sm font-semibold">Add a user</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="reviewer">Reviewer</option><option value="controller">Controller</option><option value="auditor">Auditor</option><option value="admin">Admin</option>
            </Select>
            <Input type="password" placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <Button onClick={async () => { setError(null); try { await send("/api/users", "POST", form); setForm({ name: "", email: "", role: "reviewer", password: "" }); router.refresh(); } catch (e) { setError((e as Error).message); } }}>Add user</Button>
        </CardBody>
      ) : null}
    </Card>
  );
}

function BankAccounts({ data, canEdit }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ nickname: "", holderName: "", bankName: "", routingNumber: "", accountNumber: "", isDefault: false });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function add() {
    setError(null);
    try { await send("/api/bank-accounts", "POST", form); setAdding(false); setForm({ nickname: "", holderName: "", bankName: "", routingNumber: "", accountNumber: "", isDefault: false }); router.refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function change(a: any, body: Record<string, unknown>, question: string) {
    const reason = window.prompt(question);
    if (!reason) return;
    try { await send(`/api/bank-accounts/${a.id}`, "PATCH", { ...body, reason }); router.refresh(); } catch (e) { alert((e as Error).message); }
  }
  return (
    <Card>
      <CardHeader
        title="Bank accounts"
        description="The accounts you pay supplier invoices from. Account numbers are stored encrypted and only the last four digits are ever shown. Control Room records payments; it doesn't move money."
        action={canEdit && !adding ? <Button size="sm" onClick={() => setAdding(true)} data-testid="add-bank-account"><Plus className="h-4 w-4" /> Add account</Button> : null}
      />
      {adding ? (
        <CardBody className="grid gap-3 border-b border-border sm:grid-cols-2">
          <Field label="Name for this account"><Input value={form.nickname} onChange={set("nickname")} placeholder="Operating account" data-testid="bank-nickname" /></Field>
          <Field label="Account holder"><Input value={form.holderName} onChange={set("holderName")} placeholder="Harbor & Pine Manufacturing Inc." data-testid="bank-holder" /></Field>
          <Field label="Bank"><Input value={form.bankName} onChange={set("bankName")} placeholder="Pacific Commerce Bank" data-testid="bank-name" /></Field>
          <Field label="Routing number" hint="9 digits (ABA)"><Input inputMode="numeric" value={form.routingNumber} onChange={set("routingNumber")} placeholder="021000021" data-testid="bank-routing" /></Field>
          <Field label="Account number"><Input inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set("accountNumber")} data-testid="bank-account" /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /> Use as the default for payments</label>
          {error ? <Alert tone="bad" className="sm:col-span-2">{error}</Alert> : null}
          <div className="flex gap-2 sm:col-span-2"><Button onClick={add} data-testid="bank-save">Save account</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </CardBody>
      ) : null}
      <Table>
        <thead><tr><Th>Account</Th><Th>Bank</Th><Th>Routing</Th><Th>Number</Th><Th>Currency</Th><Th>Added</Th><Th /></tr></thead>
        <tbody>
          {data.bankAccounts.map((a: any) => (
            <tr key={a.id} className={a.state === "archived" ? "opacity-60" : ""}>
              <Td><span className="font-medium">{a.nickname}</span> {a.isDefault ? <Badge tone="brand">Default</Badge> : null} {a.state === "archived" ? <Badge>Archived</Badge> : null}<div className="text-xs text-muted">{a.holderName}</div></Td>
              <Td>{a.bankName}</Td>
              <Td className="tabular">{a.routingNumber}</Td>
              <Td className="tabular">••••{a.accountLast4}</Td>
              <Td>{a.currency}</Td>
              <Td className="text-muted">{formatDate(a.createdAt)}</Td>
              <Td className="space-x-1 text-right">
                {canEdit && a.state === "active" && !a.isDefault ? <Button size="sm" variant="ghost" onClick={() => change(a, { isDefault: true }, `Why make ${a.nickname} the default?`)}>Make default</Button> : null}
                {canEdit && !a.isDefault ? <Button size="sm" variant="ghost" onClick={() => change(a, { archived: a.state === "active" }, a.state === "active" ? `Why archive ${a.nickname}?` : `Why restore ${a.nickname}?`)}>{a.state === "active" ? "Archive" : "Restore"}</Button> : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
