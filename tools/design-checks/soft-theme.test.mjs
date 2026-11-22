import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { findBrowser } from '../browser-path.mjs';

const root = new URL('../../', import.meta.url);
const app = new URL('backend/pwa/', root);
const origin = 'http://127.0.0.1:41730';
const evidence = process.env.C190_EVIDENCE;
const baselineRef = process.env.C190_BASELINE;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const fixtureUser = { id: 'fixture', username: 'учебная', displayName: 'Учебная учётная запись', role: 'manager', canMoney: true };
const columns = [{ key: 'waiting', title: 'Ждёт запуска' }, { key: 'assembly', title: 'Сборка' }, { key: 'done', title: 'Готово' }];
const work = [
  { id: 'a1', code: 'УЧ-101', title: 'Каркас для пробной сборки', status: 'waiting', qty: 4 },
  { id: 'a2', code: 'УЧ-102', title: 'Контрольный комплект', status: 'waiting', qty: 2 },
  { id: 'b1', code: 'УЧ-103', title: 'Стенд с длинным названием и запасной крепёжной планкой', status: 'work', stepKey: 'assembly', currentStep: 'Сборка', qty: 1, priority: 'high' },
  { id: 'b2', code: 'УЧ-104', title: 'Пробный крепёж', status: 'work', stepKey: 'assembly', currentStep: 'Сборка', qty: 8 },
  { id: 'c1', code: 'УЧ-105', title: 'Учебная секция', status: 'done', qty: 3 },
];
const orders = ['production', 'ready', 'partly', 'shipped'].map((stage, i) => ({
  key: 'УЧ-' + (100 + i), productionNo: 'УЧ-' + (100 + i), stage,
  orderNos: ['Д-' + (31 + i)], customers: ['Учебная мастерская «Север»'], companyNames: ['Учебное производство'],
  lineCount: i + 2, deadline: '2026-11-' + (21 + i), amount: 15000 + i * 2000,
  priority: ['high', 'normal', 'urgent', 'normal'][i],
}));
const paths = {
  board: '#work?view=board',
  list: '#salesorders?view=table',
  map: '#atlas',
};
function apiFixture(url) {
  switch (url.pathname) {
    case '/api/auth/me': return fixtureUser;
    case '/api/work-tasks': {
      const status = url.searchParams.get('status');
      const items = status ? work.filter(row => row.status === status) : work;
      return { items, total: items.length, columns, counts: { all: work.length } };
    }
    case '/api/work-tasks/a1': return { ...work[0], customer: 'Учебная мастерская «Север»', productId: 'p1', productName: 'Пробный каркас', saler: '', route: [] };
    case '/api/work-tasks/b1': return { ...work[2], incomeId: 'income-1', stepIndex: 0, route: [{ stepId: 'step-1', state: 'current', name: 'Сборка' }] };
    case '/api/orderline-plans/by-income/income-1': return { id: 'plan-1', steps: [{ id: 'step-1', startedAt: '2026-11-21T07:30:00Z' }] };
    case '/api/production-orders': return { items: orders, total: orders.length, counts: { active: orders.length } };
    default: return { items: [], total: 0 };
  }
}

async function openFixture(browser, width, theme, css) {
  const context = await browser.newContext({ viewport: { width, height: 1080 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  const denied = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-11-22T09:00:00Z'));
  await context.addInitScript(({ theme, fixtureUser }) => {
    localStorage.setItem('dc-theme', theme);
    sessionStorage.setItem('dca_access', 'synthetic');
    sessionStorage.setItem('dca_refresh', 'synthetic');
    sessionStorage.setItem('dca_user', JSON.stringify(fixtureUser));
  }, { theme, fixtureUser });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      denied.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 403, json: {} });
    }
    if (url.pathname === '/app/ui/tokens.css') return route.fulfill({ contentType: mime['.css'], body: css });
    if (url.pathname.startsWith('/app/')) {
      const relative = url.pathname.slice(5) || 'index.html';
      try {
        return await route.fulfill({ contentType: mime[extname(relative)] || 'application/octet-stream', body: await readFile(new URL(relative, app)) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return route.fulfill({ status: 404 });
      }
    }
    return route.fulfill({ json: apiFixture(url) });
  });
  return { context, page, errors, denied };
}

