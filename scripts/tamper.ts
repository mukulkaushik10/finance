// DEMO ONLY: simulate someone with direct database access quietly editing an audit record,
// to show that "Verify chain" catches it.
//
//   npm run tamper                 # change the amount on the most recent reviewed invoice's record
//   npm run tamper -- --seq 42     # tamper with a specific record number
//   npm run tamper -- --restore    # put the original back (from the backup this script wrote)
//
// The audit table rejects UPDATE through normal means (database trigger). A superuser can still
// bypass triggers with session_replication_role = replica; that is exactly the threat the hash
// chain exists to detect.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
if (existsSync(".env")) process.loadEnvFile(".env");
const { rawPrisma } = await import("../src/server/db/client");
const { verifyChain } = await import("../src/server/audit/chain");
const { DEMO } = await import("../src/server/seed/demo");

const orgId = process.env.ORG_ID ?? DEMO.orgId;
const backupFile = path.join(process.env.STORAGE_DIR ?? "./storage", "tamper-backup.json");
const args = process.argv.slice(2);

async function asSuperuser(sql: string, ...params: unknown[]) {
  await rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(sql, ...params);
  });
}

if (args.includes("--restore")) {
  if (!existsSync(backupFile)) { console.log("Nothing to restore."); process.exit(0); }
  const b = JSON.parse(readFileSync(backupFile, "utf8"));
  await asSuperuser(`UPDATE "AuditRecord" SET payload = $1::jsonb WHERE id = $2`, JSON.stringify(b.payload), b.id);
  console.log(`Restored audit record #${b.seq}.`);
} else {
  const seqArg = args.indexOf("--seq");
  const record = seqArg >= 0
    ? await rawPrisma.auditRecord.findFirst({ where: { organisationId: orgId, seq: Number(args[seqArg + 1]) } })
    : await rawPrisma.auditRecord.findFirst({ where: { organisationId: orgId, eventType: "action.evaluated" }, orderBy: { seq: "desc" }, skip: 5 });
  if (!record) { console.error("No audit record found."); process.exit(1); }
  mkdirSync(path.dirname(backupFile), { recursive: true });
  writeFileSync(backupFile, JSON.stringify({ id: record.id, seq: record.seq, payload: record.payload }));
  const payload = record.payload as any;
  if (payload?.inputs?.amount) payload.inputs.amount.minor = Math.floor(payload.inputs.amount.minor / 10);
  else payload.tampered = true;
  await asSuperuser(`UPDATE "AuditRecord" SET payload = $1::jsonb WHERE id = $2`, JSON.stringify(payload), record.id);
  console.log(`Edited audit record #${record.seq} (${record.eventType}) directly in the database${payload?.inputs?.amount ? ": invoice amount cut to a tenth" : ""}.`);
}

const v = await verifyChain(orgId);
console.log(v.ok ? `Verify chain: PASSED (${v.checked} records)` : `Verify chain: FAILED\n  ${v.problems.map((p) => p.problem).join("\n  ")}`);
await rawPrisma.$disconnect();
