import { PrismaClient } from "@prisma/client";

// Raw, UNSCOPED Prisma client. Only the data-access layer (dal.ts), the audit chain,
// background workers and seed/maintenance scripts may import this file.
// Everything else must use `forOrg(organisationId)` from ./dal.

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const rawPrisma: PrismaClient =
  globalForPrisma.__prisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = rawPrisma;
