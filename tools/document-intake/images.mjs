// C239: рисунки прикрепляются только к исходным строкам уже загруженного документа.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { apiAddress, authorize, connectApi } from './api.mjs';
import { checkBinding, findReview, getReviewOriginal } from './analysis.mjs';
import { IntakeError, jsonAtomic, lock, openRoot, readJson, sha256, uid } from './store.mjs';

const exec = promisify(execFile);
const extractor = fileURLToPath(new URL('./extract-images.py', import.meta.url));
const idOf = value => value?.id ?? value?._id;
const objectId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const hash = value => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
const fail = message => new IntakeError('QUESTION', message, 'Проверьте рисунки и исходные позиции, затем подготовьте список заново.');
const stale = () => new IntakeError('VERSION', 'Список рисунков или исходные позиции изменились. Подготовьте рисунки ещё раз.');
const skuOf = title => typeof title === 'string' ? title.match(/^\s*([A-ZА-ЯЁ]{1,8}-\d{1,6})(?![\p{L}\p{N}_-])/iu)?.[1].toUpperCase() : null;
const confirmationFile = store => path.join(store.root, '.intake', 'image-confirmation.json');
const journalFile = (store, digest) => path.join(store.documents, `c239-images-${digest}.json`);
const sourceOf = line => ({ id: idOf(line), orderId: String(line.orderId ?? ''), title: line.title, qty: line.qty, sourceLine: line.sourceLine });
const unchanged = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const photoIds = line => [...new Set([...(line.photoIds || []).map(String), ...(line.photos || []).map(idOf)].filter(Boolean))];
const active = order => order && !order.deletedAt && order.stage !== 'cancelled' && !order.archived && !Number(order.activeArchiveVersion);

export async function extractDocumentImages(original, signal) {
  try {
    const { stdout } = await exec('python', [extractor, original], { signal, timeout: 45_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true });
    return JSON.parse(stdout);
  } catch {
    if (signal?.aborted) throw new IntakeError('ABORTED', 'Подготовка рисунков остановлена.');
    throw fail('Не удалось однозначно прочитать рисунки PDF. Для этого оформления нужна отдельная сверка.');
  }
}

