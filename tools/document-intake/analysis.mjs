// C171: локальная проверка не имеет средств записи в DataCore.
import path from 'node:path';
import {
  IntakeError, MAX_BYTES, arrivalsOf, claim, exists, finishArrival, inboxFiles, jsonAtomic, lock,
  openRoot, readJson, readOriginal, reconcileArrival, reconcileRetry, saveArrival, sha256, startRetry, uid,
} from './store.mjs';
import { apiAddress, authorize, connectApi, decideInvoice, findOrderContract, lookupParty, resolveSalesParties } from './api.mjs';
import { applyInvoiceLayout, checkPages, confirmParties, confirmReadFact, EXTRACTOR_VERSION, extractDocument, extractPartyColumns, extractTables, evidencedKind, learnInvoiceLayout, mergeVisionProof, recoverPrintedRows, propose, referencedContract, renderPages, resolvePrintedDoubts, RULES_VERSION, validateProposal, validInn, verifyCitations, VISION_VERSION } from './proposal.mjs';

const interrupted = new Set(['AUTH', 'ACTOR', 'CONTOUR', 'API_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'EXTRACTOR', 'ABORTED']);
const fileBusy = new Set(['EPERM', 'EACCES', 'EBUSY']);
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
  const location = moved ? destination : entry.state;
  const bytes = await readOriginal(store, entry, MAX_BYTES, location);
  if (sha256(bytes) !== entry.hash) throw new IntakeError('ORIGINAL', 'Оригинал изменён.', 'Восстановите неизменённый исходный файл.');
  const draft = await readJson(draftFile(store, entry.hash));
  if (!draft || draft.hash !== entry.hash || draft.workflow !== 'c171') throw new IntakeError('JOURNAL', 'Черновик не соответствует оригиналу.');
  return { entry, draft, bytes, original: path.join(store.folders[location], entry.arrivalId, entry.name) };
}

async function validate(draft, api, loadColumns, raw = draft.raw) {
  let reading = true;
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
    draft.kind = evidencedKind(raw, draft.pages);
    if (draft.kind === 'acceptance') {
      reading = false;
      throw new IntakeError('QUESTION', 'Акт нужно привязать к договору.', 'Найдите договор заказчика по реквизитам оригинала и добавьте PDF в комплект документов.');
    }
    const corrected = draft.manualFacts ? { ...raw, ...draft.manualFacts } : raw;
    let evidence = verifyCitations(corrected, draft.pages);
    let sides = confirmParties(evidence, draft.pages, [], draft.manualParties);
    if (draft.kind === 'contract' && sides.some(side => side.issue)) {
      if (!draft.partyColumns && loadColumns) draft.partyColumns = await loadColumns();
      if (draft.partyColumns?.length) {
        evidence = verifyCitations(corrected, draft.pages, draft.partyColumns);
        sides = confirmParties(evidence, draft.pages, draft.partyColumns, draft.manualParties);
      }
    }
    if (draft.printedRows?.length) evidence = resolvePrintedDoubts({ ...evidence, lines: draft.printedRows },
      draft.pages, draft.partyColumns || [], draft.printedRows, draft.manualParties);
    if (evidence !== draft.raw) draft.evidence = evidence;

    if (['supplier_invoice', 'customer_invoice'].includes(draft.kind) && sides.every(side => side.party && !side.issue)) {
      try { draft.kind = (await decideInvoice(api, { seller: evidence.seller, buyer: evidence.buyer })).kind; }
      catch (error) { if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error; }
    }

    let proposal;
    try { proposal = validateProposal(evidence, draft.pages, draft.kind === 'contract' ? draft.partyColumns : [], draft.printedRows, draft.manualParties); }
    catch (error) {
      if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
      if (error.code === 'SOURCE_FORMAT') reading = false;
      if (!sides.some(side => side.issue?.message === error.message)) {
        draft.issues.push(problem(error.code, error.message, error.action));
      }
    }
    if (!proposal) {
      const invoice = ['supplier_invoice', 'customer_invoice'].includes(draft.kind);
      const labels = invoice && draft.kind !== 'customer_invoice' ? { seller: 'Поставщик', buyer: 'Плательщик' } : { seller: 'Исполнитель', buyer: 'Заказчик' };
      draft.state = 'question';
      for (const { key, party, issue } of sides) {
        if (issue) {
          draft.issues.push({ ...problem(issue.code, issue.message, issue.action), field: key });
          continue;
        }
        try { await lookupParty(api, party, labels[key]); }
        catch (error) {
          if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
          draft.issues.push(problem(error.code, error.message, error.action));
        }
      }
      return reading;
    }
    reading = false;
    const reference = draft.kind === 'order' ? referencedContract(draft.pages) : null;
    if (['contract', 'offer', 'order'].includes(proposal.kind)) {
      if (proposal.revision) throw new IntakeError('QUESTION', 'В документе указана редакция.', 'Сверьте редакцию в карточке существующего документа.');
      draft.parties = await resolveSalesParties(api, proposal, { allowMissingCustomer: proposal.kind === 'contract' });
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
    return false;
  } catch (error) {
    if (!(error instanceof IntakeError) || interrupted.has(error.code)) throw error;
    draft.state = 'question';
    draft.issues = [problem(error.code, error.message, error.action || 'Сверьте поле с оригиналом.')];
    return reading;
  }
}

async function fileReviewResult(store, entry, draft) {
  const state = draft.state === 'question' ? 'question' : 'ready';
  const hadIssue = Boolean(entry.reviewIssue);
  delete entry.reviewIssue;
  delete entry.reviewDiagnostic;
  if (entry.state !== state) await finishArrival(store, entry, { state });
  else if (hadIssue) await saveArrival(store, entry);
}

function distinctCopies(items) {
  const rank = { uploaded: 5, existing: 4, checked: 3, sending: 2, question: 1 };
  const documents = new Map();
  for (const item of items) {
    const key = /^[\da-f]{64}$/.test(item.hash || '') ? item.hash : item.arrivalId;
    const previous = documents.get(key);
    if (!previous || (rank[item.state] || 0) > (rank[previous.state] || 0)
      || (item.state === 'question' && previous.state === 'question' && previous.issues.some(issue => issue.code === 'DOCUMENT')
        && !item.issues.some(issue => issue.code === 'DOCUMENT'))) documents.set(key, item);
  }
  return [...documents.values()];
}

export async function reviewStatus({ root, owner, target, collapseCopies = false }) {
  const store = await openRoot(root, { create: false });
  const entries = (await arrivalsOf(store)).filter(row => row.workflow === 'c171');
  let items = [];
  let automatic = 0;
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
    if (draft?.autoDispatch && !entry.reviewIssue && !journalIssue && ['checked', 'sending'].includes(draft.state)) automatic++;
    const issues = [entry.reviewIssue, journalIssue, ...(draft?.issues || [])].filter(Boolean);
    const evidence = draft?.evidence || draft?.raw;
    const fields = new Set(issues.map(reviewField).filter(field => ['seller', 'buyer'].includes(field)));
    const reviewParties = !draft?.returnToManager && draft?.state === 'question' ? [...fields].map(field => {
      const party = evidence?.[field];
      if (typeof party?.name !== 'string' || !party.name.trim() || party.name.length > 300 || !validInn(party.inn)) return null;
      const page = draft.pages?.findIndex(text => typeof text === 'string' && text.includes(party.inn)) + 1;
      return { field, name: party.name, inn: party.inn, ...(page ? { page } : {}) };
    }).filter(Boolean) : [];
    items.push({ arrivalId: entry.arrivalId, batchId: entry.batchId, name: entry.name, hash: entry.hash,
      kind: draft?.kind || draft?.proposal?.kind || null,
      state: entry.reviewIssue || journalIssue ? 'question' : draft?.state || 'pending', version: draft?.version || 0,
      issues, ...(reviewParties.length ? { reviewParties } : {}),
      ...(draft?.returnToManager ? { returnToManager: true } : {}),
      updatedAt: draft?.updatedAt || entry.updatedAt });
  }
  if (collapseCopies) items = distinctCopies(items);
  return { items, counts: {
    pending: items.filter(row => ['pending', 'extracting', 'proposing'].includes(row.state)).length,
    checked: items.filter(row => row.state === 'checked').length,
    question: items.filter(row => row.state === 'question').length,
    ...(items.some(row => row.state === 'sending') ? { sending: items.filter(row => row.state === 'sending').length } : {}),
    uploaded: items.filter(row => row.state === 'uploaded').length,
    ...(automatic ? { automatic } : {}),
  } };
}

