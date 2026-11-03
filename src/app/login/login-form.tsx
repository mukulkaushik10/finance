"use client";

import { useState } from "react";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

const DEMO_USERS = [
  { email: "controller@harborpine.example", label: "Dana Whitfield", role: "Controller" },
  { email: "admin@harborpine.example", label: "Alex Morgan", role: "Admin" },
  { email: "auditor@harborpine.example", label: "Sam Okafor", role: "Auditor (read-only)" },
];

export function LoginForm({ demo }: { demo: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent, override?: { email: string; password: string }) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(override ?? { email, password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => null);
    setError(data?.error?.message ?? "Could not sign in");
    setBusy(false);
  }

  return (
    <Card>
      <CardBody className="space-y-4 py-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Work email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <Button type="submit" className="w-full" disabled={busy}>Sign in</Button>
        </form>
        <p className="text-xs text-muted">Single sign-on (SAML / OIDC) can be enabled for your organisation by an admin.</p>
        {demo ? (
          <div className="border-t border-border pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Demo accounts</div>
            <div className="space-y-1.5">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  disabled={busy}
                  onClick={() => submit(undefined, { email: u.email, password: "demo1234" })}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:border-brand/50 hover:bg-brand-soft/40"
                  data-testid={`demo-login-${u.role.split(" ")[0].toLowerCase()}`}
                >
                  <span className="font-medium">{u.label}</span>
                  <span className="text-xs text-muted">{u.role}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
