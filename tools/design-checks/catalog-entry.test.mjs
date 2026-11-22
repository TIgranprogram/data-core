import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { findBrowser } from '../browser-path.mjs';

const app = new URL('../../backend/pwa/', import.meta.url);
const origin = 'http://127.0.0.1:41731';
const evidence = process.env.C193_EVIDENCE;
const id = (n) => n.toString(16).padStart(24, '0');
const pdm = { id: id(10), storageUrl: '/uploads/pdm-render.png', mimeType: 'image/png', source: 'pdm' };
const field = { id: id(11), storageUrl: '/uploads/workshop.png', mimeType: 'image/png' };
const sheet = { id: id(12), storageUrl: '/uploads/pdm/secret.png', mimeType: 'image/png' };
const broken = { id: id(13), storageUrl: '/uploads/missing.png', mimeType: 'image/png' };
const part = { id: id(1), name: 'Кронштейн испытательного стенда', article: 'УЧ.Д.01', unit: 'шт.', mainPhotoId: field, photoIds: [pdm, field] };
const noPhotoPart = { id: id(2), name: 'Планка без фотографии', article: 'УЧ.Д.02', unit: 'шт.', photoIds: [sheet] };
const module = { id: id(3), name: 'Сборка испытательного стенда', article: 'УЧ.М.01', mainPhotoId: pdm, photoIds: [pdm] };
const noPhotoModule = { id: id(4), name: 'Рама без фотографии', article: 'УЧ.М.02', mainPhotoId: broken, photoIds: [broken] };
const product = { id: id(5), name: 'Учебный испытательный стенд', sku: 'УЧ.И.01', photos: [] };
const workshop = { id: 'fixture', username: 'учебная', displayName: 'Учебная учётная запись', role: 'manager', sections: ['products', 'stock'] };
const uses = (kind, entry, quantity) => ({ id: entry.id, kind, name: entry.name, quantity, unit: 'шт.' });
const links = {
  ['/api/materials/' + part.id + '/where-used']: [uses('module', module, 4), uses('product', product, 2)],
  ['/api/modules/' + module.id + '/where-used']: [uses('product', product, 1)],
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

function sampleImage(kind) {
  const image = new PNG({ width: 480, height: 300 });
  const wall = kind === 'pdm' ? [221, 230, 236] : [225, 219, 210];
  const metal = kind === 'pdm' ? [83, 108, 129] : [112, 103, 86];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const beam = x > 70 && x < 405 && ((y > 86 && y < 120) || (y > 199 && y < 230));
    const post = y > 82 && y < 230 && ((x > 95 && x < 124) || (x > 348 && x < 377));
    const bolt = [108, 363].some(bx => [103, 214].some(by => Math.hypot(x - bx, y - by) < 8));
    const background = beam || post ? metal : wall;
    const pos = (y * image.width + x) * 4;
    for (let c = 0; c < 3; c++) image.data[pos + c] = bolt ? 178 : background[c] - Math.round(y / 18);
    image.data[pos + 3] = 255;
  }
  return PNG.sync.write(image);
}

function fixtureApi(path, user) {
  if (Object.hasOwn(links, path)) return { items: links[path], total: links[path].length, page: 1, limit: 20 };
  switch (path) {
    case '/api/auth/me': return user;
    case '/api/materials': return { items: [part, noPhotoPart], total: 2, page: 1, limit: 50 };
    case '/api/modules': return [module, noPhotoModule];
    case '/api/materials/' + part.id: return part;
    case '/api/materials/' + noPhotoPart.id: return noPhotoPart;
    case '/api/modules/' + module.id: return { ...module, mainPhotoId: pdm.id, photoIds: [pdm.id] };
    case '/api/modules/' + noPhotoModule.id: return noPhotoModule;
    case '/api/showcase/' + product.id: return product;
    case '/api/photos/' + pdm.id: return pdm;
    default: return { items: [], total: 0, page: 1, limit: 20 };
  }
}

