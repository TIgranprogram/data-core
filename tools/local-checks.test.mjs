import test from 'node:test';
import assert from 'node:assert/strict';
import { commandStatus, totalStatus, parseArgs, plan, runCommand } from './local-checks.mjs';

test('пропуск и сбой никогда не становятся общим PASS', () => {
  assert.equal(totalStatus([{ status: 'PASS' }, { status: 'SKIP' }]), 'PARTIAL');
  assert.equal(totalStatus([{ status: 'SKIP' }, { status: 'FAIL' }]), 'FAIL');
  assert.equal(commandStatus({ code: 0, output: '# skipped 2' }), 'SKIP');
  assert.equal(commandStatus({ code: 0, output: 'ℹ skipped 1' }), 'SKIP');
  assert.equal(commandStatus({ code: 0, output: 'Анализировано: 1; кэш: 0; сбой: 0; пропущено: 2.' }), 'SKIP');
  assert.equal(commandStatus({ code: 0, output: '', timedOut: true }), 'FAIL');
  assert.equal(commandStatus({ code: null, output: '' }), 'FAIL');
});
test('план не дублирует этапы и не запускает базу/облако', () => {
  const steps = plan({}, () => true);
  assert.equal(new Set(steps.map(s => s.id)).size, steps.length);
  assert.equal(steps.find(s => s.id === 'unit').args.filter(a => a.includes('jest.js')).length, 1);
  assert.equal(steps.find(s => s.id === 'e2e').status, 'SKIP');
  assert.equal(steps.find(s => s.id === 'live-ui').status, 'SKIP');
  assert.equal(steps.find(s => s.id === 'pixels').skip, true);
  assert.equal(steps.find(s => s.id === 'vision').skip, true);
  assert.ok(!JSON.stringify(steps).includes('dc.mjs'));
  assert.equal(plan({ 'ready-only': true }).some(s => s.id === 'unit'), false);
});
test('нет зависимостей — тесты пропускаются явно', () => {
  const steps = plan({}, () => false);
  assert.equal(steps.find(s => s.id === 'dependencies').status, 'FAIL');
  assert.equal(steps.find(s => s.id === 'unit').skip, true);
  assert.equal(steps.find(s => s.id === 'browser-fixture').skip, true);
});
test('аргументы требуют пару снимков и отдельный режим готовности', () => {
  assert.throws(() => parseArgs(['--baseline', 'a.png']));
  assert.throws(() => parseArgs(['--ready-only', '--vision-input', 'a.png']));
  assert.throws(() => parseArgs(['--unknown']));
  assert.ok(parseArgs(['--baseline', 'a.png', '--current', 'b.png']).baseline.endsWith('a.png'));
});
test('таймаут действительно завершает процесс; следующий этап возможен', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(commandStatus(result), 'FAIL');
  assert.equal(commandStatus(await runCommand(process.execPath, ['-e', 'console.log("ok")'])), 'PASS');
});
