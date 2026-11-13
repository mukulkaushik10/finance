// In-memory stand-in for @prisma/client, for the browser build of Control Room.
// It implements the part of the Prisma Client API the app's services use (filters, relations,
// include/select, _count, aggregate _sum, nested create, defaults, unique constraints,
// transactions with rollback, $extends query hooks) over plain arrays, driven by the real
// schema's DMMF so relations and defaults match prisma/schema.prisma exactly.
import DMMF from "../generated/dmmf.json";

type Row = Record<string, any>;
interface Field { name: string; kind: string; type: string; isList: boolean; isId: boolean; isUnique: boolean; isRequired: boolean; isUpdatedAt: boolean; hasDefaultValue: boolean; default?: any; relationName?: string; relationFromFields?: string[]; relationToFields?: string[] }
interface Model { name: string; fields: Field[]; uniqueFields: string[][] }

const MODELS: Record<string, Model> = Object.fromEntries((DMMF as Model[]).map((m) => [m.name, m]));
const delegateName = (m: string) => m[0].toLowerCase() + m.slice(1);
const MODEL_BY_DELEGATE: Record<string, string> = Object.fromEntries(Object.keys(MODELS).map((m) => [delegateName(m), m]));
const fieldOf = (model: string, f: string) => MODELS[model].fields.find((x) => x.name === f);
const idField = (model: string) => MODELS[model].fields.find((f) => f.isId)!.name;

/* ---------------------------------------------------------------- errors */
export class PrismaClientKnownRequestError extends Error {
  code: string; meta?: any; clientVersion = "in-memory";
  constructor(message: string, opts: { code: string; meta?: any; clientVersion?: string }) { super(message); this.code = opts.code; this.meta = opts.meta; this.name = "PrismaClientKnownRequestError"; }
}
export class PrismaClientInitializationError extends Error {}
export class PrismaClientValidationError extends Error {}
export const Prisma = { PrismaClientKnownRequestError, PrismaClientInitializationError, PrismaClientValidationError, JsonNull: null, DbNull: null, dmmf: { datamodel: { models: DMMF } } };

/* ---------------------------------------------------------------- storage */
export interface Store { tables: Record<string, Row[]>; byId: Record<string, Map<string, Row>>; seq: Record<string, number> }
export const store: Store = { tables: {}, byId: {}, seq: {} };
for (const m of Object.keys(MODELS)) { store.tables[m] = []; store.byId[m] = new Map(); }

let undo: (() => void)[] | null = null;
let changeListeners: (() => void)[] = [];
export function onChange(fn: () => void) { changeListeners.push(fn); }
const changed = () => changeListeners.forEach((f) => f());

function insertRow(model: string, row: Row) {
  store.tables[model].push(row); store.byId[model].set(row[idField(model)], row);
  undo?.push(() => { const t = store.tables[model]; const i = t.indexOf(row); if (i >= 0) t.splice(i, 1); store.byId[model].delete(row[idField(model)]); });
}
function removeRow(model: string, row: Row) {
  const t = store.tables[model]; const i = t.indexOf(row); if (i < 0) return;
  t.splice(i, 1); store.byId[model].delete(row[idField(model)]);
  undo?.push(() => { t.splice(i, 0, row); store.byId[model].set(row[idField(model)], row); });
}
function patchRow(model: string, row: Row, patch: Row) {
  const prev = { ...row };
  const oldId = row[idField(model)];
  Object.assign(row, patch);
  if (row[idField(model)] !== oldId) { store.byId[model].delete(oldId); store.byId[model].set(row[idField(model)], row); }
  undo?.push(() => { for (const k of Object.keys(row)) delete row[k]; Object.assign(row, prev); store.byId[model].delete(row[idField(model)]); store.byId[model].set(prev[idField(model)], row); });
}

