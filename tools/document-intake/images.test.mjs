import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareDocumentImages, sendDocumentImages, imageFilename, extractDocumentImages, searchImageContracts } from './images.mjs';
import { IntakeError, openRoot, sha256, uid } from './store.mjs';
import { draftFile } from './analysis.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDqkAAAAASUVORK5CYII=', 'base64');
const actorId = '111111111111111111111111';
const contractId = '222222222222222222222222';
const originalId = '333333333333333333333333';
const oldPhoto = '444444444444444444444444';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c239-images-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await openRoot(root);
  const arrivalId = uid();
  const bytes = Buffer.from('%PDF-1.4\nОбезличенный оригинал C239');
  const digest = sha256(bytes);
  const folder = path.join(store.folders.question, arrivalId);
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'КП.pdf'), bytes);
  const entry = { arrivalId, workflow: 'c171', state: 'question', name: 'КП.pdf', hash: digest, createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(store.arrivals, arrivalId + '.json'), JSON.stringify(entry));
  const draft = { workflow: 'c171', owner: actorId, target: 'http://127.0.0.1:3102/api', version: 1, hash: digest, issues: [] };
  await fs.writeFile(draftFile(store, digest), JSON.stringify(draft));
  const asset = { sha256: sha256(png), sizeBytes: png.length, mime: 'image/png', ext: 'png', width: 1, height: 1, base64: png.toString('base64') };
  const extracted = { extractorVersion: 1, assets: [asset], rows: ['AA-001', 'AA-002'].map((sku, i) => ({ sku, page: 1, bbox: [100, 20 + i * 20, 110, 30 + i * 20], assetSha256: asset.sha256 })), warnings: [] };
  const lines = ['AA-001', 'AA-002'].map((sku, i) => ({ id: String(5 + i).repeat(24), orderId: contractId,
    title: sku + ' Скамья', qty: 1, photoIds: i ? [] : [oldPhoto],
    sourceLine: { documentUid: 'contract-17', rowKey: String(i + 1), title: sku + ' Скамья', qty: 1, unit: 'шт', unitPrice: 100, lineAmount: 100 } }));
  const order = { id: contractId, orderNo: '17', legalVersion: 1, legal: { documents: [{ uid: 'offer-17', fileId: originalId, sourceSha256: digest }] }, lines };
  const photos = [];
  const calls = [];
  let failure = null;
  let downloaded = png;
  const api = {
    async get(endpoint) {
      calls.push(['GET', endpoint]);
      if (endpoint === '/auth/me') return { id: actorId, canMoney: true, role: 'manager' };
      if (endpoint === '/salesorders') return { items: [structuredClone(order)], total: 1 };
      if (endpoint === '/salesorders/' + contractId) return structuredClone(order);
      if (endpoint === '/photos/' + originalId) return { id: originalId, sourceProtected: true, mimeType: 'application/pdf', sha256: digest, sizeBytes: bytes.length };
      if (endpoint === '/photos') return structuredClone(photos);
      if (endpoint.startsWith('/photos/')) return structuredClone(photos.find(item => item.id === endpoint.split('/').at(-1)));
      if (endpoint.startsWith('/incomes/')) return structuredClone(lines.find(item => item.id === endpoint.split('/')[2]));
      throw Error('Неожиданный GET ' + endpoint);
    },
    async original() { calls.push(['BYTES']); return downloaded; },
    async post(endpoint, body) {
      calls.push(['POST', endpoint]);
      if (endpoint === '/photos/upload') {
        if (failure === 'auth') throw new IntakeError('AUTH', 'Вход');
        if (failure === 'empty') throw new IntakeError('API_UNAVAILABLE', 'Связь');
        const file = body.get('file');
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
        const photo = { id: '777777777777777777777777', variant: 'original', originalFilename: file.name,
          mimeType: file.type, sizeBytes: file.size, storageUrl: '/uploads/c239.png' };
        photos.push(photo);
        if (failure === 'created') { failure = null; throw new IntakeError('API_UNAVAILABLE', 'Ответ потерян'); }
        return structuredClone(photo);
      }
      const line = lines.find(item => endpoint === `/incomes/${item.id}/photos`);
      assert.ok(line, 'Только добавление фото позиции');
      if (!line.photoIds.includes(body.photoId)) line.photoIds.push(body.photoId);
      if (failure === 'attach') { failure = null; throw new IntakeError('API_UNAVAILABLE', 'Ответ потерян'); }
      return structuredClone(line);
    },
  };
  return { store, draft, digest, lines, order, photos, calls, asset, extracted, actorId, api,
    options: { root, arrivalId, contractId, apiBase: 'http://127.0.0.1:3102/api', token: 'test' },
    dependencies: { connect: () => api, extract: async () => structuredClone(extracted) },
    failure: value => { failure = value; }, downloaded: value => { downloaded = value; },
    saveDraft: () => fs.writeFile(draftFile(store, digest), JSON.stringify(draft)) };
}

