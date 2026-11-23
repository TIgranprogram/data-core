import path from 'node:path';
import { apiAddress, authorize, checkAutomaticDuplicate, checkOrderAttachment, checkSalesCandidates, connectApi, ensureSalesCustomer, executeIntake, executeOrderAttachment, makeInvoicePayload, proveReviewedInvoice, resolveSalesParties } from './api.mjs';
import { checkBinding, draftFile, findReview, reviewStatus } from './analysis.mjs';
import { IntakeError, jsonAtomic, lock, openRoot, readJson, sha256, uid } from './store.mjs';

const endpoint = '/supply/invoices/intake';
const confirmationFile = store => path.join(store.root, '.intake', 'confirmation.json');
const save = (store, draft) => jsonAtomic(draftFile(store, draft.hash), draft);
const sales = kind => ['contract', 'offer', 'order'].includes(kind);
const salesProof = draft => sha256(JSON.stringify([draft.hash, draft.version, draft.proposal, draft.parties, draft.orderContract, draft.orderReference]));
const stale = () => new IntakeError('VERSION', 'Список документов изменён. Подготовьте его ещё раз.');
function checkInterruption(error, signal) {
  if (signal?.aborted) throw new IntakeError('ABORTED', 'Действие остановлено. Повторите сверку квитанций.');
  if (['AUTH', 'ACTOR', 'CONTOUR', 'API_UNAVAILABLE', 'ABORTED'].includes(error?.code)) throw error;
}
const publicIssue = error => ({ code: error instanceof IntakeError ? error.code : 'DOCUMENT',
  message: error instanceof IntakeError ? error.message : 'Документ требует сверки.', action: error.action || 'Сверьте документ и подготовьте список повторно.' });

async function submit(store, draft, api) {
  const item = draft.submission;
  const result = await api.post(endpoint + '/review', item.input);
  if (result?.draftId !== item.input.draftId || result.revision !== item.input.expectedRevision + 1 || !/^[a-f0-9]{64}$/.test(result.payloadHash)) throw stale();
  item.result = result;
  await save(store, draft);
  return result;
}

export async function withdrawReview(store, draft, api) {
  const item = draft.submission;
  const result = item.result || await submit(store, draft, api);
  if (!item.withdrawId) { item.withdrawId = uid(); await save(store, draft); }
  const revoked = await api.post(endpoint + '/review', { ...item.input, expectedRevision: result.revision, requestId: item.withdrawId, withdraw: true });
  if (revoked?.state !== 'question' || revoked.revision !== result.revision + 1 || revoked.draftId !== result.draftId) throw stale();
  draft.previousReview = { draftId: result.draftId, batchId: item.input.batchId, revision: revoked.revision };
  delete draft.submission;
}

async function reviewed(store, api, draft, entry, bytes) {
  if (bytes.length > 15 * 1024 * 1024) throw new IntakeError('QUESTION', 'PDF превышает 15 МиБ.');
  if (!draft.submission) {
    if (draft.proposal?.revision) throw new IntakeError('QUESTION', 'Редакцию нужно сверить с существующим счётом.');
    const facts = makeInvoicePayload(draft);
    for (const key of ['uid', 'fileId', 'sourceSha256']) delete facts[key];
    const previous = draft.previousReview;
    draft.submission = { localVersion: draft.version, input: {
      draftId: previous?.draftId || entry.arrivalId, batchId: previous?.batchId || entry.batchId, requestId: uid(),
      expectedRevision: previous?.revision || 0, sourceSha256: draft.hash, sourceSize: bytes.length,
      evidenceSummary: sha256(JSON.stringify([draft.version, draft.engine, draft.evidence || draft.raw])),
      facts: { ...facts, supplierInn: draft.proposal.seller.inn, payerInn: draft.proposal.buyer.inn },
    } };
    await save(store, draft);
  }
  const item = draft.submission;
  if (item.localVersion !== draft.version || item.withdrawId) throw stale();
  const result = item.result || await submit(store, draft, api);
  const current = await api.get(endpoint + '/review/' + item.input.draftId, undefined, true);
  if (!current || result.revision !== current.revision || result.payloadHash !== current.payloadHash) throw stale();
  if (current.state === 'question') throw new IntakeError('QUESTION', current.reason || 'Сервер отклонил счёт.');
  return { draftId: result.draftId, revision: result.revision, payloadHash: result.payloadHash };
}

