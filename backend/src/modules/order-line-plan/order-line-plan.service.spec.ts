/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderLinePlanService } from './order-line-plan.service';

type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? +a === +b : String(a ?? null) === String(b ?? null));

/** Мини-коллекция: равенство, $in, $ne, регулярка; update: $set / $setOnInsert / $inc / $unset, upsert. */
class Coll {
  rows: Row[] = [];
  private ok(d: Row, f: Row): boolean {
    return Object.entries(f).every(([k, v]) => {
      if (v instanceof RegExp) return v.test(String(d[k] ?? ''));
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && !(v instanceof Date) && '$in' in v) return v.$in.some((x: unknown) => same(d[k], x));
      return same(d[k], v);
    });
  }
  private cur(list: () => Row[]) {
    const c: Row = { sort: () => c, limit: () => c, toArray: async () => list(), then: (r: any) => Promise.resolve(list()).then(r) };
    return c;
  }
  find = (f: Row = {}) => this.cur(() => this.rows.filter((d) => this.ok(d, f)));
  findOne = async (f: Row = {}) => this.rows.find((d) => this.ok(d, f)) ?? null;
  countDocuments = async (f: Row = {}) => this.rows.filter((d) => this.ok(d, f)).length;
  insertOne = async (d: Row) => { const _id = new Types.ObjectId(); this.rows.push({ _id, ...d }); return { insertedId: _id }; };
  insertMany = async (ds: Row[]) => { for (const d of ds) await this.insertOne(d); };
  private apply(row: Row, u: Row) {
    Object.assign(row, u.$set ?? {});
    for (const [k, n] of Object.entries<number>(u.$inc ?? {})) row[k] = (row[k] ?? 0) + n;
    for (const k of Object.keys(u.$unset ?? {})) delete row[k];
  }
  updateOne = async (f: Row, u: Row, o: Row = {}) => {
    const row = this.rows.find((d) => this.ok(d, f));
    if (row) { this.apply(row, u); return { matchedCount: 1 }; }
    if (o.upsert && !this.rows.some((d) => this.ok(d, f))) { const n = { _id: new Types.ObjectId(), ...(u.$setOnInsert ?? {}) }; this.rows.push(n); return { matchedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0 };
  };
  updateMany = async (f: Row, u: Row) => { for (const d of this.rows.filter((x) => this.ok(x, f))) this.apply(d, u); return {}; };
}