/* ---------------------------------------------------------------- values */
let cuidCounter = Math.floor(Math.random() * 1e6);
export function cuid() {
  cuidCounter = (cuidCounter + 1) % 1679616;
  const t = Date.now().toString(36).padStart(8, "0").slice(-8);
  const c = cuidCounter.toString(36).padStart(4, "0");
  const r = Math.random().toString(36).slice(2, 10).padEnd(8, "0") + Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return ("c" + t + c + r).slice(0, 25);
}
function coerce(f: Field, v: any): any {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (f.isList) return Array.isArray(v) ? v.map((x) => coerce({ ...f, isList: false }, x)) : v;
  switch (f.type) {
    case "DateTime": return v instanceof Date ? new Date(v.getTime()) : new Date(v);
    case "BigInt": return typeof v === "bigint" ? v : BigInt(v);
    case "Int": return typeof v === "number" ? v : Number(v);
    case "Float": case "Decimal": return Number(v);
    case "Boolean": return v === true || v === "true";
    case "Json": return v === null ? null : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
    default: return v;
  }
}
function defaultFor(f: Field): any {
  const d = f.default;
  if (d && typeof d === "object" && !Array.isArray(d) && "name" in d) {
    if (d.name === "cuid") return cuid();
    if (d.name === "uuid") return crypto.randomUUID();
    if (d.name === "now") return new Date();
    if (d.name === "autoincrement") return undefined;
  }
  if (d === undefined) return f.isList ? [] : null;
  if (f.type === "Json") return typeof d === "string" ? JSON.parse(d) : d;
  return coerce(f, d);
}
const cmpVal = (v: any) => (v instanceof Date ? v.getTime() : typeof v === "bigint" ? Number(v) : v);
function eq(a: any, b: any) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (a instanceof Date || b instanceof Date) return cmpVal(a) === cmpVal(new Date(b));
  if (typeof a === "bigint" || typeof b === "bigint") return BigInt(a) === BigInt(b);
  return a === b;
}
const clone = (row: Row) => { const o: Row = {}; for (const k in row) { const v = row[k]; o[k] = v instanceof Date ? new Date(v.getTime()) : v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; } return o; };

/* ---------------------------------------------------------------- relations */
interface Rel { field: Field; target: string; list: boolean; localKeys: string[]; remoteKeys: string[] }
const relCache = new Map<string, Rel>();
function rel(model: string, fieldName: string): Rel {
  const key = model + "." + fieldName;
  if (relCache.has(key)) return relCache.get(key)!;
  const f = fieldOf(model, fieldName)!;
  let r: Rel;
  if (f.relationFromFields && f.relationFromFields.length) r = { field: f, target: f.type, list: false, localKeys: f.relationFromFields, remoteKeys: f.relationToFields! };
  else {
    const other = MODELS[f.type].fields.find((x) => x.relationName === f.relationName && x.kind === "object" && (f.type !== model || x.name !== f.name) && x.relationFromFields && x.relationFromFields.length)!;
    r = { field: f, target: f.type, list: f.isList, localKeys: other.relationToFields!, remoteKeys: other.relationFromFields! };
  }
  relCache.set(key, r); return r;
}
function related(model: string, row: Row, fieldName: string): Row[] {
  const r = rel(model, fieldName);
  if (!r.list && r.remoteKeys.length === 1 && r.remoteKeys[0] === idField(r.target)) { const v = row[r.localKeys[0]]; const hit = v == null ? undefined : store.byId[r.target].get(v); return hit ? [hit] : []; }
  return store.tables[r.target].filter((t) => r.localKeys.every((lk, i) => row[lk] != null && eq(t[r.remoteKeys[i]], row[lk])));
}

