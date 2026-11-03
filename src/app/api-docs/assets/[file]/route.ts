import { readFile } from "node:fs/promises";
import path from "node:path";

// Serve Swagger UI's static files from node_modules (no CDN needed).
const ALLOWED: Record<string, string> = {
  "swagger-ui.css": "text/css",
  "swagger-ui-bundle.js": "application/javascript",
};

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const type = ALLOWED[file];
  if (!type) return new Response("Not found", { status: 404 });
  const body = await readFile(path.join(process.cwd(), "node_modules", "swagger-ui-dist", file));
  return new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
}
