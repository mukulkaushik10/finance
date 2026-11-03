import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { ActionStatusResponseSchema, EvaluateRequestSchema, EvaluateResponseSchema } from "./gate/schemas";
import { LoginSchema } from "./auth/login";
import { ActionFilterSchema } from "./actions/query";
import { ReviewSchema } from "./review/service";
import { CreateRuleSchema, UpdateRuleSchema } from "./rules/service";
import { ChangeLevelSchema, WorkflowSettingsSchema } from "./autonomy/service";
import { StartComparisonSchema } from "./replay/service";
import { AuditFilterSchema } from "./audit/service";
import { ScorecardQuerySchema } from "./scorecard/service";
import { ConnectorSchema, CreateAgentSchema, CreateUserSchema, UpdateAgentSchema, UpdateUserSchema, UpdateVendorSchema } from "./settings/service";
import { AgentAnswerSchema } from "./agents/webhook";
import { InvoiceSubjectSchema } from "./workflows/ap_invoice/subject";

extendZodWithOpenApi(z);

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
}).openapi("Error");
const Any = (description: string) => z.object({}).passthrough().describe(description);

type Method = "get" | "post" | "put" | "patch" | "delete";
interface Op {
  method: Method; path: string; tag: string; summary: string; description?: string;
  auth: "agent" | "session" | "signature" | "none";
  body?: z.ZodTypeAny; bodyType?: "json" | "multipart"; query?: z.AnyZodObject; params?: string[];
  ok: { status: number; schema?: z.ZodTypeAny; description: string; contentType?: string };
  errors?: number[];
}

