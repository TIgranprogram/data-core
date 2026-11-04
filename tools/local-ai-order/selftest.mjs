/** Быстрый самотест формата C019 без LM Studio. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOrderXlsx, orderToRows } from './write-xlsx.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const sample = {
  orderNo: 'ТЕСТ-1',
  productionNo: '',
  customer: 'МБУ «ДСО»',
  companyName: 'СИЮ',
  title: 'Тестовая площадка',
  paymentForm: 'б/р',
  notes: 'самотест',
  lines: [
    { title: 'Секция ограждения', unit: 'шт', qty: 2 },
    { title: 'Стойка', unit: 'шт', qty: 4, unitPrice: 100 },
  ],
};

const rows = orderToRows(sample);
assert.equal(rows[1][0], '№ договора');
assert.ok(rows.some((r) => r[0] === '№' && /НАИМЕНОВАНИЕ/i.test(String(r[1]))));
const out = path.join(root, 'out', '_selftest.xlsx');
writeOrderXlsx(out, sample);
assert.ok(fs.existsSync(out) && fs.statSync(out).size > 500);
fs.unlinkSync(out);
console.log('selftest OK');
