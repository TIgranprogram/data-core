import { nameSimilarity, suggestProducts } from './product-match';

describe('product-match', () => {
  it('похожесть по словам', () => {
    expect(nameSimilarity('Скамья парковая 2 м', 'скамья парковая')).toBe(1);
    expect(nameSimilarity('Скамья', 'Качели')).toBe(0);
    expect(nameSimilarity('', 'Скамья')).toBe(0);
  });
  it('предложения: порог и порядок', () => {
    const r = suggestProducts('Скамья парковая цвет графит', [
      { id: 'a', name: 'Качели' }, { id: 'b', name: 'Скамья', sku: '3410' }, { id: 'c', name: 'Скамья парковая', sku: '3411' },
    ]);
    expect(r.map((x) => x.productId)).toEqual(['b', 'c']);
  });
});
