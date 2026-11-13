import * as React from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { rt, START } from "./runtime/core";
import { pages, apis } from "./generated/routes";
import { loadStore, onChange, dumpStore, store } from "./shims/prisma";
import { files } from "./shims/fs";
import { RedirectSignal, NotFoundSignal } from "./shims/next-navigation";

/* ------------------------------------------------------------ data */
const SNAP = JSON.parse(document.getElementById("cr-snapshot")!.textContent!);
const SAVE_KEY = "control-room-browser-db-v1";
// Changes are kept in this browser (IndexedDB), so a reload continues where you left off.
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open("control-room-browser", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbGet(key: string): Promise<any> {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }); } catch { return null; }
}
async function idbSet(key: string, val: any) { try { const db = await idb(); db.transaction("kv", "readwrite").objectStore("kv").put(val, key); } catch { /* storage blocked: the session still works */ } }
async function idbDel(key: string) { try { const db = await idb(); db.transaction("kv", "readwrite").objectStore("kv").delete(key); } catch {} }
async function loadInitial() {
  let saved: any = null;
  try { const raw = await idbGet(SAVE_KEY); if (raw) saved = JSON.parse(raw); } catch { saved = null; }
  const src = saved && saved.seededAt === SNAP.seededAt ? saved : SNAP;
  loadStore(src.db);
  files.clear();
  for (const [k, v] of Object.entries(src.files as Record<string, string>)) files.set(k, Uint8Array.from(atob(v), (c) => c.charCodeAt(0)));
  if (saved && src === saved) { rt.cookies = new Map(saved.cookies ?? []); if (saved.url) { rt.history = [saved.url]; rt.setUrl(saved.url); } }
}
let saveTimer: any = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const fsDump: Record<string, string> = {};
      for (const [k, v] of files) { let s = ""; for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000)); fsDump[k] = btoa(s); }
      idbSet(SAVE_KEY, JSON.stringify({ seededAt: SNAP.seededAt, db: JSON.parse(dumpStore()), files: fsDump, cookies: [...rt.cookies.entries()], url: rt.url.pathname + rt.url.search }));
    } catch { /* storage full or blocked: the session still works, it just won't survive a reload */ }
  }, 600);
}
function resetData() { idbDel(SAVE_KEY); rt.cookies.clear(); loadStore(SNAP.db); files.clear(); for (const [k, v] of Object.entries(SNAP.files as Record<string, string>)) files.set(k, Uint8Array.from(atob(v), (c) => c.charCodeAt(0))); rt.history = [START]; rt.index = 0; rt.navigate(START, { replace: true }); }

/* ------------------------------------------------------------ requests */
rt.apis = apis as any;
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, rt.url);
  if (url.host !== "controlroom.local") return realFetch(input as any, init);
  const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
  headers.set("x-cr-cookie", rt.cookieHeader());
  const req = input instanceof Request ? new Request(url, { method: input.method, headers, body: input.body, duplex: "half" } as any) : new Request(url, { ...init, headers });
  const res = await rt.handle(req);
  if (req.method !== "GET") scheduleSave();
  return res;
};
(window as any).__crNavigate = (u: string) => rt.navigate(String(u));
(window as any).__crSearch = () => rt.url.search;

/* ------------------------------------------------------------ dialogs (confirm / prompt / alert) */
type Dialog = { kind: "confirm" | "prompt" | "alert"; message: string; resolve: (v: any) => void };
let showDialog: (d: Dialog | null) => void = () => {};
for (const kind of ["confirm", "prompt", "alert"] as const) (window as any)["__cr_" + kind] = (message: string) => new Promise((resolve) => showDialog({ kind, message: String(message ?? ""), resolve }));
function DialogBox({ d, close }: { d: Dialog; close: () => void }) {
  const [v, setV] = React.useState("");
  const done = (val: any) => { d.resolve(val); close(); };
  return (
    <div className="cr-overlay" onClick={(e) => { if (e.target === e.currentTarget) done(d.kind === "confirm" ? false : d.kind === "prompt" ? null : undefined); }}>
      <div className="cr-dialog" role="dialog" aria-modal="true">
        <div className="cr-dialog-host">controlroom.local says</div>
        <div className="cr-dialog-msg">{d.message}</div>
        {d.kind === "prompt" ? <input autoFocus className="cr-dialog-input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") done(v); }} /> : null}
        <div className="cr-dialog-btns">
          {d.kind !== "alert" ? <button className="cr-btn" onClick={() => done(d.kind === "confirm" ? false : null)}>Cancel</button> : null}
          <button className="cr-btn cr-btn-primary" autoFocus={d.kind !== "prompt"} onClick={() => done(d.kind === "confirm" ? true : d.kind === "prompt" ? v : undefined)}>OK</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ downloads and new-tab links */
