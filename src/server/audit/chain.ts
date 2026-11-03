import { createHash } from "node:crypto";
import type { AuditRecord } from "@prisma/client";
import { rawPrisma } from "../db/client";
import { canonicalJson, toJsonSafe, type JsonValue } from "./canonical";
import type { Tx } from "../db/dal";

// Append-only, hash-chained audit trail.
//
// hash(n) = SHA-256( canonical JSON of { organisationId, seq, eventType, entityType, entityId,
//                                         actorType, actorId, occurredAt, payload, prevHash } )
// prevHash(n) = hash(n-1); the first record uses GENESIS_HASH.
//
// Appends are serialised per organisation with a transaction-scoped advisory lock, so seq is
// gap-free and the chain never forks. UPDATE/DELETE are rejected by a database trigger.

export const GENESIS_HASH = "0".repeat(64);

export type AuditEventType =
  | "action.evaluated"
  | "action.reviewed"
  | "rule.created"
  | "rule.changed"
  | "autonomy.changed"
  | "workflow.settings_changed"
  | "agent.created"
  | "agent.changed"
  | "vendor.changed"
  | "user.changed"
  | "replay.completed"
  | "evidence.exported";

export interface AuditEvent {
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  actorType: "agent" | "user" | "system";
  actorId: string;
  occurredAt?: Date;
  payload: unknown;
}

export interface HashInput {
  organisationId: string;
  seq: number;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  occurredAt: Date | string;
  payload: unknown;
  prevHash: string;
}

export function computeHash(r: HashInput): string {
  const occurredAt = typeof r.occurredAt === "string" ? r.occurredAt : r.occurredAt.toISOString();
  const body = canonicalJson({
    organisationId: r.organisationId,
    seq: r.seq,
    eventType: r.eventType,
    entityType: r.entityType,
    entityId: r.entityId,
    actorType: r.actorType,
    actorId: r.actorId,
    occurredAt,
    payload: r.payload,
    prevHash: r.prevHash,
  });
  return createHash("sha256").update(body).digest("hex");
}

/** Append one record. Must be called inside a transaction (pass the transaction client). */
export async function appendAudit(tx: Tx, organisationId: string, event: AuditEvent): Promise<AuditRecord> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + organisationId}))`;
  const last = await tx.auditRecord.findFirst({
    where: { organisationId },
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const occurredAt = new Date(event.occurredAt ?? new Date()); // ms precision, same as Postgres timestamp(3)
  const payload = toJsonSafe(event.payload) as JsonValue;
  const hash = computeHash({
    organisationId, seq, eventType: event.eventType, entityType: event.entityType, entityId: event.entityId,
    actorType: event.actorType, actorId: event.actorId, occurredAt, payload, prevHash,
  });
  return tx.auditRecord.create({
    data: {
      organisationId, seq, eventType: event.eventType, entityType: event.entityType, entityId: event.entityId,
      actorType: event.actorType, actorId: event.actorId, occurredAt, payload: payload as never, prevHash, hash,
    },
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  headSeq: number;
  headHash: string;
  verifiedAt: string;
  problems: { seq: number; recordId: string; problem: string }[];
}

/** Recompute every hash in order and check each link. Reports the first problems found. */
export async function verifyChain(organisationId: string, opts: { maxProblems?: number } = {}): Promise<ChainVerification> {
  const maxProblems = opts.maxProblems ?? 20;
  const problems: ChainVerification["problems"] = [];
  let expectedSeq = 1;
  let prevHash = GENESIS_HASH;
  let checked = 0;
  let cursor = 0;
  const BATCH = 2000;
  for (;;) {
    const batch = await rawPrisma.auditRecord.findMany({
      where: { organisationId, seq: { gt: cursor } },
      orderBy: { seq: "asc" },
      take: BATCH,
    });
    if (batch.length === 0) break;
    for (const r of batch) {
      if (r.seq !== expectedSeq) {
        problems.push({ seq: expectedSeq, recordId: r.id, problem: `Record #${expectedSeq} is missing (next record found is #${r.seq})` });
      }
      if (r.prevHash !== prevHash) {
        problems.push({ seq: r.seq, recordId: r.id, problem: `Record #${r.seq} does not link to the record before it` });
      }
      const recomputed = computeHash({ ...r, payload: r.payload });
      if (recomputed !== r.hash) {
        problems.push({ seq: r.seq, recordId: r.id, problem: `Record #${r.seq} was changed after it was written (its contents no longer match its fingerprint)` });
      }
      prevHash = r.hash;
      expectedSeq = r.seq + 1;
      checked++;
      if (problems.length >= maxProblems) break;
    }
    if (problems.length >= maxProblems) break;
    cursor = batch[batch.length - 1].seq;
  }
  return {
    ok: problems.length === 0,
    checked,
    headSeq: expectedSeq - 1,
    headHash: prevHash,
    verifiedAt: new Date().toISOString(),
    problems,
  };
}
