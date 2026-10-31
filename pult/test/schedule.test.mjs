// Автозапуск: сроки правил и запуск по таймеру на учебном каталоге (прод не трогается).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cleanRule, isDue, lastSlot, mergeRules, nextSlot } from '../schedule.mjs';
import { createPult } from '../server.mjs';
import * as catalog from '../catalog.mjs';

const d = (s) => new Date(s); // местное время

test('ежедневно: срок сегодня после времени, вчера — до', () => {
  const r = { kind: 'daily', time: '09:00', enabled: true };
  assert.equal(lastSlot(r, d('2026-10-31T10:00')).getTime(), d('2026-10-31T09:00').getTime());
  assert.equal(lastSlot(r, d('2026-10-31T08:00')).getTime(), d('2026-10-30T09:00').getTime());
  assert.equal(nextSlot(r, d('2026-10-31T10:00')).getTime(), d('2026-11-01T09:00').getTime());
});

test('раз в неделю: понедельник (31.10.2026 — суббота)', () => {
  const r = { kind: 'weekly', day: 1, time: '09:30', enabled: true };
  assert.equal(lastSlot(r, d('2026-10-31T12:00')).getTime(), d('2026-10-26T09:30').getTime());
  assert.equal(nextSlot(r, d('2026-10-31T12:00')).getTime(), d('2026-11-02T09:30').getTime());
});

test('раз в месяц: 1-го', () => {
  const r = { kind: 'monthly', day: 1, time: '12:00', enabled: true };
  assert.equal(lastSlot(r, d('2026-10-31T12:00')).getTime(), d('2026-10-01T12:00').getTime());
  assert.equal(nextSlot(r, d('2026-10-31T12:00')).getTime(), d('2026-11-01T12:00').getTime());
});

test('пропущенный срок догоняется один раз; выключенное не идёт', () => {
  const r = { kind: 'daily', time: '09:00', enabled: true };
  const now = d('2026-10-31T15:00');
  assert.equal(isDue(r, undefined, now), true);
  assert.equal(isDue(r, d('2026-10-30T20:00').getTime(), now), true);
  assert.equal(isDue(r, d('2026-10-31T09:01').getTime(), now), false);
  assert.equal(isDue({ ...r, enabled: false }, undefined, now), false);
});

test('правка проверяется; битая правка — умолчание', () => {
  const base = { id: 'x', kind: 'daily', time: '09:00', enabled: true };
  assert.throws(() => cleanRule(base, { time: '25:00' }));
  assert.throws(() => cleanRule(base, { kind: 'weekly', day: 9 }));
  assert.deepEqual(cleanRule(base, { kind: 'weekly', day: 3, enabled: false }), { id: 'x', kind: 'weekly', time: '09:00', day: 3, enabled: false });
  assert.deepEqual(mergeRules([base], { x: { time: 'nope' } }), [base]);
});

test('каталог: в автозапуске только чтение и этот ПК, без подтверждений', () => {
  for (const r of catalog.SCHEDULE) {
    const c = catalog.COMMANDS.find((x) => x.id === r.id);
    assert.ok(c, r.id);
    assert.ok(['read', 'local'].includes(c.risk) && !c.confirm, `${r.id}: запись на сайт не ставится на автозапуск`);
    assert.doesNotThrow(() => cleanRule(r, {}), r.id);
  }
});

test('таймер: запускает просроченную команду, запись на сайт пропускает, второй раз не повторяет', async () => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pult-auto-'));
  const fake = {
    SECTIONS: [{ id: 's', title: 's', icon: '•', hint: 'x' }], RISKS: {}, ADVICE: [], NOT_ON_BUTTONS: {},
    COMMANDS: [
      { id: 'w', section: 's', title: 'Запись', hint: 'h', time: '1', risk: 'prod-write', confirm: 'да?', run: { node: ['-e', '0'] } },
      { id: 'r', section: 's', title: 'Чтение', hint: 'h', time: '1', risk: 'read', run: { node: ['-e', "console.log('авто')"] } },
    ],
    SCHEDULE: [{ id: 'w', kind: 'daily', time: '00:00', enabled: true }, { id: 'r', kind: 'daily', time: '00:00', enabled: true }],
  };
  const machine = { bash: null, gitRoot: null, docker: null, route: null, home: os.homedir() };
  const pult = createPult({ catalog: fake, machine, logDir, statusFn: async () => ({}) });
  const job = pult.tickAuto();
  assert.equal(job?.cmdId, 'r');
  assert.ok(job.auto);
  await new Promise((ok) => { const t = setInterval(() => { if (pult.jobs.get(job.id).state !== 'running') { clearInterval(t); ok(); } }, 20); });
  assert.equal(pult.tickAuto(), null);
  await pult.close();
});
