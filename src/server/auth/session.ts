import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { rawPrisma } from "../db/client";
import { can, type Permission } from "./permissions";
import { forbidden, unauthorized } from "../errors";

// Session handling sits behind this small surface so SSO (OIDC/SAML) can replace the
// password login later without touching callers: everything downstream only sees `Ctx`.

export const SESSION_COOKIE = "cr_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface Ctx {
  organisationId: string;
  user: { id: string; name: string; email: string; role: Role };
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export function sessionCookieHeader(token: string, maxAge = MAX_AGE_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function ctxFromToken(token: string | undefined | null): Promise<Ctx | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const user = await rawPrisma.user.findUnique({ where: { id: String(payload.uid) } });
    if (!user || !user.active) return null;
    return { organisationId: user.organisationId, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function ctxFromRequest(req: Request): Promise<Ctx | null> {
  return ctxFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export async function requireCtx(req: Request, permission?: Permission): Promise<Ctx> {
  const ctx = await ctxFromRequest(req);
  if (!ctx) throw unauthorized();
  if (permission) requirePermission(ctx, permission);
  return ctx;
}

export function requirePermission(ctx: Ctx, permission: Permission) {
  if (!can(ctx.user.role, permission)) throw forbidden();
}
