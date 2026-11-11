// План способа установки: node --test backend/scripts/passport-install-method.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan, matchInstall } = createRequire(import.meta.url)('./passport-install-method.js');

const installs = [{ _id: 'i1', code: 'CONCRETE_POSTS', name: 'Бетонирование опор' }, { _id: 'i2', code: 'EMBEDDED', name: 'На закладные детали' }, { _id: 'i3', code: 'FENCE_POSTS', name: 'Ограждение на опорных стойках' }];
const prod = (id, extra = {}) => ({ _id: id, name: 'Изд ' + id, ...extra });
const pass = (productId, installationMethod, issuedAt) => ({ productId, installationMethod, issuedAt });

test('ключевые слова: закладные важнее бетонирования', () => {
  assert.equal(matchInstall('методом бетонирования закладных деталей', installs)._id, 'i2');
  assert.equal(matchInstall('методом бетонирования опорных стоек в грунт', installs)._id, 'i1');
  assert.equal(matchInstall('по периметру площадок с фиксацией к опорным стойкам', installs)._id, 'i3');
  assert.equal(matchInstall('в местах общественного пользования', installs), null);
});

test('берётся текст последнего паспорта; нет паспорта — текст изделия; нераспознанное — в списке', () => {
  const prods = [prod('a'), prod('b', { installation: 'Бетонирование опор' }), prod('c'), prod('d', { installation: 'во дворе' })];
  const pass3 = [pass('a', 'на закладных деталях', '2026-01-01'), pass('a', 'бетонирование стоек', '2026-05-01')];
  const p = buildPlan(prods, pass3, installs);
  assert.deepEqual(p.items.map((i) => [i.id, i.typeId]), [['a', 'i1'], ['b', 'i1']]);
  assert.equal(p.noText, 1);
  assert.equal(p.unmatched.length, 1);
});

test('повторный запуск: заданный способ не трогается', () => {
  const p = buildPlan([prod('a', { passportDefaults: { installationTypeId: 'i1' } })], [pass('a', 'бетонирование', '2026-01-01')], installs);
  assert.equal(p.items.length, 0);
  assert.equal(p.already, 1);
});