type Viewer = { title: string; blob?: Blob; kind: "pdf" | "zip" | "json" | "text" | "html"; url?: string; entries?: { name: string; text?: string; size: number; pdfUrl?: string }[]; text?: string };
let showViewer: (v: Viewer | null) => void = () => {};
async function openResource(href: string) {
  const res = await fetch(href);
  const type = res.headers.get("content-type") ?? "";
  const disp = res.headers.get("content-disposition") ?? "";
  const name = disp.match(/filename="?([^";]+)"?/)?.[1] ?? href.split("?")[0].split("/").pop() ?? "file";
  if (!res.ok) { const j = await res.json().catch(() => null); await (window as any).__cr_alert(j?.error?.message ?? `Request failed (${res.status})`); return; }
  const blob = await res.blob();
  if (type.includes("pdf")) return showViewer({ title: name, blob, kind: "pdf", url: URL.createObjectURL(blob) });
  if (type.includes("zip")) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const entries = await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map(async (f) => {
      const bytes = await f.async("uint8array");
      return f.name.endsWith(".pdf") ? { name: f.name, size: bytes.length, pdfUrl: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })) } : { name: f.name, size: bytes.length, text: new TextDecoder().decode(bytes) };
    }));
    return showViewer({ title: name, blob, kind: "zip", entries });
  }
  const text = await blob.text();
  showViewer({ title: name, blob, kind: type.includes("json") ? "json" : "text", text: type.includes("json") ? JSON.stringify(JSON.parse(text), null, 2) : text });
}
// Real downloads go through the artifact viewer's downloads capability (the viewer confirms each save).
let downloadsApi: Promise<any> | null = null;
const getDownloads = () => (downloadsApi ??= ((window as any).claude?.use ? (window as any).claude.use("downloads").catch(() => null) : Promise.resolve(null)));
function ViewerBox({ v, close }: { v: Viewer; close: () => void }) {
  const [sel, setSel] = React.useState(0);
  const [dl, setDl] = React.useState<any>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => { getDownloads().then(setDl); }, []);
  const save = async () => {
    setNote("");
    try { await dl.save({ filename: v.title, data: v.blob }); setNote("Saved"); }
    catch (e: any) { setNote(e?.code === "declined" ? "" : e?.code === "rate_limited" ? "A save is already waiting; try again in a moment" : "This file can't be saved here"); }
  };
  const e = v.entries?.[sel];
  return (
    <div className="cr-overlay" onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div className="cr-viewer" role="dialog" aria-modal="true">
        <div className="cr-viewer-head"><div className="cr-viewer-title">{v.title}</div><span className="cr-viewer-note">{note}</span>{dl && v.blob ? <button className="cr-btn cr-btn-primary" onClick={save}>Download</button> : null}<button className="cr-btn" onClick={close}>Close</button></div>
        {v.kind === "pdf" ? <iframe className="cr-viewer-frame" src={v.url} title={v.title} /> : null}
        {v.kind === "zip" ? (
          <div className="cr-zip">
            <div className="cr-zip-list">{v.entries!.map((f, i) => <button key={f.name} className={i === sel ? "on" : ""} onClick={() => setSel(i)}><span>{f.name}</span><span className="cr-zip-size">{(f.size / 1024).toFixed(1)} KB</span></button>)}</div>
            <div className="cr-zip-body">{e?.pdfUrl ? <iframe className="cr-viewer-frame" src={e.pdfUrl} title={e.name} /> : <pre>{e?.text}</pre>}</div>
          </div>
        ) : null}
        {v.kind === "json" || v.kind === "text" ? <pre className="cr-viewer-pre">{v.text}</pre> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ rendering pages like the Next.js server */
const isAsync = (f: any) => typeof f === "function" && f.constructor?.name === "AsyncFunction";
async function resolveNode(node: any): Promise<any> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveNode));
  if (!React.isValidElement(node)) return node;
  const el: any = node;
  if (isAsync(el.type)) return resolveNode(await el.type(el.props));
  if (el.props && el.props.children !== undefined) {
    const ch = await resolveNode(el.props.children);
    if (ch !== el.props.children) return React.cloneElement(el, { children: ch });
  }
  return el;
}
function NotFoundPage() {
  return <div style={{ fontFamily: "system-ui", height: "calc(100vh - 44px)", display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}><h1 style={{ fontSize: 24, fontWeight: 500, paddingRight: 20, borderRight: "1px solid rgba(0,0,0,.3)" }}>404</h1><h2 style={{ fontSize: 14, fontWeight: 400 }}>This page could not be found.</h2></div>;
}
function ErrorPage({ error }: { error: Error }) {
  return <div style={{ fontFamily: "system-ui", padding: 40 }}><h2 style={{ fontSize: 16, fontWeight: 600 }}>Application error: a server-side exception has occurred</h2><pre style={{ marginTop: 12, fontSize: 12, whiteSpace: "pre-wrap", color: "#991b1b" }}>{String(error?.message ?? error)}</pre></div>;
}
function SwaggerPage() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!(window as any).SwaggerUIBundle) {
      const st = document.createElement("style"); st.textContent = document.getElementById("cr-swagger-css")!.textContent!; document.head.appendChild(st);
      const sc = document.createElement("script"); sc.textContent = document.getElementById("cr-swagger-js")!.textContent!; document.head.appendChild(sc);
    }
    (window as any).SwaggerUIBundle({ url: "http://controlroom.local/api/openapi.json", domNode: ref.current, deepLinking: false, defaultModelsExpandDepth: 0 });
  }, []);
  return <div className="cr-swagger" style={{ background: "#fff", minHeight: "calc(100vh - 44px)" }}><div ref={ref} /></div>;
}

