// C171: локальная проверка не имеет средств записи в DataCore.
import path from 'node:path';
import {
  IntakeError, MAX_BYTES, arrivalsOf, claim, exists, finishArrival, inboxFiles, jsonAtomic, lock,
  openRoot, readJson, readOriginal, reconcileArrival, reconcileRetry, saveArrival, sha256, startRetry, uid,
} from './store.mjs';
import { apiAddress, authorize, connectApi, decideInvoice, findOrderContract, lookupParty, resolveSalesParties } from './api.mjs';
import { checkPages, confirmParties, EXTRACTOR_VERSION, extractDocument, extractPartyColumns, evidencedKind, propose, referencedContract, RULES_VERSION, validateProposal, verifyCitations } from './proposal.mjs';

const interrupted = new Set(['AUTH', 'ACTOR', 'CONTOUR', 'API_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'EXTRACTOR', 'ABORTED']);
export const draftFile = (store, hash) => path.join(store.documents, `c171-${hash}.json`);
const problem = (code, message, action) => ({ code, message, action });
const abort = signal => { if (signal?.aborted) throw new IntakeError('ABORTED', 'Проверка остановлена.', 'Нажмите «Возобновить».'); };

function readOnly(api) {
  // Даже подмена извлечения/модели не получает сетевой клиент с POST.
  return Object.freeze({ get: api.get.bind(api) });
}

export function checkBinding(draft, target, actor) {
  if (draft.target !== target) throw new IntakeError('CONTOUR', 'Черновик относится к другому контуру.', 'Верните прежний адрес DataCore.');
  if (draft.owner !== actor.id) throw new IntakeError('ACTOR', 'Черновик создан другой учётной записью.', 'Войдите под прежней учётной записью.');
}

export async function findReview(store, arrivalId) {
  const entry = (await arrivalsOf(store)).find(row => row.arrivalId === arrivalId && row.workflow === 'c171');
  if (!entry?.hash || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new IntakeError('SELECTION', 'Черновик не найден.');
  const destination = entry.pending?.state;
  const moved = destination && await exists(path.join(store.folders[destination], entry.arrivalId));
  const bytes = await readOriginal(store, entry, MAX_BYTES, moved ? destination : entry.state);
  if (sha256(bytes) !== entry.hash) throw new IntakeError('ORIGINAL', 'Оригинал изменён.', 'Восстановите неизменённый исходный файл.');
  const draft = await readJson(draftFile(store, entry.hash));
  if (!draft || draft.hash !== entry.hash || draft.workflow !== 'c171') throw new IntakeError('JOURNAL', 'Черновик не соответствует оригиналу.');
  return { entry, draft, bytes };
}

async function validate(draft, api, loadColumns) {
  draft.engine.rules = RULES_VERSION;
  draft.proposal = null;
  draft.parties = null;
  draft.issues = [];
  draft.kind = null;
  draft.orderContract = null;
  draft.orderReference = null;
  delete draft.evidence;
  try {
    checkPages(draft.pages);
    draft.kind = evidencedKind(draft.raw, draft.pages);
    if (draft.kind === 'acceptance') {
      throw new IntakeError('QUESTION', 'Акт нужно привязать к договору.', 'Найдите договор заказчика по реквизитам оригинала и добавьте PDF в комплект документов.');
    }
    const reference = draft.kind === 'order' ? referencedContract(draft.pages) : null;
    let evidence = verifyCitations(draft.raw, draft.pages);
    let sides = confirmParties(evidence, draft.pages);
    if (draft.kind === 'contract' && sides.some(side => side.issue)) {
      if (!draft.partyColumns && loadColumns) draft.partyColumns = await loadColumns();
      if (draft.partyColumns?.length) {
        evidence = verifyCitations(draft.raw, draft.pages, draft.partyColumns);
        sides = confirmParties(evidence, draft.pages, draft.partyColumns);
      }
    }
    if (evidence !== draft.raw) draft.evidence = evidence;

    let proposal;
    try { proposal = validateProposal(evidence, draft.pages, draft.kind === 'contract' ? draft.partyColumns : []); }
    catch (error) {
      if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
      if (!sides.some(side => side.issue?.message === error.message)) {
        draft.issues.push(problem(error.code, error.message, error.action));
      }
    }
    if (!proposal) {
      const invoice = ['supplier_invoice', 'customer_invoice'].includes(draft.kind);
      const labels = invoice ? { seller: 'Поставщик', buyer: 'Плательщик' } : { seller: 'Исполнитель', buyer: 'Заказчик' };
      draft.state = 'question';
      for (const { key, party, issue } of sides) {
        if (issue) {
          draft.issues.push(problem(issue.code, issue.message, issue.action));
          continue;
        }
        try { await lookupParty(api, party, labels[key]); }
        catch (error) {
          if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
          draft.issues.push(problem(error.code, error.message, error.action));
        }
      }
      return;
    }
    if (['contract', 'offer', 'order'].includes(proposal.kind)) {
      if (proposal.revision) throw new IntakeError('QUESTION', 'В документе указана редакция.', 'Сверьте редакцию в карточке существующего документа.');
      draft.parties = await resolveSalesParties(api, proposal);
      if (reference) {
        draft.orderReference = reference;
        const contract = await findOrderContract(api, reference, draft.parties, proposal);
        draft.orderContract = contract.id ?? contract._id;
      }
      draft.proposal = proposal;
    } else {
      const result = await decideInvoice(api, proposal);
      draft.kind = result.kind;
      if (result.kind !== 'supplier_invoice') throw new IntakeError('QUESTION', 'Счёт выставлен нашей компанией.', 'Добавьте PDF в комплект документов договора заказчика.');
      draft.proposal = { ...proposal, kind: result.kind };
      draft.parties = result.parties;
    }
    // Нельзя обещать готовность к отправке до серверной проверки версии и дублей.
    draft.state = 'checked';
  } catch (error) {
    if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
    draft.state = 'question';
    draft.issues = [problem(error.code, error.message, error.action || 'Сверьте поле с оригиналом.')];
  }
}

async function fileReviewResult(store, entry, draft) {
  const state = draft.state === 'question' ? 'question' : 'ready';
  const hadIssue = Boolean(entry.reviewIssue);
  delete entry.reviewIssue;
  if (entry.state !== state) await finishArrival(store, entry, { state });
  else if (hadIssue) await saveArrival(store, entry);
}

export async function reviewStatus({ root, owner, target }) {
  const store = await openRoot(root, { create: false });
  const entries = (await arrivalsOf(store)).filter(row => row.workflow === 'c171');
  const items = [];
  for (const entry of entries) {
    let draft = null, journalIssue = null;
    try {
      if (entry.hash && !/^[a-f0-9]{64}$/.test(entry.hash)) throw new IntakeError('JOURNAL', 'Не подтверждён хеш черновика.');
      draft = entry.hash ? await readJson(draftFile(store, entry.hash)) : null;
      if (draft && (draft.workflow !== 'c171' || draft.hash !== entry.hash || !Array.isArray(draft.issues))) {
        throw new IntakeError('JOURNAL', 'Черновик не соответствует поступлению.');
      }
    } catch {
      draft = null;
      journalIssue = problem('JOURNAL', 'Локальный черновик не читается.', 'Сохраните папку для сверки; остальные документы можно проверить.');
    }
    if (owner && (draft?.owner ?? entry.reviewOwner) !== owner) continue;
    if (target && (draft?.target ?? entry.reviewTarget) !== target) continue;
    items.push({ arrivalId: entry.arrivalId, batchId: entry.batchId, name: entry.name, hash: entry.hash,
      kind: draft?.kind || draft?.proposal?.kind || null,
      state: entry.reviewIssue || journalIssue ? 'question' : draft?.state || 'pending', version: draft?.version || 0,
      issues: [entry.reviewIssue, journalIssue, ...(draft?.issues || [])].filter(Boolean),
      updatedAt: draft?.updatedAt || entry.updatedAt });
  }
  return { items, counts: {
    pending: items.filter(row => ['pending', 'extracting', 'proposing'].includes(row.state)).length,
    checked: items.filter(row => row.state === 'checked').length,
    question: items.filter(row => row.state === 'question').length,
    ...(items.some(row => row.state === 'sending') ? { sending: items.filter(row => row.state === 'sending').length } : {}),
    uploaded: items.filter(row => row.state === 'uploaded').length,
  } };
}

export async function getDraft({ root, arrivalId }) {
  const { entry, draft } = await findReview(await openRoot(root), arrivalId);
  return { ...draft, arrivalId, name: entry.name, batchId: entry.batchId };
}

export async function reviseDraft(options, dependencies = {}) {
  const { root, arrivalId, version, raw, signal } = options;
  const store = await openRoot(root);
  const release = await lock(store.root);
  try {
    abort(signal);
    const { draft, entry } = await findReview(store, arrivalId);
    if (draft.sendStarted || draft.state === 'uploaded') throw new IntakeError('VERSION', 'Сначала завершите сверку отправленного счёта.');
    if (!Number.isSafeInteger(version) || draft.version !== version) throw new IntakeError('VERSION', 'Черновик изменён в другом окне.', 'Откройте актуальную версию и повторите правку.');
    if (draft.version >= 100) throw new IntakeError('VERSION', 'Достигнут предел версий черновика.', 'Передайте историю ответственному за приложение.');
    if (!raw || Buffer.byteLength(JSON.stringify(raw)) > 140_000) throw new IntakeError('QUESTION', 'Исправленный ответ слишком большой или пуст.');
    const connection = (dependencies.connect || connectApi)(options);
    const api = readOnly(connection);
    const actor = await authorize(api);
    checkBinding(draft, apiAddress(options.apiBase), actor);
    if (draft.submission) {
      const { withdrawReview } = await import('./delivery.mjs');
      await withdrawReview(store, draft, connection);
    }
    draft.history.push({ version: draft.version, raw: draft.raw, state: draft.state, updatedAt: draft.updatedAt });
    draft.raw = structuredClone(raw);
    draft.version++;
    draft.updatedAt = new Date().toISOString();
    await validate(draft, api);
    abort(signal);
    await jsonAtomic(draftFile(store, draft.hash), draft);
    if (entry.pending) await reconcileArrival(store, entry);
    await fileReviewResult(store, entry, draft);
    return getDraft({ root, arrivalId });
  } finally { await release(); }
}

export async function analyze(options, dependencies = {}) {
  const { root, signal, onProgress, scope } = options;
  const store = await openRoot(root);
  const release = await lock(store.root);
  const runtime = { extract: extractDocument, extractColumns: extractPartyColumns, propose, connect: connectApi, ...dependencies };
  let current = '', stage = 'preparing', processed = 0, total = 0;
  let lastEventAt = new Date().toISOString();
  const notify = (event = false) => {
    if (event) lastEventAt = new Date().toISOString();
    try { onProgress?.({ current, stage, processed, total, lastEventAt, heartbeatAt: new Date().toISOString(), state: 'processing' }); } catch { /* закрытое окно не прерывает журнал */ }
  };
  const timer = setInterval(() => notify(), dependencies.heartbeatMs || 5_000);
  timer.unref?.();
  const batchId = uid();
  try {
    const existingEntries = await arrivalsOf(store);
    if (existingEntries.some(row => row.state === 'processing' && row.workflow !== 'c171')) {
      throw new IntakeError('LEGACY_PENDING', 'В папке остался незавершённый импорт C169.', 'Выберите новую папку для проверки C171. Старую очередь сохраните для сверки.');
    }
    // До захвата первого файла закрываем для всей папки старый автоматический импорт.
    await jsonAtomic(path.join(store.root, '.intake', 'c171-review.json'), { workflow: 'c171', version: 1 });
    abort(signal);
    const target = apiAddress(options.apiBase);
    const api = readOnly(runtime.connect(options));
    const actor = await authorize(api);
    const entries = [];
    for (const entry of existingEntries.filter(row => row.workflow === 'c171')) {
      if (entry.reviewOwner !== actor.id || entry.reviewTarget !== target) continue;
      if (entry.pending || entry.phase === 'claiming') {
        if (!await reconcileArrival(store, entry)) continue;
      }
      const needsReview = entry.state === 'question' || Boolean(entry.reviewIssue) || Boolean(entry.retryIntent);
      if ((scope === 'incoming' && (entry.state === 'question' || entry.reviewIssue)) || (scope === 'review' && !needsReview)) continue;
      if (entry.state === 'question') await startRetry(store, entry, { target, owner: actor.id });
      if (entry.phase === 'retrying') await reconcileRetry(store, entry);
      if (entry.state === 'processing') entries.push(entry);
    }
    const incoming = scope === 'review' ? [] : await inboxFiles(store);
    // Снимок пачки: новые поступления во время анализа остаются до следующего запуска.
    total = entries.length + incoming.length;
    const work = async entry => {
      abort(signal);
      current = entry.name;
      stage = 'extracting'; notify(true);
      const bytes = await readOriginal(store, entry, MAX_BYTES);
      const hash = sha256(bytes);
      if (entry.hash && entry.hash !== hash) throw new IntakeError('ORIGINAL', 'Оригинал изменён.', 'Восстановите исходные байты.');
      entry.hash = hash;
      await saveArrival(store, entry);
      let draft = await readJson(draftFile(store, hash));
      if (draft) {
        checkBinding(draft, target, actor);
        if (draft.submission || draft.sendStarted || draft.state === 'uploaded') {
          await fileReviewResult(store, entry, draft);
          return draft.state;
        }
      }
      else {
        draft = { workflow: 'c171', hash, target, owner: actor.id, version: 1, history: [],
          engine: { rules: RULES_VERSION, extractor: EXTRACTOR_VERSION, model: options.model },
          state: 'extracting', pages: null, raw: null, issues: [], updatedAt: new Date().toISOString() };
        await jsonAtomic(draftFile(store, hash), draft);
      }
      try {
        if (!draft.pages) {
          if (path.extname(entry.name).toLowerCase() !== '.pdf') throw new IntakeError('QUESTION', 'Для проверки нужен оригинал PDF.', 'Добавьте текстовый PDF.');
          draft.pages = await runtime.extract(path.join(store.folders.processing, entry.arrivalId, entry.name), bytes, signal);
          await jsonAtomic(draftFile(store, hash), draft);
          checkPages(draft.pages);
        }
        if (!draft.raw) {
          stage = 'proposing'; draft.state = stage; notify(true);
          draft.raw = await runtime.propose({ pages: draft.pages, modelBase: options.modelBase, model: options.model, signal });
          // Доказательства сохраняются до первой проверки, в том числе ошибочные кандидаты.
          await jsonAtomic(draftFile(store, hash), draft);
        }
        stage = 'validating'; notify(true);
        await validate(draft, api, () => runtime.extractColumns(path.join(store.folders.processing, entry.arrivalId, entry.name), signal));
      } catch (error) {
        if (interrupted.has(error.code) || signal?.aborted) throw error;
        draft.state = 'question';
        draft.issues = [error instanceof IntakeError
          ? problem(error.code, error.message, error.action || 'Сверьте оригинал.')
          : problem('DOCUMENT', 'Файл не удалось проверить.', 'Откройте оригинал и проверьте читаемость.')];
      }
      if (sha256(await readOriginal(store, entry, MAX_BYTES)) !== hash) throw new IntakeError('ORIGINAL', 'Оригинал изменён во время проверки.', 'Восстановите исходные байты.');
      abort(signal);
      draft.updatedAt = new Date().toISOString();
      await jsonAtomic(draftFile(store, hash), draft);
      await fileReviewResult(store, entry, draft);
      return draft.state;
    };
    const workSafely = async entry => {
      try {
        stage = await work(entry);
      } catch (error) {
        if (interrupted.has(error.code) || signal?.aborted) throw error;
        entry.reviewIssue = problem(error instanceof IntakeError ? error.code : 'DOCUMENT',
          error instanceof IntakeError ? error.message : 'Не удалось прочитать документ.',
          error instanceof IntakeError ? error.action : 'Сверьте наличие и читаемость оригинала.');
        if (error.code === 'QUESTION' && !entry.pending && entry.state === 'processing') await finishArrival(store, entry, { state: 'question' });
        else await saveArrival(store, entry);
        stage = 'question';
      }
      processed++; notify(true);
    };
    for (const entry of entries) await workSafely(entry);
    for (const name of incoming) {
      abort(signal);
      const entry = await claim(store, name, runtime.stableMs, { workflow: 'c171', batchId, owner: actor.id, target });
      if (!entry) continue; // Занятый или ещё сохраняемый файл не считается проверенным.
      await workSafely(entry);
    }
    return { ...await reviewStatus({ root }), processed, total };
  } catch (error) {
    return { ...await reviewStatus({ root }), processed, total, stopped: signal?.aborted
      ? problem('ABORTED', 'Проверка остановлена.', 'Нажмите «Возобновить».')
      : problem(error instanceof IntakeError ? error.code : 'INTAKE', error instanceof IntakeError ? error.message : 'Проверка приостановлена.', error instanceof IntakeError ? error.action : 'Проверьте папку и повторите запуск.') };
  } finally { clearInterval(timer); await release(); }
}
