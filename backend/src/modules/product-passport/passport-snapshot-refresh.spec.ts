import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';
import { PassportIssue, type IssueHost } from './passport-issue';
import { carryManual, sameSnapshot } from './passport-snapshot-refresh';
import type { SnapshotSection } from './passport-snapshot-edit';

/** C096 Э1: автоматический текст черновика следует текущим данным; ручные пункты не теряются; конфликт — 409 без записи. */

type D = Record<string, unknown>;
const sec = (key: string, items: Array<[string, string, Partial<{ edited: boolean; original: string }>?]>): SnapshotSection =>
  ({ key, number: '1', title: key, items: items.map(([k, text, x]) => ({ key: k, number: null, text, bullet: false, ...(x || {}) })) });

describe('carryManual', () => {
  it('совпадение ручного текста с шаблоном не отменяет его при следующем обновлении', () => {
    const prev = [sec('use', [['a', 'Б', { edited: true, original: 'А' }]])];
    const same = carryManual(prev, [sec('use', [['a', 'Б']])]);
    const later = carryManual(same.sections, [sec('use', [['a', 'В']])]);
    expect(later.sections[0].items[0]).toMatchObject({ text: 'Б', edited: true, original: 'В' });
  });
  it('ручной пункт переносится, исходный обновляется, автоматический — новый', () => {
    const prev = [sec('use', [['a', 'Мой текст', { edited: true, original: 'Старый A' }], ['b', 'Старый B']])];
    const next = [sec('use', [['a', 'Новый A'], ['b', 'Новый B']])];
    const r = carryManual(prev, next);
    expect(r.conflicts).toEqual([]);
    expect(r.sections[0].items[0]).toEqual(expect.objectContaining({ text: 'Мой текст', edited: true, original: 'Новый A' }));
    expect(r.sections[0].items[1].text).toBe('Новый B');
    expect(next[0].items[0].text).toBe('Новый A'); // сборка не меняется на месте
  });
  it('ключ исчез или встречается дважды — конфликт', () => {
    const prev = [sec('use', [['a', 'Мой', { edited: true, original: 'x' }]])];
    expect(carryManual(prev, [sec('use', [['b', 'B']])]).conflicts).toHaveLength(1);
    expect(carryManual(prev, [sec('use', [['a', 'A'], ['a', 'A2']])]).conflicts).toHaveLength(1);
    expect(carryManual(prev, [sec('other', [['a', 'A']])]).conflicts).toHaveLength(1);
  });
  it('сравнение снимков не зависит от at, editedAt и порядка ключей', () => {
    expect(sameSnapshot({ at: new Date(1), b: 1, a: [1] }, { a: [1], b: 1, at: new Date(2), editedAt: new Date() })).toBe(true);
    expect(sameSnapshot({ a: 1 }, { a: 2 })).toBe(false);
  });
  it('пустой choices после Mongoose minimize не вызывает повторной записи', () => {
    expect(sameSnapshot({ sections: [] }, { sections: [], choices: {} })).toBe(true);
    expect(sameSnapshot({ sections: [] }, { sections: [], choices: { purpose: 'x' } })).toBe(false);
    expect(sameSnapshot({}, { sections: [] })).toBe(false);
  });
});

/** «База» из одного паспорта: каждое чтение — новый документ (как Mongoose), запись — только save(). */
function fakeDb(data: D) {
  const state = { data: JSON.parse(JSON.stringify(data)) as D, saves: 0 };
  const open = () => {
    const mem = JSON.parse(JSON.stringify(state.data)) as D;
    const doc = {
      get: (k: string) => mem[k],
      set: (k: string | D, v?: unknown) => { if (typeof k === 'string') mem[k] = v; else Object.assign(mem, k); },
      toObject: () => JSON.parse(JSON.stringify(mem)),
      save: async () => { state.saves++; state.data = JSON.parse(JSON.stringify(mem)); return doc; },
      get passportCategory() { return mem.passportCategory; },
      _id: mem._id,
    };
    return doc;
  };
  return { open, state };
}

/**
 * Сервис без БД: сборка текста подставляет поля паспорта в шаблон; шаблон и «изделие» меняются в тесте.
 * Разделы: «use» — пункт `a` с названием изделия, `b` — с текстом шаблона; категория KOMPL даёт другой набор ключей.
 */
