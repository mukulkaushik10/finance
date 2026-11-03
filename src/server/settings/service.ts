import { z } from "zod";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { badRequest, conflict, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { generateApiKey, generateSigningSecret } from "../agents/keys";
import { MockConfigSchema } from "../agents/mock";
import { hashPassword } from "../auth/password";
import { ERP_CONNECTORS } from "../connectors/erp";
import { fingerprint } from "../seed/generator";

// Admin settings: agents, vendor master flags, users, system-of-record connector.
// Every change is written to the audit trail.

const publicAgent = (a: { id: string; name: string; vendorName: string | null; kind: string; endpointUrl: string | null; callbackUrl: string | null; apiKeyPrefix: string; version: string; mockConfig: unknown; costPerActionMinor: bigint; costCurrency: string; active: boolean; createdAt: Date }) => ({
  id: a.id, name: a.name, vendorName: a.vendorName, kind: a.kind, endpointUrl: a.endpointUrl, callbackUrl: a.callbackUrl,
  apiKeyPrefix: a.apiKeyPrefix, version: a.version, mockConfig: a.mockConfig, costPerActionMinor: a.costPerActionMinor,
  costCurrency: a.costCurrency, active: a.active, createdAt: a.createdAt,
});

export async function listAgents(ctx: Ctx) {
  requirePermission(ctx, "settings:view");
  const rows = await forOrg(ctx.organisationId).agent.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(publicAgent);
}

const url = z.string().url().refine((u) => /^https?:\/\//.test(u), "Must be an http(s) URL");

export const CreateAgentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  vendorName: z.string().trim().max(120).optional(),
  kind: z.enum(["webhook", "mock"]),
  endpointUrl: url.optional(),
  callbackUrl: url.optional(),
  version: z.string().max(64).default("1.0.0"),
  mockConfig: MockConfigSchema.optional(),
  costPerActionMinor: z.number().int().min(0).default(0),
}).superRefine((a, c) => {
  if (a.kind === "webhook" && !a.endpointUrl) c.addIssue({ code: "custom", path: ["endpointUrl"], message: "A webhook agent needs an endpoint URL" });
  if (a.kind === "mock" && !a.mockConfig) c.addIssue({ code: "custom", path: ["mockConfig"], message: "Choose an error profile for the demo agent" });
});

/** Connect an agent. The API key and signing secret are shown once, here, and never again. */
export async function createAgent(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = CreateAgentSchema.parse(input);
  const key = generateApiKey();
  const signingSecret = generateSigningSecret();
  const db = forOrg(ctx.organisationId);
  const agent = await db.$transaction(async (tx) => {
    const a = await tx.agent.create({
      data: {
        organisationId: ctx.organisationId, name: d.name, vendorName: d.vendorName ?? null, kind: d.kind,
        endpointUrl: d.endpointUrl ?? null, callbackUrl: d.callbackUrl ?? null, version: d.version,
        mockConfig: d.mockConfig ?? undefined, costPerActionMinor: BigInt(d.costPerActionMinor),
        apiKeyHash: key.hash, apiKeyPrefix: key.prefix, signingSecret,
      },
    });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "agent.created", entityType: "agent", entityId: a.id, actorType: "user", actorId: ctx.user.id,
      payload: { agent: publicAgent(a), by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return a;
  });
  return { agent: publicAgent(agent), apiKey: key.key, signingSecret };
}

export const UpdateAgentSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  endpointUrl: url.nullable().optional(),
  callbackUrl: url.nullable().optional(),
  version: z.string().max(64).optional(),
  mockConfig: MockConfigSchema.optional(),
  costPerActionMinor: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  rotateKey: z.boolean().optional(),
});

export async function updateAgent(ctx: Ctx, agentId: string, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const { rotateKey, costPerActionMinor, ...d } = UpdateAgentSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const before = await tx.agent.findFirst({ where: { id: agentId } });
    if (!before) throw notFound("Agent");
    if (d.mockConfig && before.kind !== "mock") throw badRequest("Only demo agents have an error profile");
    const key = rotateKey ? generateApiKey() : null;
    const a = await tx.agent.update({
      where: { id: agentId },
      data: {
        ...d,
        ...(costPerActionMinor !== undefined ? { costPerActionMinor: BigInt(costPerActionMinor) } : {}),
        ...(key ? { apiKeyHash: key.hash, apiKeyPrefix: key.prefix } : {}),
      },
    });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "agent.changed", entityType: "agent", entityId: a.id, actorType: "user", actorId: ctx.user.id,
      payload: { agent: { id: a.id, name: a.name }, before: publicAgent(before), after: publicAgent(a), keyRotated: Boolean(key), by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return { agent: publicAgent(a), apiKey: key?.key ?? null };
  });
}

// ---- vendors