function validateImages(extracted) {
  if (extracted?.extractorVersion !== 1 || !Array.isArray(extracted.assets) || !extracted.assets.length || extracted.assets.length > 30
    || !Array.isArray(extracted.rows) || !extracted.rows.length || extracted.rows.length > 200) throw fail('Нет проверяемых рисунков таблицы.');
  let total = 0;
  const assets = new Map();
  for (const asset of extracted.assets) {
    if (!hash(asset?.sha256) || !['png', 'jpeg'].includes(asset.ext) || asset.mime !== `image/${asset.ext}`
      || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 2560 || asset.height > 2560
      || typeof asset.base64 !== 'string' || asset.base64.length > 4_194_304 || !/^[A-Za-z\d+/]*={0,2}$/.test(asset.base64)) throw fail('Формат или размер рисунка не подтверждён.');
    const bytes = Buffer.from(asset.base64, 'base64');
    if (!bytes.length || bytes.length !== asset.sizeBytes || bytes.length > 3 * 1024 * 1024 || sha256(bytes) !== asset.sha256
      || (asset.ext === 'png' ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' : bytes.subarray(0, 3).toString('hex') !== 'ffd8ff')) throw fail('Байты рисунка отличаются от подготовленного источника.');
    total += bytes.length;
    if (assets.has(asset.sha256) || total > 6 * 1024 * 1024) throw fail('Список рисунков превышает допустимый размер.');
    assets.set(asset.sha256, asset);
  }
  const codes = new Set();
  for (const row of extracted.rows) {
    if (!row?.sku || skuOf(row.sku) !== row.sku || codes.has(row.sku) || !assets.has(row.assetSha256)
      || !Number.isInteger(row.page) || row.page < 1 || !Array.isArray(row.bbox) || row.bbox.length !== 4
      || row.bbox.some(value => !Number.isFinite(value))) throw fail('Рисунок не связан с единственной исходной строкой.');
    codes.add(row.sku);
  }
  return extracted;
}

async function contractFor(api, contractId, digest) {
  if (!objectId(contractId)) throw fail('Выберите договор по номеру.');
  const order = await api.get(`/salesorders/${contractId}`);
  if (idOf(order) !== contractId || !active(order)) throw fail('Договор удалён или зафиксирован в архиве. Рисунки не изменены.');
  boundSource(order, digest);
  return order;
}

async function bindingFor(store, draft, options, actor) {
  const journal = await readJson(journalFile(store, draft.hash));
  if (journal && (journal.owner !== actor.id || journal.target !== apiAddress(options.apiBase))) throw stale();
  const selected = options.contractId || journal?.contractId || draft.receipt?.entityId;
  if (journal?.contractId && selected !== journal.contractId && Object.values(journal.assets || {}).some(asset => asset.uploadStarted || asset.photoId)) throw stale();
  return { journal, selected };
}

export function searchImageContracts(options, dependencies = {}) {
  return locked(options, dependencies, async (store, api, actor) => {
    const found = await findReview(store, options.arrivalId);
    checkBinding(found.draft, apiAddress(options.apiBase), actor);
    const query = String(options.search || '').trim();
    if (query.length < 2 || query.length > 80) throw fail('Введите не менее двух символов номера договора.');
    const result = await api.get('/salesorders', { search: query, filter: 'all', limit: 20, page: 1 });
    if (!Array.isArray(result?.items) || result.items.length > 20) throw fail('Сайт не вернул ограниченный список договоров.');
    return { items: result.items.filter(row => objectId(idOf(row))).map(row => ({ id: idOf(row),
      label: `Договор № ${row.orderNo || 'без номера'} · ${row.counterparty?.name || row.counterpartyName || row.clientName || ''}` })), truncated: result.total > 20 };
  });
}

function boundSource(order, digest) {
  const docs = order.legal?.documents?.filter(doc => doc.sourceSha256 === digest) || [];
  if (docs.length !== 1 || !objectId(docs[0].fileId)) throw fail('Не подтверждён оригинал документа в договоре.');
  return { uid: docs[0].uid, fileId: docs[0].fileId, sha256: digest };
}

function proofOf(plan) {
  return sha256(JSON.stringify({ owner: plan.owner, target: plan.target, arrivalId: plan.arrivalId, version: plan.version,
    sourceSha256: plan.sourceSha256, contractId: plan.contractId, legalVersion: plan.legalVersion, source: plan.source,
    assets: plan.assets.map(({ base64, ...asset }) => asset), rows: plan.rows.map(({ existingPhotoId, alreadyAttached, currentPhotoIds, ...row }) => row) }));
}

async function preparePlan(options, store, api, actor, dependencies, inspectPhotos = false) {
  const found = await findReview(store, options.arrivalId);
  checkBinding(found.draft, apiAddress(options.apiBase), actor);
  const original = await getReviewOriginal({ root: store.root, arrivalId: options.arrivalId });
  const digest = sha256(found.bytes);
  if (digest !== found.draft.hash) throw fail('Исходный PDF изменился.');
  const extracted = validateImages(await (dependencies.extract || extractDocumentImages)(original.original, options.signal));
  if (sha256((await findReview(store, options.arrivalId)).bytes) !== digest) throw fail('Исходный PDF изменился во время извлечения рисунков.');
  const { journal, selected } = await bindingFor(store, found.draft, options, actor);
  if (!selected) return { selectionRequired: true };
  const order = await contractFor(api, selected, digest);
  const source = boundSource(order, digest);
  const sourceMeta = await api.get(`/photos/${source.fileId}`);
  if (sourceMeta?.deletedAt || sourceMeta?.sha256 !== digest || sourceMeta?.sourceProtected !== true
    || sourceMeta?.mimeType !== 'application/pdf' || sourceMeta?.sizeBytes !== found.bytes.length) throw fail('Карточка оригинала PDF не подтверждает исходный документ.');
  const lines = order.lines;
  if (!Array.isArray(lines)) throw fail('Не получены исходные позиции договора.');
  const rows = extracted.rows.map(image => {
    const matches = lines.filter(line => !line.deletedAt && !line.cancelledAt && skuOf(line.sourceLine?.title) === image.sku);
    if (matches.length !== 1 || !objectId(idOf(matches[0]))) throw fail(`Код ${image.sku} не определяет единственную исходную позицию договора.`);
    const line = matches[0];
    if (line.orderId && String(line.orderId) !== idOf(order)) throw fail('Позиция относится к другому договору.');
    if (!line.sourceLine?.documentUid || !line.sourceLine.rowKey || !Number.isFinite(line.sourceLine.qty)
      || Number(line.qty) !== line.sourceLine.qty) throw fail('Исходная строка или количество позиции не подтверждены.');
    return { sku: image.sku, page: image.page, bbox: image.bbox, assetSha256: image.assetSha256,
      line: { ...sourceOf(line), orderId: idOf(order) }, currentPhotoIds: photoIds(line) };
  });
  const plan = { owner: actor.id, target: apiAddress(options.apiBase), arrivalId: options.arrivalId, version: found.draft.version,
    sourceSha256: digest, contractId: idOf(order), contractNo: order.orderNo, legalVersion: order.legalVersion ?? 0,
    source, assets: extracted.assets, rows,
    warnings: [...(extracted.warnings?.length ? ['Некоторые изображения без однозначной связи исключены из списка.'] : []),
      'Иллюстрации исходного документа. Разрешение не увеличивается; фотографии каталога не меняются.'] };
  if (inspectPhotos) {
    const photos = await listPhotos(api);
    for (const asset of plan.assets) {
      const filename = imageFilename(plan.sourceSha256, asset);
      const candidates = originals(photos, filename);
      if (candidates.length > 1) throw fail('Найдено несколько оригиналов одного рисунка. Требуется сверка.');
      const existing = idOf(candidates[0]);
      if (existing) await verifyPhoto(api, existing, asset, filename);
      for (const row of rows.filter(item => item.assetSha256 === asset.sha256)) {
        row.existingPhotoId = existing || null;
        row.alreadyAttached = Boolean(existing && row.currentPhotoIds.includes(existing));
      }
    }
  }
  // Привязка хранится под исходным SHA и проверенными владельцем/контуром.
  await jsonAtomic(journalFile(store, digest), { ...(journal || {}), owner: actor.id, target: plan.target, contractId: plan.contractId, assets: journal?.assets || {} });
  plan.proof = proofOf(plan);
  return plan;
}

function preview(plan, confirmationId) {
  return { confirmationId, target: plan.target, contractId: plan.contractId, contractNo: plan.contractNo,
    sourceSha256: plan.sourceSha256, uniqueImages: plan.assets.length, warnings: plan.warnings,
    alreadyAttached: plan.rows.filter(row => row.alreadyAttached).length,
    items: plan.rows.map(row => {
      const asset = plan.assets.find(item => item.sha256 === row.assetSha256);
      return { lineId: row.line.id, title: row.line.sourceLine.title, sku: row.sku, page: row.page,
        width: asset.width, height: asset.height, alreadyAttached: Boolean(row.alreadyAttached),
        preview: `data:${asset.mime};base64,${asset.base64}` };
    }) };
}

async function locked(options, dependencies, work) {
  const store = await openRoot(options.root, { create: false });
  const release = await lock(store.root);
  try {
    const api = (dependencies.connect || connectApi)(options);
    const actor = await authorize(api);
    return await work(store, api, actor);
  } finally { await release(); }
}

export function prepareDocumentImages(options, dependencies = {}) {
  return locked(options, dependencies, async (store, api, actor) => {
    const plan = await preparePlan(options, store, api, actor, dependencies, true);
    if (plan.selectionRequired) return plan;
    const id = uid();
    await jsonAtomic(confirmationFile(store), { id, expiresAt: Date.now() + 15 * 60_000, plan });
    return preview(plan, id);
  });
}

export const imageFilename = (sourceSha256, asset) => `dcimg-${sourceSha256}-${asset.sha256}.${asset.ext}`;
const originals = (photos, filename) => photos.filter(photo => photo.originalFilename === filename && photo.variant === 'original' && !photo.parentPhotoId && !photo.deletedAt);
async function listPhotos(api) {
  const result = await api.get('/photos');
  const photos = Array.isArray(result) ? result : result?.items;
  if (!Array.isArray(photos)) throw fail('Сайт не вернул проверяемый список фотографий.');
  return photos;
}

async function verifyPhoto(api, photoId, asset, filename) {
  if (!objectId(photoId)) throw fail('Не подтверждён идентификатор фотографии.');
  const meta = await api.get(`/photos/${photoId}`);
  if (idOf(meta) !== photoId || meta.deletedAt || meta.parentPhotoId || meta.variant !== 'original'
    || meta.originalFilename !== filename || meta.mimeType !== asset.mime || meta.sizeBytes !== asset.sizeBytes) throw fail('Фотография не подтверждает подготовленный рисунок.');
  const bytes = await api.original(meta.storageUrl, asset.sizeBytes);
  if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) throw fail('Байты фотографии не совпадают с рисунком PDF.');
  return meta;
}

async function verifyLine(api, plan, row) {
  const order = await api.get(`/salesorders/${plan.contractId}`);
  if (!active(order) || Number(order.legalVersion ?? 0) !== plan.legalVersion || !unchanged(boundSource(order, plan.sourceSha256), plan.source)) throw stale();
  const line = await api.get(`/incomes/${row.line.id}`);
  if (line.deletedAt || line.cancelledAt || String(line.orderId ?? '') !== plan.contractId || !unchanged(sourceOf(line), row.line)) throw stale();
  return line;
}

export function sendDocumentImages(options, dependencies = {}) {
  return locked(options, dependencies, async (store, api, actor) => {
    const saved = await readJson(confirmationFile(store));
    if (!saved || saved.id !== options.confirmationId || saved.expiresAt < Date.now()) throw stale();
    const plan = saved.plan;
    if (plan.owner !== actor.id || plan.target !== apiAddress(options.apiBase) || plan.arrivalId !== options.arrivalId) throw stale();
    validateImages({ extractorVersion: 1, assets: plan.assets, rows: plan.rows });
    const current = await preparePlan({ ...options, contractId: plan.contractId }, store, api, actor, dependencies);
    if (proofOf(plan) !== plan.proof || current.proof !== plan.proof) throw stale();
    const file = journalFile(store, plan.sourceSha256);
    let journal = await readJson(file);
    if (journal && (journal.owner !== actor.id || journal.target !== plan.target || journal.contractId !== plan.contractId)) throw stale();
    journal ||= { owner: actor.id, target: plan.target, contractId: plan.contractId, assets: {} };
    const persist = () => jsonAtomic(file, journal);
    const photos = await listPhotos(api);
    let attached = 0;
    let added = 0;
    for (const asset of plan.assets) {
      options.signal?.throwIfAborted();
      const filename = imageFilename(plan.sourceSha256, asset);
      const state = journal.assets[asset.sha256] ||= {};
      const candidates = originals(photos, filename);
      if (candidates.length > 1) throw fail('Найдено несколько оригиналов одного рисунка. Требуется сверка.');
      let photoId = state.photoId || idOf(candidates[0]);
      const assetRows = plan.rows.filter(item => item.assetSha256 === asset.sha256);
      for (const row of assetRows) await verifyLine(api, plan, row);
      if (!photoId) {
        if (state.uploadStarted) throw fail('Исход предыдущей загрузки неизвестен. Повторная загрузка остановлена, чтобы не создать дубль.');
        state.uploadStarted = true;
        await persist();
        const form = new FormData();
        form.set('file', new Blob([Buffer.from(asset.base64, 'base64')], { type: asset.mime }), filename);
        // При потере ответа журнал остаётся uploadStarted: следующий запуск ищет по имени и проверяет байты.
        let uploaded;
        try { uploaded = await api.post('/photos/upload', form); }
        catch (error) {
          // Явный отказ авторизации означает, что обработчик загрузки не выполнялся.
          if (error.code === 'AUTH') { state.uploadStarted = false; await persist(); }
          throw error;
        }
        photoId = idOf(uploaded?.original) || idOf(uploaded);
      }
      await verifyPhoto(api, photoId, asset, filename);
      state.photoId = photoId;
      await persist();
      for (const row of assetRows) {
        const before = await verifyLine(api, plan, row);
        const previous = photoIds(before);
        if (!previous.includes(photoId)) { await api.post(`/incomes/${row.line.id}/photos`, { photoId }); added++; }
        const after = await verifyLine(api, plan, row);
        const ids = photoIds(after);
        if (!ids.includes(photoId) || previous.some(id => !ids.includes(id))) throw fail('Сайт не подтвердил сохранность фотографий позиции.');
        state.attached = [...new Set([...(state.attached || []), row.line.id])];
        await persist();
        attached++;
      }
    }
    return { attached, added, uniqueImages: plan.assets.length, contractId: plan.contractId, contractNo: plan.contractNo };
  });
}