async function recover(store, api, draft, bytes, version) {
  const receipt = await api.get(endpoint + '/c169-' + draft.hash, undefined, true);
  if (!receipt) return false;
  if (receipt.payloadHash !== version.payloadHash) {
    // В другой пачке был свой резерв fileId. Только сервер может подтвердить полный снимок с фактическим fileId.
    const lookup = endpoint + '/review/' + version.draftId;
    const current = await api.get(lookup, undefined, true);
    if (current?.revision !== version.revision || current.payloadHash !== version.payloadHash || current.state === 'question') throw stale();
    if (current.state !== 'committed') {
      await api.post(endpoint + '/prepare', { draftId: version.draftId, revision: version.revision, payloadHash: version.payloadHash });
      const confirmed = await api.get(lookup, undefined, true);
      if (confirmed?.state !== 'committed' || confirmed.revision !== version.revision || confirmed.payloadHash !== version.payloadHash) throw stale();
    }
  }
  await proveReviewedInvoice(api, draft, bytes, receipt);
  draft.state = 'uploaded'; draft.receipt = receipt; draft.issues = []; draft.updatedAt = new Date().toISOString();
  await save(store, draft);
  return true;
}

async function prepareSales(api, draft, bytes) {
  if (bytes.length > 15 * 1024 * 1024) throw new IntakeError('QUESTION', 'PDF превышает 15 МиБ.');
  if (draft.proposal.revision) throw new IntakeError('QUESTION', 'Редакцию нужно сверить с существующей карточкой.');
  const pending = draft.parties?.pendingCustomer;
  const parties = await resolveSalesParties(api, draft.proposal, { allowMissingCustomer: draft.proposal.kind === 'contract' });
  if (parties.companyId !== draft.parties?.companyId
    || (!pending && parties.counterpartyId !== draft.parties?.counterpartyId)
    || (pending && (pending.inn !== draft.proposal.buyer.inn || pending.name !== draft.proposal.buyer.name))) {
    throw new IntakeError('QUESTION', 'Стороны документа изменились в справочнике.');
  }
  const doc = draft.salesDelivery || { uid: 'c169-' + draft.hash, hash: draft.hash, proposal: draft.proposal, parties,
    orderContract: draft.orderContract, orderReference: draft.orderReference };
  if (draft.salesDelivery && (doc.parties.companyId !== parties.companyId
    || (doc.parties.counterpartyId && doc.parties.counterpartyId !== parties.counterpartyId))) {
    throw new IntakeError('QUESTION', 'Сохранённый заказчик договора изменился или недоступен.');
  }
  if (doc.proposal.kind === 'order') await checkOrderAttachment(api, doc);
  else await checkSalesCandidates(api, doc);
  return doc;
}

async function sendSales(store, api, draft, item, found) {
  if (item.kind !== draft.proposal?.kind || draft.hash !== item.hash || draft.version !== item.localVersion || salesProof(draft) !== item.payloadHash) throw stale();
  if (draft.state !== 'uploaded' && !(Date.parse(item.expiresAt) > Date.now())) throw stale();
  const doc = await prepareSales(api, draft, found.bytes);
  if (!doc.complete) {
    draft.salesDelivery = doc;
    draft.sendStarted = true;
    draft.state = 'sending';
    await save(store, draft);
  }
  if (doc.parties.pendingCustomer) {
    const counterpartyId = await ensureSalesCustomer(api, doc.parties.pendingCustomer);
    doc.parties = { companyId: doc.parties.companyId, counterpartyId };
    // Подтверждённый draft/proof остаётся неизменным; фактический ID живёт в журнале отправки.
    await save(store, draft);
  }
  // Оригинал и строки используют устойчивые ключи записи. При обрыве продолжаем с локальных квитанций.
  const execute = item.kind === 'order' ? executeOrderAttachment : executeIntake;
  await execute({ api, doc, bytes: found.bytes, name: found.entry.name, save: () => save(store, draft) });
  draft.receipt = { kind: item.kind, entityId: doc.entityId, fileId: doc.fileId };
  draft.state = 'uploaded';
  draft.issues = [];
  draft.updatedAt = new Date().toISOString();
  await save(store, draft);
}

async function lockedBatch(options, dependencies, work) {
  const store = await openRoot(options.root);
  const release = await lock(store.root);
  try {
    const api = (dependencies.connect || connectApi)(options);
    const actor = await authorize(api);
    return await work(store, api, actor, apiAddress(options.apiBase));
  } finally { await release(); }
}

