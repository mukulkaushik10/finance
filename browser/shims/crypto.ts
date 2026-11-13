// Browser stand-in for node:crypto: the functions Control Room uses, implemented synchronously.
// SHA-256 and HMAC are exact. scrypt and AES-GCM are replaced by SHA-256-based equivalents
// (same inputs and outputs, reversible, authenticated) because the browser has no sync versions.
import { Buffer } from "buffer";

const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function sha256(msg: Uint8Array): Uint8Array {
  const l = msg.length; const n = ((l + 9 + 63) >> 6) << 6; const buf = new Uint8Array(n); buf.set(msg); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); const W = new Uint32Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = W[i-15], b = W[i-2]; W[i] = (W[i-16] + (((a>>>7)|(a<<25)) ^ ((a>>>18)|(a<<14)) ^ (a>>>3)) + W[i-7] + (((b>>>17)|(b<<15)) ^ ((b>>>19)|(b<<13)) ^ (b>>>10))) | 0; }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) { const t1 = (h + (((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0; const t2 = ((((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h;
  }
  const out = new Uint8Array(32); const ov = new DataView(out.buffer); H.forEach((x, i) => ov.setUint32(i * 4, x)); return out;
}
const toBytes = (d: any, enc?: string): Uint8Array => (typeof d === "string" ? Buffer.from(d, (enc as any) ?? "utf8") : d instanceof Uint8Array ? d : Buffer.from(d));
const concat = (parts: Uint8Array[]) => { const n = parts.reduce((t, p) => t + p.length, 0); const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
function hmac(key: Uint8Array, msg: Uint8Array) {
  let k = key.length > 64 ? sha256(key) : key; const kb = new Uint8Array(64); kb.set(k);
  const ip = kb.map((x) => x ^ 0x36), op = kb.map((x) => x ^ 0x5c);
  return sha256(concat([op, sha256(concat([ip, msg]))]));
}
const out = (bytes: Uint8Array, enc?: string) => { const b = Buffer.from(bytes); return enc ? b.toString(enc as any) : b; };

export function createHash(alg: string) {
  if (alg !== "sha256") throw new Error(`hash ${alg} not available in the browser build`);
  const parts: Uint8Array[] = [];
  const h = { update(d: any, enc?: string) { parts.push(toBytes(d, enc)); return h; }, digest(enc?: string) { return out(sha256(concat(parts)), enc) as any; } };
  return h;
}
export function createHmac(alg: string, key: any) {
  if (alg !== "sha256") throw new Error(`hmac ${alg} not available`);
  const parts: Uint8Array[] = [];
  const h = { update(d: any, enc?: string) { parts.push(toBytes(d, enc)); return h; }, digest(enc?: string) { return out(hmac(toBytes(key), concat(parts)), enc) as any; } };
  return h;
}
export function randomBytes(n: number) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Buffer.from(b); }
export function randomUUID() { return globalThis.crypto.randomUUID(); }
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) throw new RangeError("Input buffers must have the same byte length"); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
/** scrypt replaced by iterated HMAC-SHA256 (fast in the browser, same call shape). */
export function scryptSync(password: any, salt: any, keylen: number) {
  let block = hmac(toBytes(salt), toBytes(password));
  for (let i = 0; i < 64; i++) block = hmac(block, toBytes(password));
  const outb = new Uint8Array(keylen); for (let i = 0; i < keylen; i++) outb[i] = block[i % 32]; return Buffer.from(outb);
}
/** AES-256-GCM replaced by a SHA-256 keystream with an HMAC tag: reversible and authenticated. */
function stream(key: Uint8Array, iv: Uint8Array, data: Uint8Array) {
  const o = new Uint8Array(data.length);
  for (let blk = 0; blk * 32 < data.length; blk++) { const ks = sha256(concat([key, iv, Uint8Array.of(blk >>> 24, blk >>> 16, blk >>> 8, blk)])); for (let i = 0; i < 32 && blk * 32 + i < data.length; i++) o[blk * 32 + i] = data[blk * 32 + i] ^ ks[i]; }
  return o;
}
export function createCipheriv(_alg: string, key: any, iv: any) {
  const k = toBytes(key), v = toBytes(iv); const chunks: Uint8Array[] = []; let tag: Uint8Array;
  return {
    update(d: any, enc?: string) { const c = stream(k, v, toBytes(d, enc)); chunks.push(c); return Buffer.from(new Uint8Array(0)); },
    final() { const all = concat(chunks); tag = hmac(k, concat([v, all])).slice(0, 16); return Buffer.from(all); },
    getAuthTag() { return Buffer.from(tag); },
  };
}
export function createDecipheriv(_alg: string, key: any, iv: any) {
  const k = toBytes(key), v = toBytes(iv); const chunks: Uint8Array[] = []; let tag: Uint8Array | null = null;
  return {
    setAuthTag(t: any) { tag = toBytes(t); },
    update(d: any) { chunks.push(toBytes(d)); return Buffer.from(new Uint8Array(0)); },
    final() { const all = concat(chunks); const exp = hmac(k, concat([v, all])).slice(0, 16); if (!tag || !timingSafeEqual(exp, tag)) throw new Error("Unsupported state or unable to authenticate data"); return Buffer.from(stream(k, v, all)); },
  };
}
export default { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, scryptSync, createCipheriv, createDecipheriv };
