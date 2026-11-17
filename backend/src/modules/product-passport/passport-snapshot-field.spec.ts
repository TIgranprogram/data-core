import { BadRequestException } from '@nestjs/common';
import { carryFields, editField, fieldTarget, parseIndex, removeMaintRow, type FieldSnap } from './passport-snapshot-field';
import { maintenanceTables, usageRulesFrom } from './passport-compose-parts';
import { buildV2Text } from './passport-v2-text';

const snap = (): FieldSnap => ({
  description: 'Горка состоит из стойки.', purpose: 'Для игр.', install: { text: 'Бетонирование.', requirements: [] },
  rules: ['Не лазить', 'Не прыгать'],
  maintenance: [{ period: 'ежемесячно', rows: [{ what: 'Болты' }, { what: 'Сварка' }] }, { period: 'ежегодно', rows: [{ what: 'Покраска' }] }],
  src: { description: 'product', purpose: 'product', install: 'product' },
  refs: { description: { kind: 'product', id: 'a', field: 'description' }, rules: [{ kind: 'element', id: 'e1', field: 'usageRules' }, null], maintenance: [null, null, { kind: 'defect', id: 'd1', field: 'name' }] },
});

describe('C132 editField: правка строки только в этом паспорте', () => {
  it('скаляр: текст, manual и исходный; возврат к исходному снимает пометку и цвет', () => {
    const a = editField(snap(), 'purpose', undefined, '  Для   игр детей ');
    expect(a.purpose).toBe('Для игр детей');
    expect(a.src).toEqual(expect.objectContaining({ purpose: 'manual', description: 'product' }));
    expect(a.fieldEdits?.purpose).toEqual({ original: 'Для игр.', src: 'product' });
    const b = editField(a, 'purpose', undefined, 'Другое');
    expect(b.fieldEdits?.purpose?.original).toBe('Для игр.');
    const c = editField(b, 'purpose', undefined, 'Для игр.');
    expect(c.fieldEdits).toBeUndefined();
    expect(c.src?.purpose).toBe('product');
  });
  it('монтаж меняет install.text и сохраняет абзацы', () => {
    const a = editField(snap(), 'install', undefined, 'Шаг 1.\r\n\r\nШаг 2.');
    expect(a.install?.text).toBe('Шаг 1.\nШаг 2.');
    expect(a.install?.requirements).toEqual([]);
    expect(a.src?.install).toBe('manual');
  });
  it('правила и обслуживание — по номеру строки; остальные не трогаются', () => {
    const a = editField(snap(), 'rules', 1, 'Не бегать');
    expect(a.rules).toEqual(['Не лазить', 'Не бегать']);
    expect(a.fieldEdits?.rules).toEqual({ '1': { original: 'Не прыгать' } });
    const m = editField(snap(), 'maintenance', 2, 'Покраска стоек');
    expect(m.maintenance![1].rows[0].what).toBe('Покраска стоек');
    expect(m.maintenance![0].rows[1].what).toBe('Сварка');
    expect(editField(a, 'rules', 1, 'Не прыгать').fieldEdits).toBeUndefined();
  });
  it('обслуживание: колонки Где/Мера/Допуск и удаление строки', () => {
    const base = { ...snap(), maintenance: [{ period: 'ежемесячно', rows: [{ what: 'Болты', where: 'Стойка', measure: 'Визуально', tolerance: '—' }, { what: 'Сварка', where: 'Шов' }] }] };
    const w = editField(base, 'maintenance', 0, 'Указатель', 'where');
    expect(w.maintenance![0].rows[0].where).toBe('Указатель');
    expect(w.maintenance![0].rows[0].what).toBe('Болты');
    expect(w.fieldEdits?.maintenance?.['0:where']).toEqual({ original: 'Стойка' });
    expect(editField(w, 'maintenance', 0, '', 'where').maintenance![0].rows[0].where).toBe('');
    const gone = removeMaintRow(base, 0);
    expect(gone.maintenance![0].rows).toEqual([{ what: 'Сварка', where: 'Шов' }]);
  });
  it('пустой текст, чужой номер и неизвестное поле — 400', () => {
    expect(() => editField(snap(), 'purpose', undefined, '  ')).toThrow(BadRequestException);
    expect(() => parseIndex('rules', snap(), 5)).toThrow(BadRequestException);
    expect(() => parseIndex('rules', snap(), undefined)).toThrow(BadRequestException);
    expect(parseIndex('maintenance', snap(), 2)).toBe(2);
    expect(parseIndex('purpose', snap(), undefined)).toBeUndefined();
  });
  it('fieldTarget: источник, прежний текст и признак правки', () => {
    const a = editField(snap(), 'rules', 0, 'Не лазить без взрослых');
    expect(fieldTarget(a, 'rules', 0)).toEqual({ text: 'Не лазить без взрослых', old: 'Не лазить', edited: true, ref: { kind: 'element', id: 'e1', field: 'usageRules' } });
    expect(fieldTarget(snap(), 'maintenance', 2).ref).toEqual({ kind: 'defect', id: 'd1', field: 'name' });
    expect(fieldTarget(snap(), 'description').edited).toBe(false);
  });
});

