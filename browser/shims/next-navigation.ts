import { useSyncExternalStore } from "react";
import { rt } from "../runtime/core";

export class RedirectSignal extends Error { constructor(public url: string) { super("NEXT_REDIRECT"); } }
export class NotFoundSignal extends Error { constructor() { super("NEXT_NOT_FOUND"); } }
export function redirect(url: string): never { throw new RedirectSignal(url); }
export function permanentRedirect(url: string): never { throw new RedirectSignal(url); }
export function notFound(): never { throw new NotFoundSignal(); }

const sub = (fn: () => void) => rt.subscribe(fn);
export function usePathname() { return useSyncExternalStore(sub, () => rt.url.pathname); }
export function useSearchParams() { const s = useSyncExternalStore(sub, () => rt.url.search); return new URLSearchParams(s); }
export function useParams() { return rt.params; }
export function useRouter() {
  return { push: (u: string) => rt.navigate(u), replace: (u: string) => rt.navigate(u, { replace: true }), refresh: () => rt.refresh(), back: () => rt.back(), forward: () => rt.forward(), prefetch: () => {} };
}
