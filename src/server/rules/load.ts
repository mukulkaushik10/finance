import type { OrgDb } from "../db/dal";
import type { ActiveRule } from "./types";

/** Load the current version of every rule in a workflow, straight from the database (no caching). */
export async function loadActiveRules(db: OrgDb, workflowId: string): Promise<ActiveRule[]> {
  const rules = await db.rule.findMany({
    where: { workflowId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  return rules
    .filter((r) => r.versions.length)
    .map((r) => {
      const v = r.versions[0];
      return {
        ruleId: r.id, ruleVersionId: v.id, version: v.version, name: r.name, type: r.type,
        severity: v.severity, enabled: v.enabled, params: v.params,
      };
    });
}
