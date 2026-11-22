import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arrivalsOf, claim, finishArrival, jsonAtomic, openRoot, originalPath, readJson, readOriginal, reconcileArrival, saveArrival, sha256, uid } from './store.mjs';

const original = Buffer.from('%PDF-1.7\nСинтетический оригинал');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intake-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return openRoot(root);
}

function sharingViolation() {
  return Object.assign(new Error('Временная блокировка Windows'), { code: 'EPERM' });
}

test('временная блокировка журнала не теряет прежнюю запись', { skip: process.platform !== 'win32' }, async (t) => {
  const store = await fixture(t);
  const file = path.join(store.documents, 'fixture.json');
  await jsonAtomic(file, { state: 'checked' });
  const rename = fs.rename;
  let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === file && ++attempts === 1) {
      assert.deepEqual(await readJson(file), { state: 'checked' });
      throw sharingViolation();
    }
    await rename(from, to);
  });
  await jsonAtomic(file, { state: 'question' });
  assert.equal(attempts, 2);
  assert.deepEqual(await readJson(file), { state: 'question' });
  assert.deepEqual(await fs.readdir(store.documents), ['fixture.json']);
});

test('постоянная блокировка журнала сохраняет прежнюю запись и возвращает EPERM', { skip: process.platform !== 'win32' }, async (t) => {
  const store = await fixture(t);
  const file = path.join(store.documents, 'fixture.json');
  await jsonAtomic(file, { state: 'checked' });
  const rename = fs.rename;
  t.mock.method(fs, 'rename', (from, to) => {
    if (to === file) throw sharingViolation();
    return rename(from, to);
  });
  await assert.rejects(jsonAtomic(file, { state: 'question' }), { code: 'EPERM' });
  assert.deepEqual(await readJson(file), { state: 'checked' });
  assert.deepEqual(await fs.readdir(store.documents), ['fixture.json']);
});

test('перенос после временного EPERM завершается с одним неизменённым оригиналом', { skip: process.platform !== 'win32' }, async (t) => {
  const store = await fixture(t);
  await fs.writeFile(path.join(store.folders.inbox, 'Документ.pdf'), original);
  const entry = await claim(store, 'Документ.pdf', 0);
  const source = path.join(store.folders.processing, entry.arrivalId);
  const target = path.join(store.folders.question, entry.arrivalId);
  const rename = fs.rename;
  let attempts = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === source && to === target && ++attempts === 1) throw sharingViolation();
    await rename(from, to);
  });
  await finishArrival(store, entry, { state: 'question' });
  assert.equal(attempts, 2);
  const [saved] = await arrivalsOf(store);
  assert.equal(saved.state, 'question');
  assert.deepEqual(await readOriginal(store, saved), original);
  assert.deepEqual(await fs.readdir(store.folders.processing), []);
});

test('повтор переноса распознаёт уже перемещённую папку', { skip: process.platform !== 'win32' }, async (t) => {
  const store = await fixture(t);
  await fs.writeFile(path.join(store.folders.inbox, 'Документ.pdf'), original);
  const entry = await claim(store, 'Документ.pdf', 0);
  const source = path.join(store.folders.processing, entry.arrivalId);
  const target = path.join(store.folders.question, entry.arrivalId);
  const rename = fs.rename;
  let moves = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    await rename(from, to);
    if (from === source && to === target) {
      moves++;
      throw sharingViolation();
    }
  });
  await finishArrival(store, entry, { state: 'question' });
  assert.equal(moves, 1);
  assert.deepEqual(await readOriginal(store, entry), original);
  assert.deepEqual(await fs.readdir(store.folders.processing), []);
});

test('восстановление захвата после перемещения фиксирует хэш без повторного захвата', async (t) => {
  const store = await fixture(t);
  const entry = { arrivalId: uid(), name: 'Документ.pdf', state: 'processing', phase: 'claiming', createdAt: new Date().toISOString() };
  const file = originalPath(store, entry);
  await saveArrival(store, entry);
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, original);
  await reconcileArrival(store, entry);
  const [saved] = await arrivalsOf(store);
  assert.equal(saved.phase, 'claimed');
  assert.equal(saved.hash, sha256(original));
  assert.deepEqual(await readOriginal(store, saved), original);
  assert.deepEqual(await fs.readdir(store.folders.inbox), []);
});