describe('OrderLinePlanService (C041 Э1)', () => {
  const id = () => new Types.ObjectId();
  let c: Record<string, Coll>, svc: OrderLinePlanService;
  let cut: Types.ObjectId, weld: Types.ObjectId, prod: Types.ObjectId, inc: Types.ObjectId, part: Types.ObjectId;
  const T0 = new Date('2026-11-01T00:00:00Z');

  beforeEach(() => {
    c = Object.fromEntries(['incomes', 'products', 'worktypes', 'worktasks', 'users', 'dict_values', 'orderlineplans'].map((n) => [n, new Coll()]));
    svc = new OrderLinePlanService({ db: { collection: (n: string) => c[n] } } as never);
    [cut, weld, prod, inc, part] = Array.from({ length: 5 }, id);
    c.worktypes.rows.push({ _id: cut, name: 'Резка', deletedAt: null }, { _id: weld, name: 'Сварка', deletedAt: null });
    c.products.rows.push({ _id: prod, name: 'Беседка', deletedAt: null, updatedAt: T0, parts: [{ _id: part, name: 'Стойки', qty: 4, checked: true }], workTypes: [{ workTypeId: cut }, { workTypeId: weld, partRowId: part, hours: 2 }] });
    c.incomes.rows.push({ _id: inc, productId: prod, deletedAt: null });
  });

  it('первое открытие: план копируется из изделия, повторное — тот же план (без дублей)', async () => {
    const a = await svc.byIncome(String(inc));
    const b = await svc.byIncome(String(inc));
    expect(c.orderlineplans.rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ rev: 1, origin: 'product', productName: 'Беседка', productChangedSinceCopy: false, diff: { changed: false } });
    expect(a.steps.map((s) => [s.workTypeName, s.partName, s.hours])).toEqual([['Резка', 'Изделие целиком', null], ['Сварка', 'Стойки', 2]]);
    expect(a.parts[0]).toMatchObject({ name: 'Стойки', qty: 4, checked: true });
  });

  it('нет изделия — пустой ручной план; позиция в корзине — 404', async () => {
    const free = id();
    const trash = id();
    c.incomes.rows.push({ _id: free, deletedAt: null }, { _id: trash, deletedAt: new Date() });
    expect(await svc.byIncome(String(free))).toMatchObject({ origin: 'manual', productId: null, parts: [], steps: [] });
    await expect(svc.byIncome(String(trash))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PUT: rev растёт, старый rev — 409; новая часть попадает в справочник; diff показывает отличие от изделия', async () => {
    const p = await svc.byIncome(String(inc));
    const saved = await svc.save(p.id, { rev: 1, parts: [{ id: p.parts[0].id, name: 'Стойки', qty: 4 }, { id: 'n', name: 'Навес', qty: 1 }], steps: [{ workTypeId: String(cut), partRowId: 'n', hours: 3 }] }, String(id()));
    expect(saved.rev).toBe(2);
    expect(saved.steps[0]).toMatchObject({ partName: 'Навес', hours: 3 });
    expect(saved.diff).toMatchObject({ changed: true, added: 2, removed: 2 });
    expect(c.dict_values.rows.filter((d) => d.dict === 'productParts').map((d) => d.name)).toContain('Навес');
    await expect(svc.save(p.id, { rev: 1, parts: [], steps: [] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('«Проверено»: ставится и снимается, rev растёт', async () => {
    const p = await svc.byIncome(String(inc));
    const by = String(id());
    c.users.rows.push({ _id: new Types.ObjectId(by), displayName: 'Мастер' });
    const on = await svc.check(p.id, { kind: 'step', rowId: p.steps[0].id, checked: true }, by);
    expect(on.steps[0]).toMatchObject({ checked: true, checkedByName: 'Мастер' });
    expect(on.rev).toBe(2);
    expect((await svc.check(p.id, { kind: 'step', rowId: p.steps[0].id, checked: false })).steps[0].checked).toBe(false);
    await expect(svc.check(p.id, { kind: 'part', rowId: String(id()), checked: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('«и в продукцию»: изделие меняется, повтор со старой датой — 409', async () => {
    const p = await svc.byIncome(String(inc));
    const e = await svc.save(p.id, { rev: 1, parts: [{ id: p.parts[0].id, name: 'Стойки', qty: 6 }], steps: [{ workTypeId: String(cut), partRowId: p.parts[0].id }] });
    const r = await svc.applyToProduct(p.id, { productUpdatedAt: e.productUpdatedAt!.toISOString() });
    expect(c.products.rows[0].parts[0].qty).toBe(6);
    expect(c.products.rows[0].workTypes).toHaveLength(1);
    expect(r.plan.diff.changed).toBe(false);
    expect(r.product.updatedAt.getTime()).toBeGreaterThan(T0.getTime());
    await expect(svc.applyToProduct(p.id, { productUpdatedAt: T0.toISOString() })).rejects.toBeInstanceOf(ConflictException);
  });

  it('изделие изменили после копии: флаг, «взять заново» пересобирает план', async () => {
    const p = await svc.byIncome(String(inc));
    c.products.rows[0].updatedAt = new Date('2026-11-05T00:00:00Z');
    c.products.rows[0].workTypes = [{ workTypeId: weld }];
    const stale = await svc.byIncome(String(inc));
    expect(stale.productChangedSinceCopy).toBe(true);
    const fresh = await svc.resetFromProduct(p.id);
    expect(fresh.steps.map((s) => s.workTypeName)).toEqual(['Сварка']);
    expect(fresh).toMatchObject({ productChangedSinceCopy: false, rev: 2 });
  });

  it('смена изделия у позиции: план не затирается, флаг есть, перенос в изделие запрещён', async () => {
    const p = await svc.byIncome(String(inc));
    c.incomes.rows[0].productId = id();
    const r = await svc.byIncome(String(inc));
    expect(r.steps).toHaveLength(2);
    expect(r.productChangedSinceCopy).toBe(true);
    await expect(svc.applyToProduct(p.id, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('запуск: шаги плана как снимок со stepId/partName/hours, счёт непроверенного; пометка «запущено»; правка после — флаг', async () => {
    const p = await svc.byIncome(String(inc));
    const m = await svc.forLaunch([{ _id: inc, productId: prod }]);
    const one = m.get(String(inc))!;
    expect(one).toMatchObject({ total: 2, unchecked: 2 });
    expect(one.steps[1]).toMatchObject({ name: 'Сварка', partName: 'Стойки', hours: 2 });
    expect(String(one.steps[1].stepId)).toBe(p.steps[1].id);
    await svc.markLaunched([inc]);
    expect((await svc.byIncome(String(inc))).changedAfterLaunch).toBe(false);
    c.orderlineplans.rows[0].updatedAt = new Date(Date.now() + 5000);
    expect((await svc.byIncome(String(inc))).changedAfterLaunch).toBe(true);
  });

  it('справочник частей: пока пуст — заводятся части по умолчанию, второй раз не дублируются', async () => {
    await svc.onModuleInit();
    await svc.onModuleInit();
    expect(c.dict_values.rows.map((d) => d.name)).toEqual(['Стойки', 'Навес', 'Наполнение', 'Основание']);
  });
});
