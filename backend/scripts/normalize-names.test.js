const test = require('node:test');
const assert = require('node:assert');
const n = require('./normalize-names.js');

test('кавычки', () => {
  assert.equal(n.quotes('Качалка-балансир "Мишка"'), 'Качалка-балансир «Мишка»');
  assert.equal(n.quotes('МО "Город Майкоп"'), 'МО «Город Майкоп»');
  assert.equal(n.quotes('зона"Мэздах"'), 'зона«Мэздах»');
  assert.equal(n.quotes('нечётная "'), null);
});
test('размеры', () => {
  assert.equal(n.sizes('Пергола 6150*2200*2600'), 'Пергола 6150х2200х2600');
  assert.equal(n.sizes('Изделие арт. 3217, 2400×1200×2500'), 'Изделие арт. 3217, 2400х1200х2500');
  assert.equal(n.sizes('1,5 х 0,58 х 0.85 м'), '1,5х0,58х0,85 м');
  assert.equal(n.sizes('габариты: 1,5 х 0,58 х 0,85м'), 'габариты: 1,5х0,58х0,85 м');
  assert.equal(n.sizes('0,6х 0,3 х 0,86 м.'), '0,6х0,3х0,86 м.');
});
test('ё', () => {
  assert.equal(n.yo('Уличный тренажер «Хипс»'), 'Уличный тренажёр «Хипс»');
  assert.equal(n.yo('Тренажер'), 'Тренажёр');
});
test('мм и м.п.', () => {
  assert.equal(n.mm('сталь 3мм.'), 'сталь 3 мм');
  assert.equal(n.mm('d трубы 89 мм'), 'd трубы 89 мм');
  assert.equal(n.mp('3х1,5 м.п'), '3х1,5 м.п.');
  assert.equal(n.mp('3х1,5 м.п.'), '3х1,5 м.п.');
});
test('пробелы', () => {
  assert.equal(n.spaces('(Скамья «CHOICE SHADOW »)'), '(Скамья «CHOICE SHADOW»)');
  assert.equal(n.spaces('Скамья   городская'), 'Скамья городская');
});
test('первая буква', () => { assert.equal(n.capital('деревянный гамак'), 'Деревянный гамак'); });
test('артикул - только свой sku', () => {
  assert.equal(n.article('Скамья_6_3', '6_3'), 'Скамья');
  assert.equal(n.article('Урна 12_3', '12_3'), 'Урна');
  assert.equal(n.article('Урна УСДК-800.400 «12_6»', '12_6'), 'Урна УСДК-800.400');
  assert.equal(n.article('Урна 12_3', '99'), 'Урна 12_3');
});
test('normalize целиком, повтор безопасен', () => {
  const r = n.normalize('Скамья городская   (Скамья "CHOICE SHADOW ")');
  assert.equal(r.out, 'Скамья городская (Скамья «CHOICE SHADOW»)');
  assert.equal(n.normalize(r.out).out, r.out);
  assert.equal(n.normalize('Скамья_6_3', { sku: '6_3' }).out, 'Скамья');
  assert.equal(n.normalize('нечётная "').out, 'нечётная "');
  assert.ok(n.normalize('Скамья_2шт-Турники').disputed.length);
});
test('опечатки', () => {
  assert.equal(n.typos('жим к к груди'), 'жим к груди');
  assert.equal(n.typos('плавнойрегулировки, механизмомнатяжения'), 'плавной регулировки, механизмом натяжения');
  assert.equal(n.normalize('внутри раммы', { typos: true }).out, 'Внутри рамы');
});