function reviewField(issue) {
  if (issue.field) return issue.field;
  if (issue.code !== 'QUESTION') return null;
  if (/^Не подтверждено поле «итог(?: с налогом)?»/iu.test(issue.message)) return 'gross';
  if (/^Не подтверждено поле «номер документа»/iu.test(issue.message)) return 'number';
  if (/^Не подтверждено поле «дата»/iu.test(issue.message)) return 'date';
  if (!/^ИНН /u.test(issue.message)) return null;
  if (/«поставщик или исполнитель»/u.test(issue.message)) return 'seller';
  if (/«покупатель или заказчик»/u.test(issue.message)) return 'buyer';
  return null;
}

export async function getDraft({ root, arrivalId }) {
  const { entry, draft } = await findReview(await openRoot(root), arrivalId);
  const issues = draft.issues.map(issue => ({ ...issue, field: reviewField(issue) }));
  return { ...draft, issues, arrivalId, name: entry.name, batchId: entry.batchId };
}

export async function getReviewOriginal({ root, arrivalId }) {
  const { draft, bytes, original } = await findReview(await openRoot(root, { create: false }), arrivalId);
  if (path.extname(original).toLowerCase() !== '.pdf' || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new IntakeError('QUESTION', 'Этот оригинал не является PDF.');
  }
  return { owner: draft.owner, target: draft.target, original };
}

