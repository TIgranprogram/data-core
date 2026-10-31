#!/usr/bin/env node
// Макет HA (ТЗ HA-TWO-SERVERS, HA-1). Без зависимостей проекта на хосте: только node + docker CLI.
// Клиент нагрузки запускается ВНУТРИ контейнера halab-cli (образ бэкенда: mongoose 8 -> драйвер mongodb 6, как в проде).
//
//   node lab.mjs setup                  поднять 3 узла, rs labrs, пользователь, tc netem (30 мс, 1 %)
//   node lab.mjs run A B D ...          сценарии (A B D E F G1 G2 Bmrc0 Bfc0), all — все
//   node lab.mjs teardown               docker compose -p halab down -v
//   node lab.mjs client '<json>'        (внутренний) нагрузка и замеры
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  (fs.existsSync(path.join(HERE, '.env.lab')) ? fs.readFileSync(path.join(HERE, '.env.lab'), 'utf8') : '')
    .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const USER = env.LAB_USER || process.env.LAB_USER || 'labroot';
const PASS = env.LAB_PASS || process.env.LAB_PASS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IP = { dc1: '172.29.77.11', dc2: '172.29.77.12', dcarb: '172.29.77.13' };
const NODES = ['dc1', 'dc2', 'dcarb'];

// ======================================================================= КЛИЕНТ (в контейнере)
async function clientMain(cfg) {
  const require = createRequire('/app/package.json');
  const { mongo } = require('mongoose');
  const { MongoClient } = mongo;
  const crypto = require('node:crypto');
  const pass = encodeURIComponent(cfg.pass);
  const base = `mongodb://${cfg.user}:${pass}@`;
  // как backend: replicaSet из конфигурации, остальное по умолчанию драйвера (retryWrites=true, w не задан, readConcern не задан)
  const uri = `${base}dc1:27017,dc2:27017/?replicaSet=labrs&authSource=admin`;
  const uriNoRetry = `${uri}&retryWrites=false`;
  const t0 = Date.now();
  const rel = () => Date.now() - t0;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const main = new MongoClient(uri, { maxPoolSize: 20 });
  const noretry = new MongoClient(uriNoRetry, { maxPoolSize: 5 });
  await main.connect(); await noretry.connect();
  const db = main.db(cfg.db);
  const dbNr = noretry.db(cfg.db);
  let stopping = false;
  const B = new Map(); // секунда -> счётчики
  const bk = (s) => { let b = B.get(s); if (!b) { b = { wi: 0, we: 0, wmax: 0, ui: 0, ue: 0, rd: 0, re: 0, rsum: 0, rmax: 0, ce: 0, tx: 0, txe: 0 }; B.set(s, b); } return b; };
  const marks = [];
  const okTimes = [];
  const ackedMain = {}; const ackedNr = [];
  const errSamples = {};
  const noteErr = (k, e) => { const key = `${k}: ${(e && (e.codeName || e.code || e.name)) || ''} ${String(e && e.message).slice(0, 110)}`; errSamples[key] = (errSamples[key] || 0) + 1; };
  const rnd = (n) => Math.floor(Math.random() * n);
  const payload = () => crypto.randomBytes(300).toString('hex');

  // --- запись (режим load)
  const col = db.collection('w'); const hot = db.collection('hot');
  async function writer(w) {
    ackedMain[w] = []; let n = 0;
    while (!stopping) {
      n++; const s = rel();
      try { await col.insertOne({ _id: `${w}-${n}`, w, n, p: payload() }); const e = rel(); ackedMain[w].push(n); okTimes.push(e); const b = bk(Math.floor(e / 1000)); b.wi++; b.wmax = Math.max(b.wmax, e - s); }
      catch (e) { bk(Math.floor(rel() / 1000)).we++; noteErr('insert', e); await sleep(200); }
      try { await hot.updateOne({ _id: rnd(1000) }, { $set: { p: payload() }, $inc: { v: 1 } }, { upsert: true }); bk(Math.floor(rel() / 1000)).ui++; }
      catch (e) { bk(Math.floor(rel() / 1000)).ue++; noteErr('update', e); await sleep(200); }
      await sleep(10);
    }
  }
  const colNr = dbNr.collection('w_noretry');
  async function writerNr() {
    let n = 0;
    while (!stopping) {
      n++;
      try { await colNr.insertOne({ _id: n, n, p: payload() }); ackedNr.push(n); }
      catch (e) { cfg.nrErr = (cfg.nrErr || 0) + 1; noteErr('noretry-insert', e); await sleep(200); }
      await sleep(20);
    }
  }
  async function reader() {
    while (!stopping) {
      const s = rel();
      try { await col.findOne({ _id: `${rnd(2)}-${1 + rnd(2000)}` }); const e = rel(); const b = bk(Math.floor(e / 1000)); b.rd++; b.rsum += e - s; b.rmax = Math.max(b.rmax, e - s); }
      catch (e) { bk(Math.floor(rel() / 1000)).re++; noteErr('read', e); await sleep(200); }
      await sleep(50);
    }
  }

  // --- транзакции (режим tx)
  const txCnt = db.collection('tx_cnt'); const txDocs = { with: db.collection('tx_with'), manual: db.collection('tx_manual') };
  const txRes = { with: { ok: 0, err: 0, ids: [], okIds: [], labels: {} }, manual: { ok: 0, err: 0, ids: [], okIds: [], labels: {} } };
  async function txWorker(mode, w) {
    let n = 0;
    while (!stopping) {
      n++; const id = `${mode}-${w}-${n}`; const R = txRes[mode]; R.ids.push(id);
      const session = main.startSession();
      const body = async () => { await txDocs[mode].insertOne({ _id: id }, { session }); await txCnt.updateOne({ _id: mode }, { $inc: { v: 1 } }, { upsert: true, session }); };
      try {
        if (mode === 'with') await session.withTransaction(body, { maxCommitTimeMS: 20000 });
        else { session.startTransaction(); try { await body(); await session.commitTransaction(); } catch (e) { await session.abortTransaction().catch(() => undefined); throw e; } }
        R.ok++; R.okIds.push(id); bk(Math.floor(rel() / 1000)).tx++;
      } catch (e) {
        R.err++; bk(Math.floor(rel() / 1000)).txe++;
        const lb = (e.errorLabels || []).join(',') || 'нет метки'; R.labels[lb] = (R.labels[lb] || 0) + 1; noteErr(`tx-${mode}`, e);
        await sleep(200);
      } finally { await session.endSession().catch(() => undefined); }
      await sleep(20);
    }
  }

  // --- поток изменений (как data-version.service.ts:41)
  let cs; const csErrors = []; let csOpen = 0;
  function openStream() {
    if (stopping) return;
    try {
      cs = db.watch([{ $project: { ns: 1 } }]); csOpen++;
      cs.on('change', () => { bk(Math.floor(rel() / 1000)).ce++; });
      cs.on('error', (e) => { csErrors.push({ t: rel(), m: String(e.message).slice(0, 120) }); setTimeout(openStream, cfg.csRetryMs || 5000); });
      cs.on('close', () => { /* закрытие без ошибки фиксируем в csErrors */ });
    } catch (e) { csErrors.push({ t: rel(), m: String(e.message).slice(0, 120) }); setTimeout(openStream, 5000); }
  }

  // --- опрос состояния узлов (как «rs.status» и память)
  const direct = {};
  for (const nm of ['dc1', 'dc2', 'dcarb']) direct[nm] = new MongoClient(`${base}${nm}:27017/?directConnection=true&authSource=admin`, { serverSelectionTimeoutMS: 900, socketTimeoutMS: 2500, connectTimeoutMS: 900 });
  const sec = (ts) => (ts ? ts.getHighBits() : null);
  async function poll(nm) {
    while (!stopping) {
      const t = rel();
      try {
        const admin = direct[nm].db('admin');
        const st = await admin.command({ replSetGetStatus: 1 });
        const rec = { k: 's', t, node: nm, st: st.myState, members: st.members.map((m) => [m.name.split(':')[0], m.health, m.stateStr[0], m.optimeDate ? Math.floor(m.optimeDate.getTime() / 1000) : null]), commit: sec(st.optimes?.lastCommittedOpTime?.ts), applied: sec(st.optimes?.appliedOpTime?.ts) };
        if (nm !== 'dcarb') {
          const ss = await admin.command({ serverStatus: 1 });
          const c = ss.wiredTiger?.cache || {};
          rec.cache = Math.round((c['bytes currently in the cache'] || 0) / 1048576);
          rec.dirty = Math.round((c['tracked dirty bytes in the cache'] || 0) / 1048576);
          rec.res = ss.mem?.resident; rec.fc = ss.flowControl ? { on: ss.flowControl.enabled, lag: ss.flowControl.isLagged, rate: ss.flowControl.targetRateLimit } : null;
        }
        out(rec);
      } catch (e) { out({ k: 's', t, node: nm, down: String(e.message).slice(0, 60) }); }
      await sleep(1500);
    }
  }

  // --- подготовка
  await db.collection('w').createIndex({ w: 1 }).catch(() => undefined);
  if (cfg.mode === 'tx') { await db.createCollection('tx_with').catch(() => undefined); await db.createCollection('tx_manual').catch(() => undefined); await db.createCollection('tx_cnt').catch(() => undefined); }
  const loops = [];
  if (cfg.csOff !== true) openStream();
  if (cfg.mode === 'tx') { for (let w = 0; w < 3; w++) { loops.push(txWorker('with', w)); loops.push(txWorker('manual', w)); } }
  else { loops.push(writer(0), writer(1), writerNr(), reader(), reader()); }
  const pollers = ['dc1', 'dc2', 'dcarb'].map((n) => poll(n));
  const ticker = setInterval(() => { const s = Math.floor(rel() / 1000) - 1; if (s >= 0) out({ k: 'b', s, ...bk(s) }); }, 1000);
  out({ k: 'ready', t: 0 });

  // --- команды от оркестратора
  const rl = createInterface({ input: process.stdin });
  await new Promise((resolve) => {
    rl.on('line', (line) => {
      const [cmd, ...rest] = line.trim().split(' ');
      if (cmd === 'mark') { marks.push({ name: rest.join(' '), t: rel() }); out({ k: 'mark', name: rest.join(' '), t: rel() }); }
      if (cmd === 'stop') resolve();
    });
  });
  stopping = true; await Promise.allSettled(loops); await Promise.allSettled(pollers); clearInterval(ticker);
  try { await cs?.close(); } catch { /* */ }
  // --- сверка (читаем с главного)
  const res = { k: 'final', marks, csErrors, csOpen, errSamples, okTimes: undefined };
  const pref = { readPreference: 'primary' };
  async function present(c, filter, proj) { const arr = []; const cur = c.find(filter, { projection: proj, ...pref, maxTimeMS: 60000 }); for await (const d of cur) arr.push(d); return arr; }
  try {
    if (cfg.mode === 'tx') {
      res.tx = {};
      for (const mode of ['with', 'manual']) {
        const docs = new Set((await present(txDocs[mode], {}, { _id: 1 })).map((d) => d._id));
        const cnt = (await txCnt.findOne({ _id: mode }, pref))?.v ?? 0;
        const R = txRes[mode];
        const okMissing = R.okIds.filter((i) => !docs.has(i)).length;
        const errPresent = R.ids.filter((i) => !R.okIds.includes(i) && docs.has(i)).length;
        res.tx[mode] = { attempts: R.ids.length, ok: R.ok, err: R.err, labels: R.labels, docs: docs.size, counter: cnt, okButMissing: okMissing, errButPresent: errPresent, docsVsCounterDiff: docs.size - cnt };
      }
    } else {
      const docs = await present(col, {}, { w: 1, n: 1 });
      const have = { 0: new Set(), 1: new Set() }; for (const d of docs) have[d.w].add(d.n);
      let acked = 0, lost = 0; const lostSample = [];
      for (const w of [0, 1]) for (const n of ackedMain[w]) { acked++; if (!have[w].has(n)) { lost++; if (lostSample.length < 3) lostSample.push(`${w}-${n}`); } }
      const ackedSet = { 0: new Set(ackedMain[0]), 1: new Set(ackedMain[1]) };
      let extra = 0; for (const w of [0, 1]) for (const n of have[w]) if (!ackedSet[w].has(n)) extra++;
      const nrDocs = new Set((await present(colNr, {}, { n: 1 })).map((d) => d.n));
      const nrLost = ackedNr.filter((n) => !nrDocs.has(n)).length;
      res.writes = { acked, present: docs.length, lost, lostSample, extraUnacked: extra, ins_err: [...B.values()].reduce((s, b) => s + b.we, 0), upd_err: [...B.values()].reduce((s, b) => s + b.ue, 0), noRetry: { acked: ackedNr.length, errors: cfg.nrErr || 0, lost: nrLost, present: nrDocs.size } };
    }
  } catch (e) { res.reconcileError = String(e.message).slice(0, 200); }
  // пропуски записи > 1 с
  const gaps = []; let prev = 0; for (const t of okTimes) { if (t - prev > 250) gaps.push({ at: prev, ms: t - prev }); prev = t; }
  res.gaps = gaps; res.total = rel();
  res.buckets = [...B.entries()].map(([s, b]) => ({ s, ...b }));
  await new Promise((r) => process.stdout.write(JSON.stringify(res) + '\n', r));
  await main.close(); await noretry.close(); for (const c of Object.values(direct)) await c.close().catch(() => undefined);
  process.exit(0);
}

