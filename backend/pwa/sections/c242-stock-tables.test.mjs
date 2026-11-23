import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const root = new URL('../', import.meta.url), origin = 'http://c242.test';
const zones = [{ id: 'main', name: 'Основной', isDefault: true }, { id: 'pipe', name: 'Трубы' }, { id: 'sheet', name: 'Листовой материал' }, { id: 'wood', name: 'Деревообработка', categoryIds: ['wood-cat'] }];
const pipe = (id, w, h, wall, quantity, extra = {}) => ({ id, materialId: id, metal: 'pipe', name: `Труба ${w}×${h}×${wall}, ${id}`, assortment: `Труба ${w}×${h}×${wall}`, categoryName: 'Профильная труба', unit: 'м', quantity, reservedQty: 0, materialGrade: 'Ст3', washed: false,
  dims: { width: w, height: h, thickness: wall, length: 6000 }, sectionProfile: { shape: 'rect', widthMm: w, heightMm: h, wallMm: wall, label: `${w}×${h}×${wall}`, state: 'complete', source: 'dimensions' }, ...extra });
const samples = {
  main: [{ id: 'tool', name: 'Киянка резиновая', categoryName: 'Инструмент', unit: 'шт', quantity: 2, reservedQty: 1 }, { id: 'zero-tool', name: 'Сетка для площадки', categoryName: 'Сетка', unit: 'м²', quantity: 0 }],
  pipe: [pipe('fully-reserved', 20, 20, 2, 4, { reservedQty: 4 }), pipe('mixed-lengths', 40, 40, 2, 20), pipe('zero-80', 80, 60, 3, 0), pipe('same-section-other-grade', 80, 60, 3, 6, { materialGrade: 'AISI 304', washed: null }),
    { id: 'pieces', materialId: 'pieces', metal: 'pipe', name: 'Куски трубы, длины не определены', assortment: 'Труба 50×50×2', unit: 'м', quantity: 2, dims: {}, sectionProfile: { shape: 'rect', label: '50×50×2', state: 'complete', widthMm: 50, heightMm: 50, wallMm: 2 } }],
  sheet: [{ id: 'sheet-one', name: 'Лист Ст3', metal: 'sheet', materialGrade: 'Ст3', unit: 'лист', quantity: 4, reservedQty: 1, dims: { thickness: 3, width: 1250, length: 2500 } },
    { id: 'offcut', name: 'Обрезок AISI304', metal: 'sheet', materialGrade: 'AISI 304', offcutOf: 'sheet-one', unit: 'шт', quantity: 1, dims: { thickness: 6, width: 500, length: 640 } },
    { id: 'unknown-sheet', name: 'Лист без формата', metal: 'sheet', unit: 'лист', quantity: 0, dims: {} }],
  wood: [{ id: 'beam', name: 'Брус сосновый', categoryId: 'wood-cat', categoryName: 'Дерево', unit: 'м', quantity: 12, dims: { width: 100, height: 50, length: 3000 } },
    { id: 'ply', name: 'Фанера берёзовая', categoryId: 'wood-cat', categoryName: 'Фанера', unit: 'м²', quantity: 4, dims: { width: 1525, length: 1525, thickness: 15 } },
    { id: 'glue', name: 'Клей столярный', categoryId: 'wood-cat', categoryName: 'Расходники', unit: 'шт', quantity: 0, dims: {} }],
};
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });
const normalize = value => String(value || '').toLowerCase().replace(/[xх*]/g, '×').replace(/\s*×\s*/g, '×');

