import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { prepareDocumentImages, searchImageContracts, sendDocumentImages } from './images.mjs';
import { draftFile } from './analysis.mjs';
import { IntakeError, openRoot, sha256, uid } from './store.mjs';

const actor = '111111111111111111111111';
const contractId = '222222222222222222222222';
const originalId = '333333333333333333333333';
const oldPhoto = '444444444444444444444444';
const addedByUser = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id = value => value.toString(16).padStart(24, '0');

function image(index) {
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); payload.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, index * 31, 200 - index * 15, 120 + index * 10]))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t, failAttach = 0) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'datacore-c239-qa-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('datacore-c239-qa-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = await openRoot(root), arrivalId = uid();
  const bytes = Buffer.from('%PDF-1.4\nQA C239 8 рисунков / 9 позиций'), digest = sha256(bytes);
  const folder = path.join(store.folders.question, arrivalId);
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'QA.pdf'), bytes);
  await fs.writeFile(path.join(store.arrivals, arrivalId + '.json'), JSON.stringify({
    arrivalId, workflow: 'c171', state: 'question', name: 'QA.pdf', hash: digest, createdAt: new Date().toISOString(),
  }));
  const apiBase = 'http://127.0.0.1:3102/api';
  await fs.writeFile(draftFile(store, digest), JSON.stringify({ workflow: 'c171', owner: actor, target: apiBase, version: 1, hash: digest, issues: [] }));
  const assetBytes = Array.from({ length: 8 }, (_, index) => image(index));
  const assets = assetBytes.map(buffer => ({ sha256: sha256(buffer), sizeBytes: buffer.length, mime: 'image/png', ext: 'png', width: 1, height: 1, base64: buffer.toString('base64') }));
  const rows = Array.from({ length: 9 }, (_, index) => ({ sku: `QA-${String(index + 1).padStart(3, '0')}`, page: 1,
    bbox: [100, index * 20 + 10, 110, index * 20 + 20], assetSha256: assets[Math.min(index, 7)].sha256 }));
  const lines = rows.map((row, index) => ({ id: id(100 + index), orderId: contractId, title: row.sku + ' Скамья', qty: 1,
    photoIds: index === 0 ? [oldPhoto] : [], sourceLine: { documentUid: 'contract-qa', rowKey: String(index + 1),
      title: row.sku + ' Скамья', qty: 1, unit: 'шт', unitPrice: 100, lineAmount: 100 } }));
  const order = { id: contractId, orderNo: 'QA-17', legalVersion: 1,
    legal: { documents: [{ uid: 'offer-qa', fileId: originalId, sourceSha256: digest }] }, lines };
  const photos = [], calls = [], stored = new Map();
  let attachCalls = 0;
  const api = {
    async get(endpoint) {
      calls.push({ method: 'GET', endpoint });
      if (endpoint === '/auth/me') return { id: actor, role: 'manager', canMoney: true };
      if (endpoint === '/salesorders') return { items: [structuredClone(order)], total: 1 };
      if (endpoint === '/salesorders/' + contractId) return structuredClone(order);
      if (endpoint === '/photos/' + originalId) return { id: originalId, sourceProtected: true, mimeType: 'application/pdf', sha256: digest, sizeBytes: bytes.length };
      if (endpoint === '/photos') return structuredClone(photos);
      if (endpoint.startsWith('/photos/')) return structuredClone(photos.find(photo => photo.id === endpoint.split('/').at(-1)));
      if (endpoint.startsWith('/incomes/')) return structuredClone(lines.find(line => line.id === endpoint.split('/')[2]));
      assert.fail('Неожиданный GET ' + endpoint);
    },
    async original(url) { return stored.get(url); },
    async post(endpoint, body) {
      calls.push({ method: 'POST', endpoint });
      if (endpoint === '/photos/upload') {
        const file = body.get('file'), buffer = Buffer.from(await file.arrayBuffer());
        assert.ok(assetBytes.some(source => source.equals(buffer)));
        const photo = { id: id(1000 + photos.length), variant: 'original', originalFilename: file.name,
          mimeType: file.type, sizeBytes: file.size, storageUrl: `/uploads/qa-${photos.length}.png` };
        photos.push(photo); stored.set(photo.storageUrl, buffer);
        return structuredClone(photo);
      }
      const line = lines.find(item => endpoint === `/incomes/${item.id}/photos`);
      assert.ok(line, 'Разрешены только фотографии существующих позиций');
      if (!line.photoIds.includes(body.photoId)) line.photoIds.push(body.photoId);
      if (++attachCalls === failAttach) { failAttach = 0; throw new IntakeError('API_UNAVAILABLE', 'Ответ пятой привязки потерян'); }
      return structuredClone(line);
    },
  };
  const options = { root, arrivalId, apiBase, contractId, token: 'fixture' };
  const dependencies = { connect: () => api, extract: async () => ({ extractorVersion: 1, assets, rows, warnings: [] }) };
  return { options, dependencies, api, lines, photos, calls, bytes, folder };
}