// ======================================================================= ОРКЕСТРАТОР (хост)
function docker(args, opt = {}) { return spawnSync('docker', args, { encoding: 'utf8', timeout: opt.timeout || 90000 }); }
const dexec = (node, cmd) => docker(['exec', `halab-${node}`, 'sh', '-c', cmd]);
function meval(node, js, auth = true) {
  const a = ['exec', `halab-${node}`, 'mongo', '--quiet'];
  if (auth) a.push('-u', USER, '-p', PASS, '--authenticationDatabase', 'admin');
  a.push('--eval', js);
  const r = docker(a, { timeout: 60000 });
  return (r.stdout || '') + (r.stderr || '');
}
function rsStatus() {
  for (const n of NODES) {
    const c = docker(['inspect', '-f', '{{.State.Running}}', `halab-${n}`]).stdout?.trim();
    if (c !== 'true') continue;
    const o = meval(n, 'try{var s=rs.status();print(JSON.stringify({set:s.set,members:s.members.map(function(m){return {n:m.name.split(":")[0],h:m.health,s:m.stateStr,o:m.optimeDate?m.optimeDate.getTime():0}})}))}catch(e){print("ERR "+e.message)}');
    const line = o.split('\n').find((l) => l.startsWith('{'));
    if (line) { try { return JSON.parse(line); } catch { /* */ } }
  }
  return null;
}
function primaryName() { const s = rsStatus(); return s?.members.find((m) => m.s === 'PRIMARY')?.n || null; }
const other = (n) => (n === 'dc1' ? 'dc2' : 'dc1');
async function waitHealthy(maxS = 240, lagS = 3) {
  const t = Date.now();
  while (Date.now() - t < maxS * 1000) {
    const s = rsStatus();
    if (s) {
      const p = s.members.find((m) => m.s === 'PRIMARY');
      const sec = s.members.find((m) => m.s === 'SECONDARY');
      const arb = s.members.find((m) => m.s === 'ARBITER');
      if (p && sec && arb && s.members.every((m) => m.h === 1) && Math.abs(p.o - sec.o) <= lagS * 1000) return true;
    }
    await sleep(3000);
  }
  return false;
}
// --- сетевые приёмы
function shape(node) {
  const peers = NODES.filter((n) => n !== node);
  dexec(node, 'tc qdisc del dev eth0 root 2>/dev/null; true');
  let c = 'tc qdisc add dev eth0 root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 && tc qdisc add dev eth0 parent 1:3 handle 30: netem delay 30ms loss 1%';
  let i = 3;
  for (const p of peers) c += ` && tc filter add dev eth0 protocol ip parent 1:0 prio ${i++} u32 match ip dst ${IP[p]}/32 flowid 1:3`;
  const r = dexec(node, c);
  if (r.status !== 0) throw new Error(`tc ${node}: ${r.stderr}`);
}
const cut = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) dexec(x, `iptables -I INPUT -s ${IP[y]} -j DROP && iptables -I OUTPUT -d ${IP[y]} -j DROP`); };
const uncut = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) dexec(x, `iptables -D INPUT -s ${IP[y]} -j DROP 2>/dev/null; iptables -D OUTPUT -d ${IP[y]} -j DROP 2>/dev/null; true`); };
function uncutAll() { for (const n of NODES) dexec(n, 'iptables -F INPUT; iptables -F OUTPUT; true'); }
const dkill = (n) => docker(['kill', `halab-${n}`]);
const dstart = (n) => docker(['start', `halab-${n}`]);
const dstop = (n) => docker(['stop', '-t', '2', `halab-${n}`]);

