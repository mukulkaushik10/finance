// Builds the single-file browser version of Control Room (docs/control-room-prototype.html):
// the real app's pages, components, API route handlers and services, bundled with an
// in-memory database and seeded with the real seed scripts.
import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");
const B = (p) => path.join(root, "browser", p);
const gen = B("generated");
mkdirSync(gen, { recursive: true });

// 0. Schema metadata (models, fields, relations, defaults) for the in-memory database
{
  const { createRequire } = await import("node:module");
  const { Prisma } = createRequire(import.meta.url)("@prisma/client");
  const pick = (f) => ({ name: f.name, kind: f.kind, type: f.type, isList: f.isList, isId: f.isId, isUnique: f.isUnique, isRequired: f.isRequired, isUpdatedAt: f.isUpdatedAt, hasDefaultValue: f.hasDefaultValue, default: f.default, relationName: f.relationName, relationFromFields: f.relationFromFields, relationToFields: f.relationToFields });
  writeFileSync(path.join(gen, "dmmf.json"), JSON.stringify(Prisma.dmmf.datamodel.models.map((m) => ({ name: m.name, fields: m.fields.map(pick), uniqueFields: m.uniqueFields }))));
}

// 1. Route table from src/app (pages, layouts, API routes)
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const appDir = path.join(root, "src/app");
const all = walk(appDir).map((p) => path.relative(appDir, p));
const toPattern = (rel) => {
  const segs = path.dirname(rel).split(path.sep).filter((s) => s !== "." && !/^\(.*\)$/.test(s));
  const keys = []; const re = "^/" + segs.map((s) => { const m = s.match(/^\[(.+)\]$/); if (m) { keys.push(m[1]); return "([^/]+)"; } return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("/") + "/?$";
  return { re, keys, depth: segs.length, statics: segs.filter((s) => !s.startsWith("[")).length };
};
const imp = (rel) => JSON.stringify(path.join(appDir, rel));
const pages = all.filter((r) => /(^|\/)page\.tsx$/.test(r)).map((r) => {
  const layouts = [];
  let d = path.dirname(r);
  while (d !== "." && d !== "") { if (all.includes(path.join(d, "layout.tsx"))) layouts.unshift(path.join(d, "layout.tsx")); d = path.dirname(d); }
  return { rel: r, ...toPattern(r), layouts };
}).sort((a, b) => b.statics - a.statics || b.depth - a.depth);
const apis = all.filter((r) => /(^|\/)route\.ts$/.test(r)).map((r) => ({ rel: r, ...toPattern(r) })).sort((a, b) => b.statics - a.statics || b.depth - a.depth);
let routes = "";
const modName = new Map(); let n = 0;
const nameFor = (rel) => { if (!modName.has(rel)) { modName.set(rel, `M${n++}`); routes += `import * as ${modName.get(rel)} from ${imp(rel)};\n`; } return modName.get(rel); };
const pageEntries = pages.map((p) => `{ re: new RegExp(${JSON.stringify(p.re)}), keys: ${JSON.stringify(p.keys)}, path: ${JSON.stringify(p.rel)}, mod: ${nameFor(p.rel)}, layouts: [${p.layouts.map(nameFor).join(", ")}] }`);
const apiEntries = apis.map((a) => `{ re: new RegExp(${JSON.stringify(a.re)}), keys: ${JSON.stringify(a.keys)}, path: ${JSON.stringify(a.rel)}, mod: ${nameFor(a.rel)} }`);
routes += `export const pages = [\n  ${pageEntries.join(",\n  ")}\n];\nexport const apis = [\n  ${apiEntries.join(",\n  ")}\n];\n`;
writeFileSync(path.join(gen, "routes.ts"), routes);

// 2. Shared esbuild settings: shims for Node, Prisma, Next.js and the job queue
const ENV = { NODE_ENV: "production", DEMO_MODE: "1", APP_URL: "http://controlroom.local", SESSION_SECRET: "browser-demo-session-secret-that-is-long-enough", STORAGE_DIR: "/app/storage", DATABASE_URL: "memory://controlroom" };
const alias = {
  "@prisma/client": B("shims/prisma.ts"),
  "node:fs": B("shims/fs.ts"), fs: B("shims/fs.ts"), "node:fs/promises": B("shims/fs.ts"), "node:path": B("shims/path.ts"), path: B("shims/path.ts"),
  "next/navigation": B("shims/next-navigation.ts"), "next/link": B("shims/next-link.tsx"), "next/headers": B("shims/next-headers.ts"), "pg-boss": B("shims/empty.ts"),
};
const srcRewrite = {
  name: "browser-rewrites",
  setup(b) {
    b.onResolve({ filter: /jobs\/queue$/ }, () => ({ path: B("shims/queue.ts") }));
    b.onResolve({ filter: /^(node:)?crypto$/ }, (a) => (a.importer.includes("/node_modules/") ? undefined : { path: B("shims/crypto.ts") }));
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: "skip-css" }));
    b.onLoad({ filter: /.*/, namespace: "skip-css" }, () => ({ contents: "", loader: "js" }));
    b.onLoad({ filter: /\/src\/.*\.(ts|tsx)$/ }, (a) => {
      let s = readFileSync(a.path, "utf8");
      s = s.replace(/\.get\("cookie"\)/g, '.get("x-cr-cookie")').replace(/"set-cookie"/g, '"x-cr-set-cookie"');
      s = s.replace(/window\.location\.href = ([^;]+);/g, "window.__crNavigate($1);").replace(/window\.location\.search/g, "window.__crSearch()");
      s = s.replace(/(^|[^.\w])(?:window\.)?(confirm|prompt|alert)\(/g, "$1await window.__cr_$2(");
      return { contents: s, loader: a.path.endsWith("x") ? "tsx" : "ts" };
    });
  },
};
const shared = { bundle: true, alias, plugins: [srcRewrite], tsconfig: path.join(root, "tsconfig.json"), jsx: "automatic", logLevel: "warning", define: { "process.env.NODE_ENV": '"production"' }, inject: [B("shims/globals.ts")], legalComments: "none" };

