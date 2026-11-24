import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  LEGACY, checkRel, isStrictDebt, gate, collect, selfTest,
} = require('./audit-domain-boundaries.js');
const here = path.dirname(fileURLToPath(import.meta.url));

test('self-test правила', () => {
  assert.equal(selfTest(), 0);
});

test('закрытый файл снаружи запрещён, открытый и index — нет', () => {
  const bad = checkRel('src/modules/finance/finance.service.ts', 'src/modules/incomes/dto.ts');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, 'private');
  assert.equal(checkRel('src/modules/dicts/dicts.defs.ts', 'src/modules/product/product-writes.ts').length, 0);
  assert.equal(checkRel('src/app.module.ts', 'src/modules/product/index.ts').length, 0);
  assert.equal(checkRel('src/modules/incomes/incomes.service.ts', 'src/modules/incomes/dto.ts').length, 0);
  assert.equal(LEGACY.incomes.has('dto.ts'), false);
  assert.equal(LEGACY.salesorders.has('order-pdf.ts'), false);
});

test('платформа не импортирует бизнес, соседа платформы можно', () => {
  const plat = checkRel('src/modules/auth/auth.service.ts', 'src/modules/stock/stock.service.ts');
  assert.equal(plat[0].kind, 'platform');
  assert.equal(checkRel('src/modules/role/role.service.ts', 'src/modules/user/user.service.ts').length, 0);
  assert.equal(checkRel('src/modules/feature-flag/feature-flag.service.ts', 'src/common/decorators/roles.decorator.ts').length, 0);
});

test('common в три домена только портом или index', () => {
  assert.equal(checkRel('src/common/income-owner-port.ts', 'src/modules/incomes/income-writes.ts').length, 0);
  const deep = checkRel('src/common/foo.ts', 'src/modules/incomes/income.schema.ts');
  assert.equal(deep[0].kind, 'common');
  assert.equal(checkRel('src/common/catalog/catalog-delete-guards.spec.ts', 'src/modules/product/product.service.ts').length, 0);
});

test('порт цикла на writes не долг полного правила', () => {
  assert.equal(isStrictDebt('src/common/product-owner-port.ts', 'src/modules/product/product-writes.ts'), false);
  assert.equal(isStrictDebt('src/modules/pdm-import/pdm-import.service.ts', 'src/modules/product/product-writes.ts'), true);
  assert.equal(isStrictDebt('src/common/stock-owner-port.ts', 'src/modules/stock/stock-writes.ts'), false);
});

test('текущий src проходит включённое правило', () => {
  const found = gate(collect(path.join(here, '..', 'src')));
  assert.deepEqual(found, []);
});