// --- клиент
function startClient(cfg) {
  const full = { user: USER, pass: PASS, db: `lab_${cfg.name}_${Date.now().toString(36)}`.replace(/[^\w]/g, '_'), ...cfg };
  const p = spawn('docker', ['exec', '-i', 'halab-cli', 'node', '/lab/lab.mjs', 'client', JSON.stringify(full)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = []; let final = null; let ready;
  const rdy = new Promise((r) => { ready = r; });
  const rl = createInterface({ input: p.stdout });
  const waitFinal = new Promise((r) => { rl.on('close', () => r(final)); });
  rl.on('line', (l) => { try { const o = JSON.parse(l); if (o.k === 'final') final = o; else lines.push(o); if (o.k === 'ready') ready(); } catch (e) { if (l.startsWith('{"k":"final')) console.log('final не разобран:', l.length, e.message); } });
  p.on('close', (c, sg) => { if (!final) console.log('клиент завершился, код', c, sg); });
  return {
    ready: rdy,
    mark: (name) => { p.stdin.write(`mark ${name}\n`); },
    recent: (field, sec) => { const bs = lines.filter((x) => x.k === 'b'); return bs.slice(-sec).reduce((s, b) => s + (b[field] || 0), 0); },
    stop: async () => { p.stdin.write('stop\n'); return await waitFinal.then((f) => ({ final: f, lines })); },
  };
}

// --- анализ
function analyse(name, fin, lines) {
  const marks = fin.marks; const samples = lines.filter((x) => x.k === 's' && !x.down);
  const edges = [{ name: 'начало', t: 0 }, ...marks, { name: 'конец', t: fin.total }];
  const phases = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i].t, b = edges[i + 1].t; if (b - a < 500) continue;
    const bs = fin.buckets.filter((x) => x.s * 1000 >= a && x.s * 1000 < b);
    const sum = (f) => bs.reduce((s, x) => s + x[f], 0); const dur = (b - a) / 1000;
    const sm = samples.filter((x) => x.t >= a && x.t < b);
    const cache = {}; for (const n of ['dc1', 'dc2']) { const z = sm.filter((x) => x.node === n && x.cache != null); if (z.length) cache[n] = `${z[0].cache}→${z[z.length - 1].cache}`; }
    const commitLag = Math.max(0, ...sm.filter((x) => x.st === 1 && x.commit && x.applied).map((x) => x.applied - x.commit));
    const replLag = [];
    for (const x of sm) if (x.st === 1) { const p = x.members.find((m) => m[2] === 'P'); const s = x.members.find((m) => m[2] === 'S' && m[1] === 1); if (p && s && p[3] && s[3]) replLag.push(p[3] - s[3]); }
    const h0 = sm.find((x) => x.st === 1 && x.members.some((m) => m[1] === 0));
    const primaries = [...new Set(sm.filter((x) => x.st === 1).map((x) => x.node))];
    const gp = fin.gaps.filter((g) => g.at >= a - 1000 && g.at < b);
    phases.push({
      фаза: edges[i].name, с: +(a / 1000).toFixed(0), сек: +dur.toFixed(0),
      'вставок/с': +(sum('wi') / dur).toFixed(0), 'ошибок вставки': sum('we'), 'ошибок обновл.': sum('ue'), 'ошибок чтения': sum('re'),
      'чт. макс мс': Math.max(0, ...bs.map((x) => x.rmax)), 'вст. макс мс': Math.max(0, ...bs.map((x) => x.wmax)),
      'событий потока': sum('ce'), 'tx ok': sum('tx'), 'tx err': sum('txe'),
      'провал записи мс': gp.length ? Math.max(...gp.map((g) => g.ms)) : 0,
      'кэш МБ': cache, 'лаг коммит-точки макс с': commitLag, 'лаг репликации макс с': replLag.length ? Math.max(...replLag) : 0,
      'health0 виден через с': h0 ? +((h0.t - a) / 1000).toFixed(1) : null, 'главные': primaries,
      'flow-control': sm.some((x) => x.fc && x.fc.lag) ? 'lagged' : '-',
    });
  }
  return { name, total: fin.total, marks, writes: fin.writes, tx: fin.tx, gaps: fin.gaps, csErrors: fin.csErrors, csOpen: fin.csOpen, errSamples: fin.errSamples, reconcileError: fin.reconcileError, phases };
}
function rollbackFiles() {
  const r = {}; for (const n of ['dc1', 'dc2']) { const o = dexec(n, "find /data/db/rollback -type f -printf '%s %p\\n' 2>/dev/null"); r[n] = (o.stdout || '').split('\n').filter(Boolean); }
  return r;
}
function results(name, obj) { fs.mkdirSync(path.join(HERE, 'results'), { recursive: true }); fs.writeFileSync(path.join(HERE, 'results', `${name}.json`), JSON.stringify(obj, null, 1)); }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function settle(cl) {
  uncutAll();
  for (const n of NODES) { const r = docker(['inspect', '-f', '{{.State.Running}}', `halab-${n}`]).stdout?.trim(); if (r !== 'true') dstart(n); }
  const ok = await waitHealthy(300, 2);
  log('settle healthy=', ok);
  await sleep(8000);
  return ok;
}