/* ---------------------------------------------------------------- where */
function matchScalar(v: any, cond: any, f: Field): boolean {
  if (cond === null) return v === null || v === undefined;
  if (typeof cond !== "object" || cond instanceof Date || Array.isArray(cond)) return eq(v, cond);
  const ins = cond.mode === "insensitive";
  const s = (x: any) => (ins ? String(x ?? "").toLowerCase() : String(x ?? ""));
  for (const [op, raw] of Object.entries(cond)) {
    if (raw === undefined || op === "mode") continue;
    const c = f.type === "DateTime" && raw !== null && typeof raw !== "object" ? new Date(raw as any) : raw;
    switch (op) {
      case "equals": if (!(ins ? s(v) === s(c) : eq(v, c))) return false; break;
      case "not": if (c !== null && typeof c === "object" && !(c instanceof Date)) { if (matchScalar(v, { ...c, mode: cond.mode }, f)) return false; } else if (eq(v, c)) return false; break;
      case "in": if (!(c as any[]).some((x) => eq(v, x))) return false; break;
      case "notIn": if ((c as any[]).some((x) => eq(v, x))) return false; break;
      case "lt": if (v == null || !(cmpVal(v) < cmpVal(c))) return false; break;
      case "lte": if (v == null || !(cmpVal(v) <= cmpVal(c))) return false; break;
      case "gt": if (v == null || !(cmpVal(v) > cmpVal(c))) return false; break;
      case "gte": if (v == null || !(cmpVal(v) >= cmpVal(c))) return false; break;
      case "contains": if (v == null || !s(v).includes(s(c))) return false; break;
      case "startsWith": if (v == null || !s(v).startsWith(s(c))) return false; break;
      case "endsWith": if (v == null || !s(v).endsWith(s(c))) return false; break;
      case "has": if (!Array.isArray(v) || !v.some((x) => eq(x, c))) return false; break;
      default: throw new PrismaClientValidationError(`Unsupported filter ${op} on ${f.name}`);
    }
  }
  return true;
}
export function matches(model: string, row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === "AND") { if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(model, row, w))) return false; continue; }
    if (k === "OR") { if (!(cond as any[]).some((w) => matches(model, row, w))) return false; continue; }
    if (k === "NOT") { if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(model, row, w))) return false; continue; }
    const f = fieldOf(model, k);
    if (!f) { // compound unique, e.g. organisationId_poNumber: { organisationId, poNumber }
      if (cond && typeof cond === "object") { if (!Object.entries(cond).every(([kk, vv]) => eq(row[kk], vv))) return false; continue; }
      throw new PrismaClientValidationError(`Unknown field ${model}.${k}`);
    }
    if (f.kind === "object") {
      const rows = related(model, row, k);
      if (f.isList) {
        const c = cond as any;
        if (c.some && !rows.some((r) => matches(f.type, r, c.some))) return false;
        if (c.every && !rows.every((r) => matches(f.type, r, c.every))) return false;
        if (c.none && rows.some((r) => matches(f.type, r, c.none))) return false;
      } else {
        const r = rows[0];
        if (cond === null) { if (r) return false; continue; }
        const c = cond as any;
        if ("is" in c || "isNot" in c) {
          if ("is" in c) { if (c.is === null ? r : !r || !matches(f.type, r, c.is)) return false; }
          if ("isNot" in c) { if (c.isNot === null ? !r : r && matches(f.type, r, c.isNot)) return false; }
        } else if (!r || !matches(f.type, r, c)) return false;
      }
      continue;
    }
    if (!matchScalar(row[k], cond, f)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------- orderBy */
function sortRows(model: string, rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const list = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  const keyed = list.map(([field, spec]) => {
    const f = fieldOf(model, field)!;
    if (f.kind === "object") { const [[sub, dir]] = Object.entries(spec as any); return { get: (r: Row) => related(model, r, field)[0]?.[sub] ?? null, dir: dir as string, nulls: null as string | null }; }
    const dir = typeof spec === "string" ? spec : (spec as any).sort; const nulls = typeof spec === "object" ? (spec as any).nulls ?? null : null;
    return { get: (r: Row) => r[field] ?? null, dir, nulls };
  });
  return rows.slice().sort((a, b) => {
    for (const k of keyed) {
      const x = k.get(a), y = k.get(b);
      if (x === null || y === null) {
        if (x === y) continue;
        const nullsFirst = k.nulls ? k.nulls === "first" : k.dir === "desc"; // Postgres: NULLS LAST for asc, FIRST for desc
        return (x === null ? -1 : 1) * (nullsFirst ? 1 : -1);
      }
      const cx = cmpVal(x), cy = cmpVal(y);
      if (cx < cy) return k.dir === "desc" ? 1 : -1;
      if (cx > cy) return k.dir === "desc" ? -1 : 1;
    }
    return 0;
  });
}

/* ---------------------------------------------------------------- projection */
function project(model: string, row: Row, args: any = {}): Row {
  const { select, include } = args;
  const out: Row = {};
  const fields = MODELS[model].fields;
  if (select) {
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      if (k === "_count") { out._count = counts(model, row, (v as any).select); continue; }
      const f = fieldOf(model, k)!;
      if (f.kind === "object") out[k] = projectRelation(model, row, k, v);
      else out[k] = clone({ v: row[k] }).v;
    }
    return out;
  }
  for (const f of fields) if (f.kind !== "object") out[f.name] = row[f.name] instanceof Date ? new Date(row[f.name].getTime()) : f.type === "Json" && row[f.name] && typeof row[f.name] === "object" ? JSON.parse(JSON.stringify(row[f.name])) : row[f.name] ?? null;
  if (include) for (const [k, v] of Object.entries(include)) {
    if (!v) continue;
    if (k === "_count") { out._count = counts(model, row, (v as any).select); continue; }
    out[k] = projectRelation(model, row, k, v);
  }
  return out;
}
function projectRelation(model: string, row: Row, k: string, v: any) {
  const f = fieldOf(model, k)!; let rows = related(model, row, k);
  const a = v === true ? {} : v;
  if (a.where) rows = rows.filter((r) => matches(f.type, r, a.where));
  if (f.isList) { rows = sortRows(f.type, rows, a.orderBy); if (a.skip) rows = rows.slice(a.skip); if (a.take !== undefined) rows = rows.slice(0, a.take); return rows.map((r) => project(f.type, r, a)); }
  return rows[0] ? project(f.type, rows[0], a) : null;
}
function counts(model: string, row: Row, sel: any) {
  const o: Row = {};
  for (const [k, v] of Object.entries(sel ?? {})) { const f = fieldOf(model, k)!; let rows = related(model, row, k); if (v && typeof v === "object" && (v as any).where) rows = rows.filter((r) => matches(f.type, r, (v as any).where)); o[k] = rows.length; }
  return o;
}

