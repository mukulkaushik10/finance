import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rawPrisma } from "../db/client";
import { forOrg } from "../db/dal";
import { hashPassword } from "../auth/password";
import { hashApiKey } from "../agents/keys";
import { createDefaultRules } from "../rules/service";
import { appendAudit } from "../audit/chain";
import { generateInvoices, generateVendors, toCsv, type GenGRN, type GenPO } from "./generator";

export const DEMO = {
  orgId: "org_demo",
  workflowId: "wf_ap_main",
  password: "demo1234",
  users: {
    admin: { id: "usr_admin", email: "admin@harborpine.example", name: "Alex Morgan", role: "admin" as const },
    controller: { id: "usr_controller", email: "controller@harborpine.example", name: "Dana Whitfield", role: "controller" as const },
    auditor: { id: "usr_auditor", email: "auditor@harborpine.example", name: "Sam Okafor", role: "auditor" as const },
  },
  agents: {
    cautious: {
      id: "agt_cautious", name: "Cautious Co. AP Agent", vendorName: "Cautious Co.",
      apiKey: "cr_demo_cautious_0000000000000000000000", signingSecret: "whsec_demo_cautious",
      mockConfig: { profile: "cautious", errorRate: 0.07, seed: "cautious-v1" }, costPerActionMinor: 4n, version: "2.3.0",
    },
    fastpay: {
      id: "agt_fastpay", name: "Fast-Pay AI", vendorName: "FastPay Labs",
      apiKey: "cr_demo_fastpay_00000000000000000000000", signingSecret: "whsec_demo_fastpay",
      mockConfig: { profile: "fast_pay", errorRate: 0.06, seed: "fastpay-v1" }, costPerActionMinor: 2n, version: "0.9.4",
    },
  },
  replay: { seed: "replay-v1", count: 1000, start: "2026-06-01", end: "2026-09-30" },
};

const TABLES = [
  "InvoiceMessage", "InvoiceEvent", "InvoiceLine", "Invoice", "BankDetailChange", "VendorConnection",
  "VendorBankAccount", "VendorUser", "VendorAccount", "OrganisationBankAccount",
  "AuditRecord", "ReplayResult", "ReplayRun", "ReplayComparison", "ReplayCase", "ReplayDataset", "Review", "RuleResult",
  "Action", "RuleVersion", "Rule", "AutonomyChange", "Workflow", "Agent", "GoodsReceipt", "PurchaseOrder", "Vendor",
  "StoredFile", "User", "Organisation",
];

export async function resetDatabase() {
  // TRUNCATE does not fire the row-level append-only triggers; this is a dev/test reset only.
  await rawPrisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await rawPrisma.$executeRawUnsafe(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN EXECUTE 'TRUNCATE pgboss.job'; END IF; END $$`).catch(() => {});
}

export interface SeedResult {
  csvPath: string;
  csv: string;
  counts: Record<string, number>;
}

/** Base demo data: organisation, users, vendor master, POs/GRNs, two mock agents, workflow + default rules. */
export async function seedBase(opts: { csvDir?: string; level?: number } = {}): Promise<SeedResult> {
  await resetDatabase();
  const orgId = DEMO.orgId;
  await rawPrisma.organisation.create({ data: { id: orgId, name: "Harbor & Pine Manufacturing", baseCurrency: "USD" } });
  const db = forOrg(orgId);

  const pw = hashPassword(DEMO.password);
  for (const u of Object.values(DEMO.users)) {
    await db.user.create({ data: { id: u.id, organisationId: orgId, email: u.email, name: u.name, role: u.role, passwordHash: pw } });
  }

  const vendors = generateVendors();
  await db.vendor.createMany({ data: vendors.map((v) => ({ organisationId: orgId, ...v })) });

  const replay = generateInvoices(vendors, {
    seed: DEMO.replay.seed, count: DEMO.replay.count,
    start: new Date(DEMO.replay.start + "T00:00:00Z"), end: new Date(DEMO.replay.end + "T00:00:00Z"),
    idPrefix: "INV", poStart: 40000, includeBankFingerprint: false,
  });
  // The replay set is past invoices, so their purchase orders are already billed and closed.
  await insertPoGrn(orgId, replay.pos.map((p) => ({ ...p, closedAt: new Date(DEMO.replay.end + "T00:00:00Z") })), replay.grns);

  for (const a of Object.values(DEMO.agents)) {
    await db.agent.create({
      data: {
        id: a.id, organisationId: orgId, name: a.name, vendorName: a.vendorName, kind: "mock",
        signingSecret: a.signingSecret, apiKeyHash: hashApiKey(a.apiKey), apiKeyPrefix: a.apiKey.slice(0, 12),
        version: a.version, mockConfig: a.mockConfig, costPerActionMinor: a.costPerActionMinor, costCurrency: "USD",
      },
    });
  }

  await db.$transaction(async (tx) => {
    await tx.workflow.create({
      data: {
        id: DEMO.workflowId, organisationId: orgId, type: "ap_invoice", name: "Accounts payable — invoice approval",
        autonomyLevel: opts.level ?? 1, autoApproveLimitMinor: 500_000n, currency: "USD", confidenceThresholdBps: 8500,
        promotionWindow: 50, promotionTargetBps: 9500, erpConnector: "fake_quickbooks", primaryAgentId: DEMO.agents.cautious.id,
      },
    });
    await appendAudit(tx, orgId, {
      eventType: "workflow.settings_changed", entityType: "workflow", entityId: DEMO.workflowId, actorType: "system", actorId: "seed",
      payload: { created: true, autonomyLevel: opts.level ?? 1, autoApproveLimitMinor: 500_000n, confidenceThresholdBps: 8500 },
    });
    await createDefaultRules(tx, orgId, DEMO.workflowId, { type: "system", id: "seed" });
  }, { timeout: 30_000 });

  const csv = toCsv(replay.invoices);
  const dir = opts.csvDir ?? path.join(process.cwd(), "seed");
  mkdirSync(dir, { recursive: true });
  const csvPath = path.join(dir, "invoices.csv");
  writeFileSync(csvPath, csv);

  return {
    csvPath, csv,
    counts: { vendors: vendors.length, purchaseOrders: replay.pos.length, goodsReceipts: replay.grns.length, replayInvoices: replay.invoices.length },
  };
}

export async function insertPoGrn(orgId: string, pos: (GenPO & { closedAt?: Date })[], grns: GenGRN[]) {
  const db = forOrg(orgId);
  for (let i = 0; i < pos.length; i += 1000) {
    await db.purchaseOrder.createMany({ data: pos.slice(i, i + 1000).map((p) => ({ organisationId: orgId, ...p })) });
  }
  for (let i = 0; i < grns.length; i += 1000) {
    await db.goodsReceipt.createMany({ data: grns.slice(i, i + 1000).map((g) => ({ organisationId: orgId, ...g })) });
  }
}
