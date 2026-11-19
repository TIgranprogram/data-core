// C163: исполнитель только утверждённого JSON; запуск/авторизация — агент access.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';

const PLAN = 'docs/crew/C163-new-product-passport-funnel/DICTIONARY-SUPPLEMENT.json';
const PLAN_SHA = 'caf452a6f4023c30f3aff57b56d47b6ef3d5034c3b943e63abef4ed054939fc5';
const [environment, mode] = process.argv.slice(2);
function assert(ok, why) { if (!ok) throw new Error(why); }
assert(process.argv.length === 4 && ['stand', 'prod'].includes(environment) && ['dry', 'apply'].includes(mode), 'Use stand|prod dry|apply');
assert(typeof process.env.C163_RELEASE === 'string' && process.env.C163_RELEASE.length > 0, 'C163_RELEASE must name the exact reviewed served version');
const planBytes = readFileSync(PLAN);
assert(createHash('sha256').update(planBytes).digest('hex') === PLAN_SHA, 'Reviewed plan SHA mismatch');
const plan = JSON.parse(planBytes);
const oid = /^[0-9a-f]{24}$/;
const namespaces = ['passportParts', 'productFacets', 'productFacetValues', 'passportPhrases'];
const readNamespaces = [...namespaces, 'passportKinds'];
const expectedCounts = { passportParts: 9, productFacets: 5, productFacetValues: 9, passportPhrases: 20 };
assert(plan.format === 'c163-dictionary-supplement/1' && plan.records.length === 43, 'Unexpected plan format/count');
assert(same(plan.expectedNewCounts, expectedCounts), 'Unexpected planned namespace counts');
const bySymbol = new Map(plan.records.map(row => [row.symbol, row]));
assert(bySymbol.size === 43 && plan.records.every(row => namespaces.includes(row.key)), 'Invalid or duplicate record symbols');
assert(namespaces.every(key => plan.records.filter(row => row.key === key).length === expectedCounts[key]), 'Wrong record distribution');
assert(plan.records.filter(row => row.symbol.startsWith('root.')).length === 10
  && plan.records.filter(row => row.symbol.startsWith('leaf.')).length === 10, 'Need ten separate roots/leaves');
for (const ref of Object.values(plan.existing)) assert(readNamespaces.includes(ref.key) && oid.test(ref.id), 'Invalid existing reference');
const aliases = new Set([...Object.keys(plan.existing), ...bySymbol.keys()]);
function checkRefs(value) {
  if (Array.isArray(value)) return value.forEach(checkRefs);
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    assert(Object.keys(value).length === 1 && aliases.has(value.$ref), 'Unknown symbolic ref');
    return;
  }
  Object.values(value).forEach(checkRefs);
}
plan.records.forEach(row => checkRefs(row.body));
const run = 'tools/logs/c163-dictionary-supplement-' + environment + '-' + mode + '-' + Date.now();
mkdirSync(run, { recursive: true });
const journal = { environment, mode, planSha256: PLAN_SHA, created: [], reused: [], verified: [], rollbackPlanOnly: [] };
const save = (name, data) => writeFileSync(run + '/' + name + '.json', JSON.stringify(data, null, 2));
save('approved-plan', plan);
const wait = new Int32Array(new SharedArrayBuffer(4));
let lastStart = 0;
const writablePaths = new Set(namespaces.map(key => '/api/dicts/' + key));
const fixedReads = new Set(['/app/version.json', '/app/development.json', '/api/health/ready',
  '/api/showcase/6adaff442a8dad6034b14606/passport-template?variant=short',
  '/api/showcase/6aff34a8e27fdcbff25a0c9e',
  ...readNamespaces.map(key => '/api/dicts/' + key + '?limit=250')]);