/* ---------------------------------------------------------------- writes */
function checkUnique(model: string, row: Row, self?: Row) {
  const m = MODELS[model];
  const groups = [...m.fields.filter((f) => (f.isUnique || f.isId) && f.kind !== "object").map((f) => [f.name]), ...m.uniqueFields];
  for (const g of groups) {
    if (g.some((k) => row[k] === null || row[k] === undefined)) continue;
    if (g.length === 1 && g[0] === idField(model)) { const hit = store.byId[model].get(row[g[0]]); if (hit && hit !== self) throw new PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${g.join("`,`")}\`)`, { code: "P2002", meta: { target: g } }); continue; }
    const hit = store.tables[model].find((t) => t !== self && g.every((k) => eq(t[k], row[k])));
    if (hit) throw new PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${g.join("`,`")}\`)`, { code: "P2002", meta: { target: g } });
  }
}
function createRow(model: string, data: Row): Row {
  const m = MODELS[model];
  const row: Row = {};
  const after: (() => void)[] = [];
  for (const f of m.fields) {
    if (f.kind === "object") {
      const v = data[f.name]; if (!v) continue;
      const r = rel(model, f.name);
      if (r.localKeys.length && !r.list && f.relationFromFields?.length) { // FK on this model
        const target = v.connect ? findUniqueRow(r.target, v.connect) : v.create ? createRow(r.target, v.create) : v.connectOrCreate ? (findUniqueRow(r.target, v.connectOrCreate.where, true) ?? createRow(r.target, v.connectOrCreate.create)) : null;
        if (target) r.localKeys.forEach((lk, i) => (row[lk] = target[r.remoteKeys[i]]));
      } else {
        after.push(() => {
          const items = v.create ? (Array.isArray(v.create) ? v.create : [v.create]) : v.createMany ? v.createMany.data : [];
          for (const it of items) { const child: Row = { ...it }; r.remoteKeys.forEach((rk, i) => (child[rk] = row[r.localKeys[i]])); createRow(r.target, child); }
          for (const w of v.connect ? (Array.isArray(v.connect) ? v.connect : [v.connect]) : []) { const t = findUniqueRow(r.target, w); patchRow(r.target, t, Object.fromEntries(r.remoteKeys.map((rk, i) => [rk, row[r.localKeys[i]]]))); }
        });
      }
      continue;
    }
    if (row[f.name] !== undefined) continue;
    const v = data[f.name];
    if (v !== undefined) row[f.name] = coerce(f, v);
    else if (f.isUpdatedAt) row[f.name] = new Date();
    else if (f.hasDefaultValue) { const d = defaultFor(f); if (d !== undefined) row[f.name] = d; else if (f.default?.name === "autoincrement") { store.seq[model] = (store.seq[model] ?? 0) + 1; row[f.name] = store.seq[model]; } }
    else row[f.name] = f.isList ? [] : null;
  }
  checkUnique(model, row);
  insertRow(model, row);
  after.forEach((fn) => fn());
  return row;
}
function applyUpdate(model: string, row: Row, data: Row) {
  const patch: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const f = fieldOf(model, k); if (!f) throw new PrismaClientValidationError(`Unknown field ${model}.${k}`);
    if (f.kind === "object") {
      const r = rel(model, k);
      if (f.relationFromFields?.length) {
        if ((v as any).connect) { const t = findUniqueRow(r.target, (v as any).connect); r.localKeys.forEach((lk, i) => (patch[lk] = t[r.remoteKeys[i]])); }
        if ((v as any).disconnect) r.localKeys.forEach((lk) => (patch[lk] = null));
      } else if ((v as any).create) { for (const it of Array.isArray((v as any).create) ? (v as any).create : [(v as any).create]) { const child: Row = { ...it }; r.remoteKeys.forEach((rk, i) => (child[rk] = row[r.localKeys[i]])); createRow(r.target, child); } }
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && f.type !== "Json" && !Array.isArray(v)) {
      const cur = row[k]; const o = v as any;
      if ("set" in o) patch[k] = coerce(f, o.set);
      else if ("increment" in o) patch[k] = typeof cur === "bigint" ? cur + BigInt(o.increment) : cur + Number(o.increment);
      else if ("decrement" in o) patch[k] = typeof cur === "bigint" ? cur - BigInt(o.decrement) : cur - Number(o.decrement);
      else if ("multiply" in o) patch[k] = typeof cur === "bigint" ? cur * BigInt(o.multiply) : cur * Number(o.multiply);
      continue;
    }
    patch[k] = coerce(f, v);
  }
  for (const f of MODELS[model].fields) if (f.isUpdatedAt && !(f.name in patch)) patch[f.name] = new Date();
  const next = { ...row, ...patch };
  checkUnique(model, next, row);
  patchRow(model, row, patch);
}
function findRows(model: string, where: any): Row[] {
  const id = idField(model);
  if (where && typeof where[id] === "string" && Object.keys(where).length >= 1) { const hit = store.byId[model].get(where[id]); return hit && matches(model, hit, where) ? [hit] : []; }
  return store.tables[model].filter((r) => matches(model, r, where));
}
function findUniqueRow(model: string, where: any, soft = false): Row {
  const r = findRows(model, where)[0];
  if (!r && !soft) throw new PrismaClientKnownRequestError(`No ${model} found`, { code: "P2025", meta: { cause: "Record to update not found." } });
  return r;
}

