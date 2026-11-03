import { createHash, randomBytes } from "node:crypto";
import type { Agent } from "@prisma/client";
import { rawPrisma } from "../db/client";
import { unauthorized } from "../errors";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `cr_live_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, 12) };
}

export function generateSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** Authenticate an agent from `Authorization: Bearer <key>`. The key identifies the organisation. */
export async function authenticateAgent(req: Request): Promise<Agent> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) throw unauthorized("Missing agent API key (Authorization: Bearer <key>)");
  const agent = await rawPrisma.agent.findUnique({ where: { apiKeyHash: hashApiKey(m[1]) } });
  if (!agent || !agent.active) throw unauthorized("Unknown or disabled agent API key");
  return agent;
}