// Динамические GET допускаются только для заранее известных или только что созданных id.
const allowedExactReads = new Set(Object.values(plan.existing).map(row => '/api/dicts/' + row.key + '/' + row.id));
function api(label, path, body) {
  if (body !== undefined) assert(mode === 'apply' && writablePaths.has(path), 'Write outside four namespace POST refused');
  else assert(fixedReads.has(path) || allowedExactReads.has(path), 'Read outside reviewed fixed paths refused');
  if (body !== undefined) save(label + '-request', body);
  const lag = 1100 - (Date.now() - lastStart);
  if (lag > 0) Atomics.wait(wait, 0, 0, lag);
  lastStart = Date.now();
  const response = spawnSync('C:/Program Files/Git/bin/bash.exe', ['deploy/synology/api.sh', environment,
    body === undefined ? 'GET' : 'POST', path,
    ...(body === undefined ? [] : ['../../' + run + '/' + label + '-request.json'])],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  assert(response.status === 0, label + ': helper exit ' + response.status + '; inspect server before retry after an uncertain POST');
  let result;
  try { result = JSON.parse(response.stdout); } catch { throw new Error(label + ': non-JSON; uncertain POST must be reconciled before retry'); }
  save(label, result);
  assert(!result.statusCode || result.statusCode < 400, label + ': HTTP ' + result.statusCode);
  return result;
}
function list(key, phase) {
  const data = api(phase + '-' + key, '/api/dicts/' + key + '?limit=250');
  assert(Number.isInteger(data.total) && Array.isArray(data.items) && data.items.length === data.total,
    'Incomplete full list: ' + key);
  assert(data.items.every(row => oid.test(row.id)) && new Set(data.items.map(row => row.id)).size === data.total, 'Invalid list ids: ' + key);
  return data.items;
}
const fold = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru').replaceAll('ё', 'е');
function resolve(value, bindings, provisional = false) {
  if (Array.isArray(value)) return value.map(item => resolve(item, bindings, provisional));
  if (!value || typeof value !== 'object') return value;
  if ('$ref' in value) {
    const id = bindings.get(value.$ref);
    assert(id && (provisional || oid.test(id)), 'Unresolved reference ' + value.$ref);
    return id;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, bindings, provisional)]));
}
function comparable(row, key) {
  if (key === 'passportPhrases') return { ...row, parentId: row.parentId || '', text: row.text || '',
    groupIds: row.groupIds || [], partIds: row.partIds || [], kindIds: row.kindIds || [], facetValueIds: row.facetValueIds || [],
    allCategories: !!row.allCategories, isDefault: !!row.isDefault, required: !!row.required };
  if (key === 'productFacetValues') return { ...row, purposePhraseId: row.purposePhraseId || '',
    installTypeId: row.installTypeId || '', elementIds: row.elementIds || [] };
  return row;
}
function fieldsMatch(actual, expected, key) {
  const row = comparable(actual, key);
  return Object.entries(expected).every(([field, value]) => same(row[field], value));
}
function candidates(rows, record, body) {
  return rows.filter(row => {
    const name = fold(row.name) === fold(body.name);
    if (record.key === 'passportParts') return name;
    if (record.key === 'productFacets') return fold(row.code) === fold(body.code) || name;
    if (record.key === 'productFacetValues') return fold(row.code) === fold(body.code) || name && row.parentId === body.parentId;
    // Одинаковые слова при другом kind допустимы: T2 сохраняет прежний leaf вида «для ног».
    // В рамках того же родителя или kind+criterion несовпадение полей блокирует запись.
    const scope = same(row.kindIds || [], body.kindIds) && same(row.facetValueIds || [], body.facetValueIds);
    const role = !row.parentId === !body.parentId;
    return name && row.section === body.section && role && (row.parentId === body.parentId || scope);
  });
}
const product1061 = '/api/showcase/6adaff442a8dad6034b14606/passport-template?variant=short';
const product1068 = '/api/showcase/6aff34a8e27fdcbff25a0c9e';
function protect1061(row) {
  assert(row.productId === '6adaff442a8dad6034b14606' && row.readiness?.ready === true
    && row.simpleDescriptionSource?.kind === 'dictionary' && row.simpleDescriptionSource.id === '6aff288ffd285cf4215c75a3'
    && row.simpleDescriptionSource.rootId === '6aff288cfd285cf4215c759c'
    && row.document?.simpleDescription?.text === 'Тренажёр состоит из несущей рамы, подвижных рычагов с рукоятками и упоров для ног.', '1061 baseline changed');
  return { source: row.simpleDescriptionSource, defaults: row.defaults, effectiveImages: row.effectiveImages };
}
function protect1068(row) {
  assert(row.id === '6aff34a8e27fdcbff25a0c9e' && String(row.sku) === '1068', '1068 identity changed');
  return { name: row.name, kind: row.kind, facets: row.facetValueIds, photos: row.photos,
    defaults: row.passportDefaults, counts: row.passportsCount };
}

