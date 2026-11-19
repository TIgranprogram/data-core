import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [mode, releasedCommit, approvedPlanSha] = process.argv.slice(2);
const planFile = 'docs/crew/C155-passport-owner-queue/dictionary-content-plan.json';
const sourceDir = 'tools/logs/c155-dictionary-source';
const section = 'simple-description';
const objectId = /^[a-f0-9]{24}$/;
const dicts = ['passportCategories', 'passportKinds', 'passportParts', 'productFacets', 'productFacetValues', 'passportPhrases'];
const productionOrigin = 'https://kppdf-crm.ru';
const j = value => JSON.stringify(value, null, 2) + '\n';
const requireThat = (ok, error) => { if (!ok) throw Error(error); };
const dir = path.resolve(sourceDir, 'prod-short', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);

function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const locations = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git'),
    'C:/Program Files/Git',
  ];
  const installed = locations.filter(Boolean).map(root => path.join(root, 'bin', 'bash.exe')).find(file => fs.existsSync(file));
  requireThat(installed, 'Для Windows нужен Git for Windows с Git Bash');
  return installed;
}

requireThat(['dry', 'apply'].includes(mode), 'Укажите dry или apply');
requireThat(/^[0-9a-f]{8}$/i.test(releasedCommit ?? ''), 'Нужны восемь символов опубликованной ревизии');
requireThat(/^[0-9a-f]{64}$/i.test(approvedPlanSha ?? ''), 'Требуется утверждённая SHA-256 плана');
const planBuffer = fs.readFileSync(planFile);
requireThat(createHash('sha256').update(planBuffer).digest('hex') === approvedPlanSha.toLowerCase(), 'Содержимое плана изменилось');
const plan = JSON.parse(planBuffer);
fs.mkdirSync(dir, { recursive: true });
const summary = { mode, releasedCommit, approvedPlanSha, completed: false, roots: 0, leaves: 0, wouldCreate: 0, existing: 0, created: [] };

const save = (file, value) => {
  const target = path.join(dir, file);
  fs.writeFileSync(target, j(value));
  return target.replaceAll('\\', '/');
};

