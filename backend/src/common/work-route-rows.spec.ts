import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { diffRows, normalizeRows, productFields, rowsFromProduct, setChecked } from './work-route-rows';

const oid = () => new Types.ObjectId();
const cut = oid(), weld = oid();
const typeNames = new Map([[String(cut), 'Резка'], [String(weld), 'Сварка']]);
const user = oid();
const ctx = { typeNames, by: user, now: new Date('2026-11-07T10:00:00Z'), keepLinks: true };
const empty = { parts: [], steps: [] };

describe('work-route-rows: состав работ (C041)', () => {
  it('новые части и шаги получают id; шаг ссылается на новую часть по временному ключу', () => {
    const r = normalizeRows({ parts: [{ id: 'new1', name: ' Стойки ', qty: 4 }], steps: [{ workTypeId: String(cut), partRowId: 'new1', hours: 1.5 }, { workTypeId: String(weld), partRowId: null }] }, empty, ctx);
    expect(r.parts[0]).toMatchObject({ name: 'Стойки', qty: 4, checked: false });
    expect(r.steps[0].partRowId).toEqual(r.parts[0]._id);
    expect(r.steps[1].partRowId).toBeUndefined(); // «Изделие целиком»
    expect(r.steps[0].hours).toBe(1.5);
  });

  it('клиентский id (24 hex) у новой строки сохраняется', () => {
    const id = String(oid());
    const r = normalizeRows({ parts: [{ id, name: 'Навес' }], steps: [{ id: String(oid()), workTypeId: String(cut), partRowId: id }] }, empty, ctx);
    expect(String(r.parts[0]._id)).toBe(id);
    expect(r.steps[0].partRowId).toEqual(r.parts[0]._id);
  });

  it('вид работ на разных частях можно, на одной и той же — 400', () => {
    const parts = [{ id: 'a', name: 'Стойки' }, { id: 'b', name: 'Навес' }];
    expect(normalizeRows({ parts, steps: [{ workTypeId: String(cut), partRowId: 'a' }, { workTypeId: String(cut), partRowId: 'b' }] }, empty, ctx).steps).toHaveLength(2);
    expect(() => normalizeRows({ parts, steps: [{ workTypeId: String(cut), partRowId: 'a' }, { workTypeId: String(cut), partRowId: 'a' }] }, empty, ctx)).toThrow(/Стойки/);
    expect(() => normalizeRows({ parts: [], steps: [{ workTypeId: String(cut) }, { workTypeId: String(cut) }] }, empty, ctx)).toThrow(/Изделие целиком/);
  });

  it('ошибки по-русски: чужой вид работ, часть без названия, повтор части, лишние часы', () => {
    const bad = (i: Parameters<typeof normalizeRows>[0]) => () => normalizeRows(i, empty, ctx);
    expect(bad({ parts: [], steps: [{ workTypeId: String(oid()) }] })).toThrow(BadRequestException);
    expect(bad({ parts: [{ name: ' ' }], steps: [] })).toThrow(/название/);
    expect(bad({ parts: [{ name: 'Навес' }, { name: 'навес' }], steps: [] })).toThrow(/уже есть/);
    expect(bad({ parts: [], steps: [{ workTypeId: String(cut), hours: 5000 }] })).toThrow(/часов/);
    expect(bad({ parts: [], steps: [{ workTypeId: String(cut), partRowId: 'нет' }] })).toThrow(/Часть/);
  });

  it('«Проверено»: автор и время ставятся один раз, прежняя отметка не перезаписывается, снятие очищает', () => {
    const first = normalizeRows({ parts: [{ id: 'a', name: 'Стойки', checked: true }], steps: [] }, empty, ctx);
    expect(first.parts[0]).toMatchObject({ checked: true, checkedBy: user, checkedAt: ctx.now });
    const other = oid(), later = { ...ctx, by: other, now: new Date('2026-11-08T10:00:00Z') };
    const again = normalizeRows({ parts: [{ id: String(first.parts[0]._id), name: 'Стойки', checked: true }], steps: [] }, first, later);
    expect(again.parts[0].checkedBy).toEqual(user);
    const off = normalizeRows({ parts: [{ id: String(first.parts[0]._id), name: 'Стойки', checked: false }], steps: [] }, first, later);
    expect(off.parts[0].checked).toBe(false);
    expect(off.parts[0].checkedBy).toBeUndefined();
  });

  it('задел Э2: исполнитель и план шага не теряются при правке без них; ссылка на состав — тоже', () => {
    const line = oid(), who = oid();
    const prev = { parts: [], steps: [{ _id: oid(), workTypeId: cut, checked: false, lineId: line, assigneeId: who, plan: { start: new Date('2026-12-01'), end: new Date('2026-12-03') } }] };
    const r = normalizeRows({ parts: [], steps: [{ workTypeId: String(cut), hours: 2 }] }, prev, ctx);
    expect(r.steps[0]).toMatchObject({ lineId: line, assigneeId: who, plan: { end: new Date('2026-12-03') }, hours: 2 });
    expect(r.steps[0]._id).toEqual(prev.steps[0]._id); // тот же шаг найден по паре «вид работ × часть»
  });

  it('setChecked: нет строки — null; поставить и снять', () => {
    const rows = [{ _id: cut, checked: false }];
    expect(setChecked(rows, String(oid()), true, ctx)).toBeNull();
    const on = setChecked(rows, String(cut), true, ctx)!;
    expect(on[0]).toMatchObject({ checked: true, checkedBy: user });
    expect(setChecked(on, String(cut), false, ctx)![0]).toEqual({ _id: cut, checked: false });
  });

  it('из изделия: старые шаги без части остаются «Изделие целиком», удалённый вид работ и осиротевшая часть пропускаются', () => {
    const part = oid(), gone = oid();
    const r = rowsFromProduct({ parts: [{ _id: part, name: 'Навес', qty: 2 }], workTypes: [{ workTypeId: cut }, { workTypeId: weld, partRowId: part, hours: 1 }, { workTypeId: gone }, { workTypeId: cut, partRowId: oid() }] }, typeNames);
    expect(r.steps.map((s) => [String(s.workTypeId), s.partRowId ? 'part' : 'целиком'])).toEqual([[String(cut), 'целиком'], [String(weld), 'part'], [String(cut), 'целиком']]);
    expect(r.parts[0]).toMatchObject({ name: 'Навес', qty: 2, checked: false });
  });

  it('в изделие: пустое — убрать поле; «Проверено» не входит в сравнение с изделием', () => {
    expect(productFields([], [])).toEqual({ set: {}, unset: { parts: '', workTypes: '' } });
    const base = normalizeRows({ parts: [{ id: 'a', name: 'Стойки', qty: 2 }], steps: [{ workTypeId: String(cut), partRowId: 'a', hours: 1 }] }, empty, ctx);
    const checked = normalizeRows({ parts: [{ id: String(base.parts[0]._id), name: 'Стойки', qty: 2, checked: true }], steps: [{ workTypeId: String(cut), partRowId: String(base.parts[0]._id), hours: 1, checked: true }] }, base, ctx);
    expect(diffRows(checked, base)).toEqual({ changed: false, added: 0, removed: 0, edited: 0 });
  });

  it('сравнение: добавлено / убрано / изменено / порядок', () => {
    const base = normalizeRows({ parts: [{ id: 'a', name: 'Стойки' }], steps: [{ workTypeId: String(cut), partRowId: 'a', hours: 1 }, { workTypeId: String(weld), partRowId: 'a' }] }, empty, ctx);
    const aId = String(base.parts[0]._id);
    const more = normalizeRows({ parts: [{ id: aId, name: 'Стойки' }, { id: 'n', name: 'Навес' }], steps: [{ workTypeId: String(cut), partRowId: aId, hours: 2 }, { workTypeId: String(cut), partRowId: 'n' }] }, base, ctx);
    expect(diffRows(more, base)).toEqual({ changed: true, added: 2, removed: 1, edited: 1 });
    const swapped = normalizeRows({ parts: [{ id: aId, name: 'Стойки' }], steps: [{ workTypeId: String(weld), partRowId: aId }, { workTypeId: String(cut), partRowId: aId, hours: 1 }] }, base, ctx);
    expect(diffRows(swapped, base)).toMatchObject({ changed: true, edited: 1 });
  });
});