async function fixture(t, { kind = 'pipe', theme = 'light', many = false, width = 2560, delayedPipe = false, mixedMain = false, unknownSize = false, excluded = false, countCase } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1100 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const records = structuredClone(samples), calls = [], errors = [];
  if (many) records.pipe = Array.from({ length: typeof many === 'number' ? many : 103 }, (_, index) => pipe('material-' + index, 20 + index, 20, 2, index));
  if (mixedMain) records.main = [...Array.from({ length: 30 }, (_, index) => ({ id: 'tool-' + index, name: 'А-инструмент-' + index, quantity: 1, unit: 'шт' })), { id: 'last-sized', name: 'Я-брус', quantity: 1, unit: 'м', categoryName: 'Дерево', dims: { width: 100, height: 50, length: 3000 } }];
  if (unknownSize) records.main.push({ id: 'missing-size', categoryId: 'missing-size', categoryName: 'Доска', name: 'Доска без размеров', unit: 'м', quantity: 0 });
  if (excluded) records.main.push({ id: 'pdm-part', materialKind: 'part', name: 'Собственная деталь PDM', quantity: 10 }, { id: 'catalogue-profile', isProfile: true, name: 'Профиль справочника', quantity: 0 });
  for (const key of Object.keys(records)) records[key] = records[key].map(item => ({ countMode: 'single', ...item }));
  if (countCase) Object.assign(records[kind][0], { quantity: 5, reservedQty: 0, countMode: countCase === 'missing' ? undefined : countCase });
  const person = { id: 'c242-user', role: 'admin', displayName: 'Складская проверка', sections: null, canMoney: false };
  await page.addInitScript(({ person, kind, theme }) => {
    localStorage.setItem('dca_user', JSON.stringify(person)); localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_refresh', 'fixture');
    localStorage.setItem('dc-stock-zone-' + person.id, kind); localStorage.setItem('dc-theme', theme);
  }, { person, kind, theme });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method(), query = Object.fromEntries(url.searchParams);
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, query, method, body });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: person });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: zones } });
      if (url.pathname === '/api/stock/batch' && method === 'POST') {
        for (const line of body.lines) { const item = Object.values(records).flat().find(item => item.id === line.materialId); if (item) item.quantity = line.qty; }
        return route.fulfill({ json: { ok: true } });
      }
      if (method === 'PATCH' && url.pathname.startsWith('/api/stock/items/')) {
        const item = Object.values(records).flat().find(item => item.id === decodeURIComponent(url.pathname.split('/').at(-1)));
        if (item && body.notes !== undefined) item.notes = body.notes;
        return route.fulfill({ json: item || {} });
      }
      if (url.pathname === '/api/stock/items') {
        if (delayedPipe && query.zoneId === 'pipe' && Number(query.limit) < 1000) await new Promise(resolve => setTimeout(resolve, 750));
        let found = [...(records[query.zoneId] || Object.values(records).flat())];
        if (query.withParts === '0') found = found.filter(item => item.materialKind !== 'part' && !item.isProfile);
        if (query.search) found = found.filter(item => normalize([item.name, item.assortment, item.materialGrade].join(' ')).includes(normalize(query.search)));
        if (query.held === '1' || query.availability === 'in') found = found.filter(item => item.quantity > 0);
        if (query.availability === 'none') found = found.filter(item => item.quantity === 0);
        if (query.ids) found = found.filter(item => query.ids.split(',').includes(item.id));
        if (query.categoryId) found = found.filter(item => query.categoryId.split(',').includes(item.categoryId || 'none'));
        const field = (query.sort || 'name').replace(/^-/, ''), desc = query.sort?.startsWith('-') ? -1 : 1;
        if (field === 'quantity') found.sort((a, b) => desc * (a.quantity - b.quantity));
        else if (field === 'sectionSize') found.sort((a, b) => desc * ((a.sectionProfile?.widthMm || 0) - (b.sectionProfile?.widthMm || 0)));
        else if (field === 'name') found.sort((a, b) => desc * a.name.localeCompare(b.name));
        else if (query.sort?.startsWith('-')) found.reverse();
        const limit = Number(query.limit || 100), number = Number(query.page || 1), total = found.length;
        return route.fulfill({ json: { items: found.slice((number - 1) * limit, number * limit), total, page: number, limit, counts: { all: total, ok: total } } });
      }
      if (url.pathname === '/api/stock/categories') return route.fulfill({ json: { items: [{ id: 'wood-cat', name: 'Материалы', total: 3 }], total: 3 } });
      if (url.pathname === '/api/stock/lookup') return route.fulfill({ json: { items: Object.values(records).flat() } });
      if (url.pathname === '/api/supply/lookups') return route.fulfill({ json: { categories: [{ name: 'Профильная труба' }], units: ['м', 'лист', 'шт'] } });
      if (url.pathname === '/api/categories') return route.fulfill({ json: [{ id: 'wood-cat', name: 'Дерево' }] });
      return route.fulfill({ json: { items: [], counts: {}, metrics: {}, feed: [], week: [] } });
    }
    if (url.pathname === '/app/version.json') return route.fulfill({ json: { v: 'fixture' } });
    if (url.pathname === '/app/fixture.html') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="fixture"></div></body></html>' });
    const file = url.pathname.slice('/app/'.length) || 'index.html';
    const type = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', woff2: 'font/woff2' }[file.split('.').pop()];
    try { return route.fulfill({ contentType: type || 'application/octet-stream', body: await readFile(new URL(file, root)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  const view = kind === 'main' ? 'table&all=1' : kind;
  await page.goto(origin + '/app/#stock?view=' + view);
  return { page, calls, records, errors };
}

for (const kind of ['main', 'pipe', 'sheet', 'wood']) for (const theme of ['light', 'dark']) {
  test(kind + ' / ' + theme + ': отдельные колонки, исходные unit и серый известный ноль', async t => {
    const { page, calls, errors } = await fixture(t, { kind, theme });
    const grid = page.locator('table.list').first(); await grid.locator('tbody tr').first().waitFor();
    await page.waitForTimeout(100);
    const rows = grid.locator('tbody tr');
    assert.equal(await rows.count(), samples[kind].length);
    assert.ok(await grid.getByText('Нет в наличии', { exact: true }).count());
    assert.ok(await grid.locator('tr.muted').count());
    const headers = await grid.locator('thead th').allTextContents();
    assert.ok(headers.some(value => value.includes('Ед. учёта')));
    if (kind === 'pipe') {
      assert.equal(headers[0], 'Сортамент / сечение, мм');
      assert.ok(headers.includes('Длина единицы, м'));
      assert.equal(await rows.filter({ hasText: '80×60×3' }).count(), 2);
      assert.ok((await grid.textContent()).includes('Не указано'));
      assert.equal(await grid.getByText('3,33', { exact: true }).count(), 0);
      assert.ok(calls.some(call => call.path === '/api/stock/items' && call.query.sort === 'sectionSize' && call.query.zoneId === 'pipe' && !call.query.held));
    }
    if (kind === 'sheet') {
      assert.ok(headers.includes('Толщина / стенка, мм') && headers.includes('Ширина, мм') && headers.includes('Длина, мм'));
      assert.ok((await grid.locator('tr[data-id="offcut"]').textContent()).includes('шт'));
    }
    if (kind === 'wood') assert.ok(headers.includes('Высота, мм') && headers.includes('Толщина, мм'));
    if (process.env.C242_PROOF_DIR) { await mkdir(process.env.C242_PROOF_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.C242_PROOF_DIR, kind + '-' + theme + '.png'), fullPage: true }); }
    assert.deepEqual(errors, []);
    assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
  });
}

test('native: серверная страница2, sort, поиск нуля и availability до страницы', async t => {
  const { page, calls, errors } = await fixture(t, { many: true });
  await page.locator('table tbody tr').first().waitFor();
  assert.equal(await page.locator('table tbody tr').count(), 100);
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 3);
  assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.dataset.id)), ['material-100', 'material-101', 'material-102']);
  await page.getByRole('tab', { name: 'Нет в наличии', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 1);
  assert.ok(calls.some(call => call.query.availability === 'none' && call.query.page === '1'));
  await page.getByRole('tab', { name: 'Все', exact: true }).click();
  await page.locator('select[aria-label="Сортировка"]').selectOption('-quantity', { force: true });
  await page.waitForFunction(() => document.querySelector('tbody tr')?.dataset.id === 'material-102');
  assert.ok(calls.some(call => call.query.sort === '-quantity' && call.query.page === '1'));
  assert.deepEqual(errors, []);
});