describe('C132 carryFields: пересборка черновика не теряет правки', () => {
  it('переносит скаляр и строку списка по исходному тексту', () => {
    const prev = editField(editField(snap(), 'purpose', undefined, 'Моё назначение'), 'rules', 1, 'Не бегать');
    const fresh: FieldSnap = { ...snap(), purpose: 'Новое из справочника', rules: ['Не прыгать', 'Не лазить'] };
    const r = carryFields(prev, fresh);
    expect(r.conflicts).toEqual([]);
    expect(r.snap.purpose).toBe('Моё назначение');
    expect(r.snap.fieldEdits?.purpose?.original).toBe('Новое из справочника');
    expect(r.snap.rules).toEqual(['Не бегать', 'Не лазить']); // строка с исходным текстом «Не прыгать» стала первой
  });
  it('строки больше нет в справочнике — конфликт, снимок не меняется', () => {
    const prev = editField(snap(), 'rules', 1, 'Не бегать');
    const r = carryFields(prev, { ...snap(), rules: ['Не лазить'] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toContain('Правила');
    expect(r.snap.rules).toEqual(['Не лазить']);
  });
  it('нет правок — свежий снимок как есть', () => {
    const fresh = snap();
    expect(carryFields(snap(), fresh).snap).toBe(fresh);
  });
});

describe('C132 источники строк при сборке (refs)', () => {
  const elements = [
    { id: 'e1', name: 'Горка', usageRules: 'Не лазить\nНе прыгать', inspect: 'Болты', inDescription: 'горки' },
    { id: 'e2', name: 'Качели', rules: ['Не прыгать', 'Не раскачивать'] },
  ];
  it('usageRulesFrom: повтор берётся с первого элемента, поле — то, где лежала строка', () => {
    expect(usageRulesFrom(elements).map((r) => [r.text, r.ref.id, r.ref.field])).toEqual([['Не лазить', 'e1', 'usageRules'], ['Не прыгать', 'e1', 'usageRules'], ['Не раскачивать', 'e2', 'rules']]);
  });
  it('maintenanceTables: источник каждой строки — дефект или элемент', () => {
    const refs = new Map();
    const t = maintenanceTables([], elements, [{ id: 'd1', code: 'X', name: 'Трещина', period: 'ежегодно', applies: 'E1' }, { id: 'd2', name: 'Люфт', period: 'ежегодно', applies: 'Q' }], null, refs);
    // у элементов нет кода — дефект без привязки не берётся; строки «что проверять» — из элемента
    const rows = t.flatMap((x) => x.rows);
    expect(rows.map((r) => r.what)).toEqual(['Болты']);
    expect(refs.get(rows[0])).toEqual({ kind: 'element', id: 'e1', field: 'inspect' });
  });
  it('buildV2Text кладёт refs: изделие, воронка, справочник способа установки', () => {
    const all = { sections: [] } as never;
    const passport = { productId: 'pr1', passportCategory: 'DIO', elements: ['e1'], installationTypeId: 'i1', name: 'Горка' };
    const t = buildV2Text({ passport, all, dicts: { elements: elements as never, install: [{ id: 'i1', name: 'Бетон', montage: 'Залить' }] as never } });
    expect(t.refs.description).toEqual({ kind: 'product', id: 'pr1', field: 'description' });
    expect(t.refs.purpose).toEqual({ kind: 'product', id: 'pr1', field: 'purpose' });
    expect(t.refs.install).toEqual({ kind: 'install', id: 'i1', field: 'montage' });
    expect(t.refs.rules).toHaveLength(t.rules.length);
    expect(t.refs.maintenance).toHaveLength(t.maintenance.flatMap((x) => x.rows).length);
    // вписанный вручную монтаж — изделие
    const m = buildV2Text({ passport: { ...passport, manualText: ['installationMethod'], installationMethod: 'Свой' }, all, dicts: { install: [{ id: 'i1', montage: 'Залить' }] as never } });
    expect(m.refs.install).toEqual({ kind: 'product', id: 'pr1', field: 'installation' });
    // без изделия — источника у описания нет
    expect(buildV2Text({ passport: { passportCategory: 'DIO' }, all }).refs.description).toBeNull();
  });
});


it('C132 пересборка после promote снимает уже перенесённую правку правила', () => {
  const ref = { kind: 'element' as const, id: 'e1', field: 'usageRules' };
  const base = { rules: ['А'], refs: { rules: [ref] } };
  const prev = editField(base, 'rules', 0, 'Б');
  const fresh = { rules: ['Б'], refs: { rules: [ref] } };
  expect(carryFields(prev, fresh)).toEqual({ snap: fresh, conflicts: [] });
});

it('C132 пересборка не переносит правку на другой элемент с таким же текстом', () => {
  const prev = editField({ rules: ['А'], refs: { rules: [{kind:'element' as const,id:'e1',field:'usageRules'}] } }, 'rules', 0, 'Б');
  const fresh = { rules: ['А'], refs: { rules: [{kind:'element' as const,id:'e2',field:'usageRules'}] } };
  const result = carryFields(prev, fresh);
  expect(result.conflicts).toHaveLength(1);
  expect(result.snap.rules).toEqual(['А']);
});
