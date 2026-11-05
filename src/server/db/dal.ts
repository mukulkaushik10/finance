import { Prisma } from "@prisma/client";
import { rawPrisma } from "./client";

// Tenant-scoped data access. `forOrg(orgId)` returns a Prisma client whose every query on a
// tenant model is forced to the given organisation: filters get `organisationId` added, and
// writes get it stamped. A query that tries to target another organisation's row simply
// finds nothing.

const UNSCOPED_MODELS = new Set(["Organisation"]);
// Supplier-owned models have no organisationId: buyer code may only reach them through
// relations (include/select) of a connection, invoice or bank change, never directly.
const SUPPLIER_ONLY_MODELS = new Set(["VendorAccount", "VendorUser", "VendorBankAccount"]);

const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany",
]);

export function forOrg(organisationId: string) {
  if (!organisationId) throw new Error("forOrg requires an organisationId");
  return rawPrisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (UNSCOPED_MODELS.has(model)) return query(args);
          if (SUPPLIER_ONLY_MODELS.has(model)) throw new Error(`${model} belongs to a supplier account; buyer code can't query it directly`);
          const a = (args ?? {}) as Record<string, unknown>;
          const explicit = (a.where as { organisationId?: unknown } | undefined)?.organisationId;
          if (explicit !== undefined && explicit !== organisationId) {
            throw new Error(`Cross-tenant query blocked on ${model}.${operation}`);
          }
          if (READ_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), organisationId };
          }
          if (operation === "create") {
            a.data = { ...(a.data as object), organisationId };
          }
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const data = a.data as object | object[];
            a.data = Array.isArray(data) ? data.map((d) => ({ ...d, organisationId })) : { ...data, organisationId };
          }
          if (operation === "upsert") {
            a.where = { ...((a.where as object) ?? {}), organisationId };
            a.create = { ...(a.create as object), organisationId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type OrgDb = ReturnType<typeof forOrg>;
export type Tx = Omit<OrgDb, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
export { Prisma };
