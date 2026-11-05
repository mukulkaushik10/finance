/** JSON fetch for client components; throws with the API's plain-language message. */
export async function send<T = any>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.details?.[0]?.message ?? data?.error?.message ?? "Something went wrong");
  return data as T;
}

/** Make server data (with bigints and dates) safe to pass to client components. */
export function plain<T>(v: T): any {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));
}
