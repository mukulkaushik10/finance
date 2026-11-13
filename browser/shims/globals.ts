import { Buffer } from "buffer";
const g = globalThis as any;
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process || !g.process.versions?.node) {
  const env = typeof (globalThis as any).__CR_ENV === "object" ? (globalThis as any).__CR_ENV : JSON.parse(process.env.CR_ENV as unknown as string);
  g.process = { env, cwd: () => "/app", platform: "browser", versions: {}, nextTick: (fn: () => void) => Promise.resolve().then(fn), emitWarning: () => {} };
}
export { Buffer };

// The npm "buffer" package has no base64url encoding; Node's does. Add it.
const proto = Buffer.prototype as any;
if (!proto.__crB64url) {
  const toStr = proto.toString;
  proto.toString = function (enc?: string, ...rest: any[]) {
    if (enc === "base64url") return toStr.call(this, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return toStr.call(this, enc, ...rest);
  };
  const from = (Buffer as any).from;
  (Buffer as any).from = function (v: any, enc?: any, ...rest: any[]) {
    if (enc === "base64url" && typeof v === "string") return from.call(Buffer, v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return from.call(Buffer, v, enc, ...rest);
  };
  proto.__crB64url = true;
}
