import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverPrintedRows, validateProposal } from './proposal.mjs';

const header = [
  ' №                                         Цена     Кол-   Ед.',
  '                 Наименование                                    Сумма',
  ' п/п                                                    за ед.       во    изм.',
];

function fixture(table = ['  1   Опора                                   50,00       2,00   шт    100,00']) {
  const number = 'Договор № Т-17/1';
  const date = 'Дата: 20.11.2026';
  const seller = 'Поставщик ООО Альфа ИНН 7707083893';
  const buyer = 'Покупатель ООО Бета ИНН 7702070139';
  const total = 'ИТОГО: 100,00 руб.';
  const quote = text => ({ page: 1, quote: text });
  const field = (value, text) => ({ value, ...quote(text) });
  return {
    pages: [[number, date, seller, buyer, ...header, ...table, total].join('\n')],
    raw: {
      kind: 'contract', kindEvidence: quote(number), number: field('Т-17/1', number), date: field('2026-11-20', date),
      seller: { name: 'ООО Альфа', inn: '7707083893', ...quote(seller) },
      buyer: { name: 'ООО Бета', inn: '7702070139', ...quote(buyer) },
      currency: field('RUB', 'руб.'), gross: field(100, total), revision: null, vat: null,
      lines: [{ title: 'Опора', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, ...quote(table.join('\n')) }], doubts: [],
    },
  };
}

test('C233: цена перед количеством подтверждается полным заголовком без линий сетки', () => {
  const { raw, pages } = fixture();
  const rows = recoverPrintedRows(raw, pages, []);
  assert.equal(rows.length, 1);
  const proposal = validateProposal({ ...raw, lines: rows }, pages, [], rows);
  assert.deepEqual(proposal.lines, [{ title: 'Опора', qty: 2, unit: 'шт', unitPrice: 50, amount: 100 }]);
  assert.deepEqual(validateProposal(raw, pages).lines, proposal.lines);
});

test('C233: перенос названия вокруг числовых колонок сохраняет факты и исходную цитату', () => {
  const { raw, pages } = fixture([
    '     Опора с деревянной',
    '  1                                           50,00       2,00   шт    100,00',
    '      облицовкой',
  ]);
  const rows = recoverPrintedRows(raw, pages, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Опора с деревянной облицовкой');
  assert.ok(rows[0].quote.includes('\n'));
  assert.equal(validateProposal({ ...raw, lines: rows }, pages, [], rows).lines[0].amount, 100);
});

test('C233: числовые габариты продолжают название, не заменяя количество или цену', () => {
  const { raw, pages } = fixture([
    '     Качели, габариты',
    '  1                                           50,00       2,00   шт    100,00',
    '      3100×1400×2000',
  ]);
  const rows = recoverPrintedRows(raw, pages, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Качели, габариты 3100×1400×2000');
  const proposal = validateProposal({ ...raw, lines: rows }, pages, [], rows);
  assert.equal(proposal.lines[0].qty, 2);
  assert.equal(proposal.lines[0].unitPrice, 50);
});

test('C233: арифметическое совпадение не разрешает поменять цену и количество местами', () => {
  const { raw, pages } = fixture();
  raw.lines[0].qty = 50;
  raw.lines[0].unitPrice = 2;
  assert.throws(() => validateProposal(raw, pages), /строка 1/u);
  const rows = recoverPrintedRows(raw, pages, []);
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].unitPrice, 50);
});

test('C233: заголовок обязателен, чужая страница и переставленные колонки не принимаются', () => {
  const { raw, pages } = fixture();
  assert.deepEqual(recoverPrintedRows(raw, [pages[0].replace(header.join('\n'), '')], []), []);
  assert.deepEqual(recoverPrintedRows(raw, [pages[0].replace('Цена     Кол-', 'Кол-     Цена')], []), []);
  raw.lines[0].page = 2;
  assert.throws(() => validateProposal(raw, [...pages, 'Иная страница без таблицы']), /строка 1/u);
});

test('C233: нарушенные числа, нумерация, лишняя строка и неоднозначные таблицы требуют сверки', () => {
  for (const line of [
    '  1   Опора                                   50,00       3,00   шт    100,00',
    '  2   Опора                                   50,00       2,00   шт    100,00',
    '  1   Опора                                   50,00       2,00   шт    100,00  999,00',
  ]) {
    const { raw, pages } = fixture([line]);
    assert.deepEqual(recoverPrintedRows(raw, pages, []), []);
  }
  const { raw, pages } = fixture();
  assert.deepEqual(recoverPrintedRows(raw, [...pages, ...pages], []), []);
  const rows = recoverPrintedRows(raw, pages, []);
  const forged = { ...rows[0], title: 'Несуществующий товар' };
  assert.throws(() => validateProposal({ ...raw, lines: [forged] }, pages, [], rows), /строка 1/u);
});