/* ---------------------------------------------------------------- delegate */
function pick(model: string, args: any = {}): Row[] {
  let rows = findRows(model, args.where);
  if (args.orderBy && args.take === 1 && !args.skip && !Array.isArray(args.orderBy) && Object.keys(args.orderBy).length === 1) {
    // fast path for "latest record" lookups (audit chain head)
    const [[field, spec]] = Object.entries(args.orderBy); const dir = typeof spec === "string" ? spec : (spec as any).sort;
    if (fieldOf(model, field)?.kind !== "object") { let best: Row | undefined; for (const r of rows) { if (r[field] == null) continue; if (!best || (dir === "desc" ? cmpVal(r[field]) > cmpVal(best[field]) : cmpVal(r[field]) < cmpVal(best[field]))) best = r; } return best ? [best] : []; }
  }
  rows = sortRows(model, rows, args.orderBy);
  if (args.cursor) { const i = rows.findIndex((r) => matches(model, r, args.cursor)); rows = i >= 0 ? rows.slice(i) : []; }
  if (args.skip) rows = rows.slice(args.skip);
  if (args.take !== undefined) rows = args.take < 0 ? rows.slice(args.take) : rows.slice(0, args.take);
  if (args.distinct) { const seen = new Set<string>(); rows = rows.filter((r) => { const k = (args.distinct as string[]).map((d) => String(r[d])).join("|"); if (seen.has(k)) return false; seen.add(k); return true; }); }
  return rows;
}

