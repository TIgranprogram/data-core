import { api, PREFIX, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { actions, badge, button, enhanceSelect, fieldRow, hint, section, segmented, select, stack, tagPick, textInput, toast, toastError } from '../../ui/kit/index.js';
import { FULL_KINDS, kindName, kindNorm } from '../../core/passport-kinds.js';
import { canEdit as canEditTexts, dictRows, passportCategoryOptions } from './common.js';
import { elementsTexts } from './elements-block.js';
import { passportVariant, previewPassport, VARIANT_HINT } from './dialogs.js';
import { jointsPick } from './traits.js';
import { ownTexts } from './template-texts.js';
import { patchProduct, putDefaults } from './funnel/api.js';
import { savePd } from '../products/data.js';
import { passportSlot } from '../product-files.js';
import { openTechSheet } from '../tech-sheet.js';

/**
 * Правка шаблона паспорта по разделам документа (C056 Г+Б).
 * Ответ пишется в изделие сразу. Д5: текст «Установка» с привязкой сам ставит способ установки.
 * Эталон fill (часть Д) — ещё нет: воронка «Новый паспорт» живёт отдельно.
 */
const PLACE = {
  overview: 'general',
  dimensions: 'dims', view_front: 'dims', view_side: 'dims', view_top: 'dims', view_3d: 'dims',
  overview_callouts: 'struct', nameplate: 'struct',
  mounting: 'install', foundation: 'install', holes: 'install', safety: 'install',
  assembly: 'assembly',
};
const OPS = [
  ['serviceLifeYears', 'Срок службы, лет'], ['warrantyMonths', 'Гарантия, мес.'],
  ['ageFrom', 'Возраст от, лет'], ['ageTo', 'Возраст до, лет'],
  ['heightMin', 'Рост от, мм'], ['heightMax', 'Рост до, мм'],
  ['weightMax', 'Вес пользователя до, кг'], ['fallHeight', 'Высота падения, мм'],
  ['siteLength', 'Площадка: длина, мм'], ['siteWidth', 'Площадка: ширина, мм'],
];
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const href = (u) => (!u ? '' : (String(u).startsWith('http') || String(u).startsWith(PREFIX) ? u : PREFIX + u));
const boxOf = (s) => {
  const name = s.name || ''; const sec = s.section || '';
  if (sec === 'purpose' || /назначен/i.test(name)) return 'purpose';
  if (sec === 'installation' || sec === 'mounting' || /установ|монтаж/i.test(name)) return 'install';
  if (sec === 'assembly' || /сборк/i.test(name)) return 'assembly';
  if (/гарант|эксплуатац|уход|осмотр|обслужив|хранен/i.test(name) || ['warranty', 'maintenance', 'service', 'care'].includes(sec)) return 'ops';
  return 'other';
};

export async function templateForm(r) {
  const can = session.canEdit && canEditTexts();
  const codeOf = () => r.passportDefaults?.passportCategory || r.passportCategory?.code || '';
  const [catOpts, elRows, instRows] = await Promise.all([
    passportCategoryOptions(), dictRows('passportElements'), dictRows('passportInstall'),
  ]);
  const { funnelBox } = await import('../../ui/funnel.js');
  const hosts = { purpose: h('div'), install: h('div'), assembly: h('div'), ops: h('div'), other: h('div') };
  const slotHost = { general: h('div'), dims: h('div'), struct: h('div'), install: h('div'), assembly: h('div') };
  const titles = {}; const secs = {};
  const block = (id, title, body) => {
    titles[id] = title;
    const sec = section({ title, fixed: true, tone: 'info', body });
    sec.dataset.sec = id; secs[id] = sec; return sec;
  };
  const setMark = (id, n) => { const h2 = secs[id]?.querySelector('h2'); if (h2) h2.textContent = n ? `${titles[id]} · не хватает ${n}` : `${titles[id]} · готово`; };

  let byKind = new Map(); let asked = new Set(); let missing = []; let pdm = [];
  const strip = h('div');
  const installBox = h('div');
  let mute = 1; // первый change воронки — загрузка, не запись
  const apiBox = {};

  const catSel = select({
    label: 'Категория паспорта',
    options: [['', '— по разделу и группе —'], ...catOpts.map((c) => [c.value, c.label])],
    value: r.passportDefaults?.passportCategory || codeOf(),
    onChange: (v) => onCategory(v),
  });
  if (catOpts.length > 12) enhanceSelect(catSel);

  function place(list) {
    if (!apiBox.fb) return;
    Object.values(hosts).forEach((b) => b.replaceChildren());
    for (const s of list) {
      const node = apiBox.fb.stepEl(s.id);
      if (node) hosts[boxOf(s)].append(node);
    }
    if (secs.other) secs.other.hidden = !hosts.other.childNodes.length;
    // один выбор способа установки: плитки «Установка», если их варианты сопоставимы со справочником; иначе — отдельный список
    const inst = apiBox.fb.install();
    installBox.hidden = inst.leaves.some((l) => typeOfLeaf(l));
    syncInstall(inst);
  }
  /** Уже выбранный способ установки (старое поле) — отметить соответствующую плитку текста один раз. */
  let synced = false;
  function syncInstall(inst) {
    if (synced || !inst.section || !inst.leaves.length) return;
    synced = true;
    const was = String(r.passportDefaults?.installationTypeId || '');
    if (inst.chosen || !was) return;
    const leaf = inst.leaves.find((l) => typeOfLeaf(l) === was);
    if (leaf && can) setTimeout(() => apiBox.fb.choose(inst.section.id, leaf.id), 0);
  }
  apiBox.fb = funnelBox({
    value: JSON.stringify(r.passportDefaults?.textChoices || {}),
    category: catSel.value, canEditText: can, onPaint: place, productId: r.id,
  });

  const els = elementsTexts(elRows);
  const elPick = tagPick({
    label: 'Что это за изделие', productOnly: true,
    value: (r.passportDefaults?.elements || []).map(String),
    options: elRows.map((d) => ({ value: String(d.id || d._id), label: d.name || 'без названия', kind: d.kind, cats: String(d.categories || '').split(/[,;\s]+/).filter(Boolean) })),
  });
  elPick.setScope(catSel.value);
  els.setIds(elPick.value);
  const elTexts = section({ title: 'Тексты элементов', open: false, tone: 'neutral', body: els.el });

  const joints = jointsPick(r.passportDefaults?.joints || []);
  const kitSeg = segmented({
    label: 'Как поставляется', value: r.passportDefaults?.isKit ? 'yes' : 'no',
    items: [{ key: 'no', label: 'Цельное' }, { key: 'yes', label: 'Разобранное' }],
    onChange: (k) => saveKit(k === 'yes'),
  });
  const variant = segmented({
    label: 'Вариант паспорта', value: passportVariant.value,
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    onChange: (k) => { passportVariant.value = k; reload(); },
  });

  function fieldNum(key, label, current, save) {
    const f = textInput({ label, value: current ?? '', type: 'number', disabled: !can });
    f.input.addEventListener('change', () => save(num(f.value)));
    return f.el;
  }
  const dims = ['length', 'width', 'height'].map((k, i) => fieldNum(k, ['Длина, мм', 'Ширина, мм', 'Высота, мм'][i], r.dimensions?.[k] ?? '', () => saveDims()));
  const weight = fieldNum('weightKg', 'Вес, кг', r.weightKg ?? '', (v) => { if (v) save(() => patchProduct(r.id, { weightKg: v }).then(() => { r.weightKg = v; })); });
  const users = fieldNum('maxUsers', 'Пользователей одновременно', r.passportDefaults?.maxUsers ?? '', (v) => { if (v) save(() => putDefaults(r, { maxUsers: v })); });
  const ops = OPS.map(([k, label]) => fieldNum(k, label, r.passportDefaults?.[k] ?? '', (v) => { if (v) save(() => putDefaults(r, { [k]: v })); }));

  const instOpts = instRows.filter((d) => {
    const cats = String(d.categories || '').split(/[,;\s]+/).filter(Boolean);
    return !cats.length || cats.includes(catSel.value);
  }).map((d) => [String(d.id || d._id), d.name || '']);
  /** Способ установки по варианту текста: привязка из справочника, иначе по слову («Анкерное крепление» ↔ «Анкеры на фундамент»). */
  const STEMS = [/анкер/i, /бетон/i, /заклад/i, /свобод|без креп/i];
  const stemOf = (s) => STEMS.findIndex((re) => re.test(String(s || '')));
  function typeOfLeaf(leaf) {
    if (!leaf) return '';
    if (leaf.installTypeId) return String(leaf.installTypeId);
    const i = stemOf(leaf.name);
    return i < 0 ? '' : instOpts.find(([, n]) => stemOf(n) === i)?.[0] || '';
  }
  const instSel = select({
    label: 'Способ установки',
    options: [['', 'Выберите…'], ...instOpts],
    value: String(r.passportDefaults?.installationTypeId || ''),
    disabled: !can,
    onChange: (v) => { if (v) save(() => putDefaults(r, { installationTypeId: v })); },
  });
  if (instOpts.length > 12) enhanceSelect(instSel);
  installBox.replaceChildren(hint('Вариант текста не подсказывает способ установки — выберите его здесь.'), instSel);

  function pdmBtn(kind, title) {
    const file = pdm.find((f) => f.docKind === kind && f.url);
    if (!file) return null;
    return button({ label: 'Взять из PDM', size: 'S', title, onClick: () => window.open(href(file.url), '_blank', 'noopener') });
  }
  const unnamed = () => (r.needsName || (r.composition || []).some((l) => l.needsName) ? hint('У детали нет названия', 'warn') : null);

  const nSpec = r.materialsSpec?.rows?.length || 0;
  const coat = (r.materialsSpec?.coatingIds || []).length;
  const matLine = hint(nSpec || coat ? `Из чего сделано: ${nSpec} строк${coat ? ', покрытие задано' : ''}` : 'Не указано, из чего сделано изделие — нажмите «Открыть техописание» и выберите части и материалы (можно «Взять из состава»).', nSpec || coat ? undefined : 'warn');
  const matBtn = button({ label: 'Открыть техописание', size: 'S', onClick: () => openTechSheet(r) });

  const general = block('general', 'Общие сведения', [slotHost.general, users]);
  const purpose = block('purpose', 'Назначение и элементы', [elPick.el, hosts.purpose, elTexts]);
  const dimSec = block('dims', 'Габариты и виды', [fieldRow(...dims, weight), hint('Рисунок — один: чертёж с габаритами. На нём можно показать сразу все виды (спереди, сбоку, сверху). Отдельные места под каждый вид — в варианте паспорта «Полный».'), slotHost.dims]);
  const struct = block('struct', 'Конструкция и материалы', [hint('Как соединены детали — выберите одно или оба. От этого зависят пункты осмотра в паспорте: болты — «подтягивать», сварка — «осматривать швы». «Цельное» — без болтов и сварки.'), joints.el, hint('Как поставляется заказчику'), kitSeg.el, matLine, matBtn, slotHost.struct]);
  const instSec = block('install', 'Установка', [installBox, hosts.install, slotHost.install]);
  const assembly = block('assembly', 'Сборка', [hosts.assembly, slotHost.assembly]);
  const opsSec = block('ops', 'Эксплуатация и гарантия', [fieldRow(...ops), hosts.ops]);
  const other = block('other', 'Другие тексты', hosts.other);
  const own = ownTexts({ r, can, save: (job) => save(job) });
  assembly.hidden = !r.passportDefaults?.isKit;

  async function save(job) {
    if (!can) return;
    try { await job(); await reload(); } catch (e) { toastError(e, 'сохранить в изделие'); }
  }
  async function saveKit(isKit) {
    assembly.hidden = !isKit;
    await save(() => putDefaults(r, { isKit }));
  }
  async function saveDims() {
    const inputs = dims.map((el) => el.querySelector('input'));
    const [length, width, height] = inputs.map((i) => num(i?.value));
    if (!(length && width && height)) return;
    await save(() => patchProduct(r.id, { dimensions: { length, width, height, unit: r.dimensions?.unit || 'мм' } }).then(() => { r.dimensions = { length, width, height, unit: 'мм' }; }));
  }
  async function saveTexts() {
    if (!can) return;
    const choices = JSON.parse(apiBox.fb.value || '{}');
    const inst = typeOfLeaf(apiBox.fb.installLeaf());
    const change = { textChoices: choices };
    if (catSel.value) change.passportCategory = catSel.value;
    if (inst) change.installationTypeId = inst;
    await save(() => putDefaults(r, change));
  }
  async function onCategory(v) {
    mute += 2; // смена категории и повторная загрузка текстов — не вторая запись
    apiBox.fb.setCategory(v);
    elPick.setScope(v);
    try {
      if (!v) await savePd(r.id, { category: '', choices: {}, over: {}, derived: r.passportCategory?.code || '', prev: r.passportDefaults || {} });
      else await putDefaults(r, { passportCategory: v, textChoices: {}, textOverrides: {} }); // свои тексты привязаны к разделам категории
      Object.assign(r, await api(`/showcase/${r.id}`));
      await reload();
    } catch (e) { toastError(e, 'сохранить категорию'); }
  }
  elPick.el.addEventListener('change', () => {
    let ids = []; try { ids = JSON.parse(elPick.value); } catch { ids = []; }
    if (ids.length > 3) { ids = ids.slice(0, 3); elPick.value = JSON.stringify(ids); toast('Не больше трёх элементов'); }
    els.setIds(ids);
    save(() => putDefaults(r, { elements: ids }));
  });
  joints.el.addEventListener('change', () => {
    let list = []; try { list = JSON.parse(joints.value); } catch { list = []; }
    save(() => putDefaults(r, { joints: list }));
  });
  apiBox.fb.el.addEventListener('change', () => { if (mute) { mute--; return; } saveTexts(); });

  function paintSlots() {
    const full = passportVariant.value === 'full';
    const kit = !!r.passportDefaults?.isKit;
    for (const host of Object.values(slotHost)) host.replaceChildren();
    const kinds = [...new Set([...asked, ...byKind.keys()])].filter((k) => PLACE[k]);
    const shown = kinds.filter((k) => (full || !FULL_KINDS.has(k)) && (k !== 'assembly' || kit || asked.has(k) || byKind.has(k)));
    if (!codeOf()) {
      slotHost.general.replaceChildren(hint('Сначала выберите категорию паспорта'));
      return;
    }
    const buckets = {};
    for (const k of shown) {
      const id = PLACE[k];
      (buckets[id] ||= []).push(passportSlot({
        productId: r.id, kind: k, rec: byKind.get(k), canEdit: can,
        required: asked.has(k) && !byKind.has(k), onChange: () => reload(),
      }));
    }
    for (const [id, nodes] of Object.entries(buckets)) slotHost[id].replaceChildren(h('div', { class: 'pp-slots' }, ...nodes));
    const extra = stack(pdmBtn('assembly', 'Сборочный чертёж из PDM'), unnamed());
    if (extra.childNodes.length) slotHost.dims.append(extra);
    const instExtra = pdmBtn('install', 'Схема установки из PDM');
    if (instExtra) slotHost.install.append(instExtra);
  }
  function paintStrip() {
    const miss = missing.filter((m) => m && m.key);
    const secOf = (m) => (String(m.key).startsWith('img_') ? (PLACE[kindNorm(m.key.slice(4))] || 'other') : ({
      maxUsers: 'general', name: 'general', description: 'general', height: 'dims', weight: 'dims',
      elements: 'purpose', purpose: 'purpose', joints: 'struct', materials: 'struct',
      installationTypeId: 'install', installationMethod: 'install',
    }[m.key] || (OPS.some(([k]) => k === m.key) ? 'ops' : 'other')));
    const bySec = {};
    for (const m of miss) (bySec[secOf(m)] ||= []).push(m);
    Object.keys(secs).forEach((id) => setMark(id, (bySec[id] || []).length));
    if (!codeOf()) { strip.replaceChildren(hint('Сначала выберите категорию паспорта', 'warn')); return; }
    if (!miss.length) { strip.replaceChildren(badge('Паспорт можно выпускать', 'ok')); return; }
    const chips = miss.slice(0, 12).map((m) => {
      const name = String(m.key).startsWith('img_') ? kindName(m.key.slice(4)) : (m.label || m.key);
      return button({ label: name, size: 'S', kind: 'ghost', onClick: () => secs[secOf(m)]?.scrollIntoView({ block: 'start' }) });
    });
    strip.replaceChildren(hint(`Не хватает ${miss.length}`), ...chips);
  }
  async function reload() {
    const cat = codeOf();
    let photos = []; let check = null; let files = [];
    try {
      [photos, check, files] = await Promise.all([
        api(`/products/${r.id}/photos?purpose=passport`).then((x) => x.items || x).catch(() => []),
        cat ? api('/passports/check', { method: 'POST', body: { productId: r.id, mode: 'template', variant: passportVariant.value } }).catch(() => null) : null,
        api('/pdm-files', { query: { ownerKind: 'product', ownerId: r.id } }).then((x) => x.items || []).catch(() => []),
      ]);
    } catch (e) { toastError(e, 'обновить шаблон'); }
    byKind = new Map((photos || []).map((x) => [kindNorm(x.kind), x]));
    const slots = [...(check?.imageSlots || []), ...(check?.requiredImages || [])].map(kindNorm).filter(Boolean);
    asked = new Set(slots);
    missing = check?.missing || [];
    pdm = files || [];
    assembly.hidden = !r.passportDefaults?.isKit && !asked.has('assembly');
    paintSlots(); paintStrip();
    own.load();
  }

  const el = stack(
    hint('Категория паспорта'), catSel,
    hint('Вариант паспорта'), variant.el, hint(VARIANT_HINT),
    strip, general, purpose, dimSec, struct, instSec, assembly, opsSec, other, own.el,
    actions(button({
      label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК». Паспорт не выпускается',
      onClick: () => previewPassport(r.id),
    })),
  );
  reload();
  return {
    el, readonly: true, dirty: () => false,
    focus: () => catSel.focus(),
    read: () => ({ values: { category: catSel.value, choices: JSON.parse(apiBox.fb.value || '{}'), over: {} } }),
  };
}