export function prepareBatch(options, dependencies = {}) {
  return lockedBatch(options, dependencies, async (store, api, actor, target) => {
    const confirmation = { id: uid(), target, owner: actor.id, items: [] };
    await jsonAtomic(confirmationFile(store), confirmation);
    const report = await reviewStatus({ root: options.root, owner: actor.id, target });
    const seen = new Set(), problems = [];
    for (const row of report.items) {
      checkInterruption(null, options.signal);
      if (!['checked', 'sending'].includes(row.state) || seen.has(row.hash)) continue;
      seen.add(row.hash);
      let draft;
      try {
        const found = await findReview(store, row.arrivalId);
        draft = found.draft;
        checkBinding(draft, target, actor);
        if (options.automatic && !draft.autoDispatch) continue;
        const kind = draft.proposal?.kind;
        if (options.automatic && !draft.submission && !draft.sendStarted && await checkAutomaticDuplicate(api, { ...draft, bytes: found.bytes })) {
          draft.state = 'existing';
          draft.issues = [];
          draft.updatedAt = new Date().toISOString();
          await save(store, draft);
          continue;
        }
        if (sales(kind)) {
          await prepareSales(api, draft, found.bytes);
          confirmation.items.push({ arrivalId: row.arrivalId, name: row.name, hash: row.hash, localVersion: draft.version,
            kind, reference: draft.orderReference, payloadHash: salesProof(draft), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
          continue;
        }
        const version = await reviewed(store, api, draft, found.entry, found.bytes);
        if (await recover(store, api, draft, found.bytes, version)) continue;
        const prepared = await api.post(endpoint + '/prepare', version);
        if (prepared.draftId !== version.draftId || prepared.revision !== version.revision || prepared.payloadHash !== version.payloadHash
          || !/^[a-f0-9]{64}$/.test(prepared.ticket) || !(Date.parse(prepared.expiresAt) > Date.now())) throw stale();
        confirmation.items.push({ arrivalId: row.arrivalId, name: row.name, hash: row.hash, localVersion: draft.version, kind, ...prepared });
      } catch (error) {
        checkInterruption(error, options.signal);
        const issue = publicIssue(error);
        problems.push({ name: row.name, message: issue.message });
        if (draft?.sendStarted && draft.submission?.input) {
          const current = await api.get(endpoint + '/review/' + draft.submission.input.draftId, undefined, true);
          if (current?.state === 'question') draft.sendStarted = false;
        }
        if (draft && !draft.sendStarted) { draft.state = 'question'; draft.issues = [issue]; await save(store, draft); }
      }
    }
    await jsonAtomic(confirmationFile(store), confirmation);
    return { id: confirmation.id, target, items: confirmation.items.map(({ name, localVersion, kind, reference }) => ({ name, version: localVersion, kind, ...(reference ? { reference } : {}) })), problems };
  });
}

export function sendBatch(options, dependencies = {}) {
  return lockedBatch(options, dependencies, async (store, api, actor, target) => {
    const confirmation = await readJson(confirmationFile(store));
    if (!confirmation?.items.length || confirmation.id !== options.confirmationId || confirmation.owner !== actor.id || confirmation.target !== target) throw stale();
    const problems = [];
    let uploaded = 0;
    for (const item of confirmation.items) {
      checkInterruption(null, options.signal);
      let draft;
      try {
        const found = await findReview(store, item.arrivalId);
        draft = found.draft;
        checkBinding(draft, target, actor);
        if (sales(item.kind)) { await sendSales(store, api, draft, item, found); uploaded++; continue; }
        if (draft.hash !== item.hash || draft.version !== item.localVersion || draft.submission?.result?.payloadHash !== item.payloadHash
          || draft.submission.withdrawId) throw stale();
        if (await recover(store, api, draft, found.bytes, item)) { uploaded++; continue; }
        if (draft.receipt || draft.state === 'uploaded') throw new IntakeError('QUESTION', 'Ранее полученная квитанция исчезла.');
        const current = await api.get(endpoint + '/review/' + item.draftId, undefined, true);
        if (current?.payloadHash !== item.payloadHash || current.revision !== item.revision || !['validated','committing'].includes(current.state)
          || !(Date.parse(item.expiresAt) > Date.now())) throw stale();
        draft.sendStarted = true; draft.state = 'sending'; await save(store, draft);
        const form = new FormData();
        form.set('file', new Blob([found.bytes], { type: 'application/pdf' }), 'original.pdf');
        await api.commitReviewed(item.draftId, item.ticket, form);
        if (!await recover(store, api, draft, found.bytes, item)) throw new IntakeError('API_UNAVAILABLE', 'Сайт ещё не подтвердил квитанцию. Подготовьте список для повторной сверки.');
        uploaded++;
      } catch (error) {
        checkInterruption(error, options.signal);
        const issue = publicIssue(error);
        problems.push({ name: item.name, message: issue.message });
        if (draft && draft.version === item.localVersion) {
          draft.issues = [issue];
          if (draft.sendStarted && !sales(item.kind)) {
            const current = await api.get(endpoint + '/review/' + item.draftId, undefined, true);
            if (current?.state === 'question') { draft.state = 'question'; draft.sendStarted = false; }
          }
          await save(store, draft);
        }
      }
    }
    return { uploaded, problems };
  });
}