async function openScreen(page, screen) {
  await page.goto(origin + '/app/' + paths[screen]);
  if (screen === 'board') await page.getByText(work[0].title, { exact: true }).waitFor();
  if (screen === 'list') await page.locator('table.list tbody tr').first().waitFor();
  if (screen === 'map') await page.getByRole('region', { name: 'Карта областей, разделов и связей' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function measure(page, specs) {
  return page.evaluate(specs => {
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = value => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = value;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const blend = (fg, bg) => bg.map((channel, i) => fg[i] * (fg[3] ?? 1) + channel * (1 - (fg[3] ?? 1)));
    const luminance = rgb => rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (left, right) => {
      const [low, high] = [luminance(left), luminance(right)].sort((a, b) => a - b);
      return (high + 0.05) / (low + 0.05);
    };
    function background(el) {
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const color = rgba(getComputedStyle(node).backgroundColor);
        if (color[3] !== 0) layers.push(color);
        if (color.length === 3 || color[3] === 1) break;
      }
      return layers.reverse().reduce((base, layer) => blend(layer, base), [255, 255, 255]);
    }
    return Object.fromEntries(Object.entries(specs).map(([name, [selector, property = 'color', against, pseudo]]) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element, pseudo);
      const base = background(against ? document.querySelector(against) : element);
      const value = rgba(style[property]);
      const opacity = Number(style.opacity);
      value[3] = (value[3] ?? 1) * opacity;
      const actual = blend(value, base);
      return [name, { ratio: +ratio(actual, base).toFixed(2), fg: actual.map(Math.round), bg: base.map(Math.round), opacity }];
    }));
  }, specs);
}

const common = {
  menu: ['.side-link[href="#home"]'],
  menuGroup: ['.side-group'],
  searchPlaceholder: ['.gsearch input', 'color', null, '::placeholder'],
  searchBorder: ['.gsearch input', 'borderTopColor', '.topbar'],
};
const specs = {
  board: {
    heading: ['.page-head h1'],
    activeMenu: ['.side-link.active'],
    activeMenuMark: ['.side-link.active', 'borderLeftColor'],
    laneTitle: ['.col-head'],
    laneHint: ['.col-hint'],
    cardTitle: ['.t-title'],
    cardSubtitle: ['.t-sub'],
    cardOnLane: ['.tcard', 'backgroundColor', '.col'],
    laneOnCanvas: ['.col', 'backgroundColor', 'body'],
    laneBorder: ['.col', 'borderTopColor', 'body'],
    boardPlaceholder: ['.filter-tools input', 'color', null, '::placeholder'],
  },
  list: {
    activeMenu: ['.side-link.active'],
    tableHeading: ['table.list th'],
    tableCell: ['table.list td'],
    tableSub: ['table.list td .muted'],
    listPlaceholder: ['.search input', 'color', null, '::placeholder'],
    primaryButton: ['.page-head .btn-primary'],
    panelOnCanvas: ['.list-panel', 'backgroundColor', 'body'],
  },
  map: {
    mapTitle: ['.am-card-title'],
    mapControl: ['.atlas-map button.btn'],
  },
};
function checkContrast(metrics) {
  const minimum = {
    activeMenuMark: 3, searchBorder: 3, primaryHover: 4.5,
    cardOnLane: 1.35, laneOnCanvas: 1.1, laneBorder: 1.5, panelOnCanvas: 1.2,
    cardFocus: 3, filterFocus: 3,
  };
  for (const [name, value] of Object.entries(metrics)) {
    assert.ok(value.ratio >= (minimum[name] ?? 4.5), name + ': ' + JSON.stringify(value));
  }
}
async function inspectSoft(page, screen, save) {
  const metrics = await measure(page, { ...common, ...specs[screen] });
  const layout = {};
  if (screen === 'board') {
    const lanes = page.locator('.wk-wrap .board > .col');
    assert.equal(await lanes.count(), 3);
    const gaps = await lanes.evaluateAll(elements => elements.slice(1).map((el, i) =>
      el.getBoundingClientRect().left - elements[i].getBoundingClientRect().right));
    assert.deepEqual(gaps, [16, 16]);
    layout.laneGaps = gaps;
    const filter = page.locator('.filter-tools button[aria-controls]');
    await filter.click();
    await page.locator('.list-side').waitFor();
    layout.filterWidth = (await page.locator('.list-side').boundingBox()).width;
    await save('filters');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.list-side').isVisible(), false);
    assert.ok(await filter.evaluate(el => document.activeElement === el));
    Object.assign(metrics, await measure(page, { filterFocus: ['.filter-tools button[aria-controls]', 'outlineColor', 'body'] }));
    const card = page.locator('.tcard').first();
    await card.focus();
    assert.ok(await card.evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle === 'solid'));
    Object.assign(metrics, await measure(page, { cardFocus: ['.tcard', 'outlineColor'] }));
    await save('focus');
    await card.click();
    await page.locator('.drawer h2').getByText(/Каркас для пробной сборки/).waitFor();
    Object.assign(metrics, await measure(page, { link: ['.drawer a:not([class])'], drawerHeading: ['.drawer h2'] }));
    layout.cardWidth = (await page.locator('.drawer').boundingBox()).width;
    await save('card');
    await page.keyboard.press('Escape');
    await page.locator('.drawer').waitFor({ state: 'detached' });
    await page.getByText(work[2].title, { exact: true }).click();
    const started = page.locator('.drawer').getByRole('button', { name: 'Начал', exact: true });
    await started.waitFor();
    assert.ok(await started.isDisabled());
    assert.ok(await page.locator('.drawer').getByRole('button', { name: 'Закончил', exact: true }).isEnabled());
    layout.disabledButtonOpacity = await started.evaluate(el => Number(getComputedStyle(el).opacity));
    assert.equal(layout.disabledButtonOpacity, 0.55);
    await save('disabled');
  }
  if (screen === 'list') {
    const primary = page.locator('.page-head .btn-primary').first();
    await primary.hover();
    Object.assign(metrics, await measure(page, { primaryHover: ['.page-head .btn-primary'] }));
    assert.notDeepEqual(metrics.primaryHover.bg, metrics.primaryButton.bg);
    const row = page.locator('table.list tbody tr').first();
    const resting = await row.evaluate(el => getComputedStyle(el).backgroundColor);
    await row.hover();
    const hovered = await row.evaluate(el => getComputedStyle(el).backgroundColor);
    assert.notEqual(resting, hovered);
    Object.assign(metrics, await measure(page, { rowHover: ['table.list td'] }));
    await save('hover');
  }
  if (screen === 'map') {
    await page.evaluate(() => { location.hash = 'atlas?n=products'; });
    const contents = page.locator('.g-detail-parts').getByText('Состав', { exact: true });
    await contents.click();
    assert.ok(await contents.evaluate(el => el.closest('details').open));
    assert.ok(await page.locator('.g-detail').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    Object.assign(metrics, await measure(page, { mapDetail: ['.g-detail-parts summary'] }));
    layout.mapDrawerWidth = (await page.locator('.g-detail').boundingBox()).width;
    await save('detail');
    await page.keyboard.press('Escape');
    await page.locator('.g-detail').waitFor({ state: 'detached' });
  }
  return { metrics, layout };
}