// возврат голосов вторичному в PSA: в 4.4 обычный reconfig отклоняется, нужен rs.reconfigForPSASet
function restoreConfig(P) {
  return meval(P, 'var c=rs.conf();var i=-1;c.members.forEach(function(m,k){if(!m.arbiterOnly){m.votes=1;m.priority=1}});c.members.forEach(function(m,k){if(i<0&&(m.votes!==1))i=k});var bad=rs.conf().members.map(function(m,k){return (!m.arbiterOnly&&(m.votes!==1||m.priority!==1))?k:-1}).filter(function(k){return k>=0});bad.forEach(function(k){var cc=rs.conf();cc.members[k].votes=1;cc.members[k].priority=1;rs.reconfigForPSASet(k,cc)});print("fixed:"+bad.length)').replace(/s+/g,' ').slice(0,200);
}
async function ensureConfig() {
  for (let i = 0; i < 3; i++) { const P = primaryName(); if (P) { const o = restoreConfig(P); log('конфиг:', o.slice(-60)); return; } await sleep(5000); }
}
const stepDown = (n, secs = 60, catchup = 30) => meval(n, `try{rs.stepDown(${secs},${catchup})}catch(e){print(e.message)}`);

// ----------------------------------------------------------------------- сценарии
const SCEN = {
  // а. падение главного (kill -9 контейнера), возврат
  async A(cl) {
    await sleep(12000); const P = primaryName(); log('A главный', P);
    cl.mark(`kill_${P}`); dkill(P);
    await sleep(60000);
    cl.mark(`start_${P}`); dstart(P);
    await sleep(70000);
  },
  // б+в. падение вторичного, лечение votes:0 priority:0, возврат и догон
  async BC(cl) {
    await sleep(12000); const P = primaryName(); const S = other(P); log('B главный', P, 'вторичный', S);
    cl.mark(`kill_secondary_${S}`); dkill(S);
    await sleep(100000);
    cl.mark(`cure1_votes0_${S}`);
    const r1 = meval(P, `c=rs.conf();m=c.members.filter(function(x){return x.host=="${S}:27017"})[0];m.votes=0;m.priority=0;c.version++;printjson(rs.reconfig(c))`);
    log('cure1', r1.replace(/\s+/g, ' ').slice(0, 200));
    await sleep(35000);
    const ev = cl.recent('ce', 20); log('cure1: событий потока за 20 с =', ev);
    if (ev === 0) {
      cl.mark('cure2_remove_arbiter');
      const r2 = meval(P, 'printjson(rs.remove("dcarb:27017"))');
      log('cure2', r2.replace(/\s+/g, ' ').slice(0, 200));
      await sleep(35000);
      log('cure2: событий потока за 20 с =', cl.recent('ce', 20));
    }
    cl.mark(`start_secondary_${S}`); dstart(S);
    await sleep(60000);
    // возврат конфигурации: арбитр обратно, голоса вернуть
    cl.mark('restore_config');
    const cur = rsStatus();
    if (!cur?.members.find((m) => m.n === 'dcarb')) log('addArb', meval(P, 'printjson(rs.addArb("dcarb:27017"))').replace(/\s+/g, ' ').slice(0, 150));
    await sleep(5000);
    log('restore', restoreConfig(P));
    await sleep(40000);
  },
  // г. обрыв dc1–dc2 при живом арбитре, затем смерть главного во время обрыва, затем возврат
  async D(cl) {
    await sleep(12000); const P = primaryName(); const S = other(P); log('D главный', P);
    cl.mark(`cut_${P}_${S}`); cut(P, S);
    await sleep(180000);
    cl.mark(`kill_${P}_during_cut`); dkill(P);
    await sleep(60000);
    cl.mark('heal_net_and_start_old'); uncut(P, S); dstart(P);
    await sleep(90000);
  },
  // д. обрыв арбитра (сеть), затем остановка контейнера
  async E(cl) {
    await sleep(12000); const P = primaryName(); const S = other(P);
    cl.mark('arbiter_cut'); cut(P, 'dcarb'); cut(S, 'dcarb');
    await sleep(70000);
    cl.mark('arbiter_net_back'); uncut(P, 'dcarb'); uncut(S, 'dcarb');
    await sleep(25000);
    cl.mark('arbiter_container_stop'); dstop('dcarb');
    await sleep(50000);
    cl.mark('arbiter_container_start'); dstart('dcarb');
    await sleep(30000);
  },
  // е. плановый stepDown с догоном (3 раза)
  async F(cl) {
    await sleep(12000);
    for (let i = 1; i <= 3; i++) {
      const P = primaryName(); cl.mark(`stepdown_${i}_from_${P}`); stepDown(P, 20, 15);
      await sleep(45000);
    }
  },
};
// ж. транзакции при смене главного
SCEN.G1 = async (cl) => { await sleep(12000); const P = primaryName(); cl.mark(`kill_${P}`); dkill(P); await sleep(50000); cl.mark(`start_${P}`); dstart(P); await sleep(50000); };
SCEN.G2 = async (cl) => { await sleep(12000); for (let i = 1; i <= 2; i++) { const P = primaryName(); cl.mark(`stepdown_${i}_from_${P}`); stepDown(P, 20, 15); await sleep(35000); } };
// варианты флагов: только падение вторичного, без лечения
const variant = (extra) => async (cl) => { await sleep(12000); const P = primaryName(); const S = other(P); cl.mark(`kill_secondary_${S}`); dkill(S); await sleep(90000); cl.mark(`start_secondary_${S}`); dstart(S); await sleep(50000); };

