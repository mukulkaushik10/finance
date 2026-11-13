// Minimal POSIX path module for the browser build.
const normalize = (p: string) => { const abs = p.startsWith("/"); const out: string[] = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); } return (abs ? "/" : "") + out.join("/"); };
export const join = (...ps: string[]) => normalize(ps.filter(Boolean).join("/"));
export const resolve = (...ps: string[]) => { let r = ""; for (const p of ps) r = p.startsWith("/") ? p : r + "/" + p; return normalize(r.startsWith("/") ? r : "/app/" + r); };
export const dirname = (p: string) => { const n = normalize(p); const i = n.lastIndexOf("/"); return i <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, i); };
export const basename = (p: string, ext?: string) => { const b = normalize(p).split("/").pop() ?? ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p: string) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
export const sep = "/";
export default { join, resolve, dirname, basename, extname, sep };