test('пересчёт последних строк фильтра наличия возвращает к существующей странице, без ложных штук', async t => {
  const { page, calls, errors } = await fixture(t, { many: true });
  await page.locator('table tbody tr').first().waitFor();
  await page.getByRole('tab', { name: 'В наличии', exact: true }).click();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.locator('tr[data-id="material-101"] input.pg-in').waitFor();
  for (const id of ['material-101', 'material-102']) {
    const amount = page.locator(`tr[data-id="${id}"] input.pg-in`); await amount.fill('0'); await amount.press('Enter');
    await page.locator(`tr[data-id="${id}"]`).waitFor({ state: 'detached' });
  }
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 100);
  assert.ok(calls.some(call => call.query.availability === 'in' && call.query.page === '1'));
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines[0]), [
    { materialId: 'material-101', qty: 0, expected: 101 }, { materialId: 'material-102', qty: 0, expected: 102 },
  ]);
  assert.deepEqual(errors, []);
});

for (const kind of ['pipe', 'sheet', 'wood']) test('P2 / ' + kind + ': сумма5 multiple без inlinecount; material.notes остаётся отдельным свойством', async t => {
  const { page, calls, records, errors } = await fixture(t, { kind, theme: 'dark', countCase: 'multiple' });
  const item = records[kind][0], row = page.locator(`tr[data-id="${item.id}"]`);
  await row.waitFor();
  const count = row.locator('[aria-label^="Фактически"]');
  assert.equal(await count.textContent(), '5');
  assert.equal(await count.evaluate(element => element.tagName), 'SPAN');
  assert.equal(await row.locator('input.pg-in').count(), 0);
  assert.equal(await row.getByText('Несколько мест хранения — пересчёт общего остатка недоступен', { exact: true }).count(), 1);
  await count.evaluate(element => {
    element.value = '999';
    for (const type of ['input', 'change', 'focus', 'blur']) element.dispatchEvent(new Event(type, { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const note = row.locator('input.pg-note');
  await note.fill('Примечание общего материала');
  const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/stock/items/' + item.id));
  await note.press('Enter'); await saved;
  assert.deepEqual(calls.find(call => call.method === 'PATCH').body, { notes: 'Примечание общего материала' });
  assert.equal(calls.filter(call => call.path === '/api/stock/batch').length, 0);
  assert.equal(item.quantity, 5);
  if (process.env.C242_MULTIPLE_PROOF_DIR && kind === 'pipe') {
    await mkdir(process.env.C242_MULTIPLE_PROOF_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.C242_MULTIPLE_PROOF_DIR, 'multiple-pipe-dark.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
});

test('P2: отсутствующий или неизвестный countMode failclosed, single без storageitem допускает первый пересчёт', async t => {
  for (const countCase of ['missing', 'unrecognized']) {
    const { page, calls } = await fixture(t, { countCase });
    const row = page.locator('tr[data-id="fully-reserved"]'); await row.waitFor();
    assert.equal(await row.locator('input.pg-in').count(), 0);
    await row.getByText('Способ пересчёта не подтверждён — общий остаток доступен только для просмотра', { exact: true }).waitFor();
    assert.equal(calls.filter(call => call.path === '/api/stock/batch').length, 0);
  }
  const { page, calls } = await fixture(t);
  const input = page.locator('tr[data-id="zero-80"] input.pg-in'); await input.waitFor();
  const counted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/stock/batch'));
  await input.fill('1'); await input.press('Enter'); await counted;
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'zero-80', qty: 1, expected: 0 });
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/api/stock/items').length, 0);
});

test('нулевая raw номенклатура видима, собственные PDM/профили не возвращаются в складской список', async t => {
  const { page, calls } = await fixture(t, { kind: 'main', excluded: true });
  await page.locator('table tbody tr[data-i]').first().waitFor();
  assert.equal(await page.locator('table tbody tr[data-i]').count(), 2);
  const grid = page.locator('table').first();
  assert.equal(await grid.getByText('Сетка для площадки', { exact: true }).count(), 1);
  assert.equal(await grid.getByText('Собственная деталь PDM', { exact: true }).count(), 0);
  assert.equal(await grid.getByText('Профиль справочника', { exact: true }).count(), 0);
  assert.ok(calls.filter(call => call.path === '/api/stock/items').every(call => call.query.withParts === '0' && !call.query.held));
  const old = await page.evaluate(async () => (await (await import('/app/core/stock-list.js')).stockList()).map(item => item.id));
  assert.ok(old.includes('pdm-part')); // Старый общий клиент не получил новый фильтр.
});

test('полная подгрузка не обрезает 10123 позиций; индекс признаков не мутирует общий кэш', async t => {
  const { page, calls } = await fixture(t, { kind: 'main', many: 10123 });
  const result = await page.evaluate(async () => {
    const { catalogueStockList } = await import('/app/core/stock-list.js');
    const items = await catalogueStockList('pipe');
    return { count: items.length, ids: new Set(items.map(item => item.id)).size, last: items.at(-1).id, mutated: items.some(item => Object.hasOwn(item, '_f')) };
  });
  assert.equal(result.count, 10123); assert.equal(result.ids, 10123); assert.equal(result.mutated, false);
  assert.equal(calls.filter(call => call.query.zoneId === 'pipe' && call.query.limit === '1000').length, 11);
});

test('основные колонки выбираются по полному scope, стабильны при подгрузке; missing размеры не скрываются', async t => {
  const { page } = await fixture(t, { kind: 'main', mixedMain: true });
  await page.locator('table tbody tr[data-i]').first().waitFor();
  const first = await page.locator('table thead th').allTextContents();
  assert.ok(first.includes('Ширина, мм')); assert.ok(first.includes('Высота, мм'));
  assert.equal(await page.getByText('Я-брус', { exact: true }).count(), 0);
  await page.locator('.table-wrap').first().evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll('tr[data-i]').length === 31);
  assert.deepEqual(await page.locator('table thead th').allTextContents(), first);
  const missing = await fixture(t, { kind: 'main', unknownSize: true });
  await missing.page.evaluate(async () => (await import('/app/core/router.js')).patch({ categoryId: 'missing-size' }));
  await missing.page.getByRole('columnheader', { name: 'Размеры', exact: true }).waitFor();
  assert.equal(await missing.page.getByText('Размеры не указаны', { exact: true }).count(), 1);
});

test('форма металла хранит W/H/D отдельно; частичная смена длины не обнуляет ширину профиля', async t => {
  const { page } = await fixture(t);
  const result = await page.evaluate(async () => {
    const { metalInitial, metalBody } = await import('/app/sections/metal.js');
    const start = { categoryName: 'Профильная труба', unit: 'м', assortment: '100×50×2', dims: { length: 6000, width: 100, height: 50, thickness: 2, depth: 7 } };
    const values = { ...start, ...metalInitial(start), lengthM: 12 };
    const inferred = { ...start, dims: { thickness: 2, length: 6000 }, sectionProfile: { state: 'complete', widthMm: 100, heightMm: 50 } };
    return { pipe: metalBody(values, { wasKind: 'pipe', previous: start }), sheet: metalBody({ categoryName: 'Лист', unit: 'лист', lengthM: 2.5, widthM: 1.25, thickness: 3 }), unrelated: metalBody({ categoryName: 'Инструмент', unit: 'шт' }),
      inferred: metalBody({ ...inferred, ...metalInitial(inferred) }, { wasKind: 'pipe', previous: inferred }) };
  });
  assert.deepEqual(result.pipe.dims, { length: 12000 });
  assert.ok(!Object.hasOwn(result.pipe.dims, 'depth'));
  assert.deepEqual(result.sheet.dims, { length: 2500, width: 1250, thickness: 3 });
  assert.deepEqual(result.unrelated, {});
  assert.deepEqual(result.inferred.dims, {});
});

for (const theme of ['light', 'dark']) test('основная таблица: четыре зоны, columnsFor и default sort после query / ' + theme, async t => {
  const { page, calls, errors } = await fixture(t, { kind: 'main', theme });
  await page.locator('table tbody tr').first().waitFor();
  assert.equal(await page.getByRole('columnheader', { name: 'Ширина, мм', exact: true }).count(), 0);
  const original = await page.evaluate(async () => (await import('/app/sections/stock.js')).stock.list.columns.map(column => column.key));
  for (const kind of ['pipe', 'sheet', 'wood']) {
    await page.getByRole('button', { name: zones.find(zone => zone.id === kind).name, exact: true }).click();
    const expected = kind === 'pipe' ? 'Сортамент / сечение, мм' : kind === 'sheet' ? 'Толщина / стенка, мм' : 'Высота, мм';
    await page.waitForFunction(label => [...document.querySelectorAll('table thead th')].some(header => header.textContent.startsWith(label)), expected);
    await page.waitForFunction(expected => document.querySelectorAll('table tbody tr[data-i]').length === expected, samples[kind].length);
    const headers = await page.locator('table thead th').allTextContents();
    assert.ok(headers.some(label => label.startsWith(expected)));
    assert.ok(calls.some(call => call.query.zoneId === kind && call.query.sort === ({ pipe: 'sectionSize', sheet: 'sheetSize', wood: 'woodSize' }[kind]) && Number(call.query.limit) < 1000));
    if (kind === 'pipe') {
      await page.waitForFunction(() => document.querySelector('.ff-inline')?.textContent.includes('80×60×3'));
      assert.equal(calls.filter(call => call.query.zoneId === 'pipe' && call.query.limit === '1000').length, 1);
    }
    if (process.env.C242_PROOF_DIR) await page.screenshot({ path: path.join(process.env.C242_PROOF_DIR, 'main-zone-' + kind + '-' + theme + '.png'), fullPage: true });
  }
  const after = await page.evaluate(async () => (await import('/app/sections/stock.js')).stock.list.columns.map(column => column.key));
  assert.deepEqual(after, original);
  assert.deepEqual(errors, []);
});

test('поздний ответ прежней зоны не возвращает старые колонки/строки; явный sort=name сохраняется', async t => {
  const { page, calls, errors } = await fixture(t, { kind: 'main', delayedPipe: true });
  await page.locator('table tbody tr').first().waitFor();
  await page.getByRole('button', { name: 'Трубы', exact: true }).click();
  for (let attempt = 0; attempt < 50 && !calls.some(call => call.query.zoneId === 'pipe' && Number(call.query.limit) < 1000); attempt++) await page.waitForTimeout(10);
  await page.getByRole('button', { name: 'Листовой материал', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('table thead th')].some(header => header.textContent.startsWith('Толщина / стенка, мм')));
  await page.waitForTimeout(900);
  assert.equal(await page.locator('table tbody tr[data-i]').count(), 3);
  assert.equal(await page.getByRole('columnheader', { name: 'Сортамент / сечение, мм', exact: true }).count(), 0);
  await page.evaluate(async () => { const { patch } = await import('/app/core/router.js'); patch({ sort: 'name' }); });
  await page.waitForTimeout(100);
  assert.ok(calls.some(call => call.query.zoneId === 'sheet' && call.query.sort === 'name'));
  assert.deepEqual(errors, []);
});

test('полный каталог и held имеют разные scope-кэши; нулевой lookup нормализует размеры', async t => {
  const { page, calls } = await fixture(t);
  const result = await page.evaluate(async () => {
    const { catalogueStockList, heldStockList, resetStock, stockLookup } = await import('/app/core/stock-list.js');
    const { normSearch } = await import('/app/core/facets.js');
    const { session } = await import('/app/core/api.js');
    resetStock();
    const [all, repeated, held] = await Promise.all([catalogueStockList('pipe'), catalogueStockList('pipe'), heldStockList('pipe')]);
    const lookup = await stockLookup();
    session.user = { ...session.user, warehouseIds: ['changed-scope'] };
    await catalogueStockList('pipe');
    return { all: all.length, same: all === repeated, held: held.length, zero: lookup.filter(item => normSearch(item.name).includes(normSearch('80 х 60 x 3,0'))).length };
  });
  assert.deepEqual(result, { all: 5, same: true, held: 4, zero: 2 });
  assert.ok(calls.some(call => call.query.held === '1'));
  assert.ok(calls.filter(call => call.path === '/api/stock/items' && call.query.limit === '1000' && !call.query.held).length >= 2);
});
