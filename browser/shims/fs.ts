// In-memory file system for the browser build (seed CSV, stored uploads, evidence files).
export const files = new Map<string, Uint8Array>();
const norm = (p: string) => p.replace(/\/+/g, "/");
const bytes = (d: any) => (typeof d === "string" ? new TextEncoder().encode(d) : d instanceof Uint8Array ? new Uint8Array(d) : new TextEncoder().encode(String(d)));
export function writeFileSync(p: string, d: any) { files.set(norm(p), bytes(d)); }
export function readFileSync(p: string, enc?: string) { const b = files.get(norm(p)); if (!b) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: "ENOENT" }); return enc ? new TextDecoder().decode(b) : b; }
export function existsSync(p: string) { return files.has(norm(p)); }
export function mkdirSync() {}
export const promises = {
  async writeFile(p: string, d: any) { writeFileSync(p, d); },
  async readFile(p: string, enc?: string) { const r = readFileSync(p, enc); return typeof r === "string" ? r : (await import("buffer")).Buffer.from(r); },
  async mkdir() {},
};
export const writeFile = promises.writeFile, readFile = promises.readFile, mkdir = promises.mkdir;
export default { writeFileSync, readFileSync, existsSync, mkdirSync, promises };
