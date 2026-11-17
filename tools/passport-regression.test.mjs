/** Проверка скана PDF-текстов регрессии паспортов. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Читаем правила из исходника оркестратора через временную копию логики (без запуска main).
const src = fs.readFileSync(path.join(ROOT, 'tools/passport-regression.mjs'), 'utf8');
assert.match(src, /old-gender/);
assert.match(src, /buildDescription/);

describe('passport-regression', () => {
  it('оркестратор и кнопка пульта существуют', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/passport-regression.mjs')));
    const cat = fs.readFileSync(path.join(ROOT, 'pult/catalog.mjs'), 'utf8');
    assert.match(cat, /passport-regression/);
    assert.match(cat, /pass-funnel,pass-order,pass-queue,order-passport/);
    assert.match(cat, /passport-regression\.mjs', '--live'/);
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/passport-live-check.mjs')));
  });

  it('PWA buildDescription уже без старого рода названия', () => {
    const body = fs.readFileSync(path.join(ROOT, 'backend/pwa/sections/passports/common.js'), 'utf8');
    const m = body.match(/export function buildDescription\(v\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, 'buildDescription найден');
    assert.ok(!/в дальнейшем именуемое/.test(m[1]));
    assert.match(m[1], /далее — изделие/);
    assert.match(m[1], /Изделие изготовлено из/);
  });
});

void require;
