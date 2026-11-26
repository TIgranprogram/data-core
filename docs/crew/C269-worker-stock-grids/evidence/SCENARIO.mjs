// C269: копия данных стенда, все записи и auth-profile только в browser interception.
import { createRequire } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/crew/C269-worker-stock-grids/evidence');
const require = createRequire(path.join(root, 'tools/design-checks/package.json'));
const { chromium } = require('playwright-core');
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 200000) throw new Error('stdin слишком длинный'); }
const session = JSON.parse(input);
if (!session.access || !session.user) throw new Error('Нет сессии стенда');
let executablePath;
for (const name of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
  try { await access(name); executablePath = name; break; } catch { /* следующий */ }
}
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const report = { checks: [], screens: [], errors: [], shots: [] };
const check = (ok, name, data) => report.checks.push({ ok: !!ok, name, ...(data === undefined ? {} : { data }) });
const base = 'http://localhost:3102/app/';
const settle = page => page.waitForTimeout(500);
function fixtures(kind) {
  const item = (id, overrides = {}) => ({ id, materialId: id, name: 'Материал C269 ' + id, article: id, metal: kind,
    quantity: 12, reservedQty: 2, free: 10, unit: kind === 'pipe' ? 'м' : 'шт', countMode: 'single', materialGrade: 'Ст3',
    assortment: kind === 'pipe' ? '40×20×2' : 'Лист', washed: true, dims: kind === 'pipe' ? { length: 6000, width: 40, height: 20, thickness: 2 } : { width: 1250, length: 2500, thickness: 3 },
    sectionProfile: kind === 'pipe' ? { shape: 'rect', label: '40×20×2', state: 'complete', widthMm: 40, heightMm: 20, wallMm: 2 } : undefined,
    notes: 'Проверка C269', ...overrides });
  return kind === 'pipe' ? [
    item('pipe-6a'), item('pipe-6b'), item('pipe-12', { dims: { length: 12000 }, washed: false }),
    item('pipe-odd', { dims: { length: 7500 }, washed: null }),
    item('pipe-zero', { quantity: 0, reservedQty: 0, free: 0, dims: { length: 4000 } }),
    item('pipe-multiple', { countMode: 'multiple', dims: { length: 3000 } }),
    item('pipe-unknown', { countMode: undefined, sectionProfile: { shape: 'unknown', label: 'Уточнить сечение', state: 'unknown' }, dims: {} }),
    item('pipe-pieces', { unit: 'шт', materialGrade: 'AISI 304', dims: { length: 6000, diameter: 25, thickness: 2 }, sectionProfile: { shape: 'round', label: 'Ø25×2', state: 'complete', diameterMm: 25, wallMm: 2 } }),
  ] : [item('sheet-3a'), item('sheet-3b'), item('sheet-4', { dims: { width: 1500, length: 3000, thickness: 4 }, materialGrade: 'AISI 304' }),
    item('sheet-zero', { quantity: 0, reservedQty: 0, free: 0, dims: { width: 1000, length: 2000, thickness: 2 } }),
    item('sheet-offcut', { offcutOf: 'sheet-3a', dims: { width: 500, length: 800, thickness: 3 } }),
    item('sheet-multiple', { countMode: 'multiple', dims: { width: 1000, length: 1000, thickness: 3 } }),
    item('sheet-unknown', { countMode: undefined, dims: { thickness: 5 }, unit: 'м²' })];
}
async function run(kind, theme, width, { readOnly = false, edge = false, edits = false } = {}) {
  const state = { kind, theme, width, readOnly, edge, writes: [], blockedOtherWrites: [], items: [], errorNext: false };
  const user = { ...session.user, role: readOnly ? 'director' : 'fixture-' + kind, baseRole: readOnly ? 'director' : 'manager', roleLabel: readOnly ? 'Директор' : kind === 'pipe' ? 'Труборез' : 'Лазер лист', sections: ['stock'], stockViews: [kind], isOwner: false };
  const context = await browser.newContext({ viewport: { width, height: width === 2560 ? 1440 : 1080 }, serviceWorkers: 'block' });
  await context.addInitScript(({ access, refresh, user, theme }) => {
    localStorage.setItem('dca_access', access); localStorage.setItem('dca_refresh', refresh || '');
    localStorage.setItem('dca_user', JSON.stringify(user)); localStorage.setItem('dc-theme', theme);
  }, { access: session.access, refresh: session.refresh, user, theme });
  const changes = new Map();
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (p.endsWith('/stock/batch') && method === 'POST') {
        const body = req.postDataJSON(); state.writes.push({ path: '/stock/batch', body });
        if (state.errorNext) { state.errorNext = false; return route.fulfill({ status: 409, json: { message: 'Проверочная ошибка сохранения' } }); }
        for (const line of body.lines || []) changes.set(line.materialId, { ...changes.get(line.materialId), quantity: line.qty });
        return route.fulfill({ status: 201, json: { ok: true } });
      }
      if (/\/stock\/items\/[^/]+$/.test(p) && method === 'PATCH') {
        const body = req.postDataJSON(), id = p.split('/').pop(); state.writes.push({ path: '/stock/items/' + id, body });
        changes.set(id, { ...changes.get(id), ...body }); return route.fulfill({ status: 200, json: { id, ...body } });
      }
      state.blockedOtherWrites.push(p.replace(/\b[0-9a-f]{24}\b/g, ':id'));
      return route.fulfill({ status: 200, json: {} });
    }
    if (p.endsWith('/auth/me')) return route.fulfill({ status: 200, json: user });
    if (p.endsWith('/stock/items')) {
      let result;
      if (edge) result = { items: fixtures(kind), total: fixtures(kind).length, page: 1, limit: 100 };
      else { const response = await route.fetch(); result = await response.json(); }
      result.items = (result.items || []).map(item => ({ ...item, ...changes.get(item.materialId || item.id) }));
      state.items = result.items;
      return route.fulfill({ status: 200, json: result });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(kind + ':' + error.message));
  const prefix = [kind, theme, width, readOnly ? 'readonly' : edge ? 'edges' : 'native'].join('-');
  const shot = async suffix => { const name = prefix + '-' + suffix + '.png'; await page.screenshot({ path: path.join(out, name) }); report.shots.push(name); };
  try {
    await page.goto(base + '#stock' + (readOnly ? '?view=' + kind : ''), { waitUntil: 'domcontentloaded' });
    await page.locator('.pg-table').first().waitFor({ timeout: 25000 }); await settle(page);
    if (width <= 1500) {
      const menu = page.getByRole('button', { name: 'Меню', exact: true });
      check(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).visibility === 'hidden'), prefix + ': меню скрыто слева');
      await menu.click(); await settle(page);
      check(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).visibility === 'visible' && el.getBoundingClientRect().x >= -1), prefix + ': меню доступно по кнопке');
      await page.keyboard.press('Escape'); await settle(page);
      check(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).visibility === 'hidden'), prefix + ': Escape закрывает меню');
    }
    check(state.items.length > 0, prefix + ': заполненная таблица');
    check(await page.locator('.pg-table').count() > 0, prefix + ': специализированная сетка');
    const foundIds = await page.locator('[data-material-id]').evaluateAll(nodes => nodes.map(n => n.dataset.materialId));
    check(state.items.every(item => foundIds.includes(item.materialId || item.id)), prefix + ': ни одна позиция не потеряна', { items: state.items.length, cells: foundIds.length });
    check(new Set(foundIds).size === foundIds.length, prefix + ': materialId не дублируются');
    const geometry = await page.evaluate(() => {
      const tables = [...document.querySelectorAll('.pg-table')].map(table => ({ width: table.getBoundingClientRect().width, parent: table.parentElement.getBoundingClientRect().width }));
      const inputs = [...document.querySelectorAll('input.pg-in')].filter(el => el.getBoundingClientRect().height);
      return { pageX: document.scrollingElement.scrollWidth - innerWidth, tables, minInputHeight: inputs.length ? Math.min(...inputs.map(el => el.getBoundingClientRect().height)) : null };
    });
    check(geometry.pageX <= 1, prefix + ': нет горизонтального скролла страницы', geometry);
    if (geometry.minInputHeight != null) check(geometry.minInputHeight >= 44, prefix + ': крупные поля количества', geometry.minInputHeight);
    await shot('grid');
    if (readOnly) {
      check(await page.locator('.pg-table input').count() === 0, prefix + ': просмотр без полей записи');
      check(state.writes.length === 0, prefix + ': просмотр не пишет');
    }
    if (edge) {
      for (const item of state.items.filter(item => item.countMode !== 'single')) {
        check(await page.locator('[data-material-id="' + item.id + '"] input.pg-in').count() === 0, prefix + ': закрыт пересчёт ' + item.id);
      }
      check(await page.getByText('Нет в наличии', { exact: true }).count() > 0, prefix + ': нули подписаны');
      if (kind === 'pipe') {
        const header = await page.locator('.pg-table thead').allInnerTexts();
        check(header.join(' ').includes('7,5') || header.join(' ').includes('7.5'), prefix + ': нестандартная длина не потеряна', header);
      } else check(await page.getByText(/Обрезок/).count() > 0, prefix + ': обрезки явно показаны');
    }
    if (edits) {
      const item = state.items.find(it => it.countMode === 'single' && it.unit === (kind === 'pipe' ? 'м' : 'шт'));
      if (!item) throw new Error('Нет редактируемой позиции ' + kind);
      const id = item.materialId || item.id, cell = page.locator('[data-material-id="' + id + '"]');
      const amount = cell.locator('input.pg-in'); await amount.scrollIntoViewIfNeeded(); await amount.focus();
      await amount.fill('3'); await amount.press('Enter'); await settle(page);
      const count = state.writes.find(w => w.path === '/stock/batch');
      check(count?.body.lines?.[0]?.materialId === id && count.body.lines[0].qty === 3 && count.body.lines[0].expected === item.quantity, prefix + ': количество 3 сохраняется без преобразования', count?.body);
      const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, cls: document.activeElement.className }));
      check(focus.tag === 'INPUT' && /pg-in|pg-note/.test(focus.cls), prefix + ': фокус остался в таблице после сохранения', focus);
      const beforeEscape = state.writes.length; await amount.fill('999'); await amount.press('Escape'); await settle(page);
      check(state.writes.length === beforeEscape && await amount.inputValue() === '3', prefix + ': Escape не сохраняет');
      await amount.fill('-4'); await amount.press('Tab'); await settle(page);
      check(state.writes.length === beforeEscape && await amount.inputValue() === '3', prefix + ': отрицательное значение не записано');
      state.errorNext = true; await amount.fill('7'); await amount.press('Tab'); await settle(page);
      check(await amount.inputValue() === '3', prefix + ': ошибка сервера возвращает значение');
      const note = cell.locator('input.pg-note');
      if (await note.count()) {
        if (!await note.isVisible()) await cell.locator('details > summary').first().click();
        await note.fill('C269 проверка примечания'); await note.press('Tab'); await settle(page); check(state.writes.some(w => w.body.notes === 'C269 проверка примечания'), prefix + ': примечание сохраняется отдельно');
      }
      await shot('saved');
    }
  } catch (error) { report.errors.push(prefix + ':' + error.message); }
  finally { report.screens.push({ ...state, writes: state.writes, items: state.items.length }); await context.close(); }
}
try {
  for (const kind of ['pipe', 'sheet']) {
    await run(kind, 'light', 1440, { edits: true });
    await run(kind, 'dark', 1920);
    await run(kind, 'soft', 2560, { readOnly: true });
    await run(kind, 'light', 1024, { edge: true, edits: true });
  }
} finally { await browser.close(); }
await writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok), errors: report.errors, screenshots: report.shots }, null, 2));
if (report.errors.length || report.checks.some(c => !c.ok)) process.exitCode = 1;