function makeDelegate(model: string) {
  const write = <T>(fn: () => T): Promise<T> => { const r = fn(); changed(); return Promise.resolve(r); };
  return {
    findMany: async (a: any = {}) => pick(model, a).map((r) => project(model, r, a)),
    findFirst: async (a: any = {}) => { const r = pick(model, { ...a, take: 1 })[0]; return r ? project(model, r, a) : null; },
    findFirstOrThrow: async (a: any = {}) => { const r = pick(model, { ...a, take: 1 })[0]; if (!r) throw new PrismaClientKnownRequestError(`No ${model} found`, { code: "P2025" }); return project(model, r, a); },
    findUnique: async (a: any) => { const r = findRows(model, a.where)[0]; return r ? project(model, r, a) : null; },
    findUniqueOrThrow: async (a: any) => project(model, findUniqueRow(model, a.where), a),
    count: async (a: any = {}) => findRows(model, a.where).length,
    aggregate: async (a: any = {}) => {
      const rows = findRows(model, a.where); const out: Row = {};
      for (const agg of ["_sum", "_avg", "_min", "_max"] as const) if (a[agg]) {
        out[agg] = {};
        for (const k of Object.keys(a[agg])) {
          const vals = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
          const big = fieldOf(model, k)!.type === "BigInt";
          if (agg === "_sum") out[agg][k] = vals.length ? vals.reduce((s, v) => (big ? s + BigInt(v) : s + Number(v)), big ? 0n : 0) : null;
          if (agg === "_avg") out[agg][k] = vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null;
          if (agg === "_min") out[agg][k] = vals.length ? vals.reduce((m, v) => (cmpVal(v) < cmpVal(m) ? v : m)) : null;
          if (agg === "_max") out[agg][k] = vals.length ? vals.reduce((m, v) => (cmpVal(v) > cmpVal(m) ? v : m)) : null;
        }
      }
      if (a._count) out._count = a._count === true ? rows.length : Object.fromEntries(Object.keys(a._count).map((k) => [k, k === "_all" ? rows.length : rows.filter((r) => r[k] != null).length]));
      return out;
    },
    groupBy: async (a: any) => {
      const groups = new Map<string, Row[]>();
      for (const r of findRows(model, a.where)) { const key = JSON.stringify(a.by.map((b: string) => cmpVal(r[b]))); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(r); }
      return [...groups.values()].map((rows) => { const o: Row = Object.fromEntries(a.by.map((b: string) => [b, rows[0][b]])); if (a._count) o._count = Object.fromEntries(Object.keys(a._count).map((k) => [k, rows.length])); if (a._sum) o._sum = Object.fromEntries(Object.keys(a._sum).map((k) => [k, rows.reduce((s, r) => (typeof r[k] === "bigint" ? s + r[k] : Number(s) + Number(r[k] ?? 0)), typeof rows[0][k] === "bigint" ? 0n : 0)])); return o; });
    },
    create: (a: any) => write(() => project(model, createRow(model, a.data), a)),
    createMany: (a: any) => write(() => { const data = Array.isArray(a.data) ? a.data : [a.data]; let n = 0; for (const d of data) { try { createRow(model, d); n++; } catch (e) { if (!(a.skipDuplicates && e instanceof PrismaClientKnownRequestError)) throw e; } } return { count: n }; }),
    createManyAndReturn: (a: any) => write(() => (Array.isArray(a.data) ? a.data : [a.data]).map((d: Row) => project(model, createRow(model, d), a))),
    update: (a: any) => write(() => { const r = findUniqueRow(model, a.where); applyUpdate(model, r, a.data); return project(model, r, a); }),
    updateMany: (a: any) => write(() => { const rows = findRows(model, a.where); for (const r of rows) applyUpdate(model, r, a.data); return { count: rows.length }; }),
    upsert: (a: any) => write(() => { const r = findRows(model, a.where)[0]; if (r) { applyUpdate(model, r, a.update); return project(model, r, a); } return project(model, createRow(model, a.create), a); }),
    delete: (a: any) => write(() => { const r = findUniqueRow(model, a.where); const out = project(model, r, a); cascade(model, r); removeRow(model, r); return out; }),
    deleteMany: (a: any = {}) => write(() => { const rows = findRows(model, a.where); for (const r of rows) { cascade(model, r); removeRow(model, r); } return { count: rows.length }; }),
  };
}
const CASCADE: Record<string, string[]> = { Invoice: ["lines", "events", "messages"] }; // onDelete: Cascade in the schema
function cascade(model: string, row: Row) { for (const k of CASCADE[model] ?? []) for (const c of related(model, row, k)) removeRow(fieldOf(model, k)!.type, c); }

