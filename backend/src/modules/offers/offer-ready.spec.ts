import { offerProblems, packProblems } from './offer-ready';

describe('offer-ready: проверка КП перед отправкой', () => {
  const today = new Date('2026-11-11T00:00:00Z');
  const ok = { items: [{ productName: 'Мостик', unitPrice: 100 }], total: 100, validUntil: '2026-11-20' };

  it('всё есть — пусто', () => {
    expect(offerProblems(ok, { hasBlank: true, photos: [true], today })).toEqual([]);
  });

  it('нет цены, фото, бланка', () => {
    const r = offerProblems({ ...ok, items: [{ productName: 'Мостик', unitPrice: null }] }, { hasBlank: false, photos: [false], today });
    expect(r).toEqual(['Нет цены: «Мостик»', 'Нет фото: «Мостик»', 'Нет бланка фирмы']);
  });

  it('сумма 0 и срок прошёл; сегодняшний срок ещё действует', () => {
    const ctx = { hasBlank: true, photos: [true], today };
    expect(offerProblems({ ...ok, total: 0, validUntil: '2026-11-10' }, ctx)).toEqual(['Сумма КП равна нулю', 'Срок действия КП прошёл']);
    expect(offerProblems({ ...ok, validUntil: '2026-11-11' }, ctx)).toEqual([]);
  });

  it('нет строк', () => {
    expect(offerProblems({ items: [], total: 0 }, { hasBlank: true, photos: [], today })).toEqual(['Нет ни одной строки']);
  });

  it('пакет: проблемы с названием фирмы и разные заказчики', () => {
    const r = packProblems([
      { id: '1', companyName: 'А', customer: 'ООО  Ромашка', problems: [] },
      { id: '2', companyName: 'Б', customer: 'ооо ромашка', problems: ['Нет бланка фирмы'] },
      { id: '3', companyName: 'В', customer: 'ИП Иванов', problems: [] },
    ]);
    expect(r).toEqual(['Б: Нет бланка фирмы', 'У КП пакета разные заказчики']);
  });

  it('пакет без проблем — пусто', () => {
    expect(packProblems([{ id: '1', customer: 'X', problems: [] }, { id: '2', customer: 'x ', problems: [] }])).toEqual([]);
  });
});