export async function reviewDecision(options, dependencies = {}) {
  const { root, arrivalId, version, decision, field, name, inn, value } = options;
  const store = await openRoot(root, { create: false });
  const release = await lock(store.root);
  try {
    const { draft, entry } = await findReview(store, arrivalId);
    const api = readOnly((dependencies.connect || connectApi)(options));
    const actor = await authorize(api);
    checkBinding(draft, apiAddress(options.apiBase), actor);
    if (draft.version !== version || draft.version >= 100 || draft.state !== 'question'
      || draft.submission || draft.sendStarted || entry.pending) {
      throw new IntakeError('VERSION', 'Документ уже изменился. Откройте его из отчёта ещё раз.');
    }

    const now = new Date().toISOString();
    if (decision === 'confirm-party') {
      if (draft.returnToManager || !['seller', 'buyer'].includes(field) || !draft.issues.some(issue => reviewField(issue) === field)) {
        throw new IntakeError('SELECTION', 'Выберите реквизиты стороны, которую Пульт просит сверить.');
      }
      const partyName = typeof name === 'string' ? name.trim() : '';
      const partyInn = typeof inn === 'string' ? inn.replace(/\s+/gu, '') : '';
      if (!partyName || partyName.length > 300 || !validInn(partyInn)) {
        throw new IntakeError('QUESTION', 'Введите название и действительный ИНН из PDF.');
      }
      const opposite = field === 'seller' ? 'buyer' : 'seller';
      const evidence = draft.evidence || draft.raw;
      const other = confirmParties(evidence, draft.pages, draft.partyColumns, draft.manualParties)
        .find(side => side.key === opposite)?.party;
      if (other?.inn === partyInn) throw new IntakeError('QUESTION', 'У обеих сторон указан один ИНН. Проверьте, чей ИНН записан в PDF.');
      draft.manualParties = { ...draft.manualParties, [field]: { name: partyName, inn: partyInn, at: now } };
      await validate(draft, api, undefined, evidence);
    } else if (decision === 'confirm-fact') {
      if (draft.returnToManager || !['gross', 'number', 'date'].includes(field) || !draft.issues.some(issue => reviewField(issue) === field)) {
        throw new IntakeError('SELECTION', 'Выберите значение, которое Пульт просит сверить.');
      }
      const evidence = draft.evidence || draft.raw;
      const corrected = confirmReadFact(evidence, draft.pages, field, value);
      draft.manualFacts = { ...draft.manualFacts, [field]: corrected };
      await validate(draft, api, undefined, evidence);
    } else if (decision === 'mark-return' && !draft.returnToManager && draft.issues.some(issue => issue.code === 'SOURCE_FORMAT')) {
      draft.returnToManager = now;
    } else if (decision === 'undo-return' && draft.returnToManager) {
      delete draft.returnToManager;
    } else {
      throw new IntakeError('SELECTION', 'Действие недоступно для этого документа.');
    }

    delete draft.autoDispatch;
    draft.updatedAt = now;
    draft.version++;
    await jsonAtomic(draftFile(store, draft.hash), draft);
    await fileReviewResult(store, entry, draft);
    return getDraft({ root, arrivalId });
  } finally { await release(); }
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
    delete draft.autoDispatch;
    delete draft.manualParties;
    delete draft.manualFacts;
    delete draft.returnToManager;
    delete draft.printedRows;
    delete draft.vision;
    delete draft.layoutFields;
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

async function lookAtPages(draft, file, options, runtime, onStart) {
  const { model, modelBase, signal } = options;
  const existing = draft.vision;
  if (existing?.version === VISION_VERSION && existing.model === model && existing.candidate) return existing;
  const total = draft.pages?.length || 1;
  const raw = draft.evidence || draft.raw;
  const pageNumbers = [...new Set([1, total, raw?.seller?.page, raw?.buyer?.page, raw?.vat?.page,
    ...(Array.isArray(raw?.lines) ? raw.lines.map(line => line?.page) : []),
    ...Array.from({ length: Math.min(total, 4) }, (_, index) => index + 1),
  ].filter(page => Number.isInteger(page) && page > 0 && page <= total))].slice(0, 4).sort((a, b) => a - b);
  const result = { version: VISION_VERSION, model, pages: [], state: 'unavailable', fields: [] };
  draft.vision = result;
  try {
    const images = await runtime.renderImages(file, pageNumbers, signal);
    if (!images?.length) return result;
    result.pages = images.map(image => image.page);
    onStart();
    result.candidate = await runtime.proposeVision({ pages: draft.pages || [], modelBase, model, signal, images });
    result.state = 'review';
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return result;
}

export async function analyze(options, dependencies = {}) {
  const { root, signal, onProgress, scope, automatic } = options;
  const store = await openRoot(root);
  const release = await lock(store.root);
  const runtime = {
    extract: extractDocument, extractColumns: extractPartyColumns, propose, renderImages: renderPages,
    proposeVision: propose, readTables: extractTables, connect: connectApi, ...dependencies,
  };
  const layoutFile = path.join(store.root, '.intake', 'vision-layouts.json');
  let layouts;
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
    const candidates = existingEntries.filter(entry => entry.workflow === 'c171' && entry.reviewOwner === actor.id && entry.reviewTarget === target);
    const retrying = new Set(candidates.filter(entry => entry.state === 'processing' && entry.retryIntent).map(entry => entry.arrivalId));
    const selected = scope === 'review' ? new Set((await reviewStatus({ root, owner: actor.id, target, collapseCopies: true })).items
      .filter(item => !item.returnToManager && (item.state === 'question' || retrying.has(item.arrivalId)))
      .map(item => item.arrivalId)) : null;
    for (const entry of candidates) {
      if (selected && !selected.has(entry.arrivalId)) continue;
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
        if (draft.submission || draft.sendStarted || draft.state === 'uploaded' || draft.returnToManager) {
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
      const filename = path.join(store.folders.processing, entry.arrivalId, entry.name);
      const loadColumns = () => runtime.extractColumns(filename, signal);
      const canRender = path.extname(entry.name).toLowerCase() === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-';
      try {
        if (!draft.pages) {
          if (!canRender) {
            const word = path.extname(entry.name).toLowerCase() === '.docx';
            throw new IntakeError('QUESTION', word ? 'Приложен файл Word (.docx). Для разбора нужен оригинал PDF.' : 'Для проверки нужен оригинал PDF.',
              word ? 'Сохраните документ Word в PDF и положите его во «Входящие».' : 'Добавьте PDF.');
          }
          draft.pages = await runtime.extract(filename, bytes, signal);
          await jsonAtomic(draftFile(store, hash), draft);
        }
        checkPages(draft.pages);
        if (!draft.raw) {
          stage = 'proposing'; draft.state = stage; notify(true);
          draft.raw = await runtime.propose({ pages: draft.pages, modelBase: options.modelBase, model: options.model, signal });
          await jsonAtomic(draftFile(store, hash), draft);
        }
        stage = 'validating'; notify(true);
        let needsVision = await validate(draft, api, loadColumns);
        if (needsVision && canRender && !draft.printedRows?.length && Array.isArray(draft.raw?.lines) && draft.raw.lines.length) {
          const printedRows = recoverPrintedRows(draft.evidence || draft.raw, draft.pages, await runtime.readTables(filename, signal));
          if (printedRows.length) {
            draft.printedRows = printedRows;
            needsVision = await validate(draft, api, loadColumns);
          }
        }
        if (needsVision && canRender) {
          layouts ??= await readJson(layoutFile).catch(() => []);
          if (!Array.isArray(layouts)) layouts = [];
          const base = draft.evidence || draft.raw;
          const reused = applyInvoiceLayout(base, draft.pages, layouts);
          draft.layoutFields = reused.fields;
          if (reused.fields.length) needsVision = await validate(draft, api, loadColumns, reused.evidence);
          if (needsVision) {
            const vision = await lookAtPages(draft, filename, options, runtime, () => { stage = 'viewing'; notify(true); });
            if (vision.candidate) {
              const from = draft.evidence || draft.raw;
              const result = mergeVisionProof(from, vision.candidate, draft.pages, draft.partyColumns || [], vision.pages, draft.printedRows);
              vision.fields = result.fields;
              vision.state = result.fields.length ? 'confirmed' : 'review';
              if (result.fields.length) {
                await validate(draft, api, loadColumns, result.evidence);
                const recipes = learnInvoiceLayout(result.evidence, draft.pages, result.fields);
                if (recipes.length) {
                  const merged = new Map([...layouts, ...recipes].map(recipe => [JSON.stringify(recipe), recipe]));
                  layouts = [...merged.values()].slice(-200);
                  await jsonAtomic(layoutFile, layouts).catch(() => {});
                }
              }
            }
          }
        }
      } catch (error) {
        if (interrupted.has(error.code) || signal?.aborted) throw error;
        draft.state = 'question';
        draft.issues = [error instanceof IntakeError
          ? problem(error.code, error.message, error.action || 'Сверьте оригинал.')
          : problem('DOCUMENT', 'Файл не удалось проверить.', 'Откройте оригинал и проверьте читаемость.')];
        if (canRender && !draft.pages && error.code === 'QUESTION') {
          await lookAtPages(draft, filename, options, runtime, () => { stage = 'viewing'; notify(true); });
        }
      }
      if (sha256(await readOriginal(store, entry, MAX_BYTES)) !== hash) throw new IntakeError('ORIGINAL', 'Оригинал изменён во время проверки.', 'Восстановите исходные байты.');
      abort(signal);
      if (automatic && draft.state === 'checked' && !draft.manualParties && !draft.manualFacts) draft.autoDispatch = true;
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
        entry.reviewDiagnostic = { stage, code: typeof error.code === 'string' && /^[A-Z_]{2,40}$/.test(error.code) ? error.code : 'UNEXPECTED',
          errorClass: /^[A-Za-z]{3,30}$/.test(error?.name) ? error.name : 'Error' };
        entry.reviewIssue = fileBusy.has(error.code)
          ? problem('FILE_BUSY', 'Windows временно заблокировала файл или журнал разбора.', 'Закройте PDF и повторите проверку.')
          : problem(error instanceof IntakeError ? error.code : 'DOCUMENT',
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
      current = name;
      stage = 'claiming';
      const entry = await claim(store, name, runtime.stableMs, { workflow: 'c171', batchId, owner: actor.id, target });
      if (!entry) continue; // Занятый или ещё сохраняемый файл не считается проверенным.
      await workSafely(entry);
    }
    return { ...await reviewStatus({ root }), processed, total };
  } catch (error) {
    return { ...await reviewStatus({ root }), processed, total, stopped: signal?.aborted
      ? problem('ABORTED', 'Проверка остановлена.', 'Нажмите «Возобновить».')
      : fileBusy.has(error.code) ? problem('FILE_BUSY', current
        ? 'Windows заблокировала файловую операцию при разборе «' + current + '».'
        : 'Windows заблокировала папку или журнал разбора.', 'Закройте открытый PDF и повторите запуск. Разбор продолжится с сохранённого состояния.')
      : problem(error instanceof IntakeError ? error.code : 'INTAKE', error instanceof IntakeError ? error.message : 'Проверка приостановлена.', error instanceof IntakeError ? error.action : 'Проверьте папку и повторите запуск.') };
  } finally { clearInterval(timer); await release(); }
}
