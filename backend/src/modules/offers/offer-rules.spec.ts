import { calcTotals, canMove, checkEditable, checkMove, markedUp, resolveVat, validDays, vatAmount } from './offer-rules';

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

describe('КП: обход администратором (ЗЯ-1)', () => {
  const admin = { admin: true };
  it('менеджер получает прежние ошибки', () => {
    expect(() => checkMove('sent', 'draft', [], {})).toThrow(/нельзя перейти/);
    expect(() => checkMove('paid', 'accepted', [], { admin: false })).toThrow(/оплачено/);
    expect(() => checkEditable('paid', { admin: false })).toThrow(/правка закрыта/);
  });
  it('администратор: переход назад и выход из «Оплачено» без заказа — обход (true)', () => {
    expect(checkMove('sent', 'draft', [], admin)).toBe(true);
    expect(checkMove('paid', 'accepted', [], admin)).toBe(true);
    expect(checkMove('draft', 'sent', [{ productName: 'Урна', unitPrice: 5 }], admin)).toBe(false); // обычный шаг — не обход
    expect(checkEditable('paid', admin)).toBe(true);
    expect(checkEditable('sent', admin)).toBe(false);
  });
  it('если заказ из КП создан — «Оплачено» закрыто и для администратора', () => {
    expect(() => checkMove('paid', 'accepted', [], { admin: true, hasOrder: true })).toThrow(/оплачено/);
    expect(() => checkEditable('paid', { admin: true, hasOrder: true })).toThrow(/правка закрыта/);
  });
  it('цена к «Отправлено» обязательна и для администратора', () => {
    expect(() => checkMove('accepted', 'sent', [{ productName: 'Скамья' }], admin)).toThrow(/Укажите цену/);
  });

  describe('НДС, наценка, срок действия', () => {
    it('НДС внутри 680 000 при 22 % — 122 622,95', () => {
      expect(vatAmount(680000, 22)).toBe(122622.95);
    });
    it('режим и ставка: пусто — по фирме; нет ставки фирмы — 22', () => {
      expect(resolveVat(undefined, undefined, 22)).toEqual({ vatMode: 'with', vatRate: 22 });
      expect(resolveVat(undefined, undefined, 0)).toEqual({ vatMode: 'without', vatRate: 22 });
      expect(resolveVat(undefined, undefined, null)).toEqual({ vatMode: 'without', vatRate: 22 });
      expect(resolveVat('with', 10, 0)).toEqual({ vatMode: 'with', vatRate: 10 });
      expect(resolveVat('without', undefined, 20)).toEqual({ vatMode: 'without', vatRate: 20 });
    });
    it('наценка: +3 % → 700 400, +5 % → 714 000, округление до рубля', () => {
      expect(markedUp(680000, 3)).toBe(700400);
      expect(markedUp(680000, 5)).toBe(714000);
      expect(markedUp(1001, 3)).toBe(1031);
      expect(markedUp(1000, -10)).toBe(900);
    });
    it('срок действия — календарные дни', () => {
      expect(validDays('2026-11-06', '2026-11-16')).toBe(10);
      expect(validDays('2026-11-06', null)).toBeNull();
      expect(validDays('2026-11-06', '2026-11-06')).toBeNull();
    });
  });
});