test('Средняя тема на доске, в таблице и на карте при 1920/2560/3440 px', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const current = await readFile(new URL('ui/tokens.css', app), 'utf8');
  const baseline = baselineRef && execFileSync('git', ['show', baselineRef + ':backend/pwa/ui/tokens.css'], {
    cwd: fileURLToPath(root), encoding: 'utf8',
  });
  if (baseline) {
    const outsideSoft = css => css.replace(/\r\n/g, '\n').replace(/\/\* Средняя тема:[\s\S]+?(?=@media \(min-width: 1101px\))/, '');
    assert.equal(outsideSoft(current), outsideSoft(baseline));
  }
  const comparisons = {};
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    for (const width of [1920, 2560, 3440]) {
      const cases = [['soft', 'after', current]];
      if (baseline) cases.push(['soft', 'before', baseline]);
      if (baseline && width === 1920) {
        cases.push(['light', 'before', baseline], ['light', 'after', current], ['dark', 'before', baseline], ['dark', 'after', current]);
      }
      const screenshots = new Map();
      for (const [theme, revision, css] of cases) {
        const { context, page, errors, denied } = await openFixture(browser, width, theme, css);
        try {
          for (const screen of Object.keys(paths)) {
            await openScreen(page, screen);
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            if (evidence || baseline && theme !== 'soft') {
              const file = width + '-' + screen + '-' + theme + '-' + revision + '.png';
              const screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
              if (evidence) await writeFile(join(evidence, file), screenshot);
              const key = screen + '-' + theme;
              if (theme !== 'soft' && revision === 'before') screenshots.set(key, screenshot);
              if (theme !== 'soft' && revision === 'after') {
                const before = PNG.sync.read(screenshots.get(key));
                const after = PNG.sync.read(screenshot);
                let changedPixels = 0;
                for (let i = 0; i < before.data.length; i += 4) {
                  const peak = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(before.data[i + channel] - after.data[i + channel])));
                  if (peak > 2) assert.fail(file + ', pixel ' + (i / 4) + ', delta ' + peak);
                  if (peak > 0) changedPixels++;
                }
                comparisons[screen + '-' + theme] = changedPixels;
              }
            }
            if (theme === 'soft' && revision === 'before' && evidence) {
              const metrics = await measure(page, { ...common, ...specs[screen] });
              await writeFile(join(evidence, width + '-' + screen + '-contrast-before.json'), JSON.stringify(metrics, null, 2));
            }
            if (theme === 'soft' && revision === 'after') {
              const { metrics, layout } = await inspectSoft(page, screen, async state => {
                if (evidence) await page.screenshot({ path: join(evidence, width + '-' + screen + '-' + state + '.png'), animations: 'disabled' });
              });
              if (evidence) await writeFile(join(evidence, width + '-' + screen + '-contrast.json'), JSON.stringify(metrics, null, 2));
              if (evidence) await writeFile(join(evidence, width + '-' + screen + '-layout.json'), JSON.stringify(layout, null, 2));
              checkContrast(metrics);
            }
          }
          assert.deepEqual(errors, []);
          assert.deepEqual(denied, []);
        } finally {
          await context.close();
        }
      }
    }
    if (evidence && baseline) await writeFile(join(evidence, 'controls.json'), JSON.stringify(comparisons, null, 2));
  } finally {
    await browser.close();
  }
});

