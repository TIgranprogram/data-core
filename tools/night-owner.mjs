// T23: ресурсами управляет только создавший их запуск. Никакого удаления данных.
import crypto from 'node:crypto';
import net from 'node:net';

export const OWNER = 'datacore-night-v1';
export const RELAY_COMMAND = 'socat TCP-LISTEN:3000,fork,reuseaddr TCP:backend:3000 & socat TCP-LISTEN:27017,fork,reuseaddr TCP:mongo:27017 & wait';
const fail = (text) => { throw Object.assign(new Error('Защита стенда: ' + text), { code: 2 }); };
export function newStandRun({ id = crypto.randomBytes(12).toString('hex'), apiPort = 3102, mongoPort = 27118 } = {}) {
  const run = { owner: OWNER, id, project: `dc-${id}-night`, db: `datacore-${id}-night`, testDb: `datacore-test-${id}-night`, apiPort, mongoPort, createdContainers: [], initialized: false };
  assertRun(run);
  return run;
}
export function assertRun(run) {
  if (!run || run.owner !== OWNER || !/^[a-f0-9]{24}$/.test(run.id || '') || run.project !== `dc-${run.id}-night` || run.db !== `datacore-${run.id}-night` || run.testDb !== `datacore-test-${run.id}-night` || !Array.isArray(run.createdContainers) || run.createdContainers.some((id) => !/^[a-f0-9]{64}$/.test(id))) fail('нет достоверного паспорта запуска; legacy dcnight не управляется');
  if (run.adminUsername !== undefined && (typeof run.adminUsername !== 'string' || !/^[\p{L}\p{N}_.@+-]{1,128}$/u.test(run.adminUsername))) fail('небезопасный bootstrap username');
  const ports = [run.apiPort, run.mongoPort];
  if (ports.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535 || [3000, 3001, 3002, 27017, 27018].includes(p)) || ports[0] === ports[1]) fail('небезопасные порты');
  return run;
}
export function ownerLabels(run) {
  return { 'dc.night.owner': OWNER, 'dc.night.run': run.id, 'dc.night.db': run.db, 'com.docker.compose.project': run.project };
}
function own(resource, run) {
  const labels = resource.labels || {};
  return Object.entries(ownerLabels(run)).every(([k, v]) => labels[k] === v);
}
export function assertOwned(run, snapshot, { fresh = false, capture = false } = {}) {
  assertRun(run);
  if (!snapshot || !['containers', 'volumes', 'networks'].every((k) => Array.isArray(snapshot[k]))) fail('не удалось прочитать Docker inventory');
  if (fresh && Object.values(snapshot).some((rows) => rows.length)) fail('project уже существует; ничего не пересоздаю');
  const volumeNames = [`${run.project}_mongo-data`, `${run.project}_secrets`, `${run.project}_mongo-config`, `${run.project}_uploads`];
  for (const v of snapshot.volumes) if (!volumeNames.includes(v.name) || !own(v, run)) fail('чужой или неизвестный volume');
  for (const n of snapshot.networks) if (!own(n, run) || !((n.name === `${run.project}_default` && n.internal === true) || (n.name === `${run.project}_access` && n.internal === false))) fail('чужая или неверно изолированная сеть');
  for (const c of snapshot.containers) {
    if (!own(c, run) || !['mongo', 'backend', 'keyfile', 'proxy'].includes(c.service) || c.name !== `${run.project}-${c.service}` || !/^[a-f0-9]{64}$/.test(c.id) || (!capture && !run.createdContainers.includes(c.id))) fail('чужой или не созданный этим запуском container');
    if (c.service === 'backend' && (c.db !== run.db || c.uriTarget !== `mongo:27017/${run.db}`)) fail('БД backend не совпадает с паспортом');
    if (c.service === 'proxy') {
      if (JSON.stringify(c.command) !== JSON.stringify([RELAY_COMMAND]) || JSON.stringify(c.entrypoint) !== JSON.stringify(['/bin/sh', '-c'])) fail('шлюз не ограничен двумя фиксированными направлениями');
      if (Object.keys(c.ports || {}).length !== 2) fail('неверные порты шлюза');
      for (const [key, port] of [['27017/tcp', run.mongoPort], ['3000/tcp', run.apiPort]]) { const bindings = c.ports?.[key]; if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort !== String(port)) fail('порты шлюза не совпадают с loopback-паспортом'); }
    } else if (Object.keys(c.ports || {}).length) fail('Mongo/backend не должны публиковать порт напрямую');
    for (const m of c.mounts || []) {
      if (m.name === `${run.project}_uploads` && (c.service !== 'backend' || m.destination !== '/app/uploads')) fail('uploads подключён не к backend');
      if (c.service === 'backend' && (m.destination === '/app/uploads' || m.destination?.startsWith('/app/uploads/')) && (m.type !== 'volume' || m.name !== `${run.project}_uploads` || m.destination !== '/app/uploads')) fail('чужое хранилище uploads');
      if (m.type === 'volume' && (!volumeNames.includes(m.name) || !snapshot.volumes.some((v) => v.name === m.name))) fail('container подключён к чужому volume');
      if (c.service === 'mongo' && m.type !== 'volume') fail('Mongo использует неизвестные данные');
    }
    if (c.service === 'mongo' && !(c.mounts || []).some((m) => m.name === volumeNames[0] && m.destination === '/data/db')) fail('не подтверждён Mongo data volume');
    const allowedNetworks = c.service === 'proxy' ? [`${run.project}_default`, `${run.project}_access`] : [`${run.project}_default`];
    if ((c.networks || []).some((n) => !allowedNetworks.includes(n) || !snapshot.networks.some((s) => s.name === n)) || (c.networks || []).length !== allowedNetworks.length) fail('container подключён к чужой сети');
  }
  return snapshot;
}
const jsonLines = (s) => String(s).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const labelsOf = (row) => typeof row.Labels === 'string' ? Object.fromEntries(row.Labels.split(',').filter(Boolean).map((s) => { const at = s.indexOf('='); return [s.slice(0, at), s.slice(at + 1)]; })) : row.Labels || {};