test('QA C239: 8 уникальных рисунков дают 9 связей; добавленное после preview фото и оригинал сохраняются', async t => {
  const box = await fixture(t);
  const before = JSON.stringify(box.lines.map(({ photoIds, ...line }) => line));
  const plan = await prepareDocumentImages(box.options, box.dependencies);
  assert.equal(plan.uniqueImages, 8); assert.equal(plan.items.length, 9);
  assert.equal(box.calls.filter(call => call.method === 'POST').length, 0);
  box.lines[0].photoIds.push(addedByUser);
  const sent = await sendDocumentImages({ ...box.options, confirmationId: plan.confirmationId }, box.dependencies);
  assert.deepEqual({ attached: sent.attached, added: sent.added, unique: sent.uniqueImages }, { attached: 9, added: 9, unique: 8 });
  assert.equal(box.calls.filter(call => call.endpoint === '/photos/upload').length, 8);
  assert.equal(box.photos.length, 8);
  assert.equal(box.lines[7].photoIds[0], box.lines[8].photoIds[0]);
  assert.ok(box.lines[0].photoIds.includes(oldPhoto)); assert.ok(box.lines[0].photoIds.includes(addedByUser));
  assert.equal(JSON.stringify(box.lines.map(({ photoIds, ...line }) => line)), before);
  assert.deepEqual(await fs.readFile(path.join(box.folder, 'QA.pdf')), box.bytes);
  assert.equal(box.calls.filter(call => call.method === 'GET' && call.endpoint === '/photos').length, 2);
  const writes = box.calls.filter(call => call.method === 'POST').length;
  const repeat = await sendDocumentImages({ ...box.options, confirmationId: plan.confirmationId }, box.dependencies);
  assert.equal(repeat.attached, 9); assert.equal(repeat.added, 0);
  assert.equal(box.calls.filter(call => call.method === 'POST').length, writes);
});

test('QA C239: потеря ответа на пятой из 9 связей не дублирует 8 оригиналов при возобновлении', async t => {
  const box = await fixture(t, 5);
  const plan = await prepareDocumentImages(box.options, box.dependencies);
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: plan.confirmationId }, box.dependencies), { code: 'API_UNAVAILABLE' });
  const sent = await sendDocumentImages({ ...box.options, confirmationId: plan.confirmationId }, box.dependencies);
  assert.equal(sent.attached, 9); assert.equal(sent.added, 4);
  assert.equal(box.calls.filter(call => call.endpoint === '/photos/upload').length, 8);
  assert.equal(box.calls.filter(call => call.method === 'POST' && call.endpoint.startsWith('/incomes/')).length, 9);
  assert.ok(box.lines.every(line => new Set(line.photoIds).size === line.photoIds.length));
  assert.equal(box.lines[7].photoIds[0], box.lines[8].photoIds[0]);
});

test('QA C239: без выбора нет POST/N+1; 100 заголовков вместо лимита 20 отклоняются до чтения деталей', async t => {
  const box = await fixture(t);
  const unbound = { ...box.options, contractId: undefined };
  const selection = await prepareDocumentImages(unbound, box.dependencies);
  assert.equal(selection.selectionRequired, true);
  assert.equal(box.calls.filter(call => call.endpoint.startsWith('/salesorders')).length, 0);
  assert.equal(box.calls.filter(call => call.method === 'POST').length, 0);
  const get = box.api.get;
  box.api.get = async (endpoint, query) => {
    if (endpoint !== '/salesorders') return get(endpoint, query);
    box.calls.push({ method: 'GET', endpoint });
    assert.equal(query.limit, 20);
    return { items: Array.from({ length: 100 }, (_, index) => ({ id: id(5000 + index), orderNo: String(index) })), total: 100 };
  };
  await assert.rejects(searchImageContracts({ ...unbound, search: 'QA-17' }, box.dependencies), /ограниченный список/u);
  assert.equal(box.calls.filter(call => call.endpoint.startsWith('/salesorders/')).length, 0);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  assert.equal(prepared.items.length, 9);
  assert.equal(box.calls.filter(call => call.endpoint === '/salesorders').length, 1);
  assert.equal(box.calls.filter(call => call.endpoint === '/salesorders/' + contractId).length, 1);
  assert.equal(box.calls.filter(call => call.method === 'POST').length, 0);
});