async function mount(browser, user, width = 1920) {
  const context = await browser.newContext({ viewport: { width, height: 1080 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  const denied = [];
  const errors = [];
  const pictures = { '/uploads/pdm-render.png': sampleImage('pdm'), '/uploads/workshop.png': sampleImage('photo') };
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(user => {
    localStorage.setItem('dc-theme', 'soft');
    sessionStorage.setItem('dca_access', 'synthetic');
    sessionStorage.setItem('dca_refresh', 'synthetic');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, user);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      denied.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 403, json: {} });
    }
    requests.push(url.pathname);
    if (Object.hasOwn(pictures, url.pathname)) return route.fulfill({ body: pictures[url.pathname], contentType: 'image/png' });
    if (url.pathname.startsWith('/uploads/')) return route.fulfill({ status: 404 });
    if (url.pathname.startsWith('/app/')) {
      const relative = url.pathname.slice(5) || 'index.html';
      try {
        return await route.fulfill({ contentType: mime[extname(relative)] || 'application/octet-stream', body: await readFile(new URL(relative, app)) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return route.fulfill({ status: 404 });
      }
    }
    return route.fulfill({ json: fixtureApi(url.pathname, user) });
  });
  return { context, page, requests, denied, errors };
}

test('Детали и модули показывают обложку, пустое состояние и прямые связи каталога', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const snap = async (page, file) => {
    if (evidence) await page.screenshot({ path: join(evidence, file), animations: 'disabled' });
  };
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    const { context, page, requests, denied, errors } = await mount(browser, workshop);
    try {
      await page.goto(origin + '/app/#parts?view=table');
      const partList = page.locator('.list-panel table.list');
      const visualPart = partList.getByRole('row').filter({ hasText: part.name });
      const blankPart = partList.getByRole('row').filter({ hasText: noPhotoPart.name });
      await visualPart.locator('img[src="/uploads/workshop.png"]').waitFor();
      await blankPart.getByText('нет фото', { exact: true }).waitFor();
      const thumb = visualPart.getByRole('button', { name: 'Открыть фото крупно' });
      await thumb.click();
      await page.getByRole('button', { name: 'Закрыть фото' }).waitFor();
      await page.keyboard.press('Escape');
      assert.ok(await thumb.evaluate(el => el === document.activeElement));
      await snap(page, '1920-parts-list.png');
      await visualPart.getByText(part.name, { exact: true }).click();

      const card = page.locator('.drawer');
      const photo = card.locator('.pgal-img');
      await photo.waitFor();
      assert.equal(await photo.getAttribute('src'), '/uploads/workshop.png');
      await card.getByRole('button', { name: 'Следующее фото' }).click();
      assert.equal(await photo.getAttribute('src'), '/uploads/pdm-render.png');
      const related = card.getByRole('table', { name: 'Где используется' });
      const moduleLink = related.getByRole('link', { name: module.name });
      const productLink = related.getByRole('link', { name: product.name });
      assert.equal(await moduleLink.getAttribute('href'), '#modules?open=' + module.id);
      assert.equal(await productLink.getAttribute('href'), '#products?open=' + product.id);
      assert.ok(await moduleLink.locator('.k-clamp').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await related.getByRole('row').filter({ hasText: module.name }).getByText('4 шт.').waitFor();
      await related.getByRole('row').filter({ hasText: product.name }).getByText('2 шт.').waitFor();
      await snap(page, '1920-part-card.png');

      await moduleLink.click();
      await card.getByRole('heading', { name: new RegExp(module.name) }).waitFor();
      await card.locator('.pgal-img[src="/uploads/pdm-render.png"]').waitFor();
      await related.getByText('1 шт.', { exact: true }).waitFor();
      assert.equal(requests.filter(path => path === '/api/photos/' + pdm.id).length, 1);
      await snap(page, '1920-module-card.png');
      await related.getByRole('link', { name: product.name }).click();
      await card.getByRole('heading', { name: new RegExp(product.name) }).waitFor();

      await page.setViewportSize({ width: 3440, height: 1080 });
      await page.goto(origin + '/app/#parts?open=' + noPhotoPart.id);
      await card.getByRole('heading', { name: new RegExp(noPhotoPart.name) }).waitFor();
      await card.getByText('Нет фото', { exact: true }).waitFor();
      await snap(page, '3440-part-empty.png');

      await page.setViewportSize({ width: 2560, height: 1080 });
      await page.goto(origin + '/app/#modules?view=table');
      const moduleList = page.locator('.list-panel table.list');
      const blankModule = moduleList.getByRole('row').filter({ hasText: noPhotoModule.name });
      await moduleList.locator('img[src="/uploads/pdm-render.png"]').waitFor();
      await blankModule.getByText('нет фото', { exact: true }).waitFor();
      await snap(page, '2560-modules-list.png');
      await blankModule.getByText(noPhotoModule.name, { exact: true }).click();
      await card.getByText('Фото недоступно', { exact: true }).waitFor();
      await card.getByText('В доступном составе вхождений нет', { exact: true }).waitFor();
      await snap(page, '2560-module-empty.png');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(!requests.includes('/uploads/pdm/secret.png'));
      assert.deepEqual(denied, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }

    const limited = await mount(browser, { ...workshop, sections: ['stock'] });
    try {
      await limited.page.goto(origin + '/app/#modules?open=' + module.id);
      await limited.page.waitForURL(url => !url.hash.startsWith('#modules'));
      assert.equal(await limited.page.locator('.sidebar a[href="#modules"]').count(), 0);
      assert.ok(!limited.requests.some(path => path.startsWith('/api/modules/' + module.id) || path.startsWith('/api/photos/')));
    } finally {
      await limited.context.close();
    }
  } finally {
    await browser.close();
  }
});