try {
  const release = api('served-version', '/app/version.json');
  assert(Number.isInteger(release.n) && release.v === process.env.C163_RELEASE, 'Served version differs from exact C163_RELEASE');
  assert(api('served-ready', '/api/health/ready').status === 'ok', 'Environment not ready');
  let guard1061; let guard1068;
  if (environment === 'stand') {
    const metadata = api('qa-metadata', '/app/development.json');
    assert(metadata.mode === 'development' && metadata.origin === 'http://localhost:3102'
      && metadata.data?.backup === 'datacore-2026-11-18_031040.tgz', 'Owned QA baseline not confirmed');
  } else {
    guard1061 = protect1061(api('before-1061-template', product1061));
    guard1068 = protect1068(api('before-1068-showcase', product1068));
  }
  const before = Object.fromEntries(readNamespaces.map(key => [key, list(key, 'before')]));
  const bindings = new Map();
  for (const [symbol, expected] of Object.entries(plan.existing)) {
    const actual = before[expected.key].find(row => row.id === expected.id);
    assert(actual && fieldsMatch(actual, expected.expected, expected.key), 'Existing reference drift: ' + symbol);
    bindings.set(symbol, expected.id);
  }
  // Полная проверка всех 43 зависимостей и существующих совпадений ДО первого POST.
  const preflight = [];
  for (const record of plan.records) {
    const body = resolve(record.body, bindings, true);
    const hits = candidates(before[record.key], record, body);
    assert(hits.length <= 1, 'Duplicate conflict: ' + record.symbol);
    const existing = hits[0];
    assert(!existing || fieldsMatch(existing, body, record.key), 'Existing metadata conflict: ' + record.symbol);
    bindings.set(record.symbol, existing?.id || '@' + record.symbol);
    if (existing) allowedExactReads.add('/api/dicts/' + record.key + '/' + existing.id);
    preflight.push({ symbol: record.symbol, key: record.key, existingId: existing?.id || null, expected: body });
  }
  journal.plan = preflight;
  journal.queued = preflight.filter(row => !row.existingId).length;
  save('preflight', journal);
  if (mode === 'apply') {
    for (const [index, record] of plan.records.entries()) {
      const check = preflight[index];
      const body = resolve(record.body, bindings);
      if (check.existingId) {
        const row = api('existing-' + record.symbol, '/api/dicts/' + record.key + '/' + check.existingId);
        assert(fieldsMatch(row, body, record.key), 'Existing changed after preflight: ' + record.symbol);
        bindings.set(record.symbol, check.existingId);
        journal.reused.push({ symbol: record.symbol, key: record.key, id: check.existingId });
      } else {
        // Сначала фиксируем намерение: неуспешный транспорт POST нельзя автоматически повторять.
        journal.pendingPost = { symbol: record.symbol, key: record.key, body };
        save('progress', journal);
        const created = api('created-' + record.symbol, '/api/dicts/' + record.key, body);
        assert(oid.test(created.id), 'Created id missing: ' + record.symbol);
        const exact = '/api/dicts/' + record.key + '/' + created.id;
        allowedExactReads.add(exact);
        bindings.set(record.symbol, created.id);
        journal.created.push({ symbol: record.symbol, key: record.key, id: created.id });
        journal.rollbackPlanOnly.unshift({ symbol: record.symbol, key: record.key, id: created.id,
          action: 'После отдельного решения и проверки ссылок: только мягкое удаление, не выполняется этим скриптом' });
        delete journal.pendingPost;
        save('progress', journal);
        const row = api('readback-' + record.symbol, exact);
        assert(fieldsMatch(row, body, record.key), 'POST readback mismatch: ' + record.symbol);
        journal.verified.push(record.symbol);
        save('progress', journal);
      }
    }
    const after = Object.fromEntries(readNamespaces.map(key => [key, list(key, 'after')]));
    for (const key of readNamespaces) assert(after[key].length === before[key].length + journal.created.filter(row => row.key === key).length,
      'Full final count drift: ' + key);
    for (const record of plan.records) {
      const id = bindings.get(record.symbol);
      assert(fieldsMatch(after[record.key].find(row => row.id === id), resolve(record.body, bindings), record.key), 'Final reference/content mismatch: ' + record.symbol);
    }
    journal.finalCounts = Object.fromEntries(readNamespaces.map(key => [key, after[key].length]));
    journal.resolvedIds = Object.fromEntries(plan.records.map(row => [row.symbol, bindings.get(row.symbol)]));
  }
  if (environment === 'prod') {
    assert(same(guard1061, protect1061(api('after-1061-template', product1061))), 'Protected 1061 state changed');
    assert(same(guard1068, protect1068(api('after-1068-showcase', product1068))), 'Protected 1068 state changed');
  }
  journal.completed = true;
  console.log(JSON.stringify({ ...journal, log: run }));
} catch (error) {
  journal.error = error.message;
  console.error(JSON.stringify({ ...journal, log: run }));
  process.exitCode = 1;
} finally {
  save('summary', journal);
}
