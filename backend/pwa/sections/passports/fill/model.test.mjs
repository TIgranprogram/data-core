// Правила раскладки эталона C056 Д: node --test backend/pwa/sections/passports/fill/model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.location = { pathname: '/app/', hash: '' };
globalThis.window = {
  history: { state: null, replaceState() {}, pushState() {} },
  addEventListener() {},
  location: globalThis.location,
};
const mem = () => {
  const s = new Map();
  return {
    getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)),
    removeItem: (k) => s.delete(k), clear: () => s.clear(), key: () => null, get length() { return s.size; },
  };
};
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
class Node {}
const chain = (self) => new Proxy(self, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'style') return t._style || (t._style = {});
    if (k === 'dataset') return t._ds || (t._ds = {});
    if (k === 'classList') return t._cl || (t._cl = { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } });
    if (k === 'children' || k === 'childNodes') return [];
    return () => chain(t);
  },
  set(t, k, v) { t[k] = v; return true; },
});
class Element extends Node {
  append() {}
  prepend() {}
  replaceChildren() {}
  before() {}
  after() {}
  setAttribute() {}
  getAttribute() { return null; }
  addEventListener() {}
  removeEventListener() {}
  constructor() { super(); return chain(this); }
}
class DocumentFragment extends Node {
  append() {}
  prepend() {}
  replaceChildren() {}
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.DocumentFragment = DocumentFragment;
globalThis.document = chain({
  createElement: () => new Element(),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'hidden',
  body: new Element(),
  documentElement: new Element(),
});
const timers = [];
const origInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...a) => { const id = origInterval(fn, ms, ...a); timers.push(id); return id; };

const { SECTIONS, boxOf, gapLabel, gapSection, kitText, slotKinds, typeOfLeaf } = await import('./model.js');
const { focusGap } = await import('./paint.js');
timers.forEach((id) => clearInterval(id));

test('следующий шаг фокусирует открытое поле габаритов и прокручивает его один раз', () => {
  const calls = [];
  const input = { matches: () => false, getClientRects: () => [{}], focus: (options) => calls.push(['focus', options]) };
  const hidden = { dataset: { gap: 'height' }, getClientRects: () => [] };
  const editor = {
    dataset: { gap: 'height' }, getClientRects: () => [{}], querySelectorAll: () => [input],
    scrollIntoView: (options) => calls.push(['scroll', options]),
  };
  focusGap({ secs: { dims: { querySelectorAll: () => [hidden, editor] } } }, { kind: 'field', key: 'height' });
  assert.deepEqual(calls, [
    ['focus', { preventScroll: true }],
    ['scroll', { block: 'nearest', inline: 'nearest' }],
  ]);
});

test('разделы одни и в порядке паспорта', () => {
  assert.deepEqual(SECTIONS.map(([id]) => id), ['general', 'purpose', 'dims', 'struct', 'install', 'assembly', 'ops', 'other']);
});

test('рисунок и поле попадают в свой раздел, подпись рисунка — словами', () => {
  assert.equal(gapSection({ kind: 'image', key: 'img_overview' }), 'general');
  assert.equal(gapSection({ kind: 'image', key: 'img_dimensions' }), 'dims');
  assert.equal(gapSection({ kind: 'image', key: 'img_view_front' }), 'dims');
  assert.equal(gapSection({ kind: 'image', key: 'img_mounting' }), 'install');
  assert.equal(gapSection({ kind: 'image', key: 'img_safety' }), 'install');
  assert.equal(gapSection({ kind: 'image', key: 'img_assembly' }), 'assembly');
  assert.equal(gapSection({ kind: 'elements', key: 'elements' }), 'purpose');
  assert.equal(gapSection({ kind: 'install', key: 'installationTypeId' }), 'install');
  assert.equal(gapSection({ key: 'serviceLifeYears' }), 'ops');
  assert.equal(gapSection({ key: 'maxUsers' }), 'general');
  assert.equal(gapSection({ key: 'joints' }), 'struct');
  assert.equal(gapSection({ key: 'height' }), 'dims');
  assert.equal(gapSection({ key: 'mystery' }), 'other');
  assert.equal(gapLabel({ kind: 'image', key: 'img_foundation' }), 'Схема фундамента и анкеров');
  assert.equal(gapLabel({ kind: 'image', key: 'img_foundation' }).includes('foundation'), false);
  assert.equal(gapLabel({ key: 'serviceLifeYears', label: 'Срок службы' }), 'Срок службы');
});

