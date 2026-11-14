import { buildFillQueue } from './product-fill-queue';
import type { GapItem } from './passport-gaps';

const gap = (key: string, kind: GapItem['kind'], extra: Partial<GapItem> = {}): GapItem => ({ key, label: key, kind, required: kind !== 'facet', ...extra });
const full = { dimensions: { length: 1, width: 1, height: 1 }, weightKg: 5, composition: [{}], installation: 'бетон' };
const base = { inOrders: false, hasIssued: false };

describe('C114 J: очередь «что заполнить первым»', () => {
  it('всё заполнено — пустая очередь, N = M', () => {
    const q = buildFillQueue({ gaps: [], product: full, ...base });
    expect(q).toMatchObject({ done: 4, total: 4, items: [], scope: 'passport' });
  });

  it('порядок: тип паспорта, затем обязательные по весу, затем необязательные', () => {
    const q = buildFillQueue({ gaps: [gap('f1', 'facet'), gap('img_a', 'image'), gap('kind', 'kind'), gap('category', 'category')], product: full, ...base });
    expect(q.items.map((i) => i.key)).toEqual(['category', 'kind', 'img_a', 'f1']);
  });

  it('пустые габариты, вес, состав и монтаж попадают в очередь; пункт с умолчанием в счёт не идёт', () => {
    const q = buildFillQueue({ gaps: [gap('serviceLifeYears', 'field', { defaulted: true, required: false })], product: {}, ...base });
    expect(q.items.map((i) => i.key)).toEqual(['dimensions', 'weightKg', 'composition', 'installation']);
    expect(q).toMatchObject({ done: 0, total: 4 });
  });

  it('поле, которое уже спрашивает паспорт, не дублируется', () => {
    const q = buildFillQueue({ gaps: [gap('weight', 'field'), gap('installationTypeId', 'install')], product: {}, ...base });
    expect(q.items.map((i) => i.key)).toEqual(['weight', 'installationTypeId', 'dimensions', 'composition']);
    expect(q.total).toBe(4);
  });

  it('срочность: изделие в заказе — пометка; обязательное остаётся выше необязательного', () => {
    const q = buildFillQueue({ gaps: [gap('f1', 'facet')], product: { ...full, weightKg: 0 }, inOrders: true, hasIssued: false });
    expect(q.items.map((i) => i.key)).toEqual(['weightKg', 'f1']);
    expect(q.items.every((i) => i.urgent)).toBe(true);
  });

  it('число N из M считается по пустым пунктам', () => {
    const q = buildFillQueue({ gaps: [gap('category', 'category')], product: full, ...base });
    expect(q).toMatchObject({ done: 4, total: 5 });
  });
});
