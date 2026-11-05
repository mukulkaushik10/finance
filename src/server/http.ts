import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";

/** JSON response that serialises bigint as number (safe for amounts up to 9e15 minor units). */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = JSON.stringify(data, (_k, v) => {
    if (typeof v === "bigint") {
      if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return v.toString();
      return Number(v);
    }
    return v;
  });
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
  if (e instanceof ZodError) {
    return json({
      error: {
        code: "validation_failed",
        message: "Some fields are missing or invalid",
        details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    }, 422);
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    return json({ error: { code: "not_found", message: "Record not found" } }, 404);
  }
  if (e instanceof Prisma.PrismaClientInitializationError) {
    console.error(e);
    return json({
      error: {
        code: "database_unavailable",
        message: "The database isn't running. In a terminal, run: bash scripts/codespace-start.sh",
      },
    }, 503);
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022")) {
    console.error(e);
    return json({
      error: {
        code: "database_not_set_up",
        message: "The database has no tables or demo data yet. In a terminal, run: npm run setup",
      },
    }, 503);
  }
  console.error(e);
  return json({ error: { code: "internal_error", message: "Something went wrong" } }, 500);
}

type Handler<P> = (req: Request, params: P) => Promise<Response>;

/** Wrap a route handler: resolves Next's async params and turns thrown errors into JSON responses. */
export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const params = ((ctx?.params ? await ctx.params : {}) ?? {}) as P;
      return await handler(req, params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "Request body must be valid JSON");
  }
}
