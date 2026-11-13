// The browser runtime: an in-memory URL bar, cookie jar and history, plus the request router
// that sends fetch("/api/...") calls to the app's real route handlers.
type Listener = () => void;
export interface ApiRoute { re: RegExp; keys: string[]; mod: Record<string, any>; path: string }

// Where this copy opens: the staff sign-in, or the supplier portal sign-in for the supplier link.
export const START = (typeof document !== "undefined" && document.getElementById("cr-root")?.dataset.start) || "/login";
export const rt = {
  url: new URL("http://controlroom.local" + START),
  params: {} as Record<string, string>,
  cookies: new Map<string, string>(),
  history: [START] as string[],
  index: 0,
  listeners: new Set<Listener>(),
  apis: [] as ApiRoute[],
  render: (_opts?: { scroll?: boolean }) => {},
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach((f) => f()); },
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "); },
  setUrl(u: string) { this.url = new URL(u, "http://controlroom.local"); },
  navigate(u: string, opts: { replace?: boolean; scroll?: boolean } = {}) {
    const next = new URL(u, this.url);
    const path = next.pathname + next.search;
    if (opts.replace) this.history[this.index] = path; else { this.history = this.history.slice(0, this.index + 1); this.history.push(path); this.index++; }
    this.url = next; this.emit(); this.render({ scroll: opts.scroll ?? true });
  },
  refresh() { this.render({ scroll: false }); },
  back() { if (this.index > 0) { this.index--; this.url = new URL(this.history[this.index], "http://controlroom.local"); this.emit(); this.render({ scroll: true }); } },
  forward() { if (this.index < this.history.length - 1) { this.index++; this.url = new URL(this.history[this.index], "http://controlroom.local"); this.emit(); this.render({ scroll: true }); } },

  /** Handle a request with the app's route handlers, like the Next.js server would. */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    for (const r of this.apis) {
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const fn = r.mod[req.method] ?? (req.method === "HEAD" ? r.mod.GET : undefined);
      if (!fn) return new Response(JSON.stringify({ error: { code: "method_not_allowed", message: "Method not allowed" } }), { status: 405 });
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const res: Response = await fn(req, { params: Promise.resolve(params) });
      for (const sc of res.headers.get("x-cr-set-cookie")?.split(/,(?=\s*\w+=)/) ?? []) {
        const [kv, ...attrs] = sc.split(";"); const i = kv.indexOf("="); const k = kv.slice(0, i).trim(); const v = decodeURIComponent(kv.slice(i + 1).trim());
        const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
        if (!v || (maxAge && Number(maxAge.split("=")[1]) <= 0)) this.cookies.delete(k); else this.cookies.set(k, v);
      }
      return res;
    }
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } });
  },
};
(globalThis as any).__crRuntime = rt;
