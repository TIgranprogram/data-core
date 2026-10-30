import { calcTotals, canMove, checkEditable, checkMove } from './offer-rules';

describe('КП: статусы и суммы', () => {
  it('цепочка draft → sent → accepted → paid, пропуск шагов запрещён', () => {
    expect(canMove('draft', 'sent')).toBe(true);
    expect(canMove('sent', 'accepted')).toBe(true);
    expect(canMove('accepted', 'paid')).toBe(true);
    expect(canMove('draft', 'accepted')).toBe(false);
    expect(canMove('sent', 'draft')).toBe(false);
  });

  it('отклонить / отменить можно из любого, кроме оплаченного', () => {
    for (const s of ['draft', 'sent', 'accepted'] as const) {
      expect(canMove(s, 'rejected')).toBe(true);
      expect(canMove(s, 'cancelled')).toBe(true);
    }
    expect(canMove('paid', 'cancelled')).toBe(false);
    expect(canMove('rejected', 'sent')).toBe(false);
  });

  it('«Отправлено» без цены — 400 с названием строки', () => {
    expect(() => checkMove('draft', 'sent', [{ productName: 'Урна', unitPrice: 100 }, { productName: 'Скамья' }])).toThrow(/«Скамья»/);
    expect(() => checkMove('draft', 'sent', [])).toThrow(/хотя бы одну строку/);
    expect(() => checkMove('draft', 'sent', [{ productName: 'Урна', unitPrice: 100 }])).not.toThrow();
  });

  it('оплаченное КП: статус менять и править нельзя', () => {
    expect(() => checkMove('paid', 'cancelled', [])).toThrow(/оплачено/);
    expect(() => checkEditable('paid')).toThrow(/правка закрыта/);
    expect(() => checkEditable('sent')).not.toThrow();
  });

  it('сумма строки и итог КП с округлением до копеек', () => {
    const r = calcTotals([{ quantity: 3, unitPrice: 10.1 }, { quantity: 2 }, { quantity: 1.5, unitPrice: 100 }]);
    expect(r.items.map((i) => i.total)).toEqual([30.3, 0, 150]);
    expect(r.total).toBe(180.3);
  });
});