export async function listVendors(ctx: Ctx, q?: string) {
  requirePermission(ctx, "settings:view");
  return forOrg(ctx.organisationId).vendor.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: [{ blocked: "desc" }, { bankChangedAt: { sort: "desc", nulls: "last" } }, { code: "asc" }],
    take: 200,
  });
}

export const UpdateVendorSchema = z.object({
  blocked: z.boolean().optional(),
  blockedReason: z.string().trim().max(300).optional(),
  /** Record that the vendor's bank details changed (e.g. after a change request); triggers review for the lookback period. */
  bankDetailsChanged: z.literal(true).optional(),
  reason: z.string().trim().min(5, "Say briefly why").max(500),
}).refine((v) => v.blocked !== true || (v.blockedReason && v.blockedReason.length >= 3), { message: "Give a reason for blocking", path: ["blockedReason"] });

export async function updateVendor(ctx: Ctx, vendorId: string, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = UpdateVendorSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const v = await tx.vendor.findFirst({ where: { id: vendorId } });
    if (!v) throw notFound("Vendor");
    const now = new Date();
    const updated = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        ...(d.blocked !== undefined ? { blocked: d.blocked, blockedReason: d.blocked ? d.blockedReason : null } : {}),
        ...(d.bankDetailsChanged ? { bankChangedAt: now, bankFingerprint: fingerprint(`bank:${v.code}:${now.toISOString()}`) } : {}),
      },
    });
    const change = [
      d.blocked === true ? `blocked (${d.blockedReason})` : d.blocked === false ? "unblocked" : null,
      d.bankDetailsChanged ? "bank details changed" : null,
    ].filter(Boolean).join(", ");
    await appendAudit(tx, ctx.organisationId, {
      eventType: "vendor.changed", entityType: "vendor", entityId: v.id, actorType: "user", actorId: ctx.user.id,
      payload: { vendor: { id: v.id, code: v.code, name: v.name }, change, reason: d.reason, before: { blocked: v.blocked, bankChangedAt: v.bankChangedAt }, after: { blocked: updated.blocked, bankChangedAt: updated.bankChangedAt }, by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return updated;
  });
}

// ---- users

export async function listUsers(ctx: Ctx) {
  requirePermission(ctx, "settings:view");
  return forOrg(ctx.organisationId).user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true } });
}

export const CreateUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "controller", "reviewer", "auditor"]),
  password: z.string().min(8, "At least 8 characters"),
});

export async function createUser(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = CreateUserSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const exists = await tx.user.findFirst({ where: { email: d.email } });
    if (exists) throw conflict("A user with this email already exists");
    const u = await tx.user.create({ data: { organisationId: ctx.organisationId, name: d.name, email: d.email, role: d.role, passwordHash: hashPassword(d.password) } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "user.changed", entityType: "user", entityId: u.id, actorType: "user", actorId: ctx.user.id,
      payload: { user: { id: u.id, email: u.email, name: u.name }, change: "created", role: u.role, by: { name: ctx.user.name } },
    });
    return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active };
  });
}

export const UpdateUserSchema = z.object({ role: z.enum(["admin", "controller", "reviewer", "auditor"]).optional(), active: z.boolean().optional() });

export async function updateUser(ctx: Ctx, userId: string, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = UpdateUserSchema.parse(input);
  if (userId === ctx.user.id && (d.active === false || (d.role && d.role !== "admin"))) throw badRequest("You can't remove your own admin access");
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { id: userId } });
    if (!before) throw notFound("User");
    const u = await tx.user.update({ where: { id: userId }, data: d });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "user.changed", entityType: "user", entityId: u.id, actorType: "user", actorId: ctx.user.id,
      payload: { user: { id: u.id, email: u.email, name: u.name }, change: "updated", before: { role: before.role, active: before.active }, after: { role: u.role, active: u.active }, by: { name: ctx.user.name } },
    });
    return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active };
  });
}

// ---- system of record

export const ConnectorSchema = z.object({ erpConnector: z.enum(Object.keys(ERP_CONNECTORS) as [keyof typeof ERP_CONNECTORS]) });

export async function setErpConnector(ctx: Ctx, workflowId: string, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = ConnectorSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const wf = await tx.workflow.findFirst({ where: { id: workflowId } });
    if (!wf) throw notFound("Workflow");
    const updated = await tx.workflow.update({ where: { id: workflowId }, data: { erpConnector: d.erpConnector } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "workflow.settings_changed", entityType: "workflow", entityId: workflowId, actorType: "user", actorId: ctx.user.id,
      payload: { before: { erpConnector: wf.erpConnector }, after: { erpConnector: d.erpConnector }, reason: `System of record set to ${ERP_CONNECTORS[d.erpConnector]}` },
    });
    return updated;
  });
}