// 3. Snapshot: run the real seed scripts in Node against the in-memory database
await build({ ...shared, entryPoints: [B("snapshot-entry.ts")], outfile: path.join(gen, "snapshot.mjs"), platform: "node", format: "esm", target: "node22", banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url); import * as __realFs from 'node:fs'; globalThis.__realFs = __realFs;" } });
execFileSync("node", [path.join(gen, "snapshot.mjs"), path.join(gen, "snapshot.json")], { stdio: "inherit", env: { ...process.env, ...ENV } });

// 4. Browser bundle
const res = await build({ ...shared, entryPoints: [B("main.tsx")], write: false, platform: "browser", format: "iife", target: "es2022", minify: true, loader: { ".json": "json" }, define: { ...shared.define, "process.env.CR_ENV": JSON.stringify(JSON.stringify(ENV)) } });
const js = res.outputFiles[0].text;

// 5. CSS: the app's real Tailwind build (scans src/ and browser/)
const css = (await postcss([tailwind({ base: root })]).process(readFileSync(path.join(root, "src/app/globals.css"), "utf8"), { from: path.join(root, "src/app/globals.css") })).css;

// 6. Swagger UI assets for /api-docs
const sw = path.join(root, "node_modules/swagger-ui-dist");
const swCss = readFileSync(path.join(sw, "swagger-ui.css"), "utf8");
const swJs = readFileSync(path.join(sw, "swagger-ui-bundle.js"), "utf8");

const snapshot = readFileSync(path.join(gen, "snapshot.json"), "utf8");
const START = process.env.START_PATH ?? "/login";
const TITLE = process.env.TITLE ?? "Control Room";
let html = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<style>${readFileSync(B("chrome.css"), "utf8")}</style>
<div id="cr-root" data-start="${START}"></div>
<script type="application/json" id="cr-snapshot">${snapshot.replace(/</g, "\\u003c")}</script>
<script type="text/plain" id="cr-swagger-css">${swCss.replace(/<\/(script)/gi, "<\\/$1")}</script>
<script type="text/plain" id="cr-swagger-js">${swJs.replace(/<\/(script)/gi, "<\\/$1")}</script>
<script>${js.replace(/<\/(script)/gi, "<\\/$1")}</script>
`;
// Library code contains a few literal U+FFFD characters inside string literals; write them as escapes.
html = html.replace(/\uFFFD/g, "\\uFFFD");
const OUT = process.env.OUT ?? "docs/control-room-prototype.html";
writeFileSync(path.join(root, OUT), html);
console.log("wrote " + OUT, (html.length / 1e6).toFixed(2), "MB (js", (js.length / 1e6).toFixed(2), "MB, css", (css.length / 1e3).toFixed(0), "KB, data", (snapshot.length / 1e6).toFixed(2), "MB)");
