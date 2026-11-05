"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";
import { send } from "@/lib/send";

type F = { legalName: string; taxId: string; email: string; phone: string; addressLine1: string; addressLine2: string; city: string; region: string; postalCode: string };

export function CompanyForm({ initial, canEdit }: { initial: F; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setMsg(null);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== "" || k === "postalCode"));
      await send("/api/portal/profile", "PATCH", body); setMsg({ tone: "good", text: "Saved" }); router.refresh();
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); }
  }
  return (
    <Card className="max-w-2xl">
      <CardBody className="grid gap-3 py-5 sm:grid-cols-2">
        <Field label="Legal name" className="sm:col-span-2"><Input value={f.legalName} onChange={set("legalName")} disabled={!canEdit} /></Field>
        <Field label="EIN"><Input value={f.taxId} onChange={set("taxId")} placeholder="12-3456789" disabled={!canEdit} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} disabled={!canEdit} /></Field>
        <Field label="Billing email" className="sm:col-span-2"><Input value={f.email} onChange={set("email")} disabled={!canEdit} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.addressLine1} onChange={set("addressLine1")} disabled={!canEdit} /></Field>
        <Field label="Address line 2" className="sm:col-span-2"><Input value={f.addressLine2} onChange={set("addressLine2")} disabled={!canEdit} /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} disabled={!canEdit} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State"><Input value={f.region} onChange={set("region")} maxLength={2} disabled={!canEdit} /></Field>
          <Field label="ZIP"><Input value={f.postalCode} onChange={set("postalCode")} disabled={!canEdit} /></Field>
        </div>
        {msg ? <Alert tone={msg.tone} className="sm:col-span-2">{msg.text}</Alert> : null}
        {canEdit ? <div className="sm:col-span-2"><Button onClick={save}>Save details</Button></div> : <Alert tone="info" className="sm:col-span-2">Only your account owner can change company details.</Alert>}
      </CardBody>
    </Card>
  );
}
