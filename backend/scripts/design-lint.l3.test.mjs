// C029 Этап A — тест разбора классов для L3 (node --test): только значение class:, не соседние атрибуты.
import { test } from 'node:test';
import assert from 'node:assert';
import { litParts, classExprs } from './design-lint.mjs';

// строки из реальных нарушений (help.js:131, composition.js:84, docs.js:253, kit.js:20, chat.js:42, stock-ops.js:131)
const cases = [
  [`  const svg = s('svg', { class: 'hp-svg', viewBox: \`0 0 \${L.width} \${L.height}\`, width: L.width, height: L.height, role: 'img', 'aria-label': 'Схема' });`, ['hp-svg']],
  [`  const pick = h('ul', { class: 'pick-list', role: 'listbox', 'aria-label': 'Материалы и изделия' });`, ['pick-list']],
  [`  const el = h('div', { class: 'docs' }, h('div', { class: 'page-head' }, seg, canTpl() ? button({ label: 'Новый паспорт', kind: 'primary' }) : null), body);`, ['docs', 'page-head']],
  [`    icon: () => h('span', { class: 'ff-ico', 'aria-hidden': 'true' })`, ['ff-ico']],
  [`  const row = (id) => h('button', { type: 'button', class: 'cv-row' + (S.id === id ? ' on' : '') + (n ? ' is-new' : ''), onclick: () => open(id) },`, ['cv-row', 'on', 'is-new']],
  [`          diff.className = 'k-diff num wide ' + (d === null ? 'muted' : below ? 'neg' : d === 0 ? 'pos' : '');`, ['k-diff', 'num', 'wide', 'muted', 'neg', 'pos']],
  [`        badge.className = 'inv-badge found'; badge.replaceChildren('✓ ' + how);`, ['inv-badge', 'found']],
  [`  const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;`, ['is-busy']],
  [`    const paint = () => { row.classList.toggle('on', use.checked); wrap.inert = !use.checked; };`, ['on']],
  [`  const t = h('span', { class: \`bt-time \${late ? 'late' : ''}\`, title: noticeTime(at) });`, ['bt-time']], // 'late' внутри ${…} — не класс (ТЗ: вне ${…})
];

test('classExprs+litParts: только классы, не атрибуты и не слова рядом', () => {
  for (const [line, want] of cases) {
    const got = classExprs(line).flatMap(litParts);
    assert.deepEqual(got, want, line);
  }
});

test('не классы: aria-hidden, true, primary, span, option, Enter, viewBox-числа', () => {
  const line = `  const x = h('div', { class: 'zz', 'aria-hidden': 'true', span: 'option', kind: 'primary', onKey: 'Enter' }, 'текст');`;
  const got = classExprs(line).flatMap(litParts);
  assert.deepEqual(got, ['zz']);
  assert.ok(!got.includes('aria-hidden') && !got.includes('true') && !got.includes('primary') && !got.includes('span') && !got.includes('option') && !got.includes('Enter'));
});