async function renderUrl(): Promise<{ tree: any; title: string }> {
  const u = rt.url;
  if (u.pathname === "/api-docs" || u.pathname === "/api-docs/") return { tree: <SwaggerPage />, title: "Control Room API" };
  const page = (pages as any[]).find((p) => p.re.test(u.pathname));
  if (!page) return { tree: <NotFoundPage />, title: "404: This page could not be found." };
  const m = u.pathname.match(page.re)!;
  const params = Object.fromEntries(page.keys.map((k: string, i: number) => [k, decodeURIComponent(m[i + 1])]));
  rt.params = params;
  const sp: Record<string, string | string[]> = {};
  for (const [k, v] of u.searchParams) sp[k] = sp[k] === undefined ? v : ([] as string[]).concat(sp[k] as any, v);
  const Page = page.mod.default;
  let tree = await resolveNode(<Page params={Promise.resolve(params)} searchParams={Promise.resolve(sp)} />);
  for (const L of [...page.layouts].reverse()) tree = await resolveNode(<L.default params={Promise.resolve(params)}>{tree}</L.default>);
  const t = page.mod.metadata?.title;
  return { tree, title: t ? `${typeof t === "string" ? t : t.default} · Control Room` : "Control Room" };
}

/* ------------------------------------------------------------ the browser frame */
function AddressBar() {
  const path = React.useSyncExternalStore((f) => rt.subscribe(f), () => rt.url.pathname + rt.url.search);
  const [v, setV] = React.useState(path);
  const [menu, setMenu] = React.useState(false);
  React.useEffect(() => setV(path), [path]);
  const go = (to: string) => { const u = new URL(to.trim() || "/", "http://controlroom.local"); rt.navigate(u.pathname + u.search); };
  return (
    <div className="cr-bar">
      <button className="cr-nav" aria-label="Back" onClick={() => rt.back()} disabled={rt.index === 0}>‹</button>
      <button className="cr-nav" aria-label="Forward" onClick={() => rt.forward()} disabled={rt.index >= rt.history.length - 1}>›</button>
      <button className="cr-nav" aria-label="Reload" onClick={() => rt.refresh()}>↻</button>
      <form className="cr-url" onSubmit={(e) => { e.preventDefault(); go(v); }}>
        <span className="cr-host">controlroom.local</span>
        <input aria-label="Address" value={v} onChange={(e) => setV(e.target.value.replace(/^https?:\/\/controlroom\.local/, ""))} onFocus={(e) => e.currentTarget.select()} />
      </form>
      <div className="cr-links">
        <button onClick={() => go("/login")}>Control Room</button>
        <button onClick={() => go("/portal/login")}>Supplier portal</button>
        <button onClick={() => go("/api-docs")}>API docs</button>
        <div className="cr-more"><button aria-label="More" onClick={() => setMenu(!menu)}>⋯</button>
          {menu ? <div className="cr-menu" onMouseLeave={() => setMenu(false)}>
            <div className="cr-menu-note">Runs entirely in your browser with the app's own code and demo data. Changes are saved in this browser only.</div>
            <button onClick={async () => { setMenu(false); if (await (window as any).__cr_confirm("Reset all demo data to the starting point? Your changes in this browser will be lost.")) resetData(); }}>Reset demo data</button>
          </div> : null}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = React.useState<any>(null);
  const [dialog, setDialog] = React.useState<Dialog | null>(null);
  const [viewer, setViewer] = React.useState<Viewer | null>(null);
  const seq = React.useRef(0);
  showDialog = setDialog; showViewer = setViewer;
  React.useEffect(() => {
    rt.render = async (opts = {}) => {
      const id = ++seq.current;
      let out: { tree: any; title: string };
      try { out = await renderUrl(); }
      catch (e: any) {
        if (e instanceof RedirectSignal) { rt.navigate(e.url, { replace: true }); return; }
        if (e instanceof NotFoundSignal) out = { tree: <NotFoundPage />, title: "404: This page could not be found." };
        else { console.error(e); out = { tree: <ErrorPage error={e} />, title: "Application error" }; }
      }
      if (id !== seq.current) return;
      document.title = out.title;
      setView(out.tree);
      scheduleSave();
      if (opts.scroll) window.scrollTo(0, 0);
    };
    (globalThis as any).__crRefreshSoon = () => rt.refresh();
    rt.render({ scroll: false });
  }, []);
  return (
    <>
      <AddressBar />
      <div className="min-h-screen cr-page">{view}</div>
      {dialog ? <DialogBox d={dialog} close={() => setDialog(null)} /> : null}
      {viewer ? <ViewerBox v={viewer} close={() => setViewer(null)} /> : null}
    </>
  );
}

/* Plain <a href="/..."> links and GET forms (outside next/link) */
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
  const href = a.getAttribute("href")!;
  const local = href.startsWith("/") || href.startsWith("http://controlroom.local");
  if (!local) return;
  e.preventDefault();
  const path = href.replace("http://controlroom.local", "");
  if (path.startsWith("/api/") || a.target === "_blank" || a.hasAttribute("download")) { if (path.startsWith("/api-docs")) rt.navigate(path); else openResource(path); }
  else rt.navigate(path);
});
document.addEventListener("submit", (e) => {
  const f = e.target as HTMLFormElement;
  if (e.defaultPrevented || (f.getAttribute("method") ?? "get").toLowerCase() !== "get" || f.classList.contains("cr-url")) return;
  e.preventDefault();
  const q = new URLSearchParams();
  for (const [k, v] of new FormData(f)) if (typeof v === "string" && v !== "") q.append(k, v);
  const action = f.getAttribute("action") || rt.url.pathname;
  rt.navigate(action + (q.toString() ? "?" + q : ""));
});

(window as any).__crStore = store; // for automated checks (e.g. simulating a direct database edit)
onChange(() => scheduleSave());
loadInitial().then(() => createRoot(document.getElementById("cr-root")!).render(<App />));
