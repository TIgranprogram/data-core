import { Types } from 'mongoose';
import { elementsOfFacetValues, facetElementsPatch, mergeFacetElements } from './facet-elements';

const a = new Types.ObjectId(), b = new Types.ObjectId(), c = new Types.ObjectId();

describe('элементы из признаков изделия', () => {
  it('собирает элементы значений без дублей', () => {
    expect(elementsOfFacetValues([{ elementIds: [String(a), String(b)] }, { elementIds: [String(b), String(c)] }, {}]).map(String)).toEqual([a, b, c].map(String));
  });
  it('дописывает к ручным, не стирая и не дублируя', () => {
    expect(mergeFacetElements([a], [a, b])!.map(String)).toEqual([String(a), String(b)]);
    expect(mergeFacetElements(undefined, [b])!.map(String)).toEqual([String(b)]);
  });
  it('нечего дописывать — null', () => {
    expect(mergeFacetElements([a, b], [b])).toBeNull();
  });
  it('facetElementsPatch: значения без элементов или пустой выбор ничего не меняют', async () => {
    const db = { collection: () => ({ find: () => ({ toArray: async () => [{ elementIds: [] }] }), findOne: async () => ({}) }) } as never;
    expect(await facetElementsPatch(db, new Types.ObjectId(), [])).toBeNull();
    expect(await facetElementsPatch(db, new Types.ObjectId(), [a])).toBeNull();
  });
  it('facetElementsPatch: ручные элементы изделия сохраняются', async () => {
    const db = { collection: (n: string) => ({
      find: () => ({ toArray: async () => [{ elementIds: [b] }] }),
      findOne: async () => (n === 'products' ? { passportDefaults: { elements: [a] } } : null),
    }) } as never;
    expect((await facetElementsPatch(db, new Types.ObjectId(), [c]))!.map(String)).toEqual([String(a), String(b)]);
  });
});
