import { fillBlanks, hasLeak, printSafe } from './fill-text';

const R = { lines: { n: 6 }, optional: ['lim'], tail: ['to'] };

describe('печать: fillBlanks', () => {
  it('метка без значения → линия, без «{»', () => {
    const r = fillBlanks('Срок: [{n} не заполнено] лет.', R);
    expect(r).toBe('Срок: ______ лет.');
    expect(r).not.toContain('{');
    expect(fillBlanks('Срок: {n} лет.', R)).toBe('Срок: ______ лет.');
  });
  it('необязательная фраза исчезает без двойных знаков и пробелов', () => {
    expect(fillBlanks('Первое. Не более [{lim} не заполнено] чел. Третье.', R)).toBe('Первое. Третье.');
    expect(fillBlanks('Изготовлено по {std:X}, остальное — как есть.', R)).toBe('');
  });
  it('точка после «мес.» не режет предложение — обрывка «со дня…» нет', () => {
    expect(fillBlanks('Гарантийный срок — [{warrantyMonths} не заполнено] мес. со дня передачи.', { optional: ['warrantyMonths'] }))
      .toBe('');
  });
  it('хвост « до {to}» выпадает, предложение остаётся', () => {
    expect(fillBlanks('Дети от 3 до [{to} не заполнено] лет.', R)).toBe('Дети от 3 лет.');
  });
  it('{fig:…} и {tab:…} не трогает (их ставит PDF)', () => {
    expect(fillBlanks('См. {fig:safety_zone} и {tab:service}.', R)).toBe('См. {fig:safety_zone} и {tab:service}.');
  });
});

describe('печать: printSafe (предохранитель)', () => {
  it('остатки «{…}» и undefined/null/NaN заменяются линией, пишется предупреждение', () => {
    const warn = jest.fn();
    const r = printSafe('Вес {weight} кг, цена undefined, дата Invalid Date, NaN', warn);
    expect(hasLeak(r)).toBe(false);
    expect(r).toContain('________');
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('пустое и числа', () => {
    expect(printSafe(undefined)).toBe('');
    expect(printSafe(null)).toBe('');
    expect(printSafe(NaN)).toBe('________');
    expect(printSafe(12.5)).toBe('12.5');
    expect(printSafe('Нормальный текст без утечек')).toBe('Нормальный текст без утечек');
  });
});