/* ---------------------------------------------------------------- client */
type Hook = (p: { model: string; operation: string; args: any; query: (a: any) => Promise<any> }) => Promise<any>;
const OPS = ["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy", "create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"];

function buildClient(hooks: Hook[], inTx: boolean): any {
  const client: any = {};
  for (const m of Object.keys(MODELS)) {
    const base = makeDelegate(m) as any;
    const d: any = {};
    for (const op of OPS) {
      d[op] = (args: any) => {
        const run = (i: number, a: any): Promise<any> => (i < 0 ? base[op](a) : hooks[i]({ model: m, operation: op, args: a, query: (next: any) => run(i - 1, next) }));
        return run(hooks.length - 1, args);
      };
    }
    client[delegateName(m)] = d;
  }
  client.$transaction = async (arg: any, _opts?: any) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    if (inTx || undo) return arg(inTx ? client : buildClient(hooks, true));
    undo = [];
    try { const r = await arg(buildClient(hooks, true)); undo = null; return r; }
    catch (e) { const log = undo; undo = null; for (let i = log.length - 1; i >= 0; i--) log[i](); changed(); throw e; }
  };
  client.$extends = (ext: any) => {
    const h = ext?.query?.$allModels?.$allOperations;
    return h ? buildClient([...hooks, h], inTx) : client;
  };
  client.$executeRaw = async () => 0;
  client.$queryRaw = async () => [];
  client.$executeRawUnsafe = async (sql: string) => {
    if (/TRUNCATE/i.test(sql)) { for (const [, t] of sql.matchAll(/"(\w+)"/g)) if (store.tables[t]) { store.tables[t] = []; store.byId[t] = new Map(); } changed(); }
    return 0;
  };
  client.$queryRawUnsafe = async () => [];
  client.$connect = async () => {}; client.$disconnect = async () => {}; client.$on = () => {};
  return client;
}

export class PrismaClient { constructor() { return buildClient([], false); } }

/* ---------------------------------------------------------------- snapshot */
const enc = (v: any) => (v instanceof Date ? { $d: v.toISOString() } : typeof v === "bigint" ? { $b: v.toString() } : v);
export function dumpStore(): string {
  const out: Record<string, any[]> = {};
  for (const [m, rows] of Object.entries(store.tables)) if (rows.length) out[m] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, enc(v)])));
  return JSON.stringify(out);
}
export function loadStore(json: string | Record<string, any[]>) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  for (const m of Object.keys(MODELS)) { store.tables[m] = []; store.byId[m] = new Map(); }
  for (const [m, rows] of Object.entries(data as Record<string, any[]>)) {
    const id = idField(m);
    for (const raw of rows) {
      const r: Row = {};
      for (const [k, v] of Object.entries(raw)) r[k] = v && typeof v === "object" && "$d" in v ? new Date(v.$d) : v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v;
      store.tables[m].push(r); store.byId[m].set(r[id], r);
    }
  }
}
export const MODEL_NAMES = Object.keys(MODELS);
export { MODEL_BY_DELEGATE };
