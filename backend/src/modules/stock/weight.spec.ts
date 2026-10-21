import { weightCount, weightNote } from './weight';

describe('weight (НО): количество по весу', () => {
  it('контрольный пример из таблицы: образец 10 шт = 80 г, партии 4 930 + 1 040 → 746 шт', () => {
    const w = { sampleCount: 10, sampleWeightG: 80, batchesG: [4930, 1040] };
    const r = weightCount(w);
    expect(r).toMatchObject({ unitWeightG: 8, totalG: 5970, count: 746, exact: 746.25, ok: true, errors: [] });
    expect(weightNote(w, r)).toBe('по весу: 5 970 г ÷ 8 г = 746 шт (образец 10 шт = 80 г; партии 4 930 + 1 040)');
  });
  it('известный вес 1 шт. и тара', () => {
    expect(weightCount({ unitWeightG: 16.5, batchesG: [1700], tareG: 50 })).toMatchObject({ totalG: 1650, count: 100, ok: true });
  });
  it('округление до целого', () => {
    expect(weightCount({ unitWeightG: 3, batchesG: [100] })).toMatchObject({ exact: 33.33, count: 33 });
  });
  it('граничные: 0 штук в образце, нет веса 1 шт., нет партий, тара больше веса', () => {
    expect(weightCount({ sampleCount: 0, sampleWeightG: 80, batchesG: [100] }).errors).toContain('Сколько штук в образце — больше нуля');
    expect(weightCount({ batchesG: [100] }).errors).toContain('Нет веса 1 шт. — взвесьте образец');
    expect(weightCount({ unitWeightG: 8, batchesG: [] }).errors).toContain('Впишите вес хотя бы одной партии');
    expect(weightCount({ unitWeightG: 8, batchesG: [100], tareG: 200 }).errors).toContain('Тара больше веса партий');
    expect(weightCount({ unitWeightG: 8, batchesG: [100] }).ok).toBe(true);
  });
  it('маленький образец — подсказка', () => {
    expect(weightCount({ sampleCount: 3, sampleWeightG: 24, batchesG: [800] }).smallSample).toBe(true);
  });
});
