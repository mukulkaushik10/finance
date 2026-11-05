import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// Field-level encryption for bank account numbers (AES-256-GCM), plus a keyed fingerprint so
// two records can be compared without decrypting. Set BANK_ENCRYPTION_KEY in production; it
// falls back to a key derived from SESSION_SECRET for local development.

function key(purpose: "enc" | "fp"): Buffer {
  const base = process.env.BANK_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!base || base.length < 32) throw new Error("BANK_ENCRYPTION_KEY (or SESSION_SECRET) must be set (32+ chars)");
  return createHash("sha256").update(`control-room:${purpose}:${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key("enc"), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", key("enc"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export const digitsOnly = (s: string) => s.replace(/[\s-]/g, "");

/** US ABA routing number: 9 digits with a weighted checksum (3, 7, 1). */
export function isValidRoutingNumber(routing: string): boolean {
  const r = digitsOnly(routing);
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** Same format the rule engine compares: "sha256:" + 32 hex chars. */
export function bankFingerprint(routing: string, account: string): string {
  return "sha256:" + createHmac("sha256", key("fp")).update(`${digitsOnly(routing)}:${digitsOnly(account)}`).digest("hex").slice(0, 32);
}

export function sealBankAccount(routing: string, account: string) {
  const acct = digitsOnly(account);
  return {
    routingNumber: digitsOnly(routing),
    accountLast4: acct.slice(-4),
    accountNumberEnc: encryptSecret(acct),
    fingerprint: bankFingerprint(routing, acct),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
