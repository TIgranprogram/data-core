import { mergePhotoIds, qtySum, requestKey, similarRequests } from './product-request-rules';

describe('правила заявок на новое изделие', () => {
  it('одно название в разном написании — один ключ', () => {
    expect(requestKey('  Трибуна  ТР-1 ')).toBe(requestKey('трибуна тр-1'));
    expect(requestKey('')).toBe('');
  });

  it('похожее, но не то же название — подсказка; то же и чужое — нет', () => {
    const open = [{ titleKey: requestKey('Трибуна уличная'), title: 'a' }, { titleKey: requestKey('Скамья парковая'), title: 'b' }, { titleKey: requestKey('Трибуна уличная большая'), title: 'c' }];
    const hit = similarRequests(requestKey('Трибуна уличная'), open);
    expect(hit.map((x) => x.title)).toEqual(['c']);
  });

  it('сумма количества: пустое и отрицательное = 0', () => {
    expect(qtySum([{ qty: 2 }, { qty: '3' }, { qty: null }, { qty: -1 }, {}])).toBe(5);
  });

  it('фото сливаются без повторов, порядок сохраняется', () => {
    expect(mergePhotoIds(['a', 'b'], ['b', 'c', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