function setup(passport: D) {
  const id = new Types.ObjectId();
  const { open, state } = fakeDb({ _id: String(id), status: 'draft', passportCategory: 'DIO', ...passport });
  const env = { product: {} as D, template: 'Правило v1', builds: 0 };
  const svc = Object.create(ProductPassportService.prototype) as D;
  svc.model = { findById: () => ({ exec: async () => open() }) };
  svc.findById = async () => open();
  svc.fromProductDiff = async (cur: D) => Object.fromEntries(Object.entries(env.product).filter(([k, v]) => JSON.stringify(cur[k]) !== JSON.stringify(v)));
  svc.buildText = async (p: D) => {
    env.builds++;
    const sections = p.passportCategory === 'KOMPL'
      ? [sec('use', [['z', `Комплекс ${p.name}`]])]
      : [sec('use', [['a', `Изделие ${p.name}, рост до ${p.heightMax}`], ['b', env.template]])];
    return { text: { category: p.passportCategory, purpose: `Для ${p.name}`, install: { text: '' }, sections }, instLeaf: undefined };
  };
  svc.normalize = (d: D) => ({ ...d });
  svc.assertFree = async () => {};
  svc.mi = { check: async () => {} };
  return { svc: svc as unknown as ProductPassportService & D, state, env, id: String(id) };
}
const items = (state: { data: D }) => ((state.data.textSnapshot as { sections: SnapshotSection[] }).sections[0].items);
const prime = async (s: ReturnType<typeof setup>) => { await (s.svc as unknown as { syncDraft: (id: string, o: D) => Promise<boolean> }).syncDraft(s.id, { strict: true, build: true }); s.state.saves = 0; s.env.builds = 0; };

describe('черновик: текст по текущим данным (C096 Э1)', () => {
  it('название и рост из изделия попадают в автоматический текст при открытии', async () => {
    const s = setup({ name: 'Горка', heightMax: 1200 });
    await prime(s);
    s.env.product = { name: 'Горка-2', heightMax: 1400 };
    expect(await s.svc.syncFromProduct(s.id)).toBe(true);
    expect(items(s.state)[0].text).toBe('Изделие Горка-2, рост до 1400');
    expect(s.state.data.purpose).toBe('Для Горка-2');
    expect(s.env.builds).toBe(1); // одна сборка на одно чтение
  });
  it('шаблон категории изменился — следующий просмотр обновляет текст без изменения полей', async () => {
    const s = setup({ name: 'Горка' });
    await prime(s);
    s.env.template = 'Правило v2';
    expect(await s.svc.syncFromProduct(s.id)).toBe(true);
    expect(items(s.state)[1].text).toBe('Правило v2');
  });
  it('ничего не изменилось — повторное чтение ничего не пишет', async () => {
    const s = setup({ name: 'Горка' });
    await prime(s);
    expect(await s.svc.syncFromProduct(s.id)).toBe(false);
    expect(await s.svc.syncFromProduct(s.id)).toBe(false);
    expect(s.state.saves).toBe(0);
  });
  it('пустой список разделов — тоже снимок: одинаковые правки не обновляют его дату', async () => {
    const s = setup({ name: 'Горка' });
    (s.svc as unknown as { buildText: () => Promise<unknown> }).buildText = async () => ({ text: { sections: [], purpose: '', install: { text: '' } } });
    await prime(s);
    const at = (s.state.data.textSnapshot as D).at;
    await s.svc.update(s.id, { note: 'заметка' });
    await s.svc.update(s.id, { note: 'заметка' });
    expect((s.state.data.textSnapshot as D).at).toEqual(at);
  });
  it('ручной абзац остаётся, соседний автоматический обновляется; editedAt не сбрасывается', async () => {
    const s = setup({ name: 'Горка' });
    await prime(s);
    const snap = s.state.data.textSnapshot as D & { sections: SnapshotSection[] };
    snap.sections[0].items[1] = { ...snap.sections[0].items[1], text: 'Своё правило', edited: true, original: 'Правило v1' };
    snap.editedAt = '2026-11-12T10:00:00.000Z';
    s.env.product = { name: 'Горка-2' };
    await s.svc.syncFromProduct(s.id);
    expect(items(s.state)[0].text).toBe('Изделие Горка-2, рост до undefined');
    expect(items(s.state)[1]).toEqual(expect.objectContaining({ text: 'Своё правило', edited: true, original: 'Правило v1' }));
    expect((s.state.data.textSnapshot as D).editedAt).toBe('2026-11-12T10:00:00.000Z');
  });
  it('ручной purpose (manualText) не перезаписывается', async () => {
    const s = setup({ name: 'Горка', manualText: ['purpose'], purpose: 'Своё назначение' });
    await prime(s);
    s.env.product = { name: 'Горка-2' };
    await s.svc.syncFromProduct(s.id);
    expect(s.state.data.purpose).toBe('Своё назначение');
  });
  it('пустое значение изделия не стирает старое (политика productPatch не меняется)', async () => {
    const s = setup({ name: 'Горка', heightMax: 1200 });
    await prime(s);
    s.env.product = {}; // изделие ничего не задаёт
    expect(await s.svc.syncFromProduct(s.id)).toBe(false);
    expect(s.state.data.heightMax).toBe(1200);
  });
  it('выпущенный паспорт не меняется при изменении изделия и шаблона', async () => {
    const s = setup({ name: 'Горка' });
    await prime(s);
    s.state.data.status = 'issued';
    s.env.product = { name: 'Другое' };
    s.env.template = 'Правило v9';
    expect(await s.svc.syncFromProduct(s.id)).toBe(false);
    expect(items(s.state)[1].text).toBe('Правило v1');
    expect(s.env.builds).toBe(0);
  });
});

