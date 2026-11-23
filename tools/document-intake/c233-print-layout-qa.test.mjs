import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recoverPrintedRows } from './proposal.mjs';

const header = [
  ' №                                         Цена     Кол-   Ед.',
  '                 Наименование                                    Сумма',
  ' п/п                                                    за ед.       во    изм.',
];
const line = '  1   Опора                                   50,00       2,00   шт    100,00';
const raw = { lines: [{ title: 'Опора', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, page: 1, quote: line }] };
const recover = (...lines) => recoverPrintedRows(raw, [lines.join('\n')], []);

test('QA C233: незавершённая таблица без печатного итога не подтверждает строки', () => {
  assert.deepEqual(recover(...header, line), []);
  assert.deepEqual(recover(...header, line, '     Начало следующего наименования'), []);
});

test('QA C233: пропуск номера или отдельная числовая колонка требуют сверки', () => {
  assert.deepEqual(recover(...header, line, line.replace('  1 ', '  3 '), 'ИТОГО: 200,00'), []);
  assert.deepEqual(recover(...header, line, '       999,00', 'ИТОГО: 100,00'), []);
});

test('QA C233: текст между шапкой и строками и вымышленная единица не обходят проверку таблицы', () => {
  assert.deepEqual(recover(...header, 'Колонки распознал ИИ', line, 'ИТОГО: 100,00'), []);
  assert.deepEqual(recover(...header, line.replace('шт', '123'), 'ИТОГО: 100,00'), []);
});
