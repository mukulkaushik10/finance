// Canonical JSON: keys sorted recursively, no whitespace. bigint -> string, Date -> ISO string.
// We store exactly the sanitised value we hash, so a round-trip through Postgres jsonb
// (which reorders keys) still hashes identically.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function toJsonSafe(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = toJsonSafe(v);
    }
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number in audit payload");
    return value;
  }
  return value as string | boolean;
}

export function canonicalJson(value: unknown): string {
  const v = toJsonSafe(value);
  return stringify(v);
}

function stringify(v: JsonValue): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stringify(v[k])).join(",") + "}";
}
