// Runs the app's real seed scripts against the in-memory database and saves the result,
// so the browser build opens with exactly the hosted app's demo data.
import { seedBase, DEMO } from "@/server/seed/demo";
import { seedLiveHistory } from "@/server/seed/live-history";
import { seedPortal } from "@/server/seed/portal";
import { createDataset } from "@/server/replay/service";
import { dumpStore } from "./shims/prisma";
import { files } from "./shims/fs";

const out = process.argv[2];
const t0 = Date.now();
const base = await seedBase({ csvDir: "/app/seed" });
const live = await seedLiveHistory();
const portal = await seedPortal();
// The replay set is uploaded once so replays can run straight away (in the hosted app you upload seed/invoices.csv yourself).
const dana = DEMO.users.controller;
await createDataset({ organisationId: DEMO.orgId, user: { id: dana.id, name: dana.name, email: dana.email, role: dana.role } }, DEMO.workflowId, { name: "invoices.csv", csvText: base.csv });
const fsDump = Object.fromEntries([...files.entries()].map(([k, v]) => [k, Buffer.from(v).toString("base64")]));
(globalThis as any).__realFs.writeFileSync(out, JSON.stringify({ db: JSON.parse(dumpStore()), files: fsDump, seededAt: new Date().toISOString() }));
console.log("snapshot", { ...base.counts, ...live, ...portal, ms: Date.now() - t0 });
