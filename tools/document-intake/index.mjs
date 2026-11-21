import path from 'node:path';
import {
  IntakeError, MAX_BYTES, arrivalsOf, claim, documentFile, exists, finishArrival, inboxFiles, isRunning,
  jsonAtomic, lock, openRoot, originalPath, readJson, readOriginal, reconcileArrival, reconcileRetry, saveArrival, sha256, startRetry,
} from './store.mjs';
import { apiAddress, authorize, connectApi, decideInvoice, executeIntake } from './api.mjs';
import { checkPages, EXTRACTOR_VERSION, extractDocument, propose, question, RULES_VERSION, validateProposal } from './proposal.mjs';

export { analyze, getDraft, reviseDraft, reviewStatus } from './analysis.mjs';
export { prepareBatch, sendBatch } from './delivery.mjs';

export async function configure({ root }) {
  const store = await openRoot(root);
  return { root: store.root, folders: store.folders };
}

function publicEntry(entry) {
  const { arrivalId, name, state, outcome, message, action, updatedAt, entityId, kind } = entry;
  return { arrivalId, name, state, outcome, message, action, updatedAt, entityId, kind };
}

async function snapshot(store) {
  const [inbox, entries] = await Promise.all([inboxFiles(store), arrivalsOf(store)]);
  const counts = { inbox: inbox.length, processing: 0, ready: 0, question: 0 };
  const legacy = entries.filter(entry => entry.workflow !== 'c171');
  for (const entry of legacy) counts[entry.state]++;
  return { root: store.root, counts, items: legacy.map(publicEntry) };
}

export async function status({ root }) {
  const store = await openRoot(root);
  const [data, running] = await Promise.all([snapshot(store), isRunning(store.root)]);
  const current = running ? data.items.filter((entry) => entry.state === 'processing').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.name : null;
  return { root: store.root, folders: store.folders, running, counts: data.counts, current: current ?? null };
}

export async function report({ root }) {
  return snapshot(await openRoot(root));
}

function relatedDocument() {
  throw question('Документ требуется связать с существующим договором.',
    'Откройте доказанно связанный договор по номеру, дате и ИНН покупателя и добавьте оригинал в его комплект документов.');
}

function checkFormat(name, facts) {
  if (facts.kind === 'acceptance') relatedDocument();
  if (path.extname(name).toLowerCase() !== '.pdf') {
    throw question('Реквизиты прочитаны, но для сохранения оригинала нужен PDF.',
      'Подготовьте оригинальный текстовый PDF и положите его во «Входящие».');
  }
}

function abort(signal) {
  if (signal?.aborted) throw new IntakeError('ABORTED', 'Разбор остановлен.', 'Продолжите с кнопки «Возобновить».');
}

function assertOwner(doc, actor) {
  if (doc.owner && doc.owner !== actor.id) {
    throw new IntakeError('ACTOR', 'Этот документ начали загружать под другой учётной записью.', 'Войдите под той же учётной записью и возобновите разбор.');
  }
}

function assertTarget(expected, target) {
  if (expected && expected !== target) {
    throw new IntakeError('CONTOUR', 'Этот документ начали обрабатывать в другом контуре DataCore.', 'Верните прежний адрес DataCore и возобновите разбор.');
  }
}

function stopped(error, signal) {
  if (signal?.aborted) return { code: 'ABORTED', message: 'Разбор остановлен.', action: 'Продолжите с кнопки «Возобновить».' };
  if (error instanceof IntakeError) return { code: error.code, message: error.message, action: error.action };
  return { code: 'INTAKE', message: 'Не удалось завершить разбор этого файла.', action: 'Проверьте доступ к папке и возобновите разбор. Если ошибка повторится, передайте её ответственному за приложение.' };
}