/** Читает только метаданные выбранного project; ENV секретов и содержимое томов не выводит. */
export function dockerInventory(run, docker) {
  assertRun(run);
  const query = (args) => { const r = docker(args); if (r.code !== 0) fail('Docker inventory недоступен: ' + (r.error?.message || String(r.out).trim().slice(-200))); return r.stdout ?? r.out; };
  const rows = (args) => jsonLines(query([...args, '--format', '{{json .}}']));
  const relevant = (r) => labelsOf(r)['com.docker.compose.project'] === run.project || String(r.Names || r.Name || '').startsWith(run.project);
  const containers = rows(['container', 'ls', '-a', '--no-trunc']).filter(relevant).map((r) => {
    // Go template намеренно выбирает только имя БД, а не весь Config.Env.
    const supported = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"ports":{{json .HostConfig.PortBindings}},"networks":{{json .NetworkSettings.Networks}},"running":{{json .State.Running}},"command":{{json .Config.Cmd}},"entrypoint":{{json .Config.Entrypoint}},"db":"{{range .Config.Env}}{{if eq (index (split . "=") 0) "MONGO_DB"}}{{index (split . "=") 1}}{{end}}{{end}}","uriTarget":"{{range .Config.Env}}{{if eq (index (split . "=") 0) "MONGO_URI"}}{{index (split (index (split . "@") 1) "?") 0}}{{end}}{{end}}"}';
    const c = JSON.parse(query(['container', 'inspect', '--format', supported, r.ID]));
    return { ...c, name: c.name.replace(/^\//, ''), service: c.labels?.['com.docker.compose.service'], mounts: (c.mounts || []).map((m) => ({ type: m.Type, name: m.Name, destination: m.Destination })), networks: Object.keys(c.networks || {}) };
  });
  const volumes = rows(['volume', 'ls']).filter(relevant).map((r) => JSON.parse(query(['volume', 'inspect', '--format', '{"name":{{json .Name}},"labels":{{json .Labels}}}', r.Name])));
  const networks = rows(['network', 'ls', '--no-trunc']).filter(relevant).map((r) => JSON.parse(query(['network', 'inspect', '--format', '{"name":{{json .Name}},"labels":{{json .Labels}},"internal":{{json .Internal}}}', r.ID])));
  return { containers, volumes, networks };
}
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
/** После проверенного пустого inventory только новые labels могут попасть в createdContainers. */
export function captureCreated(run, snapshot) {
  assertOwned(run, snapshot, { capture: true });
  run.createdContainers = [...new Set([...run.createdContainers, ...snapshot.containers.map((c) => c.id)])];
}
/** stop по immutable ID, не compose down: неизвестные и прежние ресурсы остаются нетронуты. */
export function stopOwned(run, snapshot, docker) {
  assertOwned(run, snapshot);
  const ids = snapshot.containers.filter((c) => c.running).map((c) => c.id);
  if (!ids.length) return { code: 0, out: 'Контейнеры уже остановлены. База и volumes сохранены.' };
  return docker(['container', 'stop', ...ids]);
}
