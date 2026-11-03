"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Play } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui";
import { formatCount } from "@/lib/format";

interface DatasetOpt { id: string; name: string; rowCount: number; createdAt: string }
interface AgentOpt { id: string; name: string; vendorName: string | null; kind: string; version: string }
interface UploadResult {
  dataset: { id: string; name: string }; imported: number; skipped: number; pdfsAttached: number;
  mix: Record<string, number>; warnings: { row: number; message: string }[];
}

export function ReplaySetup({ datasets, agents }: { datasets: DatasetOpt[]; agents: AgentOpt[] }) {
  const router = useRouter();
  const csvRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<{ message: string; details?: { row: number; message: string }[] } | null>(null);
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>(agents.slice(0, 2).map((a) => a.id));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function doUpload() {
    const file = csvRef.current?.files?.[0];
    if (!file) return;
    setUploading(true); setUploadError(null); setUpload(null);
    const fd = new FormData();
    fd.set("csv", file);
    fd.set("name", name || file.name.replace(/\.csv$/i, ""));
    for (const p of Array.from(pdfRef.current?.files ?? [])) fd.append("pdfs", p);
    const res = await fetch("/api/replay/datasets", { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok) { setUploadError({ message: data?.error?.message ?? "Upload failed", details: data?.error?.details }); return; }
    setUpload(data);
    setDatasetId(data.dataset.id);
    router.refresh();
  }

  async function start() {
    setStarting(true); setStartError(null);
    const res = await fetch("/api/replay/comparisons", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ datasetId, agentIds: chosen }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) { setStarting(false); setStartError(data?.error?.details?.[0]?.message ?? data?.error?.message ?? "Could not start"); return; }
    router.push(`/replay/${data.comparison.id}`);
  }

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? c : [...c, id]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="1. Upload past invoices" description="A CSV with the correct outcome for each invoice. PDFs are optional; name each one after its invoice_id." />
        <CardBody className="space-y-4">
          <Field label="Invoice CSV" hint="Columns: invoice_id, vendor, amount, currency, po_number, grn_number, invoice_date, correct_decision (approve / reject / escalate), correct_gl_code. Optional: invoice_number.">
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-surface-2" data-testid="csv-input" />
          </Field>
          <Field label="Invoice PDFs (optional)">
            <input ref={pdfRef} type="file" accept="application/pdf" multiple className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-surface-2" />
          </Field>
          <Field label="Name this set">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 invoices" />
          </Field>
          <Button onClick={doUpload} disabled={uploading} data-testid="upload-csv"><FileUp className="h-4 w-4" /> {uploading ? "Checking file…" : "Upload and check"}</Button>
          {uploadError ? (
            <Alert tone="bad" title={uploadError.message}>
              {uploadError.details?.length ? (
                <ul className="mt-1 list-disc pl-5">{uploadError.details.slice(0, 8).map((d, i) => <li key={i}>{d.row ? `Row ${d.row}: ` : ""}{d.message}</li>)}</ul>
              ) : null}
            </Alert>
          ) : null}
          {upload ? (
            <Alert tone="good" title={`${formatCount(upload.imported)} invoices ready`}>
              <span data-testid="upload-summary">
                {formatCount(upload.mix.approve ?? 0)} should be approved, {formatCount(upload.mix.reject ?? 0)} rejected, {formatCount(upload.mix.escalate ?? 0)} escalated.
                {upload.skipped ? ` ${upload.skipped} rows skipped.` : ""}{upload.pdfsAttached ? ` ${upload.pdfsAttached} PDFs attached.` : ""}
              </span>
              {upload.warnings.length ? (
                <ul className="mt-1 list-disc pl-5 text-xs">{upload.warnings.slice(0, 5).map((w, i) => <li key={i}>{w.row ? `Row ${w.row}: ` : ""}{w.message}</li>)}</ul>
              ) : null}
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Choose agents to compare" description="Pick up to three. Each one gets the same invoices, in the same order." />
        <CardBody className="space-y-4">
          <Field label="Invoice set">
            <Select className="w-full" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} data-testid="dataset-select">
              {datasets.length === 0 && !upload ? <option value="">Upload a set first</option> : null}
              {upload && !datasets.some((d) => d.id === upload.dataset.id) ? <option value={upload.dataset.id}>{upload.dataset.name} ({formatCount(upload.imported)})</option> : null}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} ({formatCount(d.rowCount)})</option>)}
            </Select>
          </Field>
          <div className="space-y-2">
            {agents.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-surface-2/60">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={chosen.includes(a.id)} onChange={() => toggle(a.id)} data-testid={`agent-${a.id}`} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.name}</div>
                  <div className="text-xs text-muted">{a.vendorName ?? "In-house"} · version {a.version}</div>
                </div>
                {a.kind === "mock" ? <Badge tone="neutral">Demo agent</Badge> : <Badge tone="info">Connected</Badge>}
              </label>
            ))}
          </div>
          {startError ? <Alert tone="bad">{startError}</Alert> : null}
          <Button onClick={start} disabled={starting || !datasetId || chosen.length === 0} data-testid="start-replay">
            <Play className="h-4 w-4" /> {starting ? "Starting…" : `Run replay with ${chosen.length} agent${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