async function processEntry({ store, entry, options, runtime, getApi }) {
  const { apiBase, modelBase, model, signal } = options;
  abort(signal);
  if (entry.retryIntent) {
    assertTarget(entry.retryIntent.target, apiAddress(apiBase));
    assertOwner(entry.retryIntent, (await getApi()).actor);
  }
  const bytes = await readOriginal(store, entry, MAX_BYTES);
  const hash = sha256(bytes);
  if (entry.hash && entry.hash !== hash) {
    throw new IntakeError('ORIGINAL', 'Содержимое файла изменилось после начала разбора.', 'Верните неизменённый оригинал на место. Новую редакцию положите во «Входящие» отдельно.');
  }
  entry.hash = hash;
  await saveArrival(store, entry);
  const file = documentFile(store, hash);
  let doc = await readJson(file);
  const save = () => jsonAtomic(file, doc);
  if (!doc) {
    const pages = await runtime.extract(originalPath(store, entry), bytes, signal);
    checkPages(pages);
    if (sha256(await readOriginal(store, entry, MAX_BYTES)) !== hash) {
      throw new IntakeError('ORIGINAL', 'Файл изменился во время извлечения текста.', 'Закройте редактирование оригинала и возобновите разбор.');
    }
    const raw = await runtime.propose({ pages, modelBase, model, signal });
    const proposal = validateProposal(raw, pages);
    doc = {
      hash, uid: `c169-${hash}`, firstArrivalId: entry.arrivalId,
      engine: { rules: RULES_VERSION, extractor: EXTRACTOR_VERSION, model },
      proposal, evidence: raw,
    };
    await save();
  }
  if (doc.hash !== hash || doc.uid !== `c169-${hash}` || !doc.proposal) {
    throw new IntakeError('JOURNAL', 'Журнал не соответствует исходному файлу.', 'Сохраните папку целиком для сверки.');
  }
  entry.kind = doc.proposal.kind;
  await saveArrival(store, entry);
  checkFormat(doc.complete ? `original.pdf` : entry.name, doc.proposal);
  const target = apiAddress(apiBase);
  assertTarget(doc.target, target);
  if (!doc.target) {
    doc.target = target;
    await save();
  }
  const { api, actor } = await getApi();
  assertOwner(doc, actor);
  if (!doc.owner) {
    doc.owner = actor.id;
    await save();
  }
  if (['supplier_invoice', 'customer_invoice'].includes(doc.proposal.kind) && !doc.parties) {
    const { kind, parties } = await decideInvoice(api, doc.proposal);
    entry.kind = kind;
    await saveArrival(store, entry);
    if (kind === 'customer_invoice') relatedDocument();
    doc.proposal.kind = kind;
    doc.parties = parties;
    await save();
  }
  abort(signal);
  if (sha256(await readOriginal(store, entry, MAX_BYTES)) !== hash) {
    throw new IntakeError('ORIGINAL', 'Перед записью обнаружено изменение оригинала.', 'Верните неизменённый оригинал в «Разбираются».');
  }
  const outcome = await executeIntake({ api, doc, bytes, name: entry.name, save });
  if (sha256(await readOriginal(store, entry, MAX_BYTES)) !== hash) {
    throw new IntakeError('ORIGINAL', 'Перед завершением обнаружено изменение оригинала.', 'Верните неизменённый оригинал в «Разбираются».');
  }
  const first = entry.arrivalId === doc.firstArrivalId && !doc.adopted;
  return {
    state: 'ready', outcome: first ? 'imported' : outcome,
    message: first ? 'Документ и оригинал сверены в DataCore.' : 'Этот оригинал уже учтён. Совпадение подтверждено в DataCore.',
    entityId: doc.entityId,
  };
}