describe('конфликт ручной правки (C096 Э1)', () => {
  const edited = async () => {
    const s = setup({ name: 'Горка' });
    await prime(s);
    const snap = s.state.data.textSnapshot as D & { sections: SnapshotSection[] };
    snap.sections[0].items[0] = { ...snap.sections[0].items[0], text: 'Мой абзац', edited: true, original: 'x' };
    snap.editedAt = '2026-11-12T10:00:00.000Z';
    return s;
  };
  it('смена категории с исчезнувшим ключом: сохранение — 409, категория и текст прежние', async () => {
    const s = await edited();
    await expect(s.svc.update(s.id, { passportCategory: 'KOMPL' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(s.state.saves).toBe(0);
    expect(s.state.data.passportCategory).toBe('DIO'); // в базе — прежнее (документ не сохранён)
  });
  it('категория изделия сменилась: чтение не меняет паспорт, выпуск — 409 до записи', async () => {
    const s = await edited();
    s.env.product = { passportCategory: 'KOMPL' };
    expect(await s.svc.syncFromProduct(s.id)).toBe(false);
    expect(s.state.saves).toBe(0);
    await expect(s.svc.refreshDraftText(s.id)).rejects.toBeInstanceOf(ConflictException);
    expect(s.state.saves).toBe(0);
  });
  it('явная «Обновить текст по справочникам» по-прежнему собирает заново (правки пропадают — подтверждает клиент)', async () => {
    const s = await edited();
    await s.svc.snapshot(s.id);
    expect(items(s.state)[0]).toEqual(expect.objectContaining({ text: 'Изделие Горка, рост до undefined' }));
    expect(items(s.state)[0].edited).toBeUndefined();
  });
  it('сохранение с изменением выбора текстов: ручной пункт остаётся', async () => {
    const s = await edited();
    await s.svc.update(s.id, { name: 'Горка-3' } as never);
    expect(items(s.state)[0]).toEqual(expect.objectContaining({ text: 'Мой абзац', edited: true }));
    expect(s.state.saves).toBe(1);
  });
});

describe('новая редакция: единое сохранение', () => {
  it('ошибка сборки не сохраняет номер редакции, её поля или историю', async () => {
    const s = setup({ name: 'Горка' }); await prime(s); s.state.data.status = 'issued';
    (s.svc as unknown as { buildText: () => Promise<never> }).buildText = async () => { throw new Error('шаблон недоступен'); };
    await expect(s.svc.update(s.id, { name: 'Новое' }, { newRevision: true })).rejects.toThrow('шаблон недоступен');
    expect(s.state.saves).toBe(0); expect(s.state.data.name).toBe('Горка'); expect(s.state.data.revisions).toBeUndefined();
  });
  it('поля, ручной текст и предыдущий снимок сохраняются одной редакцией', async () => {
    const s = setup({ name: 'Горка' }); await prime(s); s.state.data.status = 'issued';
    const old = items(s.state)[1]; old.text = 'Ручной'; old.edited = true; old.original = 'Правило v1';
    await s.svc.update(s.id, { name: 'Новое' }, { newRevision: true });
    expect(s.state.saves).toBe(1); expect(s.state.data.revision).toBe(2);
    expect(items(s.state)[1]).toMatchObject({ text: 'Ручной', edited: true });
    expect(s.state.data.revisions).toHaveLength(1);
    expect((s.state.data.textSnapshot as D).sizeLayout).toBe(2);
  });
});

describe('выпуск (C096 Э1)', () => {
  const host = (refresh: () => Promise<unknown>) => {
    const order: string[] = [];
    const h = {
      model: {}, connection: { startSession: async () => { order.push('session'); throw new Error('стоп после проверок'); } },
      findById: async () => ({ toObject: () => ({ status: 'draft', passportCategory: 'DIO' }) }),
      readiness: async () => [],
      freezeImages: async () => { order.push('freeze'); },
      refresh: async () => { order.push('refresh'); return refresh(); },
      allocate: async () => { order.push('allocate'); }, assertFree: async () => {},
    } as unknown as IssueHost;
    return { h, order };
  };
  it('конфликт — 409 до заморозки рисунков и номера', async () => {
    const { h, order } = host(async () => { throw new ConflictException('конфликт'); });
    await expect(new PassportIssue(h).issue(String(new Types.ObjectId()))).rejects.toBeInstanceOf(ConflictException);
    expect(order).toEqual(['refresh']);
  });
  it('без конфликта — сначала текст, потом рисунки и номер', async () => {
    const { h, order } = host(async () => true);
    await expect(new PassportIssue(h).issue(String(new Types.ObjectId()))).rejects.toThrow('стоп после проверок');
    expect(order).toEqual(['refresh', 'freeze', 'session']);
  });
  it('готовность проверяется после смены категории при обновлении источника', async () => {
    let category = 'DIO';
    const { h, order } = host(async () => { category = 'TRN'; });
    h.findById = async () => ({ toObject: () => ({ status: 'draft', passportCategory: category }) }) as never;
    h.readiness = async (doc) => doc.passportCategory === 'TRN' ? [{ key: 'weight', label: 'Масса' }] : [];
    await expect(new PassportIssue(h).issue(String(new Types.ObjectId()))).rejects.toThrow('Масса');
    expect(order).toEqual(['refresh']);
  });
});
