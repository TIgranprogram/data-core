import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createDocumentIntake } from '../document-intake.mjs';

const production = 'https://kppdf-crm.ru/db/api';
const services = { apiBase: production, modelBase: 'http://127.0.0.1:1235/v1', model: 'synthetic-model' };
const password = 'synthetic-C245-password';
const jwt = claims => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic';

// Только tempdir, искусственные JWT и fake transport. Ни одного настоящего fetch/engine.
async function fixture(t, { secure = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-c245-'));
  const file = path.join(root, 'document-intake-session.json');
  let current = Date.UTC(2026, 10, 23), responseMode = 'ok', protectMode = 'ok', serial = 0;
  const calls = [], tokens = [], protectedValues = [], vault = new Map();
  const secureSession = async (mode, value) => {
    if (mode === 'unprotect') {
      if (protectMode === 'other-user' || !vault.has(value)) throw Error('Synthetic CurrentUser mismatch');
      return vault.get(value);
    }
    protectedValues.push(JSON.parse(value));
    if (protectMode === 'throw') throw Error('Synthetic DPAPI failure');
    if (protectMode === 'empty') return '';
    if (protectMode === 'oversize') return 'x'.repeat(64_001);
    const sealed = randomBytes(48).toString('base64'); vault.set(sealed, value); return sealed;
  };
  const fetchFn = async (url, request) => {
    const login = url.endsWith('/auth/login');
    assert.ok(login || url.endsWith('/auth/refresh'), 'Fake auth transport only');
    assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    calls.push({ url, body, auth: request.headers.Authorization });
    if (!login && responseMode === 'offline') throw Error('Synthetic offline');
    if (!login && ['500', '503', '401', '403'].includes(responseMode)) return new Response('', { status: Number(responseMode) });
    const previous = login ? null : JSON.parse(Buffer.from(request.headers.Authorization.slice(7).split('.')[1], 'base64url'));
    if (!login) assert.equal(request.headers.Authorization, 'Bearer ' + tokens.at(-1).refresh);
    const claims = { sub: login ? body.username : previous.sub, version: 4, role: 'admin', orgId: 'synthetic-org', exp: Math.floor(current / 1000) + 900, nonce: ++serial };
    if (!login) {
      if (responseMode === 'account') claims.sub = 'synthetic-other';
      if (responseMode === 'version') claims.version++;
      if (responseMode === 'role') claims.role = 'director';
      if (responseMode === 'org') claims.orgId = 'synthetic-other-org';
      if (responseMode === 'expired-access') claims.exp = Math.floor(current / 1000) - 1;
    }
    const access = jwt(claims), refresh = jwt({ sub: claims.sub, version: claims.version, exp: Math.floor(current / 1000) + 90 * 86400, rem: login ? body.remember : previous.rem, nonce: serial });
    tokens.push({ access, refresh });
    return Response.json({ access, user: { id: claims.sub, role: claims.role, canMoney: true } }, { headers: { 'Set-Cookie': `refreshToken=${refresh}; Path=/api/auth; HttpOnly; Secure` } });
  };
  const start = () => createDocumentIntake({ stateDir: root, now: () => current, fetchFn, secureSession: secure ? secureSession : null,
    pickFolder: async () => path.join(root, 'synthetic-documents'),
    engine: async () => ({ configure: async ({ root }) => ({ root, folders: {} }), status: async () => ({ counts: {}, running: false }), reviewStatus: async () => ({ counts: {}, items: [] }) }),
  });
  let intake = start();
  t.after(async () => { await intake.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const status = async () => (await intake.route('GET', 'status')).body;
  const post = async (action, body = {}) => intake.route('POST', action, async () => ({ ...body, revision: (await status()).revision }));
  const restart = async () => { await intake.stop(); intake = start(); };
  const absent = () => assert.rejects(fs.access(file), { code: 'ENOENT' });
  const noSecrets = async () => {
    const files = await fs.readdir(root);
    const contents = await Promise.all(files.map(async name => (await fs.stat(path.join(root, name))).isFile() ? fs.readFile(path.join(root, name), 'utf8') : ''));
    const exposed = JSON.stringify([await status(), contents]);
    assert.ok(!exposed.includes(password));
    for (const token of tokens) assert.ok(!exposed.includes(token.access) && !exposed.includes(token.refresh));
  };
  return { root, file, calls, tokens, protectedValues, vault, status, post, restart, absent, noSecrets,
    login: (username = 'synthetic-owner') => post('login', { username, password }),
    advance: milliseconds => { current += milliseconds; }, response: mode => { responseMode = mode; }, protect: mode => { protectMode = mode; },
  };
}

for (const apiBase of [production, production + '/', 'http://127.0.0.1:3102/api', 'http://localhost:3001/api/', 'http://[::1]:3001/api']) {
  test(`C245 allowlist/restart/rotation: ${apiBase}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.post('settings', { ...services, apiBase })).status, 200);
    assert.equal((await f.login()).status, 200); assert.equal(f.calls[0].body.remember, true);
    assert.equal((await f.status()).remembered, true);
    const first = f.tokens.at(-1).refresh, sealed = JSON.parse(await fs.readFile(f.file, 'utf8'));
    assert.deepEqual(Object.keys(sealed), ['sealed']);
    assert.deepEqual(Object.keys(f.protectedValues[0]).sort(), ['apiBase', 'claims', 'value']);
    assert.deepEqual(f.protectedValues[0].claims, { sub: 'synthetic-owner', version: 4, role: 'admin', orgId: 'synthetic-org' });
    await f.restart(); assert.equal((await f.status()).signedIn, true); assert.equal((await f.status()).remembered, true);
    assert.notEqual(f.tokens.at(-1).refresh, first);
    assert.equal(f.calls.at(-1).auth, 'Bearer ' + first);
    assert.deepEqual(f.calls.at(-1).body, {});
    await f.noSecrets();
  });
}

for (const apiBase of [production + '?x=1', production + '#x', 'https://user:pass@kppdf-crm.ru/db/api', 'https://kppdf-crm.ru:443/db/api', 'https://kppdf-crm.ru:8443/db/api', production + '/evil', 'https://evil.kppdf-crm.ru/db/api', 'https://kppdf-crm.ru.evil/db/api', 'http://kppdf-crm.ru/db/api', 'https://example.invalid/db/api', 'http://192.168.1.2:3001/api', 'http://127.0.0.1:3001/api?x=1']) {
  test(`C245 rejected settings cannot remember: ${apiBase}`, async t => {
    const f = await fixture(t);
    assert.equal((await f.post('settings', { ...services, apiBase })).status, 400);
    assert.equal(f.calls.length, 0); assert.equal(f.protectedValues.length, 0); await f.absent();
  });
}

for (const failure of ['offline', '500', '503']) {
  test(`C245 temporary ${failure}: disk survives, retry waits exactly15s`, async t => {
    const f = await fixture(t); await f.post('settings', services); await f.login();
    const stored = await fs.readFile(f.file, 'utf8');
    await f.restart(); f.response(failure);
    assert.equal((await f.status()).signedIn, false); assert.equal((await f.status()).remembered, true);
    assert.equal(await fs.readFile(f.file, 'utf8'), stored);
    const requests = f.calls.length; f.response('ok'); f.advance(14_999);
    assert.equal((await f.status()).signedIn, false); assert.equal(f.calls.length, requests);
    f.advance(1); assert.equal((await f.status()).signedIn, true); assert.equal(f.calls.length, requests + 1);
    assert.notEqual(await fs.readFile(f.file, 'utf8'), stored); await f.noSecrets();
  });
}

for (const failure of ['401', '403', 'account', 'version', 'role', 'org', 'expired-access']) {
  test(`C245 refresh ${failure}: erase binding, no retry or ghost session`, async t => {
    const f = await fixture(t); await f.post('settings', services); await f.login();
    await f.restart(); f.response(failure);
    const status = await f.status(); assert.equal(status.signedIn, false); assert.equal(status.remembered, false); await f.absent();
    const count = f.calls.length; f.advance(16_000); await f.status(); assert.equal(f.calls.length, count);
  });
}

test('C245 saved refresh expiry/CurrentUser failure erase without contacting API', async t => {
  for (const failure of ['expiry', 'other-user']) {
    const f = await fixture(t); await f.post('settings', services); await f.login();
    if (failure === 'expiry') f.advance(91 * 86400_000); else f.protect('other-user');
    await f.restart(); const count = f.calls.length;
    assert.equal((await f.status()).signedIn, false); assert.equal((await f.status()).remembered, false);
    assert.equal(f.calls.length, count); await f.absent();
  }
});

for (const binding of ['apiBase', 'sub', 'version']) {
  test(`C245 saved ${binding} binding mismatch erased before refresh`, async t => {
    const f = await fixture(t); await f.post('settings', services); await f.login();
    const { sealed } = JSON.parse(await fs.readFile(f.file, 'utf8'));
    const saved = JSON.parse(f.vault.get(sealed));
    if (binding === 'apiBase') saved.apiBase = 'http://127.0.0.1:3102/api';
    else if (binding === 'sub') saved.claims.sub = 'synthetic-other-owner';
    else saved.claims.version++;
    f.vault.set(sealed, JSON.stringify(saved));
    await f.restart(); const count = f.calls.length;
    assert.equal((await f.status()).signedIn, false); assert.equal((await f.status()).remembered, false);
    assert.equal(f.calls.length, count); await f.absent();
  });
}

test('C245 logout/site/account switch erase; model/folder changes preserve selected-site login', async t => {
  const f = await fixture(t); await f.post('settings', services); await f.login();
  const stored = await fs.readFile(f.file, 'utf8');
  await f.post('settings', { ...services, model: 'synthetic-other-model' });
  assert.equal((await f.status()).signedIn, true); assert.equal(await fs.readFile(f.file, 'utf8'), stored);
  assert.equal((await f.post('folder')).status, 200); assert.equal((await f.status()).remembered, true);
  await f.login('synthetic-new-owner'); assert.equal(f.protectedValues.at(-1).claims.sub, 'synthetic-new-owner');
  await f.post('settings', { ...services, apiBase: 'http://127.0.0.1:3102/api' });
  assert.equal((await f.status()).signedIn, false); assert.equal((await f.status()).remembered, false); await f.absent();
  await f.login(); await f.post('logout'); await f.absent(); await f.restart(); assert.equal((await f.status()).signedIn, false);
});

for (const failure of ['throw', 'empty', 'oversize', 'write', 'rename']) {
  test(`C245 protect/atomic save ${failure}: memory valid, stale blob erased, no plaintext`, async t => {
    const f = await fixture(t); await f.post('settings', services); await f.login();
    const before = f.tokens.at(-1).refresh; await f.restart();
    if (failure === 'write') {
      const open = fs.open.bind(fs);
      t.mock.method(fs, 'open', async (file, ...args) => {
        if (path.dirname(String(file)) === f.root && String(file).endsWith('.tmp')) throw Object.assign(Error('Synthetic write failure'), { code: 'EIO' });
        return open(file, ...args);
      });
    } else if (failure === 'rename') {
      const rename = fs.rename.bind(fs);
      t.mock.method(fs, 'rename', async (from, to) => {
        if (to === f.file) throw Object.assign(Error('Synthetic atomic rename failure'), { code: 'EIO' });
        return rename(from, to);
      });
    } else f.protect(failure);
    const status = await f.status(); assert.equal(status.signedIn, true); assert.equal(status.remembered, false);
    assert.notEqual(f.tokens.at(-1).refresh, before); await f.absent(); await f.noSecrets();
    assert.ok(!(await fs.readdir(f.root)).some(name => name.endsWith('.tmp')));
  });
}

test('C245 unavailable secureSession is truthful memory-only, never plaintext fallback', async t => {
  const f = await fixture(t, { secure: false }); await f.post('settings', services);
  assert.equal((await f.login()).status, 200); assert.equal(f.calls[0].body.remember, false);
  assert.equal((await f.status()).signedIn, true); assert.equal((await f.status()).remembered, false); await f.absent();
  await f.noSecrets(); await f.restart(); assert.equal((await f.status()).signedIn, false);
});

test('C245 logout erases remembered offline session and restart never refreshes it', async t => {
  const f = await fixture(t); await f.post('settings', services); await f.login();
  await f.restart(); f.response('offline');
  assert.equal((await f.status()).remembered, true); assert.equal((await f.status()).signedIn, false);
  assert.equal((await f.post('logout')).status, 200); await f.absent();
  assert.equal((await f.status()).remembered, false);
  const requests = f.calls.length; await f.restart(); f.advance(16_000);
  assert.equal((await f.status()).signedIn, false); assert.equal(f.calls.length, requests);
});
