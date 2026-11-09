import { BadRequestException } from '@nestjs/common';
import { withTraits } from './dicts.passport-traits';
import { normalizePassportDefaults } from '../showcase/passport-defaults';
import type { DictBase } from './dicts.defs';

const base = { fields: [{ key: 'name', label: 'Название' }], row: (d: Record<string, unknown>) => ({ name: d.name }), toDoc: async (b: Record<string, unknown>) => ({ name: String(b.name ?? '') }) } as unknown as DictBase;
const db = {} as never;

describe('признаки и условия в справочниках паспорта (C054)', () => {
  it('traits: нормализуются, порядок словаря; неизвестный — 400', async () => {
    const def = withTraits(base, { traits: true });
    expect((await def.toDoc({ name: 'Способ', traits: 'freestanding, metal' }, true, db)).traits).toBe('metal, freestanding');
    expect((await def.toDoc({ name: 'Способ', traits: '' }, true, db)).traits).toBeNull();
    await expect(def.toDoc({ name: 'Способ', traits: 'metal, rocket' }, true, db)).rejects.toThrow(BadRequestException);
    await expect(def.toDoc({ name: 'Способ', traits: 'rocket' }, true, db)).rejects.toThrow('Неизвестный признак: rocket');
  });

  it('when: проверяется при записи', async () => {
    const def = withTraits(base, { when: true });
    expect((await def.toDoc({ name: 'Дефект', when: ' bolts|welds  !wood ' }, true, db)).when).toBe('bolts|welds !wood');
    expect((await def.toDoc({ name: 'Дефект', when: '' }, true, db)).when).toBeNull();
    for (const bad of ['!', 'bolts|', 'nope']) await expect(def.toDoc({ name: 'Дефект', when: bad }, true, db)).rejects.toThrow(BadRequestException);
  });

  it('поле не пришло в запросе — запись его не стирает', async () => {
    const def = withTraits(base, { traits: true, when: true });
    const doc = await def.toDoc({ name: 'Старый экран' }, false, db);
    expect('traits' in doc).toBe(false);
    expect('when' in doc).toBe(false);
  });

  it('поля формы и строка таблицы получают traits / when (служебные, не столбцы)', () => {
    const def = withTraits(base, { traits: true, when: true });
    expect(def.fields.map((f) => f.key)).toEqual(['name', 'traits', 'when']);
    expect(def.fields.filter((f) => f.tech).map((f) => f.key)).toEqual(['traits', 'when']);
    expect(def.row({ name: 'x', traits: 'wood' } as never)).toEqual({ name: 'x', traits: 'wood', when: '' });
  });
});

describe('joints у изделия (passportDefaults)', () => {
  it('сохраняются в порядке словаря; пусто — не пишется; неизвестное — 400', () => {
    expect(normalizePassportDefaults({ joints: ['welds', 'bolts'] }).joints).toEqual(['bolts', 'welds']);
    expect(normalizePassportDefaults({ joints: ['solid'] }).joints).toEqual(['solid']);
    expect(normalizePassportDefaults({ joints: [] }).joints).toBeUndefined();
    expect(normalizePassportDefaults({}).joints).toBeUndefined();
    expect(() => normalizePassportDefaults({ joints: ['glue'] })).toThrow(BadRequestException);
  });
});
