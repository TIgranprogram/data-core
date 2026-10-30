import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DictsService } from './dicts.service';
import { DICT, DICTS, type Doc } from './dicts.defs';
import { trackMoved, type MovedLog, MOVED_IDS_MAX } from './dicts.moved';

type Call = { coll: string; op: string; filter: unknown; update?: Record<string, unknown>; opts?: unknown };

/** Память вместо Mongo: документы по коллекциям, журнал записей по порядку, счётчик `busy` по коллекциям. */
function fake(data: Record<string, Record<string, unknown>[]>, counts: Record<string, number> = {}) {
  const calls: Call[] = [];
  const db = {
    collection: (coll: string) => {
      const rows = () => data[coll] ?? [];
      const chain = (list: unknown[]) => { const c = { sort: () => c, limit: () => c, project: () => c, toArray: async () => list }; return c; };
      return {
        find: () => chain(rows()),
        findOne: async (f: { _id?: unknown }) => (f?._id ? rows().find((r) => String(r._id) === String(f._id)) ?? null : rows()[0] ?? null),
        countDocuments: async () => counts[coll] ?? 0,
        aggregate: () => ({ toArray: async () => [] }),
        updateMany: async (filter: unknown, update: Record<string, unknown>, opts?: unknown) => { calls.push({ coll, op: 'updateMany', filter, update, opts }); return { modifiedCount: 3 }; },
        updateOne: async (filter: unknown, update: Record<string, unknown>) => { calls.push({ coll, op: 'updateOne', filter, update }); return { modifiedCount: 1, matchedCount: 1 }; },
      };
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new DictsService({ db } as never, undefined, audit as never);
  return { svc, calls, audit, db };
}
const oid = () => new Types.ObjectId();
const cascade = (calls: Call[]) => calls.filter((c) => c.op === 'updateMany');
const setOf = (c: Call) => (c.update as { $set: Record<string, unknown> }).$set;

describe('справочники: каскад переименования (refBy: name)', () => {
  it('у каждого справочника есть паспорт: разделы и способ связи; со строковой связью — ровно девять', () => {
    for (const d of DICTS) { expect(d.sections.length).toBeGreaterThan(0); expect(['name', 'id']).toContain(d.refBy); }
    expect(DICTS.filter((d) => d.refBy === 'name').map((d) => d.key).sort()).toEqual(
      ['colors', 'invoiceTypes', 'metalAssortments', 'paymentForms', 'passportSortament', 'persons', 'steelGrades', 'units', 'writeOffReasons'].sort());
  });

  it('единицы: сначала перенос в materials и supplyrequests, потом имя в справочнике', async () => {
    const id = oid();
    const { svc, calls } = fake({ units: [{ _id: id, symbol: 'шт', label: 'Штука', key: 'u-sht' }] });
    const r = await svc.update('units', String(id), { symbol: 'штук' });
    expect(calls.map((c) => `${c.coll}:${c.op}`)).toEqual(['materials:updateMany', 'supplyrequests:updateMany', 'units:updateOne']);
    expect(setOf(calls[0]).unit).toBe('штук');
    expect(setOf(calls[1])).toMatchObject({ unit: 'штук', editedInApp: true });
    expect(setOf(calls[2]).symbol).toBe('штук');
    expect(r.moved).toBe(6);
  });

  it('формы оплаты: шапка заказа и строки', async () => {
    const id = oid();
    const { svc, calls } = fake({ dict_values: [{ _id: id, dict: 'paymentForms', name: 'б/р 30%' }] });
    await svc.update('paymentForms', String(id), { name: 'безнал 30%' });
    expect(cascade(calls).map((c) => c.coll)).toEqual(['salesorders', 'incomes']);
    expect(setOf(cascade(calls)[0]).paymentForm).toBe('безнал 30%');
    expect(setOf(cascade(calls)[1]).paymentForm).toBe('безнал 30%');
    expect(calls[calls.length - 1]).toMatchObject({ coll: 'dict_values', op: 'updateOne' });
  });

  it('типы счетов: supplyrequests.sheetExtra.invoiceType', async () => {
    const id = oid();
    const { svc, calls } = fake({ dict_values: [{ _id: id, dict: 'invoiceTypes', name: 'УПД' }] });
    await svc.update('invoiceTypes', String(id), { name: 'УПД новый' });
    expect(setOf(cascade(calls)[0])).toMatchObject({ 'sheetExtra.invoiceType': 'УПД новый', editedInApp: true });
  });

  it('цвета: materials.colors.$, incomes.color, supplyrequests.color', async () => {
    const id = oid();
    const { svc, calls } = fake({ color_references: [{ _id: id, name: 'RAL 6005' }] });
    await svc.update('colors', String(id), { name: 'RAL 6005 мох' });
    expect(cascade(calls).map((c) => c.coll).sort()).toEqual(['incomes', 'materials', 'supplyrequests']);
    expect(setOf(cascade(calls).find((c) => c.coll === 'materials')!)).toEqual({ 'colors.$': 'RAL 6005 мох' });
  });

  it('причины списания: stockmovements.reason, без метки заявок', async () => {
    const id = oid();
    const { svc, calls } = fake({ dict_values: [{ _id: id, dict: 'writeOffReasons', name: 'Брак' }] });
    await svc.update('writeOffReasons', String(id), { name: 'Заводской брак' });
    const c = cascade(calls);
    expect(c).toHaveLength(1);
    expect(c[0].coll).toBe('stockmovements');
    expect(setOf(c[0])).toEqual({ reason: 'Заводской брак' });
  });

  it.each([['steelGrades', 'materialGrade'], ['metalAssortments', 'assortment']])('%s: materials.%s', async (key, field) => {
    const id = oid();
    const { svc, calls } = fake({ dict_values: [{ _id: id, dict: key, name: 'Ст3' }] });
    await svc.update(key, String(id), { name: 'Ст3сп' });
    expect(cascade(calls)).toHaveLength(1);
    expect(setOf(cascade(calls)[0])[field]).toBe('Ст3сп');
  });

  it('сотрудник: смена имени — каскад по requestedBy; смена телефона — каскад не вызван', async () => {
    const id = oid();
    const mk = () => fake({ persons: [{ _id: id, firstName: 'Иван', lastName: 'Петров', phone: '1' }] });
    const a = mk();
    const r = await a.svc.update('persons', String(id), { firstName: 'Пётр' });
    expect(cascade(a.calls)).toHaveLength(1);
    expect(a.calls[0].coll).toBe('supplyrequests');
    expect(setOf(a.calls[0]).requestedBy).toBe('Пётр Петров');
    expect(r.moved).toBe(3);
    const b = mk();
    const r2 = await b.svc.update('persons', String(id), { phone: '+7 900', position: 'Сварщик' });
    expect(cascade(b.calls)).toHaveLength(0);
    expect(r2.moved).toBe(0);
    expect(b.audit.log).not.toHaveBeenCalled();
  });

  it('размеры материалов: изделия правятся через arrayFilters; сначала перенос, потом имя', async () => {
    const id = oid(), mat = oid();
    const { svc, calls } = fake({ dict_values: [{ _id: id, dict: 'passportSortament', name: '∅89×3', material: 'STEEL' }, { _id: mat, dict: 'passportMaterials', code: 'STEEL', name: 'Сталь' }] });
    await svc.update('passportSortament', String(id), { name: '∅89×3,5', material: 'STEEL' });
    const c = cascade(calls);
    expect(c).toHaveLength(1);
    expect(c[0].coll).toBe('products');
    expect(c[0].opts).toMatchObject({ arrayFilters: [{ 'r.materialId': { $in: expect.arrayContaining([mat]) } }, { z: '∅89×3' }] });
    expect(setOf(c[0])).toEqual({ 'materialsSpec.rows.$[r].sizes.$[z]': '∅89×3,5' });
    expect(calls.findIndex((x) => x.op === 'updateMany')).toBeLessThan(calls.findIndex((x) => x.coll === 'dict_values'));
  });

  it('справочник по id (категории): переименование без каскада, moved = 0, в журнал не пишет «переименовано»', async () => {
    const id = oid();
    const { svc, calls, audit } = fake({ categories: [{ _id: id, name: 'Метизы', type: 'material' }] });
    const r = await svc.update('categories', String(id), { name: 'Крепёж' });
    expect(cascade(calls)).toHaveLength(0);
    expect(r.moved).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('смена названия пишет dict.renamed {from, to, moved}; дубль названия — 409 до любого переноса', async () => {
    const id = oid();
    const { svc, calls, audit } = fake({ units: [{ _id: id, symbol: 'шт', key: 'a' }, { _id: oid(), symbol: 'м', key: 'b' }] });
    await expect(svc.update('units', String(id), { symbol: 'М' })).rejects.toBeInstanceOf(ConflictException);
    expect(calls).toHaveLength(0);
    await svc.update('units', String(id), { symbol: 'штук' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'dict.renamed', details: { meta: { dict: 'units', from: 'шт', to: 'штук', moved: 6 } } }));
  });

  it('ppUsage.reassign для той же записи (from == to) ничего не пишет', async () => {
    const id = oid();
    const { db, calls } = fake({});
    const cat = DICT.get('passportCategories')!;
    expect(await cat.reassign(db as never, { _id: id, code: 'TRN' } as Doc, { _id: id, code: 'TRN' } as Doc)).toBe(0);
    const el = DICT.get('passportElements')!;
    expect(await el.reassign(db as never, { _id: id } as Doc, { _id: id } as Doc)).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe('справочники: права на удаление, встроенное, usage', () => {
  const admin = { role: 'admin' }, manager = { role: 'manager' };

  it('занятое: менеджеру 403 с русским текстом, админу 409 («заменить»); свободное удаляется', async () => {
    const id = oid();
    const busy = fake({ units: [{ _id: id, symbol: 'шт', key: 'k' }, { _id: oid(), symbol: 'м', key: 'm' }] }, { materials: 1 });
    await expect(busy.svc.remove('units', String(id), manager)).rejects.toThrow(new ForbiddenException('Удаление занятого значения доступно администратору'));
    await expect(busy.svc.remove('units', String(id), admin)).rejects.toBeInstanceOf(ConflictException);
    expect(busy.calls).toHaveLength(0);
    const free = fake({ units: [{ _id: id, symbol: 'шт', key: 'k' }] });
    expect(await free.svc.remove('units', String(id), manager)).toEqual({ id: String(id), deleted: true });
    expect(free.calls[0]).toMatchObject({ coll: 'units', op: 'updateOne' });
  });

  it('встроенное нельзя удалить ни админу, ни владельцу; свою категорию паспорта — можно', async () => {
    const id = oid(), own = oid();
    const { svc } = fake({ dict_values: [{ _id: id, dict: 'passportCategories', code: 'ALL', name: 'Для всех' }, { _id: own, dict: 'passportCategories', code: 'MY', name: 'Моя' }] });
    await expect(svc.remove('passportCategories', String(id), { role: 'admin', isOwner: true })).rejects.toThrow(/встроено в программу/);
    await expect(svc.remove('passportCategories', String(own), manager)).resolves.toMatchObject({ deleted: true });
  });

  it('оформление: коды PDF встроены; значения оформления без связи с данными', async () => {
    const st = DICT.get('passportStyle')!;
    for (const code of ['COLOR_TRN', 'COLOR_ALL', 'FRAME_ALL', 'ICON_NO_CLIMB', 'COVER_TRN']) expect(st.locked!({ _id: oid(), code } as Doc)).toBe('Встроено в программу');
    expect(st.locked!({ _id: oid(), code: 'MY_ICON' } as Doc)).toBeNull();
    const id = oid();
    const { svc } = fake({ dict_values: [{ _id: id, dict: 'passportStyle', code: 'COLOR_ALL', name: 'Цвет' }] });
    expect(await svc.usage('passportStyle', String(id))).toEqual({ busy: false, sections: [], tracked: false, locked: 'Встроено в программу' });
  });

  it('merge занятого: менеджеру 403, админу можно; в журнал уходят movedIds', async () => {
    const a = oid(), b = oid(), m1 = oid(), m2 = oid();
    const data = { units: [{ _id: a, symbol: 'шт', key: 'a' }, { _id: b, symbol: 'штук', key: 'b' }], materials: [{ _id: m1 }, { _id: m2 }] };
    const denied = fake(data, { materials: 1 });
    await expect(denied.svc.merge('units', String(a), String(b), manager)).rejects.toBeInstanceOf(ForbiddenException);
    expect(denied.calls).toHaveLength(0);
    const ok = fake(data, { materials: 1 });
    const r = await ok.svc.merge('units', String(a), String(b), admin);
    expect(r.moved).toBe(6);
    expect(ok.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'dict.merged', details: { meta: expect.objectContaining({ dict: 'units', moved: 6, movedIds: [String(m1), String(m2)] }) } }));
  });

  it('merge свободного значения доступен менеджеру', async () => {
    const a = oid(), b = oid();
    const { svc } = fake({ units: [{ _id: a, symbol: 'шт', key: 'a' }, { _id: b, symbol: 'штук', key: 'b' }] });
    await expect(svc.merge('units', String(a), String(b), manager)).resolves.toHaveProperty('moved');
  });

  it('usage: занято → разделы; свободно → пусто; tracked по справочнику', async () => {
    const id = oid();
    const busy = fake({ color_references: [{ _id: id, name: 'RAL 1' }] }, { incomes: 1 });
    expect(await busy.svc.usage('colors', String(id))).toEqual({ busy: true, sections: ['Остатки', 'Заявки', 'Позиции и оплаты'], tracked: true, locked: null });
    const free = fake({ color_references: [{ _id: id, name: 'RAL 1' }] });
    expect(await free.svc.usage('colors', String(id))).toEqual({ busy: false, sections: [], tracked: true, locked: null });
    const sv = fake({ dict_values: [{ _id: id, dict: 'services', name: 'Доставка' }] });
    expect((await sv.svc.usage('services', String(id))).tracked).toBe(false);
  });

  it('список и карточка без used/related; у «Текстов паспорта» used остаётся; в dict — sections, refBy, locked', async () => {
    const id = oid();
    const { svc } = fake({ units: [{ _id: id, symbol: 'шт', key: 'k' }] });
    const l = await svc.list('units');
    expect(l.items[0]).not.toHaveProperty('used');
    expect(l.dict).toMatchObject({ sections: ['Остатки', 'Заявки'], refBy: 'name', locked: [] });
    const g = await svc.get('units', String(id));
    expect(g).not.toHaveProperty('used');
    expect(g).not.toHaveProperty('related');
    const cats = fake({ dict_values: [{ _id: id, dict: 'passportCategories', code: 'TRN', name: 'Тренажёры' }] });
    expect((await cats.svc.list('passportCategories')).dict.locked).toEqual([{ id: String(id), code: 'TRN', reason: 'Встроено в программу' }]);
    const ph = fake({ dict_values: [{ _id: id, dict: 'passportPhrases', name: 'Раздел', section: 'purpose' }] });
    expect((await ph.svc.list('passportPhrases')).items[0]).toHaveProperty('used');
  });
});

describe('trackMoved: id перенесённых записей', () => {
  it('запоминает id до updateMany и режет по лимиту', async () => {
    const rows = Array.from({ length: MOVED_IDS_MAX + 20 }, () => ({ _id: oid() }));
    const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));
    const db = { collection: () => ({ find: () => ({ limit: (n: number) => ({ toArray: async () => rows.slice(0, n) }) }), updateMany }) };
    const log: MovedLog = { ids: [], truncated: false };
    await trackMoved(db as never, log).collection('x').updateMany({ a: 1 }, { $set: { a: 2 } });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(log.ids).toHaveLength(MOVED_IDS_MAX);
    expect(log.truncated).toBe(true);
  });
});
