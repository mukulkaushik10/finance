"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { send } from "@/lib/send";
import { cn } from "@/lib/cn";

export function MessageThread({ messages, postUrl, me, canPost, emptyText }: {
  messages: { id: string; authorType: string; authorName: string; body: string; at?: string; createdAt?: string }[];
  postUrl: string; me: "buyer" | "supplier"; canPost: boolean; emptyText: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function post() {
    setBusy(true); setError(null);
    try { await send(postUrl, "POST", { body }); setBody(""); router.refresh(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="space-y-3" data-testid="messages">
      {messages.length === 0 ? <p className="text-sm text-muted">{emptyText}</p> : null}
      {messages.map((m) => (
        <div key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.authorType === me ? "ml-auto bg-brand-soft" : "bg-surface-2")}>
          <div className="whitespace-pre-wrap">{m.body}</div>
          <div className="mt-1 text-xs text-muted">{m.authorName} · {formatDateTime(m.at ?? m.createdAt)}</div>
        </div>
      ))}
      {canPost ? (
        <div className="space-y-2 pt-1">
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" data-testid="message-input" />
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <div className="flex justify-end"><Button size="sm" variant="secondary" disabled={!body.trim() || busy} onClick={post}>{busy ? "Sending…" : "Send message"}</Button></div>
        </div>
      ) : null}
    </div>
  );
}
