import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { verifyChain } from "./chain";

export async function verifyOrgChain(ctx: Ctx) {
  requirePermission(ctx, "audit:view");
  return verifyChain(ctx.organisationId);
}

export const AuditFilterSchema = z.object({
  entity: z.string().optional(),
  eventType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listAuditRecords(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "audit:view");
  const f = AuditFilterSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const where: Prisma.AuditRecordWhereInput = {
    ...(f.entity ? { entityId: f.entity } : {}),
    ...(f.eventType ? { eventType: f.eventType } : {}),
  };
  const [rows, total] = await Promise.all([
    db.auditRecord.findMany({ where, orderBy: { seq: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    db.auditRecord.count({ where }),
  ]);
  const actorIds = [...new Set(rows.filter((r) => r.actorType !== "system").map((r) => r.actorId))];
  const [users, agents] = await Promise.all([
    db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
    db.agent.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...users, ...agents].map((x) => [x.id, x.name]));
  return {
    rows: rows.map((r) => ({ ...r, actorName: r.actorType === "system" ? "Control Room" : names.get(r.actorId) ?? r.actorId, summary: summarise(r) })),
    total, page: f.page, pageSize: f.pageSize,
  };
}

/** One plain-language line per audit record. */
export function summarise(r: { eventType: string; payload: unknown }): string {
  const p = r.payload as any;
  switch (r.eventType) {
    case "action.evaluated":
      return `${p.inputs?.invoice_id} from ${p.inputs?.vendor_name}: agent proposed ${p.proposed?.decision}; ${p.gate?.computedOutcome?.replace("_", " ")}${p.gate?.enforced === false ? " (shadow)" : ""}`;
    case "action.reviewed":
      return `${p.reviewer?.name} ${p.decision === "approve" ? "approved" : "rejected"}: “${p.reason}”`;
    case "rule.created": return `Rule “${p.rule?.name}” created`;
    case "rule.changed": return `Rule “${p.rule?.name}” changed to version ${p.after?.version} by ${p.changedBy?.name}: “${p.changeNote}”`;
    case "autonomy.changed": return `Autonomy moved from Level ${p.fromLevel} to Level ${p.toLevel} by ${p.confirmedBy?.name}: “${p.reason}”`;
    case "workflow.settings_changed": return p.created ? "Workflow created" : `Workflow limits changed${p.reason ? `: “${p.reason}”` : ""}`;
    case "replay.completed": return `Replay of ${p.dataset?.rows} invoices by ${p.agent?.name} finished`;
    case "evidence.exported": return `Evidence pack exported by ${p.by?.name}: ${p.scopeLabel}`;
    case "agent.created": return `Agent “${p.agent?.name}” connected`;
    case "agent.changed": return `Agent “${p.agent?.name}” changed`;
    case "vendor.changed": return `Vendor ${p.vendor?.code} changed: ${p.change ?? ""}`;
    case "user.changed": return `User ${p.user?.email} changed`;
    default: return r.eventType;
  }
}