test('предпросмотр без POST; общий рисунок двух строк, повтор без загрузки и сохранение старого фото', async t => {
  const box = await fixture(t);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  assert.equal(prepared.uniqueImages, 1); assert.equal(prepared.items.length, 2); assert.equal(prepared.alreadyAttached, 0);
  assert.equal(box.calls.filter(call => call[0] === 'POST').length, 0);
  const sent = await sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies);
  assert.equal(sent.added, 2); assert.equal(sent.attached, 2);
  assert.deepEqual(box.lines[0].photoIds, [oldPhoto, box.photos[0].id]);
  assert.equal(box.calls.filter(call => call[1] === '/photos/upload').length, 1);
  const before = box.calls.filter(call => call[0] === 'POST').length;
  const repeated = await prepareDocumentImages(box.options, box.dependencies);
  assert.equal(repeated.alreadyAttached, 2);
  assert.ok(repeated.items.every(item => item.alreadyAttached));
  assert.equal((await sendDocumentImages({ ...box.options, confirmationId: repeated.confirmationId }, box.dependencies)).added, 0);
  assert.equal(box.calls.filter(call => call[0] === 'POST').length, before);
});

test('после потери ответа upload существующий original находится по имени и байтам; variants не дубли', async t => {
  const box = await fixture(t);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  box.failure('created');
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies), { code: 'API_UNAVAILABLE' });
  box.photos.push({ ...box.photos[0], id: '888888888888888888888888', variant: 'thumb', parentPhotoId: box.photos[0].id });
  const sent = await sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies);
  assert.equal(sent.attached, 2);
  assert.equal(box.calls.filter(call => call[1] === '/photos/upload').length, 1);
});

test('неизвестный upload без найденного original останавливает повтор, AUTH не маскируется', async t => {
  const box = await fixture(t);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  box.failure('empty');
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies), { code: 'API_UNAVAILABLE' });
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies), /неизвестен/);
  assert.equal(box.calls.filter(call => call[1] === '/photos/upload').length, 1);
  const second = await fixture(t);
  const plan = await prepareDocumentImages(second.options, second.dependencies);
  second.failure('auth');
  await assert.rejects(sendDocumentImages({ ...second.options, confirmationId: plan.confirmationId }, second.dependencies), { code: 'AUTH' });
});

test('потеря ответа attach восстанавливается без повторного upload и без дублей связей', async t => {
  const box = await fixture(t);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  box.failure('attach');
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies), { code: 'API_UNAVAILABLE' });
  assert.equal((await sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies)).attached, 2);
  assert.equal(box.calls.filter(call => call[1] === '/photos/upload').length, 1);
  assert.equal(box.lines[0].photoIds.filter(id => id === box.photos[0].id).length, 1);
});

for (const change of ['actor', 'target', 'source', 'archive', 'line', 'asset']) test(`защита изменённого контекста: ${change}`, async t => {
  const box = await fixture(t);
  const prepared = await prepareDocumentImages(box.options, box.dependencies);
  if (change === 'actor') { box.draft.owner = '999999999999999999999999'; await box.saveDraft(); }
  if (change === 'target') box.options.apiBase = 'http://127.0.0.1:3001/api';
  if (change === 'source') box.order.legal.documents[0].sourceSha256 = 'a'.repeat(64);
  if (change === 'archive') box.order.activeArchiveVersion = 1;
  if (change === 'line') box.lines[0].sourceLine.qty = 3;
  if (change === 'asset') box.extracted.assets[0].base64 = Buffer.from('wrong').toString('base64');
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: prepared.confirmationId }, box.dependencies));
  assert.equal(box.calls.filter(call => call[0] === 'POST').length, 0);
});

test('два original или подложные байты не выбираются по первому совпадению', async t => {
  const box = await fixture(t);
  const photo = { id: '777777777777777777777777', variant: 'original', originalFilename: imageFilename(box.digest, box.asset),
    mimeType: box.asset.mime, sizeBytes: png.length, storageUrl: '/uploads/c239.png' };
  box.photos.push(photo, { ...photo, id: '888888888888888888888888' });
  await assert.rejects(prepareDocumentImages(box.options, box.dependencies), /несколько оригиналов/);
  box.photos.pop(); box.downloaded(Buffer.from('wrong'));
  await assert.rejects(prepareDocumentImages(box.options, box.dependencies), /Байты фотографии/);
  assert.equal(box.calls.filter(call => call[0] === 'POST').length, 0);
});

