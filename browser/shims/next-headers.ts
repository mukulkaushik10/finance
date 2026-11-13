import { rt } from "../runtime/core";
export async function cookies() {
  return {
    get: (name: string) => (rt.cookies.has(name) ? { name, value: rt.cookies.get(name)! } : undefined),
    has: (name: string) => rt.cookies.has(name),
    getAll: () => [...rt.cookies.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => rt.cookies.set(name, value),
    delete: (name: string) => rt.cookies.delete(name),
  };
}
export async function headers() { return new Headers({ cookie: rt.cookieHeader(), host: "controlroom.local" }); }