describe('work-route-rows: статус шага от рабочего (C050)', () => {
  const partId = String(oid()), stepId = oid();
  const at = new Date('2026-11-08T08:00:00Z'), until = new Date('2026-11-09T00:00:00Z');
  const prev = {
    parts: [{ _id: new Types.ObjectId(partId), name: 'Стойки', qty: 1, checked: false }],
    steps: [{ _id: stepId, workTypeId: cut, partRowId: new Types.ObjectId(partId), checked: false, status: 'deferred' as const, statusReason: 'Нет материала', deferUntil: until, statusAt: at }],
  };
  const input = { parts: [{ id: partId, name: 'Стойки' }], steps: [{ id: String(stepId), workTypeId: String(cut), partRowId: partId, hours: 2 }] };

  it('менеджер сохраняет план — «Отложено» и причина не стираются', () => {
    const r = normalizeRows(input, prev, ctx);
    expect(r.steps[0]).toMatchObject({ status: 'deferred', statusReason: 'Нет материала', deferUntil: until, statusAt: at, hours: 2 });
  });

  it('у шага без статуса полей статуса нет (нет пустых ключей)', () => {
    const r = normalizeRows(input, { parts: prev.parts, steps: [{ ...prev.steps[0], status: undefined, statusReason: undefined, deferUntil: undefined, statusAt: undefined }] }, ctx);
    expect(Object.keys(r.steps[0])).not.toEqual(expect.arrayContaining(['status']));
    expect(r.steps[0]).not.toHaveProperty('statusReason');
  });

  it('статус шага не приходит от клиента: присланное status игнорируется', () => {
    const r = normalizeRows({ parts: input.parts, steps: [{ ...input.steps[0], status: 'problem' } as never] }, { parts: prev.parts, steps: [{ ...prev.steps[0], status: undefined }] }, ctx);
    expect(r.steps[0]).not.toHaveProperty('status');
  });
});