async function releaseVersion() {
  const response = await fetch(`${productionOrigin}/db/app/version.json`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  requireThat(response.ok, 'Публичная версия рабочего сайта недоступна');
  const version = await response.json();
  requireThat(String(version.v).toLowerCase() === releasedCommit.toLowerCase(), 'Рабочий сайт публикует другую версию');
  return { v: version.v, date: version.date };
}

const pacing = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
let lastRequestStarted = -Infinity;

function request(method, dict, item, file) {
  requireThat(dicts.includes(dict) && (!item || objectId.test(item)), 'Недопустимый словарный маршрут');
  const endpoint = `/api/dicts/${dict}${item ? `/${item}` : ''}`;
  requireThat(method === 'GET' || (mode === 'apply' && method === 'POST' && dict === 'passportPhrases' && !item && file), 'Запрещён запрос записи');
  const waitMs = 1000 - (performance.now() - lastRequestStarted);
  if (waitMs > 0) Atomics.wait(pacing, 0, 0, waitMs);
  lastRequestStarted = performance.now();
  const response = spawnSync(findBash(), ['deploy/synology/api.sh', 'prod', method, endpoint, ...(file ? [file] : [])], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  requireThat(response.status === 0, `${method} ${endpoint}: api.sh exit ${response.status}`);
  let value;
  try { value = JSON.parse(response.stdout); } catch { throw Error(`${method} ${endpoint}: ответ не JSON`); }
  requireThat(!value.statusCode || value.statusCode < 400, `${method} ${endpoint}: HTTP ${value.statusCode}`);
  return value;
}

function rows(result, dict) {
  requireThat(Array.isArray(result.items) && result.items.every(r => objectId.test(r.id)), `Некорректный список ${dict}`);
  return result.items;
}

const fold = value => String(value ?? '').trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function unique(items, match, label) {
  const found = items.filter(match);
  requireThat(found.length === 1, `${label}: ожидается одна запись, найдено ${found.length}`);
  return found[0];
}

function makeResolvers(current) {
  const reference = dict => rows(JSON.parse(fs.readFileSync(path.join(sourceDir, `${dict}.json`), 'utf8')), dict);
  const oldKinds = reference('passportKinds');
  const oldParts = reference('passportParts');
  const oldValues = reference('productFacetValues');
  const oldFacets = reference('productFacets');
  const plannedParts = plan.currentFieldsOnQa.addParts;
  const plannedFacets = [...plan.production.addFacets.map(f => ({ fields: f.fields, values: f.values.map(v => v.fields) })), ...plan.currentFieldsOnQa.addFacets];

  const kind = (id, category) => {
    const ref = unique(oldKinds, row => row.id === id && row.passportCategory === category, `Плановый вид ${id}`);
    return unique(current.passportKinds, row => row.passportCategory === category && fold(row.name) === fold(ref.name), `Рабочий вид ${ref.name}`).id;
  };
  const part = id => {
    const ref = id.startsWith('@part:')
      ? unique(plannedParts, row => row.name === id.slice(6), `Плановая часть ${id}`)
      : unique(oldParts, row => row.id === id, `Исходная часть ${id}`);
    const found = unique(current.passportParts, row => fold(row.name) === fold(ref.name), `Рабочая часть ${ref.name}`);
    requireThat(String(found.genPlural || found.genSingular || '').trim(), `У рабочей части ${ref.name} отсутствует родительный падеж`);
    return found.id;
  };
  const facet = (id, category) => {
    const reference = id.startsWith('@value:')
      ? (() => {
          const code = id.slice(7);
          const parent = unique(plannedFacets, row => row.values.some(value => value.code === code), `Плановый признак ${code}`);
          const value = unique(parent.values, row => row.code === code, `Плановое значение ${code}`);
          return { parent: parent.fields, value };
        })()
      : (() => {
          const value = unique(oldValues, row => row.id === id, `Исходное значение ${id}`);
          const parent = unique(oldFacets, row => row.id === value.parentId, `Исходный признак ${value.code}`);
          return { parent, value };
        })();
    const parent = unique(current.productFacets, row => row.code === reference.parent.code, `Рабочий признак ${reference.parent.code}`);
    requireThat(parent.category === category && fold(parent.name) === fold(reference.parent.name), `Изменился рабочий признак ${parent.code}`);
    const value = unique(current.productFacetValues, row => row.code === reference.value.code, `Рабочее значение ${reference.value.code}`);
    requireThat(value.parentId === parent.id && fold(value.name) === fold(reference.value.name), `Изменились название или родитель ${value.code}`);
    return value.id;
  };
  return { kind, part, facet };
}

const cleanPhrase = row => ({
  name: row.name, section: row.section, categories: row.categories,
  parentId: row.parentId || '', text: row.text || '', order: row.order ?? 0,
  allCategories: row.allCategories === true, required: row.required === true, isDefault: row.isDefault === true,
  kindIds: row.kindIds || [], partIds: row.partIds || [], facetValueIds: row.facetValueIds || [],
  groupIds: row.groupIds || [], installTypeId: row.installTypeId || '',
});

function plannedPhrases(current) {
  const coverage = plan.qaWithC155.kindCoverage;
  const accepted = coverage.filter(kind => ['qa', 'qa-conditional'].includes(kind.status));
  const roots = plan.qaWithC155.roots.filter(root => accepted.some(kind => kind.phraseRootKey === root.key));
  requireThat(accepted.filter(kind => kind.status === 'qa').length === 18 && accepted.filter(kind => kind.status === 'qa-conditional').length === 7
    && roots.length === 25 && roots.flatMap(root => root.leaves).length === 32, 'Пакет отличается от утверждённых 25 веток и 32 вариантов');
  requireThat(new Set(roots.flatMap(root => [root.key, ...root.leaves.map(leaf => leaf.key)])).size === 57, 'В плане повторяются ключи');
  const { kind, part, facet } = makeResolvers(current);
  const knownFields = new Set(['name', 'section', 'categories', 'parentId', 'text', 'order', 'allCategories', 'required', 'isDefault', 'kindIds', 'partIds', 'facetValueIds']);
  function body(node, allowedKind, category, parentRef = '') {
    const fields = node.fields;
    requireThat(Object.keys(fields).every(key => knownFields.has(key)) && fields.section === section && fields.categories === category && fields.allCategories === false
      && fields.kindIds?.length === 1 && fields.kindIds[0] === allowedKind && (fields.parentId || '') === parentRef.replace(/^@parent:/, '@phrase:')
      && Boolean(fields.text?.trim()) === Boolean(parentRef), `Не соответствует плану: ${node.key}`);
    const content = cleanPhrase({ ...fields, parentId: parentRef, kindIds: fields.kindIds.map(id => kind(id, category)), partIds: (fields.partIds || []).map(part), facetValueIds: (fields.facetValueIds || []).map(id => facet(id, category)) });
    if (content.text.includes('{parts}')) requireThat(content.partIds.length > 0, `Не подобраны части: ${node.key}`);
    return content;
  }
  return roots.map(root => {
    const kind = unique(accepted, row => row.phraseRootKey === root.key, `Вид для ${root.key}`);
    requireThat(current.passportCategories.some(row => row.code === kind.category), `Не найдена категория ${kind.category}`);
    return {
      key: root.key,
      body: body(root, kind.kindId, kind.category),
      children: root.leaves.map(leaf => ({ key: leaf.key, body: body(leaf, kind.kindId, kind.category, `@parent:${root.key}`) })),
    };
  });
}

function sibling(items, body, key) {
  const matched = items.filter(row => fold(row.name) === fold(body.name) && (row.parentId || '') === body.parentId);
  if (!matched.length) return null;
  requireThat(matched.length === 1 && same(cleanPhrase(matched[0]), body), `Конфликт существующей фразы ${key}`);
  return matched[0];
}

function designDry(roots, available) {
  const dry = [];
  const rootNames = new Set();
  for (const root of roots) {
    requireThat(!rootNames.has(fold(root.body.name)), `Дубликат корня в плане ${root.key}`);
    rootNames.add(fold(root.body.name));
    const before = sibling(available, root.body, root.key);
    dry.push({ key: root.key, action: before ? 'verify' : 'create', before, body: root.body });
    const seen = new Set();
    for (const leaf of root.children) {
      requireThat(!seen.has(fold(leaf.body.name)), `Дубликат листа в плане ${leaf.key}`);
      seen.add(fold(leaf.body.name));
      const body = { ...leaf.body, parentId: before?.id || leaf.body.parentId };
      const current = before ? sibling(available, body, leaf.key) : null;
      dry.push({ key: leaf.key, action: current ? 'verify' : 'create', before: current, body });
    }
  }
  return dry;
}

function apply(dry) {
  const parentIds = new Map();
  for (const [i, entry] of dry.entries()) {
    const label = `${String(i + 1).padStart(2, '0')}-${entry.key}`;
    if (entry.action === 'verify') {
      const existing = request('GET', 'passportPhrases', entry.before.id);
      save(`${label}.readback.json`, existing);
      requireThat(same(cleanPhrase(existing), entry.body), `Фраза изменилась после сверки ${entry.key}`);
      if (!entry.body.parentId) parentIds.set(entry.key, existing.id);
      continue;
    }
    const body = { ...entry.body };
    if (body.parentId.startsWith('@parent:')) body.parentId = parentIds.get(body.parentId.slice(8));
    requireThat(body.parentId === '' || objectId.test(body.parentId ?? ''), `Не разрешён родитель ${entry.key}`);
    const file = save(`${label}.request.json`, body);
    const created = request('POST', 'passportPhrases', null, file);
    save(`${label}.response.json`, created);
    requireThat(objectId.test(created.id ?? ''), `Не возвращён id ${entry.key}`);
    summary.created.push({ key: entry.key, id: created.id, parentId: body.parentId || null });
    if (!body.parentId) parentIds.set(entry.key, created.id);
    const readback = request('GET', 'passportPhrases', created.id);
    save(`${label}.readback.json`, readback);
    requireThat(same(cleanPhrase(readback), body), `Контрольное чтение отличается для ${entry.key}`);
    console.log(`Подтверждено ${summary.created.length}/${summary.wouldCreate}: ${entry.key}`);
  }
}

try {
  save('release.json', await releaseVersion());
  const current = {};
  for (const dict of dicts) {
    const result = request('GET', dict);
    save(`before-${dict}.json`, result);
    current[dict] = rows(result, dict);
    if (dict === 'passportPhrases') {
      const fields = result.dict?.fields || [];
      requireThat(fields.find(field => field.key === 'section')?.options?.some(option => option.value === section)
        && fields.some(field => field.key === 'kindIds' && field.ref === 'passportKinds')
        && fields.some(field => field.key === 'partIds' && field.ref === 'passportParts'), 'Рабочий API ещё не поддерживает короткие словарные фразы');
    }
  }
  const roots = plannedPhrases(current);
  const dry = designDry(roots, current.passportPhrases);
  save('dry-plan.json', dry);
  summary.roots = roots.length;
  summary.leaves = dry.length - roots.length;
  summary.wouldCreate = dry.filter(row => row.action === 'create').length;
  summary.existing = dry.length - summary.wouldCreate;
  if (mode === 'apply') {
    await releaseVersion();
    apply(dry);
    const final = request('GET', 'passportPhrases');
    save('after-passportPhrases.json', final);
    const postPlan = designDry(roots, rows(final, 'passportPhrases'));
    save('dry-plan-after.json', postPlan.map(({ key, action, before }) => ({ key, action, id: before?.id })));
    requireThat(postPlan.every(row => row.action === 'verify'), 'После применения осталось добавление в dry-plan');
  }
  summary.completed = true;
} catch (error) {
  summary.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  save('summary.json', summary);
  save('rollback-candidates.json', [...summary.created].reverse());
  console.log(`Веток ${summary.roots}, листьев ${summary.leaves}, к созданию ${summary.wouldCreate}, существующих ${summary.existing}, создано ${summary.created.length}`);
  console.log(`Журнал: ${path.relative(process.cwd(), dir)}`);
}