const ops: Op[] = [
  // ---- Agent-facing API
  {
    method: "post", path: "/v1/actions/evaluate", tag: "Agent API", auth: "agent",
    summary: "Ask permission before acting",
    description: "Call this before executing any action. Runs your organisation's rules and the workflow's autonomy level against the proposed action and returns auto_approve (go ahead), needs_human (wait for a person) or block (do not proceed). In shadow mode (Level 0) the outcome is always auto_approve and `shadow_outcome` says what would have happened. Send an `Idempotency-Key` header to make retries safe.",
    body: EvaluateRequestSchema, ok: { status: 201, schema: EvaluateResponseSchema, description: "Evaluated. 200 when replayed for a repeated Idempotency-Key." }, errors: [401, 404, 422],
  },
  { method: "get", path: "/v1/actions/{id}", tag: "Agent API", auth: "agent", params: ["id"], summary: "Poll for a person's decision", ok: { status: 200, schema: ActionStatusResponseSchema, description: "Current status" }, errors: [401, 404] },
  {
    method: "post", path: "/api/mock-agents/{id}/decide", tag: "Agent API", auth: "signature", params: ["id"],
    summary: "Built-in mock agent (webhook contract)",
    description: "Reference implementation of the webhook contract Control Room uses for replays: POST {subject} signed with X-ControlRoom-Timestamp and X-ControlRoom-Signature (sha256 HMAC of `<timestamp>.<body>`). Responds with the agent's decision.",
    body: z.object({ mode: z.literal("replay"), workflow_type: z.literal("ap_invoice"), subject: InvoiceSubjectSchema }),
    ok: { status: 200, schema: AgentAnswerSchema, description: "Agent decision" }, errors: [401, 404, 422],
  },
  // ---- Session
  { method: "post", path: "/api/auth/login", tag: "Session", auth: "none", summary: "Sign in", body: LoginSchema, ok: { status: 200, schema: Any("Signed-in user; sets the cr_session cookie"), description: "Signed in" }, errors: [401, 422] },
  { method: "post", path: "/api/auth/logout", tag: "Session", auth: "none", summary: "Sign out", ok: { status: 200, description: "Cookie cleared" } },
  // ---- Actions & review
  { method: "get", path: "/api/actions", tag: "Actions & review", auth: "session", summary: "List actions (filters shared with scorecard drill-downs)", query: ActionFilterSchema, ok: { status: 200, schema: Any("{ rows, total, totalAmountMinor, page, pageSize }"), description: "Page of actions" }, errors: [401, 403, 422] },
  { method: "get", path: "/api/actions/{id}", tag: "Actions & review", auth: "session", params: ["id"], summary: "Action detail with rule results, review and audit records", ok: { status: 200, schema: Any("{ action, audit, canReview }"), description: "Action" }, errors: [401, 404] },
  { method: "post", path: "/api/actions/{id}/review", tag: "Actions & review", auth: "session", params: ["id"], summary: "Approve or reject a queued action (reason required)", body: ReviewSchema, ok: { status: 201, schema: Any("{ review, audit: { seq, hash } }"), description: "Decision recorded" }, errors: [401, 403, 404, 409, 422] },
  { method: "get", path: "/api/review-queue", tag: "Actions & review", auth: "session", summary: "Invoices waiting for a person, and shadow-mode spot checks", ok: { status: 200, schema: Any("{ pending, spotChecks }"), description: "Queue" }, errors: [401] },
  // ---- Rules
  { method: "get", path: "/api/rules", tag: "Rules", auth: "session", summary: "List a workflow's rules with version history", query: z.object({ workflowId: z.string() }), ok: { status: 200, schema: Any("{ rules }"), description: "Rules" }, errors: [400, 401] },
  { method: "post", path: "/api/rules", tag: "Rules", auth: "session", summary: "Add a custom-condition rule", body: CreateRuleSchema, ok: { status: 201, schema: Any("{ rule }"), description: "Created" }, errors: [400, 401, 403, 404, 422] },
  { method: "put", path: "/api/rules/{id}", tag: "Rules", auth: "session", params: ["id"], summary: "Edit a rule (writes a new version; effective on the next evaluate call)", body: UpdateRuleSchema, ok: { status: 200, schema: Any("{ rule, version }"), description: "New version" }, errors: [400, 401, 403, 404, 422] },
  // ---- Autonomy
  { method: "get", path: "/api/workflows/{id}/autonomy", tag: "Autonomy", auth: "session", params: ["id"], summary: "Level, rolling accuracy, promotion suggestion and history", ok: { status: 200, schema: Any("{ workflow, level, accuracy, promotion, history }"), description: "State" }, errors: [401, 404] },
  { method: "post", path: "/api/workflows/{id}/autonomy", tag: "Autonomy", auth: "session", params: ["id"], summary: "Change level (promotion needs the target met and a person to confirm)", body: ChangeLevelSchema, ok: { status: 200, schema: Any("{ workflow, change }"), description: "Changed" }, errors: [400, 401, 403, 404, 422] },
  { method: "patch", path: "/api/workflows/{id}", tag: "Autonomy", auth: "session", params: ["id"], summary: "Update auto-approve limit, confidence threshold and promotion settings", body: WorkflowSettingsSchema, ok: { status: 200, schema: Any("{ workflow }"), description: "Updated" }, errors: [401, 403, 404, 422] },
  { method: "put", path: "/api/workflows/{id}/connector", tag: "Settings", auth: "session", params: ["id"], summary: "Choose the system of record connector", body: ConnectorSchema, ok: { status: 200, schema: Any("{ workflow }"), description: "Updated" }, errors: [401, 403, 404, 422] },
  // ---- Replay
  { method: "get", path: "/api/replay/datasets", tag: "Replay testing", auth: "session", summary: "List replay sets and their comparisons", ok: { status: 200, schema: Any("{ datasets }"), description: "Sets" }, errors: [401] },
  {
    method: "post", path: "/api/replay/datasets", tag: "Replay testing", auth: "session", summary: "Upload past invoices (CSV + optional PDFs)", bodyType: "multipart",
    body: z.object({ csv: z.string().describe("CSV file: invoice_id, vendor, amount, currency, po_number, grn_number, invoice_date, correct_decision, correct_gl_code [, invoice_number]"), pdfs: z.array(z.string()).optional().describe("PDF files named <invoice_id>.pdf"), name: z.string().optional(), workflowId: z.string().optional() }),
    ok: { status: 201, schema: Any("{ dataset, imported, skipped, mix, warnings, pdfsAttached }"), description: "Imported" }, errors: [400, 401, 403],
  },
  { method: "post", path: "/api/replay/comparisons", tag: "Replay testing", auth: "session", summary: "Replay a set against 1–3 agents (runs in the background)", body: StartComparisonSchema, ok: { status: 202, schema: Any("{ comparison }"), description: "Queued" }, errors: [400, 401, 403, 404, 422] },
  { method: "get", path: "/api/replay/comparisons/{id}", tag: "Replay testing", auth: "session", params: ["id"], summary: "Progress and comparison report", ok: { status: 200, schema: Any("{ comparison, reports, done }"), description: "Report" }, errors: [401, 404] },
  // ---- Audit
  { method: "get", path: "/api/audit/verify", tag: "Audit", auth: "session", summary: "Verify the hash chain", ok: { status: 200, schema: Any("{ ok, checked, headSeq, headHash, verifiedAt, problems }"), description: "Verification result" }, errors: [401] },
  { method: "get", path: "/api/audit/records", tag: "Audit", auth: "session", summary: "List audit records", query: AuditFilterSchema, ok: { status: 200, schema: Any("{ rows, total, page, pageSize }"), description: "Records" }, errors: [401, 422] },
  {
    method: "get", path: "/api/audit/export", tag: "Audit", auth: "session", summary: "Download an evidence pack (ZIP)",
    description: "Scope with `actionId`, or with `from` and `to` (YYYY-MM-DD, inclusive) and optionally `vendor`. Contains summary.pdf, actions.csv, rule_results.csv, reviews.csv, audit_records.csv, chain_verification.json and manifest.json (SHA-256 of each file).",
    query: z.object({ actionId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), vendor: z.string().optional() }),
    ok: { status: 200, description: "ZIP file", contentType: "application/zip" }, errors: [400, 401, 403, 404, 422],
  },
  // ---- Scorecard
  { method: "get", path: "/api/scorecard", tag: "Scorecard", auth: "session", summary: "Weekly outcome scorecard with drill-down links", query: ScorecardQuerySchema, ok: { status: 200, schema: Any("{ currency, weeks, selected, previous, links }"), description: "Scorecard" }, errors: [401, 422] },
  // ---- Settings
  { method: "get", path: "/api/agents", tag: "Settings", auth: "session", summary: "List connected agents", ok: { status: 200, schema: Any("{ agents }"), description: "Agents" }, errors: [401, 403] },
  { method: "post", path: "/api/agents", tag: "Settings", auth: "session", summary: "Connect an agent (API key and signing secret returned once)", body: CreateAgentSchema, ok: { status: 201, schema: Any("{ agent, apiKey, signingSecret }"), description: "Created" }, errors: [401, 403, 422] },
  { method: "patch", path: "/api/agents/{id}", tag: "Settings", auth: "session", params: ["id"], summary: "Update an agent or rotate its key", body: UpdateAgentSchema, ok: { status: 200, schema: Any("{ agent, apiKey }"), description: "Updated" }, errors: [400, 401, 403, 404, 422] },
  { method: "get", path: "/api/vendors", tag: "Settings", auth: "session", summary: "Search the vendor master", query: z.object({ q: z.string().optional() }), ok: { status: 200, schema: Any("{ vendors }"), description: "Vendors" }, errors: [401, 403] },
  { method: "patch", path: "/api/vendors/{id}", tag: "Settings", auth: "session", params: ["id"], summary: "Block/unblock a vendor or record a bank detail change", body: UpdateVendorSchema, ok: { status: 200, schema: Any("{ vendor }"), description: "Updated" }, errors: [401, 403, 404, 422] },
  { method: "get", path: "/api/users", tag: "Settings", auth: "session", summary: "List users", ok: { status: 200, schema: Any("{ users }"), description: "Users" }, errors: [401, 403] },
  { method: "post", path: "/api/users", tag: "Settings", auth: "session", summary: "Add a user", body: CreateUserSchema, ok: { status: 201, schema: Any("{ user }"), description: "Created" }, errors: [401, 403, 409, 422] },
  { method: "patch", path: "/api/users/{id}", tag: "Settings", auth: "session", params: ["id"], summary: "Change a user's role or disable them", body: UpdateUserSchema, ok: { status: 200, schema: Any("{ user }"), description: "Updated" }, errors: [400, 401, 403, 404, 422] },
  { method: "get", path: "/api/openapi.json", tag: "Docs", auth: "none", summary: "This document", ok: { status: 200, schema: Any("OpenAPI 3 document"), description: "OpenAPI" } },
];

