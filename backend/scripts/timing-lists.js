/* Замер скорости основных списков на сервере (только чтение) — скорость С8. Внутри контейнера backend:
 *   docker cp backend/scripts/timing-lists.js datacore-backend:/app/scripts/ && docker exec datacore-backend node scripts/timing-lists.js
 * Каждый вызов — 3 раза подряд, печатается время каждого (мс) и размер ответа (КБ, JSON).
 */
const path = require('path');
const root = path.join(__dirname, '..');
const { NestFactory } = require(require.resolve('@nestjs/core', { paths: [root] }));
const d = (p) => require(path.join(root, 'dist/src/modules', p));

(async () => {
  const { AppModule } = require(path.join(root, 'dist/src/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  await new Promise((r) => setTimeout(r, 4000)); // кэш списков (С9) включается через 3 с после старта
  const get = (p, name) => app.get(d(p)[name]);
  const stock = get('stock/stock.service', 'StockService');
  const supply = get('supply/supply.service', 'SupplyService');
  const incomes = get('incomes/incomes.service', 'IncomesService');
  const pass = get('product-passport/product-passport.service', 'ProductPassportService');
  const so = get('salesorders/salesorders.service', 'SalesOrdersService');
  const fill = get('fill-audit/fill-audit.service', 'FillAuditService');
  const cases = [
    ['склад limit=1', () => stock.listItems({ limit: '1' })],
    ['склад limit=10000', () => stock.listItems({ limit: '10000' })],
    ['заявки limit=1', () => supply.list({ limit: '1' })],
    ['заявки limit=2000', () => supply.list({ limit: '2000', sort: '-requestDate' })],
    ['позиции заказов limit=3000', () => incomes.list({ limit: '3000', sort: 'lineNo' })],
    ['заказы limit=1', () => so.list({ limit: '1' })],
    ['паспорта стр. 1', () => pass.list({ page: '1', limit: '25' })],
    ['паспорта галерея 50', () => pass.list({ page: '1', limit: '50', sort: 'category' })],
    ['паспорта модели', () => pass.models()],
    ['требуют заполнения', () => fill.report({ role: 'admin' }, { limit: 1 })],
  ];
  for (const [label, fn] of cases) {
    const t = []; let size = 0;
    for (let i = 0; i < 3; i++) {
      const s = Date.now();
      try { const r = await fn(); size = JSON.stringify(r).length; } catch (e) { t.push('ошибка: ' + e.message.slice(0, 60)); break; }
      t.push(Date.now() - s);
    }
    console.log(t.join(' / ').padEnd(18), String(Math.round(size / 1024) + ' КБ').padStart(8), ' ', label);
  }
  await app.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
