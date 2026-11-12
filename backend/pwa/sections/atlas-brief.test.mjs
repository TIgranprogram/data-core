// Тест сводки и проверки «Карты сайта» (C097): node --test backend/pwa/sections/atlas-brief.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, NODES, LINKS } from './atlas-data.js';
import { atlasProblems, atlasBrief, atlasJson, findNodes } from './atlas-brief.js';

const clone = () => ({ BANDS, NODES: structuredClone(NODES), LINKS: structuredClone(LINKS) });

test('текущая карта без ошибок структуры', () => {
  assert.deepEqual(atlasProblems(), []);
});

test('ловит связь, которую не отдаёт ни один шаг', () => {
  const d = clone();
  for (const p of d.NODES.find((n) => n.id === 'requests').inside) p.out = (p.out || []).filter((x) => x !== 'stock');
  assert.ok(atlasProblems(d).some((e) => e.includes('requests>stock') && e.includes('не отдаёт')));
});

test('ловит занятое место, шаг без id и вход без связи', () => {
  const d = clone();
  d.NODES.find((n) => n.id === 'offers').col = 0; // место «Контрагентов»
  delete d.NODES.find((n) => n.id === 'design').inside[0].id;
  d.NODES.find((n) => n.id === 'money').inside[0].in.push('stock');
  const bad = atlasProblems(d);
  assert.ok(bad.some((e) => e.includes('занято')));
  assert.ok(bad.some((e) => e.includes('без id')));
  assert.ok(bad.some((e) => e.includes('вход из stock')));
});

test('сводка называет шаги с метками, входы и выходы', () => {
  const t = atlasBrief('requests');
  assert.match(t, /^# Заявки — Снабжение/);
  assert.match(t, /\{requests\.[a-z-]+\}/);
  assert.match(t, /в «Доходы и расходы»: .* ← requests\.[a-z-]+, requests\.[a-z-]+/);
  const j = atlasJson('shortage');
  assert.match(j.status, /в разработке/);
  assert.ok(j.steps.every((s) => s.id.startsWith('shortage.')));
});

test('поиск по слову и по id', () => {
  assert.deepEqual(findNodes('requests').map((n) => n.id), ['requests']);
  assert.ok(findNodes('паспорт').some((n) => n.id === 'docs'));
});
