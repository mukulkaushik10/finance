import { createHash } from "node:crypto";

/** Small deterministic PRNG (mulberry32) so seed data and mock agents are reproducible. */
export function rng(seed: string | number) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  };
}

export function hashSeed(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32LE(0);
}

/** A stable value in [0,1) for a given key, e.g. (agent seed, invoice id). */
export function unitHash(...parts: string[]): number {
  return hashSeed(parts.join("|")) / 4294967296;
}
