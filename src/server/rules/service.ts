import { z } from "zod";
import type { Prisma, RuleType } from "@prisma/client";
import { forOrg, type Tx } from "../db/dal";
import type { Ctx } from "../auth/session";
import { requirePermission } from "../auth/session";
import { appendAudit } from "../audit/chain";
import { badRequest, notFound } from "../errors";
import { DEFAULT_AP_RULES, RULE_DEFINITIONS } from "./definitions";

/** Create the shipped default rules for an AP workflow (version 1 of each). */
export async function createDefaultRules(tx: Tx, organisationId: string, workflowId: string, actor: { type: "user" | "system"; id: string }) {
  let order = 0;
  for (const type of DEFAULT_AP_RULES) {
    const def = RULE_DEFINITIONS[type];
    await createRuleTx(tx, organisationId, workflowId, {
      type, name: def.defaultName, severity: def.defaultSeverity, params: def.defaultParams,
      enabled: true, locked: Boolean(def.lockedByDefault), sortOrder: (order += 10),
    }, actor);
  }
}

async function createRuleTx(
  tx: Tx, organisationId: string, workflowId: string,
  r: { type: RuleType; name: string; severity: "review" | "block"; params: unknown; enabled: boolean; locked: boolean; sortOrder: number; changeNote?: string },
  actor: { type: "user" | "system"; id: string },
) {
  const def = RULE_DEFINITIONS[r.type];
  const params = def.paramsSchema.parse(r.params);
  const rule = await tx.rule.create({
    data: { organisationId, workflowId, type: r.type, name: r.name, locked: r.locked, currentVersion: 1, sortOrder: r.sortOrder },
  });
  const version = await tx.ruleVersion.create({
    data: {
      organisationId, ruleId: rule.id, version: 1, enabled: r.enabled, severity: r.severity,
      params: params as Prisma.InputJsonValue, summary: def.summarize(params), changeNote: r.changeNote ?? "Created",
      createdById: actor.type === "user" ? actor.id : null,
    },
  });
  await appendAudit(tx, organisationId, {
    eventType: "rule.created", entityType: "rule", entityId: rule.id, actorType: actor.type, actorId: actor.id,
    payload: { rule: { id: rule.id, name: rule.name, type: rule.type, locked: rule.locked }, version: snapshot(version) },
  });
  return rule;
}

function snapshot(v: { id: string; version: number; enabled: boolean; severity: string; params: unknown; summary: string }) {
  return { id: v.id, version: v.version, enabled: v.enabled, severity: v.severity, params: v.params, summary: v.summary };
}

export const UpdateRuleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(["review", "block"]).optional(),
  params: z.unknown().optional(),
  changeNote: z.string().min(3, "Say briefly why you're changing this rule").max(500),
});

/** Edit a rule. Writes a new immutable version and an audit record; takes effect on the next evaluate call. */
export async function updateRule(ctx: Ctx, ruleId: string, input: unknown) {
  requirePermission(ctx, "rules:edit");
  const data = UpdateRuleSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    // Serialise edits to the same rule.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"rule:" + ruleId}))`;
    const rule = await tx.rule.findFirst({ where: { id: ruleId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!rule) throw notFound("Rule");
    const current = rule.versions[0];
    const def = RULE_DEFINITIONS[rule.type];
    const enabled = data.enabled ?? current.enabled;
    if (rule.locked && !enabled) throw badRequest(`"${rule.name}" is a mandatory control and can't be switched off`);
    const parsed = def.paramsSchema.safeParse(data.params === undefined ? current.params : data.params);
    if (!parsed.success) {
      throw badRequest("Some rule settings are invalid", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    }
    const params = parsed.data;
    const severity = data.severity ?? current.severity;
    const version = await tx.ruleVersion.create({
      data: {
        organisationId: ctx.organisationId, ruleId: rule.id, version: current.version + 1, enabled, severity,
        params: params as Prisma.InputJsonValue, summary: def.summarize(params), changeNote: data.changeNote, createdById: ctx.user.id,
      },
    });
    const updated = await tx.rule.update({ where: { id: rule.id }, data: { currentVersion: version.version, name: data.name ?? rule.name } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "rule.changed", entityType: "rule", entityId: rule.id, actorType: "user", actorId: ctx.user.id,
      payload: {
        rule: { id: rule.id, name: updated.name, type: rule.type },
        changedBy: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
        changeNote: data.changeNote,
        before: snapshot(current),
        after: snapshot(version),
      },
    });
    return { rule: updated, version };
  });
}

export const CreateRuleSchema = z.object({
  workflowId: z.string(),
  name: z.string().min(2).max(120),
  severity: z.enum(["review", "block"]),
  params: z.unknown(),
});

/** Add a custom-condition rule. */
export async function createCustomRule(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "rules:edit");
  const data = CreateRuleSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const wf = await db.workflow.findFirst({ where: { id: data.workflowId } });
  if (!wf) throw notFound("Workflow");
  const parsed = RULE_DEFINITIONS.custom_condition.paramsSchema.safeParse(data.params);
  if (!parsed.success) throw badRequest("Some rule settings are invalid", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const last = await db.rule.findFirst({ where: { workflowId: wf.id }, orderBy: { sortOrder: "desc" } });
  return db.$transaction((tx) =>
    createRuleTx(tx, ctx.organisationId, wf.id, {
      type: "custom_condition", name: data.name, severity: data.severity, params: parsed.data,
      enabled: true, locked: false, sortOrder: (last?.sortOrder ?? 0) + 10,
    }, { type: "user", id: ctx.user.id }),
  );
}

export async function listRules(ctx: Ctx, workflowId: string) {
  requirePermission(ctx, "rules:view");
  const db = forOrg(ctx.organisationId);
  const rules = await db.rule.findMany({
    where: { workflowId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { versions: { orderBy: { version: "desc" } } },
  });
  const userIds = [...new Set(rules.flatMap((r) => r.versions.map((v) => v.createdById).filter(Boolean)))] as string[];
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rules.map((r) => {
    const cur = r.versions[0];
    return {
      id: r.id, name: r.name, type: r.type, label: RULE_DEFINITIONS[r.type].label, description: RULE_DEFINITIONS[r.type].description,
      locked: r.locked, version: cur.version, enabled: cur.enabled, severity: cur.severity, params: cur.params, summary: cur.summary,
      updatedAt: cur.createdAt,
      history: r.versions.map((v) => ({
        version: v.version, enabled: v.enabled, severity: v.severity, summary: v.summary, changeNote: v.changeNote,
        changedBy: v.createdById ? nameOf.get(v.createdById) ?? "Unknown" : "System", createdAt: v.createdAt, params: v.params,
      })),
    };
  });
}
