import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { testerState } from '../tester.mjs';
import { createPult } from '../server.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pult-tester-'));
const logs = path.join(root, 'tools/logs/ai-tester');
fs.mkdirSync(logs, { recursive: true });
fs.mkdirSync(path.join(root, 'backend/scripts'), { recursive: true });
const marker = path.join(logs, 'run.json');

test('статусы: нет отчёта, подготовка, запуск, работа, остановка, обрыв и завершение', () => {
  const now = Date.now();
  assert.equal(testerState(root).state, 'empty');
  assert.equal(testerState(root, {}, [{cmdId:'ait-run',state:'running'}]).state, 'preparing');
  assert.equal(testerState(root, {'ait-run':{code:2,at:now}}).state, 'failed');
  assert.equal(testerState(root, {'ait-run':{code:0,at:now}}).state, 'starting');
  assert.equal(testerState(root, {'ait-run':{code:0,at:now-180000}}).state, 'missing');
  fs.writeFileSync(marker, JSON.stringify({beat:now}));
  assert.equal(testerState(root).state, 'running');
  fs.writeFileSync(path.join(logs, 'STOP'), 'stop');
  assert.equal(testerState(root).state, 'stopping');
  fs.unlinkSync(path.join(logs, 'STOP'));
  assert.equal(testerState(root, {}, [], now+300000).state, 'interrupted');
  fs.unlinkSync(marker);
  fs.mkdirSync(path.join(logs,'2026-11-12'));
  fs.writeFileSync(path.join(logs,'2026-11-12/REPORT.md'), '# Учебный отчёт');
  assert.equal(testerState(root).state, 'finished');
  assert.equal(testerState(root).report.path, 'tools/logs/ai-tester/2026-11-12/REPORT.md');
});

test('HTTP: подмена процесса; двойной запуск, ошибка подготовки, повтор, heartbeat и stop', async () => {
  const command = (id, js) => ({ id, section:'test', title:id, risk:'local', run:{node:['-e',js]} });
  const cat = { COMMANDS:[command('ait-run', 'setTimeout(()=>process.exit(2),100)'), command('ait-stop', "console.log('запрос отправлен')")], SECTIONS:[],RISKS:{},NOT_ON_BUTTONS:{}, ADVICE:[] };
  const p = createPult({root, catalog:cat, machine:{}, statusFn:async()=>({gateFiles:[]})});
  const port = await p.listen(0);
  const api = async (id) => fetch(`http://127.0.0.1:${port}/api/run`, {method:'POST',headers:{'X-Pult-Token':p.token,'Content-Type':'application/json'},body:JSON.stringify({id})});
  const wait = async () => { for(let i=0;i<100 && [...p.jobs.values()].some(j=>j.state==='running');i++) await new Promise(r=>setTimeout(r,20)); };
  try {
    assert.equal((await api('ait-run')).status,200);
    assert.equal((await api('ait-run')).status,409);
    await wait();
    assert.equal([...p.jobs.values()][0].state,'fail');
    assert.equal((await api('ait-run')).status,200);
    await wait();
    fs.writeFileSync(marker, JSON.stringify({beat:Date.now()}));
    assert.equal((await api('ait-run')).status,409);
    assert.equal((await api('ait-stop')).status,200);
    await wait();
    assert.equal(testerState(root).state,'running', 'код 0 stop не означает конец обхода');
    fs.unlinkSync(marker);
    cat.COMMANDS[0] = command('ait-run', "console.log('запущен')");
    assert.equal((await api('ait-run')).status,200);
    await wait();
    assert.equal((await api('ait-run')).status,409, 'окно ожидания heartbeat закрывает повтор');
  } finally { await p.close(); }
});