test('упрощённый прячет виды полного; сборка — у разобранного или если её просит сервер', () => {
  const asked = new Set(['overview', 'dimensions']);
  const short = slotKinds(asked, new Map(), false, false);
  assert.deepEqual(short.includes('view_front'), false);
  assert.deepEqual(short.includes('assembly'), false);
  assert.deepEqual(short.includes('overview'), true);
  const full = slotKinds(asked, new Map(), true, false);
  assert.equal(full.includes('view_front'), true);
  assert.equal(full.includes('safety'), true);
  assert.equal(full.includes('assembly'), false);
  assert.equal(slotKinds(asked, new Map(), false, true).includes('assembly'), true);
  assert.equal(slotKinds(new Set(['assembly']), new Map(), false, false).includes('assembly'), true);
  assert.equal(slotKinds(new Set(), new Map([['view_3d', { id: '1' }]]), false, false).includes('view_3d'), true);
});

test('«Цельное» только после выбора; пустое — не подстановка', () => {
  assert.equal(kitText({}), '');
  assert.equal(kitText({ passportDefaults: {} }), '');
  assert.equal(kitText({ passportDefaults: { isKit: false } }), 'Цельное');
  assert.equal(kitText({ passportDefaults: { isKit: true } }), 'Разобранное');
});

test('корень текстов — в раздел по коду или по названию', () => {
  assert.equal(boxOf({ name: 'Назначение изделия' }), 'purpose');
  assert.equal(boxOf({ section: 'installation', name: 'X' }), 'install');
  assert.equal(boxOf({ name: 'Схема сборки' }), 'assembly');
  assert.equal(boxOf({ name: 'Гарантия' }), 'ops');
  assert.equal(boxOf({ section: 'care', name: 'Уход' }), 'ops');
  assert.equal(boxOf({ name: 'Прочее' }), 'other');
});

test('способ установки: привязка листа важнее слова в названии', () => {
  const opts = [['a', 'Бетонирование'], ['b', 'Анкерные']];
  assert.equal(typeOfLeaf(null, opts), '');
  assert.equal(typeOfLeaf({ installTypeId: 'x', name: 'Бетон' }, opts), 'x');
  assert.equal(typeOfLeaf({ name: 'Бетонирование опор' }, opts), 'a');
  assert.equal(typeOfLeaf({ name: 'Другое' }, opts), '');
});

// ─── C086: применимость, показ названия, цель вставки ───────────────────────────────────────────────
const { displayName } = await import('./model.js');
const { appliesOf, decide } = await import('./paint.js');
const { pasteTarget } = await import('../../../ui/kit/photos.js');
timers.forEach((id) => clearInterval(id));

test('C086: название для показа — без капса и лишних пробелов; смешанный регистр не трогаем', () => {
  assert.equal(displayName('ДЕРЕВЯННЫЕ   УКАЗАТЕЛИ 1100Х1200  (СМЕТА)'), 'Деревянные указатели 1100х1200 (смета)');
  assert.equal(displayName('Воркаут «STREET» ГТО-3'), 'Воркаут «STREET» ГТО-3');
  assert.equal(displayName('  Качели   2 '), 'Качели 2');
  assert.equal(displayName('ГТО'), 'ГТО');
  assert.equal(displayName(null), '');
});

const BLG = { fields: { serviceLifeYears: 'required', warrantyMonths: 'optional' }, elements: 'optional', kit: 'optional', type: { needed: true, known: true, code: 'other' } };
const TRN = { fields: { heightMin: 'required', weightMax: 'required', maxUsers: 'required', siteLength: 'required', siteWidth: 'required', serviceLifeYears: 'required', warrantyMonths: 'optional', heightMax: 'optional', ageFrom: 'optional' }, elements: 'required', kit: 'optional', type: { needed: false, known: true } };
const numSpec = (key) => ({ key, num: true });
const ctxOf = (applicable, mode = 'issue', extra = {}) => ({ applicable, mode, editing: new Set(), more: false, covered: false, ...extra });
const USER = ['maxUsers', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'fallHeight', 'siteLength', 'siteWidth'];