async function recreate(extra) {
  const r = spawnSync('docker', ['compose', '-p', 'halab', '--env-file', '.env.lab', 'up', '-d', '--force-recreate', 'dc1', 'dc2', 'dcarb'], { cwd: HERE, encoding: 'utf8', env: { ...process.env, LAB_EXTRA: extra }, timeout: 180000 });
  if (r.status !== 0) throw new Error(r.stderr);
  await sleep(8000); for (const n of NODES) shape(n);
  return waitHealthy(300, 3);
}

async function runOne(key) {
  const flags = { Bmrc0: '--enableMajorityReadConcern false', Bfc0: '--setParameter enableFlowControl=false' };
  const fn = key === 'Bmrc0' || key === 'Bfc0' ? variant() : key === 'B' || key === 'C' ? SCEN.BC : SCEN[key];
  if (!fn) throw new Error('нет сценария ' + key);
  if (flags[key]) { log('перезапуск узлов с', flags[key]); if (!(await recreate(flags[key]))) log('ВНИМАНИЕ: не здоров после перезапуска'); }
  await ensureConfig();
  const cfg = { name: key, mode: key.startsWith('G') ? 'tx' : 'load' };
  log('=== сценарий', key);
  const cl = startClient(cfg); await cl.ready;
  const t0 = Date.now();
  try { await fn(cl); } catch (e) { log('ошибка сценария', e.message); }
  const healthy = await settle(cl);
  const rb = rollbackFiles();
  const { final, lines } = await cl.stop();
  if (!final) { log('нет final'); return; }
  const a = analyse(key, final, lines); a.healthyAtEnd = healthy; a.rollback = rb; a.wallSec = Math.round((Date.now() - t0) / 1000);
  results(key, a); fs.writeFileSync(path.join(HERE, 'results', `${key}.raw.json`), JSON.stringify({ lines }, null, 0));
  console.log(JSON.stringify({ name: key, writes: a.writes, tx: a.tx, rollback: rb, csErrors: a.csErrors.slice(0, 3), errs: a.errSamples }, null, 1));
  console.table(a.phases.map((p) => ({ фаза: p.фаза.slice(0, 28), сек: p.сек, 'вст/с': p['вставок/с'], 'ош.вст': p['ошибок вставки'], 'ош.чт': p['ошибок чтения'], 'поток': p['событий потока'], 'tx ok/err': `${p['tx ok']}/${p['tx err']}`, 'провал мс': p['провал записи мс'], 'вст.макс': p['вст. макс мс'], 'коммит-лаг с': p['лаг коммит-точки макс с'], 'реплик-лаг с': p['лаг репликации макс с'], 'h0 с': p['health0 виден через с'], 'главные': p['главные'].join('+'), 'кэш': JSON.stringify(p['кэш МБ']) })));
  if (flags[key]) { log('возврат штатных флагов'); await recreate(''); }
}