const ERROR_TEXT: Record<number, string> = {
  400: "The request could not be carried out (explained in the message)", 401: "Not signed in, or missing/invalid API key", 403: "Your role does not allow this",
  404: "Not found", 409: "Conflicts with the current state (e.g. already reviewed)", 422: "Some fields are missing or invalid",
};

export const DOCUMENTED_OPERATIONS = ops.map((o) => ({ method: o.method, path: o.path }));

let cached: ReturnType<OpenApiGeneratorV3["generateDocument"]> | null = null;

export function buildOpenApi() {
  if (cached) return cached;
  const registry = new OpenAPIRegistry();
  registry.register("Error", ErrorSchema);
  registry.registerComponent("securitySchemes", "agentKey", { type: "http", scheme: "bearer", description: "Agent API key (cr_live_…), from Settings → Agents" });
  registry.registerComponent("securitySchemes", "session", { type: "apiKey", in: "cookie", name: "cr_session", description: "Signed-in user session" });
  registry.registerComponent("securitySchemes", "webhookSignature", { type: "apiKey", in: "header", name: "X-ControlRoom-Signature", description: "sha256=<HMAC of `<timestamp>.<body>`> with the agent's signing secret; plus X-ControlRoom-Timestamp" });
  registry.register("EvaluateRequest", EvaluateRequestSchema);
  registry.register("EvaluateResponse", EvaluateResponseSchema);

  for (const o of ops) {
    const responses: Record<string, { description: string; content?: Record<string, { schema: z.ZodTypeAny | { type: string; format: string } }> }> = {
      [o.ok.status]: {
        description: o.ok.description,
        ...(o.ok.schema ? { content: { "application/json": { schema: o.ok.schema } } } : o.ok.contentType ? { content: { [o.ok.contentType]: { schema: { type: "string", format: "binary" } } } } : {}),
      },
    };
    for (const e of o.errors ?? []) responses[e] = { description: ERROR_TEXT[e], content: { "application/json": { schema: ErrorSchema } } };
    registry.registerPath({
      method: o.method,
      path: o.path,
      tags: [o.tag],
      summary: o.summary,
      description: o.description,
      security: o.auth === "agent" ? [{ agentKey: [] }] : o.auth === "session" ? [{ session: [] }] : o.auth === "signature" ? [{ webhookSignature: [] }] : [],
      request: {
        ...(o.params ? { params: z.object(Object.fromEntries(o.params.map((p) => [p, z.string()]))) } : {}),
        ...(o.query ? { query: o.query } : {}),
        ...(o.path === "/v1/actions/evaluate" ? { headers: z.object({ "idempotency-key": z.string().optional().describe("Makes retries safe: the same key returns the original result") }) } : {}),
        ...(o.body ? { body: { content: { [o.bodyType === "multipart" ? "multipart/form-data" : "application/json"]: { schema: o.body } } } } : {}),
      },
      responses: responses as never,
    });
  }
  cached = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Control Room API",
      version: "0.1.0",
      description: "Independent assurance for AI agents that act on money. Agents call the Agent API before acting; the rest of the API backs the Control Room app. Money is always integer minor units (cents) plus an ISO currency code.",
    },
    servers: [{ url: process.env.APP_URL ?? "http://localhost:3000" }],
    tags: ["Agent API", "Actions & review", "Rules", "Autonomy", "Replay testing", "Audit", "Scorecard", "Settings", "Session", "Docs"].map((name) => ({ name })),
  });
  return cached;
}
