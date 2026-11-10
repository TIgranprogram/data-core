// T23: ручной стенд и полный прогон не используют legacy dcnight и не удаляют volumes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertRun, assertOwned, captureCreated, dockerInventory, newStandRun, portFree, stopOwned } from './night-owner.mjs';

const bad = (text) => { throw Object.assign(new Error('Защита стенда: ' + text), { code: 2 }); };
const secretKeys = [['NIGHT_ROOT_PW', 12], ['NIGHT_APP_PW', 12], ['NIGHT_JWT', 24], ['NIGHT_JWT_REFRESH', 24], ['NIGHT_ADMIN_PW', 12], ['NIGHT_KEYFILE', 48], ['NIGHT_QA_PW', 12]];
export function createNightStand({ docker, sh, root, composeFile, nightDir, backupDir, inventoryFn = (run) => dockerInventory(run, docker), portFreeFn = portFree, healthFn = async (run) => { try { return (await fetch(`http://127.0.0.1:${run.apiPort}/api/health/ready`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch { return false; } }, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), bootFn } = {}) {
  const currentFile = path.join(nightDir, 'current-stand.json');
  const dir = (run) => path.join(nightDir, 'stands', assertRun(run).id);
  const save = (run) => { fs.mkdirSync(dir(run), { recursive: true }); fs.writeFileSync(path.join(dir(run), 'run.json'), JSON.stringify(run, null, 2) + '\n'); };
  const current = () => {
    if (!fs.existsSync(currentFile)) return null;
    try { const run = JSON.parse(fs.readFileSync(currentFile, 'utf8')); assertRun(run); return JSON.parse(fs.readFileSync(path.join(dir(run), 'run.json'), 'utf8')); }
    catch { bad('паспорт ручного стенда повреждён; legacy/неизвестный стенд не меняю'); }
  };
  function credentials(run, fresh = false) {
    const file = path.join(dir(run), 'stand.env');
    if (fresh) {
      const e = Object.fromEntries(secretKeys.map(([key, bytes]) => [key, crypto.randomBytes(bytes).toString('hex')]));
      fs.writeFileSync(file, Object.entries(e).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
      return e;
    }
    const e = Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.split('=')));
    if (secretKeys.some(([key, bytes]) => !new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(e[key] || ''))) bad('секреты своего стенда неполны');
    return e;
  }
  const inventory = (run, options) => assertOwned(run, inventoryFn(run), options);
  function command(run, args, options) { inventory(run); return docker(args, options); }
  function compose(run, args, src, { capture = false } = {}) {
    inventory(run);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MONGO|COMPOSE|NIGHT|DC_PROD|CONTROL_)/i.test(key)));
    Object.assign(env, credentials(run), { NIGHT_SRC: src.replace(/\\/g, '/'), NIGHT_PROJECT: run.project, NIGHT_RUN_ID: run.id, NIGHT_DB: run.db, NIGHT_API_PORT: String(run.apiPort), NIGHT_MONGO_PORT: String(run.mongoPort), NIGHT_ADMIN_USERNAME: run.adminUsername || 'admin' });
    const r = docker(['compose', '--env-file', path.join(dir(run), 'stand.env'), '--project-directory', dir(run), '-p', run.project, '-f', composeFile, ...args], { env });
    // Даже неуспешный up мог создать часть ресурсов. Фиксируем только проверенные labels после пустого preflight.
    if (capture) { captureCreated(run, inventoryFn(run)); save(run); }
    else inventory(run);
    return r;
  }
  const evalMongo = (run, script) => command(run, ['exec', '-i', `${run.project}-mongo`, 'sh', '-c', 'mongo --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'], { input: script });
  async function wait(label, fn, ctx, tries = 60) {
    for (let i = 0; i < tries; i++) { if (await fn()) return; await sleepFn(2000); }
    bad('таймаут: ' + label);
  }
  function checked(result, label, ctx) { ctx.log(result.out || ''); if (result.code !== 0) bad(label + ': ' + String(result.out || result.error?.message || 'сбой инструмента').trim().slice(-160)); return result; }
  async function boot(run, src, ctx) {
    const names = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((n) => /^datacore-[\d_-]+\.tgz$/.test(n)).sort() : [];
    const bk = names.at(-1); if (!bk) bad('нет свежего datacore-*.tgz в папке копий');
    checked(compose(run, ['up', '-d', '--wait', 'mongo'], src, { capture: true }), 'Mongo не поднялся', ctx);
    await wait('инициализация Mongo', () => /init process complete/.test(command(run, ['logs', `${run.project}-mongo`]).out), ctx);
    await wait('replica set rs0', () => {
      checked(evalMongo(run, "var s;try{s=rs.status()}catch(e){s=e}if(s.code===94){rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]})}"), 'replica set', ctx);
      return /true/.test(evalMongo(run, 'print(db.isMaster().ismaster)').out);
    }, ctx, 40);
    // Восстановление допускается только в пустую новую БД. Неудачный импорт никогда не повторяется поверх данных.
    const empty = checked(evalMongo(run, `print(db.getSiblingDB('${run.db}').getCollectionNames().length===0)`), 'проверка пустой БД', ctx);
    if (empty.stdout?.trim() !== 'true') bad('БД не пуста или результат проверки неизвестен; импорт запрещён');
    const ex = path.join(dir(run), 'restore'); fs.mkdirSync(ex, { recursive: false });
    try {
      checked(sh('tar', ['-xz'], { cwd: ex, input: fs.readFileSync(path.join(backupDir, bk)) }), 'распаковка копии', ctx);
      const top = fs.readdirSync(ex).find((n) => fs.existsSync(path.join(ex, n, 'datacore'))); if (!top) bad('в копии нет datacore');
      checked(command(run, ['cp', path.join(ex, top, 'datacore'), `${run.project}-mongo:/tmp/source-dump`]), 'копирование dump', ctx);
      checked(command(run, ['exec', `${run.project}-mongo`, 'sh', '-c', `mongorestore --quiet --stopOnError -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db ${run.db} /tmp/source-dump`]), 'импорт копии', ctx);
    } finally { fs.rmSync(ex, { recursive: true, force: true }); }
    const bootstrap = checked(evalMongo(run, `var d=db.getSiblingDB('${run.db}');var u=d.users.findOne({isOwner:true},{username:1})||d.users.findOne({role:'admin'},{username:1});print(JSON.stringify({username:u?u.username:null,collections:d.getCollectionNames().length}))`), 'проверка восстановленной копии', ctx);
    let restored; try { restored = JSON.parse(bootstrap.stdout?.trim() || ''); } catch { bad('результат restore неизвестен'); }
    if (restored.collections < 1 || typeof restored.username !== 'string' || !/^[\p{L}\p{N}_.@+-]{1,128}$/u.test(restored.username)) bad('restore не подтвердил коллекции и bootstrap');
    run.adminUsername = restored.username; save(run);
    const e = credentials(run);
    checked(evalMongo(run, `db.getSiblingDB('admin').createUser({user:'dcnight',pwd:'${e.NIGHT_APP_PW}',roles:[{role:'readWrite',db:'${run.db}'}]})`), 'пользователь стенда', ctx);
    checked(compose(run, ['up', '-d', '--build', 'proxy'], src, { capture: true }), 'backend/шлюз не поднялись', ctx);
    await wait('backend health', () => healthFn(run), ctx);
    const h = checked(command(run, ['exec', '-e', `PW=${e.NIGHT_QA_PW}`, `${run.project}-backend`, 'node', '-e', "console.log(require('bcryptjs').hashSync(process.env.PW,10))"]), 'хеш qa', ctx);
    if (!/^\$2[aby]\$/.test(h.stdout?.trim() || '')) bad('не получил хеш qa');
    checked(evalMongo(run, `db.getSiblingDB('${run.db}').users.updateOne({username:'qa'},{$set:{displayName:'QA night',passwordHash:'${h.stdout.trim()}',role:'admin',permissions:[],isActive:true,isOwner:false,refreshTokenVersion:0,updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true})`), 'пользователь qa', ctx);
    fs.writeFileSync(path.join(dir(run), 'qa-login.txt'), e.NIGHT_QA_PW, { mode: 0o600 });
  }
  function down(ctx, run = current()) {
    if (!run) bad('нет паспорта своего стенда; legacy dcnight не останавливаю');
    const r = stopOwned(run, inventory(run), docker); checked(r, 'остановка не удалась', ctx);
    ctx.say('Стенд остановлен. База, volumes и сеть сохранены: ' + run.project);
    return 0;
  }
  async function up(ctx, src = root, supplied = null) {
    let run = supplied || current();
    if (run && !supplied) {
      inventory(run);
      if (!run.initialized) bad('незавершённый стенд: повторный импорт/пересоздание запрещены');
      checked(compose(run, ['start'], src), 'запуск сохранённого стенда', ctx);
      await wait('backend health', () => healthFn(run), ctx);
      ctx.say(`Стенд запущен с сохранённой базой: http://localhost:${run.apiPort}/app/`);
      return 0;
    }
    run ||= newStandRun();
    inventory(run, { fresh: true });
    for (const p of [run.apiPort, run.mongoPort]) if (!(await portFreeFn(p))) bad(`порт ${p} занят; существующий стенд не меняю`);
    if (fs.existsSync(dir(run))) bad('ID запуска уже использован');
    save(run); credentials(run, true);
    if (!supplied) fs.writeFileSync(currentFile, JSON.stringify(run) + '\n', { flag: 'wx' });
    try {
      await (bootFn || boot)(run, src, ctx, { compose, command, evalMongo });
      inventory(run); run.initialized = true; save(run);
      ctx.say(`Новый стенд: ${run.project} · БД ${run.db} · http://localhost:${run.apiPort}/app/`);
      return 0;
    } catch (error) {
      try { down(ctx, run); } catch (cleanupError) { ctx.say('Cleanup отказан, ресурсы сохранены: ' + cleanupError.message); }
      throw error;
    }
  }
  async function refresh(ctx, src = root) {
    const run = current(); if (!run || !run.initialized) bad('нет готового собственного стенда');
    // оборванная пересборка (закрыли окно, перезагрузка) могла оставить новый контейнер этого же запуска вне паспорта:
    // метки dc.night.run/project/БД — только наши, проверяет captureCreated; принять его в паспорт, чужое по-прежнему — отказ
    captureCreated(run, inventoryFn(run)); save(run);
    inventory(run);
    checked(compose(run, ['up', '-d', '--no-deps', '--build', 'backend'], src, { capture: true }), 'пересборка backend', ctx);
    await wait('backend health', () => healthFn(run), ctx);
    return 0;
  }
  async function status(ctx) {
    const run = current();
    if (!run) { ctx.say('Собственный night стенд не создан. Legacy dcnight не управляется.'); return 1; }
    const s = inventory(run); // только чтение, не создаёт env и не обращается к production
    for (const c of s.containers) ctx.say(`${c.name}: ${c.running ? 'запущен' : 'остановлен'}`);
    ctx.say(`Project ${run.project} · БД ${run.db} · volumes сохранены`);
    return s.containers.some((c) => c.running) ? 0 : 1;
  }
  return { up, down, refresh, status, credentials, current, runDir: dir, compose, inventory };
}
