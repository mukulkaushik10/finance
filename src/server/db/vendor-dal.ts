import { rawPrisma } from "./client";

// Supplier-scoped data access, the mirror of forOrg(). `forVendor(vendorAccountId)` forces every
// query to the given supplier account: filters get `vendorAccountId` (or `id` for the account
// itself) added and writes get it stamped. Any model a supplier has no business reading
// (agents, rules, actions, audit records, other buyers' data) is refused outright.

const SCOPE_FIELD: Record<string, string> = {
  VendorAccount: "id",
  VendorUser: "vendorAccountId",
  VendorBankAccount: "vendorAccountId",
  VendorConnection: "vendorAccountId",
  BankDetailChange: "vendorAccountId",
  Invoice: "vendorAccountId",
  InvoiceLine: "vendorAccountId",
  InvoiceEvent: "vendorAccountId",
  InvoiceMessage: "vendorAccountId",
};

const READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany",
]);

export function forVendor(vendorAccountId: string) {
  if (!vendorAccountId) throw new Error("forVendor requires a vendorAccountId");
  return rawPrisma.$extends({
    name: "supplier-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const field = SCOPE_FIELD[model];
          if (!field) throw new Error(`Suppliers can't access ${model}`);
          const a = (args ?? {}) as Record<string, unknown>;
          const explicit = (a.where as Record<string, unknown> | undefined)?.[field];
          if (explicit !== undefined && explicit !== vendorAccountId) {
            throw new Error(`Cross-supplier query blocked on ${model}.${operation}`);
          }
          if (READ_OPS.has(operation)) a.where = { ...((a.where as object) ?? {}), [field]: vendorAccountId };
          if (operation === "create" && field !== "id") a.data = { ...(a.data as object), [field]: vendorAccountId };
          if (operation === "createMany" || operation === "createManyAndReturn") {
            const data = a.data as object | object[];
            a.data = Array.isArray(data) ? data.map((d) => ({ ...d, [field]: vendorAccountId })) : { ...data, [field]: vendorAccountId };
          }
          if (operation === "upsert") {
            a.where = { ...((a.where as object) ?? {}), [field]: vendorAccountId };
            a.create = { ...(a.create as object), [field]: vendorAccountId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type VendorDb = ReturnType<typeof forVendor>;