async function setup() {
  const r = spawnSync('docker', ['compose', '-p', 'halab', '--env-file', '.env.lab', 'up', '-d', '--build'], { cwd: HERE, stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0) throw new Error('compose up');
  await sleep(8000);
  const has = meval('dc1', 'print(JSON.stringify(rs.status().ok))', false);
  if (!/1/.test(has)) {
    log(meval('dc1', 'printjson(rs.initiate({_id:"labrs",members:[{_id:1,host:"dc1:27017"},{_id:2,host:"dc2:27017"},{_id:3,host:"dcarb:27017",arbiterOnly:true}]}))', false));
    for (let i = 0; i < 20 && !/true/.test(meval('dc1', 'print(db.isMaster().ismaster)', false)); i++) await sleep(2000);
    log(meval('dc1', `db.getSiblingDB("admin").createUser({user:"${USER}",pwd:"${PASS}",roles:["root"]})`, false));
  }
  for (const n of NODES) shape(n);
  log('здоров:', await waitHealthy(180, 3));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'client') await clientMain(JSON.parse(args[0]));
else if (cmd === 'dbg') { const cl = startClient({ name: 'dbg', mode: 'load' }); await cl.ready; await sleep(20000); const r = await cl.stop(); console.log('final?', !!r.final); }
else if (cmd === 'setup') await setup();
else if (cmd === 'run') {
  const keys = args[0] === 'all' ? ['A', 'B', 'D', 'E', 'F', 'G1', 'G2', 'Bmrc0', 'Bfc0'] : args;
  for (const k of keys) await runOne(k);
} else if (cmd === 'teardown') spawnSync('docker', ['compose', '-p', 'halab', '--env-file', '.env.lab', 'down', '-v'], { cwd: HERE, stdio: 'inherit' });
else console.log('node lab.mjs setup | run <A B D E F G1 G2 Bmrc0 Bfc0|all> | teardown');
