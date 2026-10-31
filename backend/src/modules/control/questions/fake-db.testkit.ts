/* Мини-база в памяти для spec «Разбора»: ровно то, что нужно сервису. В рантайме не используется. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types } from 'mongoose';

type Doc = Record<string, any>;

const get = (d: Doc, path: string): any => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), d);
const norm = (v: any) => (v instanceof Date ? v.getTime() : v instanceof Types.ObjectId ? String(v) : v);

/** structuredClone теряет ObjectId (становится обычным объектом) — копируем сами. */
function copy<T>(x: T): T {
  if (x instanceof Date) return new Date(x.getTime()) as T;
  if (x instanceof Types.ObjectId) return new Types.ObjectId(String(x)) as T;
  if (Array.isArray(x)) return x.map(copy) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Doc).map(([k, v]) => [k, copy(v)])) as T;
  return x;
}

function setPath(d: Doc, path: string, val: any) {
  const ks = path.split('.');
  let o = d;
  for (const k of ks.slice(0, -1)) o = o[k] ??= {};
  o[ks[ks.length - 1]] = val;
}

function test(v: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof Types.ObjectId) && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
    const x = norm(v);
    return Object.entries(cond).every(([op, c]: [string, any]) => {
      if (op === '$in') return c.map(norm).includes(x);
      if (op === '$nin') return !c.map(norm).includes(x);
      if (op === '$ne') return x !== norm(c);
      if (op === '$gte') return x != null && x >= norm(c);
      if (op === '$gt') return x != null && x > norm(c);
      if (op === '$lte') return x != null && x <= norm(c);
      if (op === '$lt') return x != null && x < norm(c);
      if (op === '$exists') return (v !== undefined) === c;
      throw new Error(`fake-db: оператор ${op} не поддержан`);
    });
  }
  if (cond === null) return v == null;
  return norm(v) === norm(cond);
}
const match = (d: Doc, f: Doc) => Object.entries(f).every(([k, c]) => test(get(d, k), c));

export class FakeColl {
  rows: Doc[] = [];
  /** Уникальный частичный ключ: [поле, условие-флаг], как в {key:1} при active:true. */
  unique: { field: string; flag: string } | null = null;

  private clone<T>(x: T): T { return copy(x); }
  private cursor(list: Doc[]) {
    let out = list;
    const c: any = {
      sort: (s: Doc) => { const [[k, dir]] = Object.entries(s); out = [...out].sort((a, b) => ((norm(get(a, k)) ?? 0) < (norm(get(b, k)) ?? 0) ? -1 : (norm(get(a, k)) ?? 0) > (norm(get(b, k)) ?? 0) ? 1 : 0) * (dir as number)); return c; },
      skip: (n: number) => { out = out.slice(n); return c; },
      limit: (n: number) => { out = out.slice(0, n); return c; },
      toArray: async () => out.map((d) => this.clone(d)),
    };
    return c;
  }
  async createIndex() { return 'ok'; }
  async findOne(f: Doc = {}, o: any = {}) {
    let list = this.rows.filter((r) => match(r, f));
    if (o.sort) list = await this.cursor(list).sort(o.sort).toArray();
    return list[0] ? this.clone(list[0]) : null;
  }
  find(f: Doc = {}) { return this.cursor(this.rows.filter((r) => match(r, f))); }
  async countDocuments(f: Doc = {}) { return this.rows.filter((r) => match(r, f)).length; }
  async insertOne(d: Doc) {
    if (this.unique) {
      const { field, flag } = this.unique;
      if (d[flag] === true && this.rows.some((r) => r[flag] === true && r[field] === d[field])) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
    this.rows.push(this.clone(d));
    return { insertedId: d._id };
  }
  private apply(r: Doc, u: Doc) {
    for (const [k, v] of Object.entries(u.$set ?? {})) setPath(r, k, this.clone(v));
    for (const [k, v] of Object.entries(u.$inc ?? {})) setPath(r, k, (get(r, k) ?? 0) + (v as number));
    if (this.unique) {
      const { field, flag } = this.unique;
      if (r[flag] === true && this.rows.some((x) => x !== r && x[flag] === true && x[field] === r[field])) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    }
  }
  async updateOne(f: Doc, u: Doc, o: { upsert?: boolean } = {}) {
    const r = this.rows.find((x) => match(x, f));
    if (!r && o.upsert) {
      // upsert: поля-равенства из фильтра + $setOnInsert + $set
      const d: Doc = {};
      for (const [k, v] of Object.entries(f)) if (!(v && typeof v === 'object' && Object.keys(v).some((x) => x.startsWith('$')))) setPath(d, k, this.clone(v));
      for (const [k, v] of Object.entries(u.$setOnInsert ?? {})) setPath(d, k, this.clone(v));
      this.rows.push(d); this.apply(d, u);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    if (!r) return { matchedCount: 0, modifiedCount: 0 };
    const before = this.clone(r);
    try { this.apply(r, u); } catch (e) { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, before); throw e; }
    return { matchedCount: 1, modifiedCount: 1 };
  }
  async replaceOne(f: Doc, d: Doc) {
    const i = this.rows.findIndex((x) => match(x, f));
    if (i < 0) return { matchedCount: 0 };
    this.rows[i] = this.clone(d);
    return { matchedCount: 1 };
  }
  async deleteOne(f: Doc) { const i = this.rows.findIndex((x) => match(x, f)); if (i >= 0) this.rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; }
  aggregate() {
    const g = new Map<string, number>();
    for (const r of this.rows) g.set(r.status, (g.get(r.status) ?? 0) + 1);
    return { toArray: async () => [...g].map(([_id, n]) => ({ _id, n })) };
  }
}

export class FakeDb {
  colls = new Map<string, FakeColl>();
  collection(name: string) {
    let c = this.colls.get(name);
    if (!c) { c = new FakeColl(); if (name === 'app_control_questions') c.unique = { field: 'key', flag: 'active' }; this.colls.set(name, c); }
    return c;
  }
  seed(name: string, docs: Doc[]) { this.collection(name).rows.push(...docs); return this; }
}