test('C086: указатель (благоустройство) — параметров пользователя, падения и площадки нет ни в одном режиме', () => {
  for (const mode of ['issue', 'template']) {
    for (const more of [false, true]) {
      const states = USER.map((k) => decide(ctxOf(BLG, mode, { more }), numSpec(k), undefined, ''));
      assert.deepEqual([...new Set(states)], ['skip'], `${mode} more=${more}`);
    }
  }
  assert.equal(appliesOf(BLG, numSpec('serviceLifeYears')), 'required');
  assert.equal(decide(ctxOf(BLG), numSpec('serviceLifeYears'), { key: 'serviceLifeYears' }, ''), 'open');
});

test('C086: необязательное при выпуске свёрнуто, в шаблоне и по «показать» открыто', () => {
  assert.equal(decide(ctxOf(BLG), numSpec('warrantyMonths'), undefined, ''), 'later');
  assert.equal(decide(ctxOf(BLG, 'issue', { more: true }), numSpec('warrantyMonths'), undefined, ''), 'open');
  assert.equal(decide(ctxOf(BLG, 'template'), numSpec('warrantyMonths'), undefined, ''), 'open');
  assert.equal(decide(ctxOf(BLG), { key: 'elements' }, undefined, ''), 'later');
  assert.equal(decide(ctxOf(TRN), { key: 'elements' }, { key: 'elements' }, ''), 'open');
});

test('C086: тренажёр — обязательные параметры остались; сохранённый ответ повторно не спрашивается', () => {
  for (const k of ['heightMin', 'weightMax', 'maxUsers', 'siteLength']) assert.equal(decide(ctxOf(TRN), numSpec(k), { key: k }, ''), 'open');
  assert.equal(decide(ctxOf(TRN), numSpec('fallHeight'), undefined, ''), 'skip');
  assert.equal(decide(ctxOf(TRN), numSpec('heightMin'), undefined, '1400 мм'), 'filled');
});

test('C086: смена категории — чужое сохранённое не стирается и не спрашивается, а объясняется', () => {
  assert.equal(decide(ctxOf(BLG), numSpec('maxUsers'), undefined, '4'), 'foreign');
  assert.equal(decide(ctxOf(TRN), numSpec('maxUsers'), undefined, '4'), 'filled');
});

test('C086: сервер требует поле (подстановка в тексте изделия) — оно открыто, даже если категория его не знает', () => {
  assert.equal(decide(ctxOf(BLG), numSpec('maxUsers'), { key: 'maxUsers', required: true }, ''), 'open');
});

test('C086: правил применимости нет (категория не выбрана) — ничего не скрыто', () => {
  assert.equal(appliesOf(null, numSpec('maxUsers')), 'required');
  assert.equal(decide(ctxOf(null), numSpec('maxUsers'), undefined, ''), 'open');
});

test('C086: Ctrl+V — ровно одна зона; фокус сильнее мыши', () => {
  const host = (name) => ({ name, contains(el) { return el === this || el?.host === this; } });
  const A = { host: host('A') }, B = { host: host('B') }, C = { host: host('C') };
  const zones = [A, B, C];
  const opt = (active, over) => ({ active, hovered: (x) => x === over, hostOf: (z) => z.host });
  assert.equal(pasteTarget(zones, opt({ host: A.host }, B.host)), A, 'фокус в A, мышь над B → A');
  assert.equal(pasteTarget(zones, opt(null, B.host)), B, 'фокуса нет → под мышью');
  assert.equal(pasteTarget(zones, opt({ host: null }, null)), null, 'ни фокуса, ни мыши → спросить');
  assert.equal(pasteTarget([B], opt(null, null)), B, 'зона одна — она');
  assert.equal(pasteTarget([], opt(null, null)), null);
});
