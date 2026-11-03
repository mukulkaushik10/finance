import { describe, expect, it } from "vitest";
import { diffBps, formatMoney, parseMoney, withinTolerance } from "@/lib/money";
import { canonicalJson } from "@/server/audit/canonical";
import { computeHash, GENESIS_HASH } from "@/server/audit/chain";
import { generateInvoices, generateVendors } from "@/server/seed/generator";

describe("money", () => {
  it("parses decimal strings to minor units without floats", () => {
    expect(parseMoney("1,234.56", "USD")).toBe(123456n);
    expect(parseMoney("0.1", "USD")).toBe(10n);
    expect(parseMoney("12", "USD")).toBe(1200n);
    expect(parseMoney("$99.90", "USD")).toBe(9990n);
    expect(parseMoney("1500", "JPY")).toBe(1500n);
    expect(parseMoney("-3.5", "EUR")).toBe(-350n);
    expect(parseMoney("12.500", "USD")).toBe(1250n);
    expect(parseMoney("90071992547409.93", "USD")).toBe(9007199254740993n); // beyond float precision
  });
  it("rejects invalid amounts and excess precision", () => {
    expect(() => parseMoney("12.345", "USD")).toThrow();
    expect(() => parseMoney("abc", "USD")).toThrow();
    expect(() => parseMoney("1.5", "JPY")).toThrow();
  });
  it("formats", () => {
    expect(formatMoney(123456n, "USD")).toBe("$1,234.56");
    expect(formatMoney(-5n, "USD")).toBe("-$0.05");
    expect(formatMoney(1500n, "JPY")).toBe("¥1,500");
    expect(formatMoney(123_456_789n, "USD", { compact: true })).toBe("$1.2M");
    expect(formatMoney(4_550_000n, "USD", { compact: true })).toBe("$45.5k");
  });
  it("tolerance maths is exact", () => {
    expect(withinTolerance(105_000n, 100_000n, 500)).toBe(true);
    expect(withinTolerance(105_001n, 100_000n, 500)).toBe(false);
    expect(diffBps(112_000n, 100_000n)).toBe(1200n);
  });
});

describe("audit hashing", () => {
  it("canonical JSON ignores key order and serialises bigint/Date", () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: new Date("2026-01-01T00:00:00Z") } })).toBe('{"a":{"c":"2026-01-01T00:00:00.000Z","d":"2"},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("hash changes when any field changes", () => {
    const rec = { organisationId: "o", seq: 1, eventType: "e", entityType: "action", entityId: "a", actorType: "user", actorId: "u", occurredAt: new Date(0), payload: { amount: "100" }, prevHash: GENESIS_HASH };
    const h = computeHash(rec);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash({ ...rec, payload: { amount: "101" } })).not.toBe(h);
    expect(computeHash({ ...rec, prevHash: "1".repeat(64) })).not.toBe(h);
    expect(computeHash({ ...rec, occurredAt: rec.occurredAt.toISOString() })).toBe(h);
  });
});

describe("seed generator", () => {
  it("is deterministic and has the planned error mix", () => {
    const v = generateVendors();
    const opts = { seed: "replay-v1", count: 1000, start: new Date("2026-06-01"), end: new Date("2026-09-30"), idPrefix: "INV", poStart: 40000, includeBankFingerprint: false };
    const a = generateInvoices(v, opts);
    const b = generateInvoices(v, opts);
    expect(a.invoices.map((i) => i.subject.invoice_id)).toEqual(b.invoices.map((i) => i.subject.invoice_id));
    expect(a.invoices).toHaveLength(1000);
    const count = (k: string) => a.invoices.filter((i) => i.anomaly === k).length;
    expect(count("duplicate")).toBe(60);
    expect(count("bank_changed")).toBeGreaterThanOrEqual(8);
    expect(count("over_limit")).toBeGreaterThan(30);
    expect(count("po_mismatch")).toBeGreaterThan(40);
    expect(count("blocked_vendor")).toBeGreaterThan(10);
    expect(new Set(a.invoices.map((i) => i.subject.invoice_id)).size).toBe(1000);
  });
});