async function runQueue(options, dependencies, mode) {
  const { root, onProgress, signal } = options;
  const store = await openRoot(root);
  const release = await lock(store.root);
  let processed = 0;
  let total = 0;
  const notify = (current, state, message) => {
    // Закрытая вкладка не должна прерывать уже сохранённую операцию.
    try { onProgress?.({ processed, total, current, state, message }); } catch { /* состояние остаётся в журнале */ }
  };
  const runtime = { extract: extractDocument, propose, connect: connectApi, ...dependencies };
  let connection;
  async function getApi() {
    if (!connection) {
      const api = runtime.connect(options);
      connection = { api, actor: await authorize(api) };
    }
    return connection;
  }

  async function retryProof(entry) {
    abort(signal);
    const moved = entry.phase === 'retrying' && await exists(originalPath(store, entry));
    const bytes = await readOriginal(store, entry, MAX_BYTES, moved ? 'processing' : 'question');
    if (sha256(bytes) !== entry.hash) {
      throw new IntakeError('ORIGINAL', 'Оригинал сомнительного документа изменился.', 'Верните сохранённый оригинал на место. Для новой редакции используйте «Входящие».');
    }
    const doc = await readJson(documentFile(store, entry.hash));
    const target = apiAddress(options.apiBase);
    assertTarget(doc?.target, target);
    assertTarget(entry.retryIntent?.target, target);
    const { actor } = await getApi();
    if (doc) assertOwner(doc, actor);
    if (entry.retryIntent) assertOwner(entry.retryIntent, actor);
    return { target, owner: actor.id };
  }
  async function work(entry) {
    notify(entry.name, 'processing', 'Проверяется исходный документ.');
    let final;
    try { final = await processEntry({ store, entry, options, runtime, getApi }); }
    catch (e) {
      if (e instanceof IntakeError && e.code === 'QUESTION' && !signal?.aborted) {
        final = { state: 'question', outcome: 'question', message: e.message, action: e.action };
      } else {
        const interruption = stopped(e, signal);
        entry.message = interruption.message;
        entry.action = interruption.action;
        entry.outcome = 'stopped';
        await saveArrival(store, entry);
        notify(entry.name, 'stopped', interruption.message);
        return interruption;
      }
    }
    await finishArrival(store, entry, final);
    processed++;
    notify(entry.name, final.state, final.message);
    return null;
  }

  try {
    if (await exists(path.join(store.root, '.intake', 'c171-review.json'))) {
      throw new IntakeError('REVIEW_REQUIRED', 'Эта папка используется для проверки черновиков C171.', 'Продолжите в экране проверки. Автоматическая отправка C169 для этой папки запрещена.');
    }
    const entries = await arrivalsOf(store);
    const selected = new Set(options.arrivalIds);
    const pending = entries.filter((entry) => entry.state === 'processing' && (mode !== 'retry' || entry.retryIntent && selected.has(entry.arrivalId)));
    const questions = mode === 'retry' ? entries.filter((entry) => entry.state === 'question' && selected.has(entry.arrivalId)) : [];
    const incoming = mode === 'run' ? await inboxFiles(store) : [];
    total = pending.length + questions.length + incoming.length;
    const outcomes = [];
    for (const entry of questions) outcomes.push(await retryProof(entry));
    let interruption;
    for (const entry of pending) {
      abort(signal);
      if (entry.phase === 'retrying') {
        await retryProof(entry);
        await reconcileRetry(store, entry);
      }
      const needsFinalizing = Boolean(entry.pending);
      if (entry.pending?.state === 'ready') {
        const originalStillInProcessing = await exists(originalPath(store, entry));
        const bytes = await readOriginal(store, entry, MAX_BYTES, originalStillInProcessing ? 'processing' : 'ready');
        const doc = await readJson(documentFile(store, entry.hash));
        if (sha256(bytes) !== entry.hash) {
          if (!originalStillInProcessing) await reconcileArrival(store, entry);
          throw new IntakeError('ORIGINAL', 'Незавершённое перемещение не подтвердило исходный файл.', 'Сохраните обе папки и проверьте оригинал по отчёту.');
        }
        if (!doc?.complete || doc.entityId !== entry.pending.entityId) {
          throw new IntakeError('JOURNAL', 'Не найдено подтверждение незавершённого переноса.', 'Сохраните папку разбора для сверки.');
        }
        assertTarget(doc.target, apiAddress(options.apiBase));
        const { api, actor } = await getApi();
        assertOwner(doc, actor);
        // У незавершённого переноса повторно получаем доказательство, прежде чем отметить «Готово».
        await executeIntake({ api, doc, bytes });
      }
      const recovered = await reconcileArrival(store, entry);
      if (!recovered) continue;
      if (needsFinalizing) {
        processed++;
        notify(recovered.name, recovered.state, recovered.message);
      } else {
        interruption = await work(recovered);
        if (interruption) break;
      }
    }
    if (!interruption) {
      for (const [index, entry] of questions.entries()) {
        abort(signal);
        await startRetry(store, entry, outcomes[index]);
        await retryProof(entry);
        await reconcileRetry(store, entry);
        interruption = await work(entry);
        if (interruption) break;
      }
    }
    if (!interruption) {
      for (const name of incoming) {
        abort(signal);
        const entry = await claim(store, name, runtime.stableMs);
        if (!entry) continue;
        interruption = await work(entry);
        if (interruption) break;
      }
    }
    const data = await snapshot(store);
    return interruption ? { ...data, stopped: interruption } : data;
  } catch (e) {
    const interruption = stopped(e, signal);
    notify(null, 'stopped', interruption.message);
    return { ...await snapshot(store), stopped: interruption };
  } finally { await release(); }
}

export function run(options, dependencies = {}) {
  return runQueue(options, dependencies, 'run');
}

export function resume(options, dependencies = {}) {
  return runQueue(options, dependencies, 'resume');
}

export async function retry(options, dependencies = {}) {
  const { arrivalIds } = options;
  if (!Array.isArray(arrivalIds) || !arrivalIds.length || arrivalIds.length > 100 || new Set(arrivalIds).size !== arrivalIds.length
    || arrivalIds.some((id) => typeof id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(id))) {
    throw new IntakeError('SELECTION', 'Выберите от одного до ста сомнительных документов.');
  }
  return runQueue(options, dependencies, 'retry');
}