test('артикул с кириллическим суффиксом не принимается за базовую модель', async t => {
  const box = await fixture(t);
  box.lines[0].sourceLine.title = 'AA-001А Другая модификация';
  await assert.rejects(prepareDocumentImages(box.options, box.dependencies), /единственную исходную позицию/);
  assert.equal(box.calls.filter(call => call[0] === 'POST').length, 0);
});

test('реальный PDF-extractor связывает рисунки геометрией SKU, не порядком; логотип исключён', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c239-extractor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'source.pdf');
  const image = path.join(root, 'source.png');
  await fs.writeFile(image, png);
  await promisify(execFile)('python', ['-c', [
    'import pymupdf,sys', 'd=pymupdf.open();p=d.new_page()',
    'p.insert_text((30,60),"1 AA-001 Bench")', 'p.insert_text((30,160),"2 AA-002 Table")',
    'p.insert_image(pymupdf.Rect(300,145,340,175),filename=sys.argv[2])',
    'p.insert_image(pymupdf.Rect(300,45,340,75),filename=sys.argv[2])',
    'p.insert_image(pymupdf.Rect(10,250,40,280),filename=sys.argv[2])', 'd.save(sys.argv[1])',
  ].join('\n'), filename, image], { windowsHide: true, timeout: 15000 });
  const result = await extractDocumentImages(filename);
  assert.deepEqual(result.rows.map(row => row.sku), ['AA-002', 'AA-001']);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].width, 1);
  assert.equal(result.warnings.length, 1);
});


test('поиск ограничен 20 заголовками; подготовка читает только выбранную карточку без N+1', async t => {
  const box = await fixture(t);
  const get = box.api.get;
  box.api.get = async (endpoint, query) => {
    if (endpoint === '/salesorders') {
      box.calls.push(['GET', endpoint]);
      assert.equal(query.limit, 20); assert.equal(query.search, '17');
      return { items: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 100).padStart(24, '0'), orderNo: String(i) })), total: 100 };
    }
    return get(endpoint, query);
  };
  const noSelection = await prepareDocumentImages({ ...box.options, contractId: undefined }, box.dependencies);
  assert.equal(noSelection.selectionRequired, true);
  assert.equal(box.calls.filter(call => call[1]?.startsWith('/salesorders')).length, 0);
  const found = await searchImageContracts({ ...box.options, search: '17' }, box.dependencies);
  assert.equal(found.items.length, 20); assert.equal(found.truncated, true);
  await prepareDocumentImages(box.options, box.dependencies);
  assert.equal(box.calls.filter(call => call[1] === '/salesorders/' + contractId).length, 1);
  assert.equal(box.calls.filter(call => call[1] === '/salesorders').length, 1);
});

test('после начала upload смена выбранного договора запрещена', async t => {
  const box = await fixture(t);
  const plan = await prepareDocumentImages(box.options, box.dependencies);
  box.failure('empty');
  await assert.rejects(sendDocumentImages({ ...box.options, confirmationId: plan.confirmationId }, box.dependencies));
  await assert.rejects(prepareDocumentImages({ ...box.options, contractId: '999999999999999999999999' }, box.dependencies), { code: 'VERSION' });
});


test('inline 3000×1 отклоняется по метаданным до digest и extract_image', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c239-inline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = `import importlib.util, pathlib, sys, pymupdf
spec = importlib.util.spec_from_file_location("extractor", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
doc = pymupdf.open(); page = doc.new_page()
xref = doc.get_new_xref(); doc.update_object(xref, "<<>>")
doc.update_stream(xref, b"q 100 0 0 10 10 10 cm BI /W 3000 /H 1 /CS /RGB /BPC 8 ID " + b"\\x00" * 9000 + b" EI Q")
page.set_contents(xref); filename = pathlib.Path(sys.argv[2]) / "inline.pdf"; doc.save(filename); doc.close()
original = pymupdf.Page.get_image_info
calls = []
def guarded(self, hashes=False, xrefs=False):
    calls.append((hashes, xrefs))
    assert not hashes and not xrefs, "digest вызван до проверки размеров"
    result = original(self, hashes=False, xrefs=False)
    assert result[0]["width"] == 3000 and result[0]["height"] == 1
    return result
pymupdf.Page.get_image_info = guarded
pymupdf.Document.extract_image = lambda *args: (_ for _ in ()).throw(AssertionError("extract_image вызван"))
try:
    module.extract(str(filename))
    raise AssertionError("inline не отклонён")
except ValueError:
    assert calls == [(False, False)]
print("PASS")`;
  const result = await promisify(execFile)('python', ['-c', script, path.resolve('tools/document-intake/extract-images.py'), root], { timeout: 10000, windowsHide: true });
  assert.match(result.stdout, /PASS/);
});
