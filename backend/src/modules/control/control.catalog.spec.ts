import { METRICS, METRIC_GROUPS, METRIC_KEYS, sourceNote } from './control.catalog';
import { emptyMetrics } from './control.rollup';

describe('CC-10: каталог показателей', () => {
  it('ключи уникальны, формат «группа.имя», группа известна', () => {
    expect(new Set(METRIC_KEYS).size).toBe(METRICS.length);
    for (const d of METRICS) {
      expect(d.key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      expect(d.key.split('.')[0]).toBe(d.group);
      expect(METRIC_GROUPS[d.group]).toBeTruthy();
    }
  });

  it('подписи и единицы — по-русски, без служебных ключей', () => {
    for (const d of METRICS) {
      expect(d.label).toMatch(/[А-Яа-я]/);
      expect(d.label).not.toContain('_');
      expect(d.unit.length).toBeGreaterThan(0);
    }
  });

  it('показатель без источника объясняет, чего не хватает', () => {
    const none = METRICS.filter((d) => d.source === 'none');
    expect(none.length).toBeGreaterThan(0);
    for (const d of none) {
      expect(d.needs).toBeTruthy();
      expect(sourceNote(d)).toContain('ещё нет источника');
    }
  });

  it('пустой день = все ключи каталога со значением null (не 0)', () => {
    const e = emptyMetrics();
    expect(Object.keys(e)).toEqual([...METRIC_KEYS]);
    expect(Object.values(e).every((v) => v === null)).toBe(true);
  });
});
