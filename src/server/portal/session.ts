import { SignJWT, jwtVerify } from "jose";
import type { VendorUserRole } from "@prisma/client";
import { rawPrisma } from "../db/client";
import { readCookie } from "../auth/session";
import { unauthorized } from "../errors";

// Supplier sessions are separate from staff sessions: a different cookie and a token type
// that the staff session check refuses (and vice versa), so a supplier can never reach
// the buyer's screens or APIs.

export const VENDOR_SESSION_COOKIE = "cr_supplier_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;
const TOKEN_TYPE = "supplier";

export interface VendorCtx {
  vendorAccountId: string;
  accountName: string;
  user: { id: string; name: string; email: string; role: VendorUserRole };
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function createVendorSessionToken(vendorUserId: string): Promise<string> {
  return new SignJWT({ vuid: vendorUserId, typ: TOKEN_TYPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export function vendorSessionCookieHeader(token: string, maxAge = MAX_AGE_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${VENDOR_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function vendorCtxFromToken(token: string | undefined | null): Promise<VendorCtx | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.typ !== TOKEN_TYPE || typeof payload.vuid !== "string") return null;
    const user = await rawPrisma.vendorUser.findUnique({ where: { id: payload.vuid }, include: { vendorAccount: true } });
    if (!user || !user.active) return null;
    return {
      vendorAccountId: user.vendorAccountId,
      accountName: user.vendorAccount.legalName,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  } catch {
    return null;
  }
}

export async function requireVendorCtx(req: Request): Promise<VendorCtx> {
  const ctx = await vendorCtxFromToken(readCookie(req.headers.get("cookie"), VENDOR_SESSION_COOKIE));
  if (!ctx) throw unauthorized();
  return ctx;
}
