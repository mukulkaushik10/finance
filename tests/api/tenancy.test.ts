import { beforeAll, describe, expect, it } from "vitest";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { DEMO, seedBase } from "@/server/seed/demo";
import { hashPassword } from "@/server/auth/password";

const OTHER = "org_other";

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed" });
  await rawPrisma.organisation.create({ data: { id: OTHER, name: "Other Co" } });
  await forOrg(OTHER).vendor.create({
    data: { organisationId: OTHER, code: "V-0001", name: "Other Co Vendor", category: "x", defaultGlCode: "1", bankFingerprint: "f" },
  });
  await forOrg(OTHER).user.create({
    data: { organisationId: OTHER, email: "x@other.example", name: "X", role: "admin", passwordHash: hashPassword("x") },
  });
});

describe("tenant isolation in the data-access layer", () => {
  it("scopes reads to the organisation", async () => {
    expect(await forOrg(OTHER).vendor.count()).toBe(1);
    expect(await forOrg(DEMO.orgId).vendor.count()).toBe(120);
    const v = await forOrg(DEMO.orgId).vendor.findFirst({ where: { name: "Other Co Vendor" } });
    expect(v).toBeNull();
  });

  it("cannot be tricked by an explicit organisationId filter", async () => {
    await expect(forOrg(DEMO.orgId).vendor.findMany({ where: { organisationId: OTHER } })).rejects.toThrow(/Cross-tenant/);
  });

  it("findUnique by id does not cross organisations", async () => {
    const other = await rawPrisma.vendor.findFirstOrThrow({ where: { organisationId: OTHER } });
    expect(await forOrg(DEMO.orgId).vendor.findUnique({ where: { id: other.id } })).toBeNull();
  });

  it("stamps organisationId on create, even if a different one is passed", async () => {
    const created = await forOrg(OTHER).vendor.create({
      data: { organisationId: DEMO.orgId, code: "V-0002", name: "Sneaky", category: "x", defaultGlCode: "1", bankFingerprint: "f" },
    });
    expect(created.organisationId).toBe(OTHER);
  });

  it("updates and deletes cannot touch another organisation's rows", async () => {
    const other = await rawPrisma.vendor.findFirstOrThrow({ where: { organisationId: OTHER, code: "V-0001" } });
    const res = await forOrg(DEMO.orgId).vendor.updateMany({ where: { id: other.id }, data: { name: "hacked" } });
    expect(res.count).toBe(0);
    await expect(forOrg(DEMO.orgId).vendor.update({ where: { id: other.id }, data: { name: "hacked" } })).rejects.toThrow();
  });

  it("the audit trail rejects UPDATE and DELETE at the database level", async () => {
    await expect(rawPrisma.$executeRawUnsafe(`UPDATE "AuditRecord" SET "eventType" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(rawPrisma.$executeRawUnsafe(`DELETE FROM "AuditRecord"`)).rejects.toThrow(/append-only/);
    await expect(rawPrisma.$executeRawUnsafe(`UPDATE "RuleVersion" SET "enabled" = false`)).rejects.toThrow(/immutable/);
  });
});
