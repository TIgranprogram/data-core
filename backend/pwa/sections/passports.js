import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { date, isoDay } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { photoDrop } from '../ui/photos.js';
import { rowsTable } from '../ui/rows-table.js';
import { tagPick } from '../ui/tag-pick.js';
import { CAT_NAMES, KINDS, KINDS_V2, catNames } from '../core/passport-kinds.js';
import { formImages, imagesBody, modelImagesToForm } from '../core/passport-images.js';
import { createProductFor } from './products.js';
import { attachCombo } from '../ui/combo.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { openBulk } from './bulk-edit.js';

/**
 * Раздел «Паспорта изделий» (TASKS ПС.4–ПС.5): паспорт = экземпляр (№, талон, номер изделия, дата, заказчик/объект),
 * модель — общие поля (наименование, габариты, материалы, описание, картинки). Номера выдаёт сервер.
 * Новый паспорт: начните печатать наименование — выберите модель, подставится всё, кроме заказчика и даты.
 * Смотреть — менеджер и выше, создавать и менять — директор и админ (как на сервере).
 */
/** 1 паспорт, 2 паспорта, 5 паспортов. */
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
/** Виды картинок: обязательные для категории паспорта — первыми (порядок справочника), остальные — как были. */
const kinds = (r) => {
  const all = [...KINDS, ...KINDS_V2];
  const req = (r?.requiredImages || []).filter((k) => all.some(([x]) => x === k));
  return [...req.map((k) => all.find(([x]) => x === k)), ...all.filter(([x]) => !req.includes(x))];
};
const isRequired = (r, kind) => (r?.requiredImages || []).includes(kind);
/** Категории, отложенные пользователем (2026-10-22: «детские пока не делаем») — в выборе не предлагаются. */
const LATER_CATS = ['DIO', 'DSP'];
/** Категории паспорта v2 и подсказки норм (решения по умолчанию — TASKS БЗ-6). */
const V2_CATS = [
  { value: '', label: 'Без категории' }, { value: 'TRN', label: 'Тренажёр' }, { value: 'WRK', label: 'Воркаут' },
  { value: 'DSP', label: 'Детское спортивное' }, { value: 'DIO', label: 'Детское игровое' }, { value: 'MAF', label: 'Благоустройство' },
];
const V2_NUMS = [
  ['ageFrom', 'Возраст от, лет', ''], ['ageTo', 'Возраст до, лет', ''],
  ['heightMin', 'Рост пользователя от, мм', ''], ['heightMax', 'Рост до, мм', ''],
  ['weightMax', 'Вес пользователя до, кг', ''], ['maxUsers', 'Пользователей одновременно', ''],
  ['fallHeight', 'Высота свободного падения, мм', ''], ['siteLength', 'Площадка: длина, мм', 'С зоной безопасности'],
  ['siteWidth', 'Площадка: ширина, мм', ''], ['serviceLifeYears', 'Срок службы, лет', ''],
];
const dictRows = async (key) => (await api(`/dicts/${key}`).catch(() => ({ items: [] }))).items || [];
const codeList = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean);
/** Записи справочника для выбора: cats — к каким категориям паспорта относится (пусто — ко всем; ФП — фильтр по категории). */
const dictOpts = async (key) => (await dictRows(key)).map((d) => ({ value: d.id, code: d.code, label: d.name, sub: catNames(d.categories), cats: codeList(d.categories) }));
/** Обязательные виды картинок категории — как на сервере (requiredImageKinds): по строке, «(если разборное)» — только у разборных; safety_zone = safety. */
const reqKinds = (cat, isKit) => {
  const out = [];
  for (const line of String(cat?.requiredImages || '').split(/\r?\n/)) {
    if (/если разборн/i.test(line) && !isKit) continue;
    for (const k of line.replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x))) { const kk = k === 'safety_zone' ? 'safety' : k; if (!out.includes(kk)) out.push(kk); }
  }
  return out;
};
/** ПК: настройки полей категории из справочника «Категории паспортов» — строки «ключ — текст» / «ключ». */
const keyLines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+[—-]\s+/)[0].trim());
const kvLines = (s) => Object.fromEntries(String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [k, ...v] = l.split(/\s+[—-]\s+/); return [k.trim(), v.join(' - ').trim()]; }).filter(([k, v]) => k && v));
/** Категория нового паспорта (из черновика «Выпустить паспорт») — форма строится до того, как видны значения. */
let newCat = '';
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const canEdit = () => ['admin', 'director'].includes(session.user?.role) || session.user?.isOwner === true;
const num = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const dims = (r) => (r.height || r.length || r.width ? `${num(r.height) || '—'} × ${num(r.length) || '—'} × ${num(r.width) || '—'} мм` : '');
// НМ: статус паспорта — черновик (без номера) / выпущен / аннулирован; старый без статуса с номером — выпущен
const statusOf = (r) => r?.status || (r?.passportNumber && !String(r.passportNumber).startsWith('draft-') ? 'issued' : 'draft');
const isIssued = (r) => statusOf(r) === 'issued';
const STATUS_LABEL = { draft: 'Черновик', issued: 'Выпущен', annulled: 'Аннулирован' };
const statusBadge = (r) => h('span', { class: 'badge ' + ({ draft: 'warn', issued: 'ok', annulled: 'dim' }[statusOf(r)]) }, STATUS_LABEL[statusOf(r)]);
/** НМ-1: у выпущенного без «Новой редакции» меняются только эти поля (как на сервере, AFTER_PRINT_FIELDS). */
const AFTER_PRINT = ['saleDate', 'customerName', 'customerOrgId', 'orderNo', 'salesOrderId', 'objectName', 'installedBy', 'installedAt', 'note'];
/** НМ: «Новая редакция» — форма правки открывается со всеми полями для этого паспорта. */
let revisionFor = null;
/** Номер для показа: у черновика — служебная метка draft-…, её не показываем. */
const numberOf = (r) => (r?.passportNumber && !String(r.passportNumber).startsWith('draft-') ? r.passportNumber : '');
const heading = (r) => (numberOf(r) ? `Паспорт № ${numberOf(r)}` : 'Паспорт — черновик');

let facetsCache = null; let facetsAt = 0;
const facets = async () => {
  if (facetsCache && Date.now() - facetsAt < 60000) return facetsCache;
  facetsCache = await api('/passports/facets').catch(() => ({ years: [], categories: [], customers: [], suppliers: [] }));
  facetsAt = Date.now();
  return facetsCache;
};
let oursCache = null;
const ourCompanies = async () => (oursCache ??= await api('/partners', { query: { type: 'our' } }).then((r) => r.items).catch(() => []));
// ПК: категории каталога — из «Категорий каталога» справочника категорий паспортов и встречавшихся в паспортах (вшитого списка нет)
const categories = async () => { const [rows, f] = await Promise.all([dictRows('passportCategories'), facets()]); return [...new Set([...rows.flatMap((c) => String(c.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)), ...f.categories.map((c) => c.value)])]; };

/** Модели для «выберите модель» (GET /passports/models: артикул + наименование, поля и фото последнего паспорта), кэш на минуту. */
let modelsCache = null; let modelsAt = 0;
async function models() {
  if (modelsCache && Date.now() - modelsAt < 60000) return modelsCache;
  const items = await api('/passports/models');
  modelsCache = items.map((r) => ({
    productId: r.productId || null,
    label: r.name, cat: r.category || '', pic: r.thumb ? PREFIX + r.thumb : null,
    sub: [r.passportCategory && (V2_CATS.find((c) => c.value === r.passportCategory)?.label || r.passportCategory), r.article && 'арт. ' + r.article, dims(r), r.weight && num(r.weight) + ' кг', `${r.n} ${plural(r.n, 'паспорт', 'паспорта', 'паспортов')}`, (r.images || []).length ? `картинок ${(r.images || []).length}` : 'без картинок'].filter(Boolean).join(' · '),
    // поиск модели (Э5a5): название, артикул, категория каталога, категория паспорта v2
    search: normSearch([r.name, r.article, r.category, r.passportCategory, V2_CATS.find((c) => c.value === r.passportCategory)?.label].filter(Boolean).join(' ')),
    values: { _copyFrom: r.id, name: r.name, category: r.category || '', article: r.article || '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight),
      materials: r.materials || '', installationMethod: r.installationMethod || '', purpose: r.purpose || '', description: r.description || '', supplierOrgId: r.supplierOrgId || '', warrantyMonths: num(r.warrantyMonths ?? 12),
      bom: JSON.stringify(bomRows(r.bom)),
      ...(r.passportCategory ? { passportCategory: r.passportCategory, elements: JSON.stringify((r.elements || []).map(String)), materialIds: JSON.stringify((r.materialIds || []).map(String)),
        installationTypeId: r.installationTypeId ? String(r.installationTypeId) : '', isKit: r.isKit ? 'yes' : 'no', ...Object.fromEntries(V2_NUMS.map(([k]) => [k, num(r[k])])) } : {}) },
  }));
  modelsAt = Date.now();
  return modelsCache;
}

/** Готовые тексты «Описания» (GET /passports/phrases) — один запрос на форму. */
let phrasesP = null; let phrasesAt = 0;
const phrases = (field) => async () => {
  if (!phrasesP || Date.now() - phrasesAt > 60000) { phrasesP = api('/passports/phrases'); phrasesAt = Date.now(); }
  // ПК: варианты — по категории паспорта; фраза про детское у недетских категорий не предлагается
  return ((await phrasesP)[field] || []).map((x) => ({ ...x, categories: CHILD_TEXT.test(x.text) ? (x.passportCategories || []).filter((c) => CHILD_CATS.includes(c)) : x.passportCategories || [] }));
};
const CHILD_TEXT = /детск|ребён|игров/i;
const CHILD_CATS = ['DIO', 'DSP'];

/** Заказы для «№ заказа»: выбор подставляет и заказчика. */
async function orders() {
  const items = (await api('/salesorders', { query: { limit: 500, sort: '-createdAt' } }).catch(() => ({ items: [] }))).items;
  return items.filter((o) => o.orderNo).map((o) => ({ label: `№ ${o.orderNo}${o.customer ? ' · ' + o.customer : ''}`, sub: [o.title, o.shipDate && 'отгрузка ' + date(o.shipDate)].filter(Boolean).join(' · '),
    cat: '', search: normSearch([o.orderNo, o.customer, o.title].filter(Boolean).join(' ')), values: { orderNo: o.orderNo, customerName: o.customer || '', salesOrderId: o.id } }));
}

/**
 * «Выпустить паспорт» из изделия или позиции заказа (БЗ-5): открывает «Новый паспорт» в правой панели. Модель ищется
 * по ссылке на изделие, затем по артикулу, затем по названию — подставляются её поля и картинки; номер и талон — сервер.
 * Возвращает true, если модель нашлась.
 */
let draft = null;
export async function issuePassport({ productId, name, article, orderNo, salesOrderId, customerName }) {
  // ПИ: изделие — единый источник; форма сама подставит его поля, значения по умолчанию, категорию и прошлый паспорт
  let pid = productId;
  if (!pid && (article || name)) {
    const n = (s) => normSearch(s || '');
    const all = await productsAll();
    pid = (article && all.find((p) => n(p.sku) === n(article)))?.id || (name && all.find((p) => n(p.name) === n(name)))?.id || null;
  }
  draft = { productId: pid || '', salesOrderId, orderNo, customerName, ...(pid ? {} : { _searchName: name || article || '' }) };
  patch({ of: 'passports', new: '1', open: undefined });
  return !!pid;
}

/** ТЭ-6: категория по названию изделия — первое совпадение по порядку (правило из docs/PASSPORT-TEXTS-ETALON.xlsx, лист «Правило категорий»). */
const NAME_RULES = [
  ['DIO', /качел|карусел|горк|песочн|игров|домик|балансир|качалк|геопласт|детск|бизиборд|пузыр|муравейник|тоннел|пен[её]к|лабиринт/],
  ['TRN', /тренаж/],
  ['WRK', /воркаут|workout|турник|брусь|рукоход|шведск|стенк|скамья для пресса|скамья гимнаст|скамья горизонт|баскет|волейб|футбол|ворот|боксер|ринг|помост|препятств|элемент «|судейск|набивани|кольц/],
  ['MAF', /скам(ья|ейк)|урн|навес|пергол|беседк|вазон|цветоч|огражд|оградит|стенд|стел|\bстол\b|диван|лавк|велопарк|фонар|флагшток|столб|клумб/],
];
const categoryByName = (name) => { const n = String(name || '').toLowerCase().replace(/ё/g, 'е'); return NAME_RULES.find(([, rx]) => rx.test(n))?.[0] || ''; };

/** Изделия «Продукции» для выбора в паспорте (ПИ): категория паспорта, число паспортов, фото — один запрос в минуту. */
let prodCache = null; let prodAt = 0;
const productsAll = async () => {
  if (!prodCache || Date.now() - prodAt > 60000) { prodAt = Date.now(); prodCache = api('/showcase', { query: { limit: 500 } }).then((r) => r.items || []).catch(() => { prodCache = null; return []; }); }
  return prodCache;
};
const mmOf = (v, unit) => { const n = Number(v); return n > 0 ? num(Math.round(n * (unit === 'м' ? 1000 : unit === 'см' ? 10 : 1))) : ''; };
/** Поля паспорта, которые помнит изделие (passportDefaults) — флажок «Запомнить» (ПИ.4). */
const DEFAULT_KEYS = ['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', ...V2_NUMS.map(([k]) => k), 'warrantyMonths'];

/**
 * Блок «Изделие» нового паспорта (ПИ): категория → изделия категории (фото, артикул, «паспортов: N»), поиск — по всем;
 * «+ Создать изделие»; выбор подставляет по порядку: поля изделия → его значения по умолчанию → умолчания категории
 * (wireForm.defaults) → последний паспорт изделия (картинки по видам, тексты). Пока не выбрано — остальное скрыто.
 */
function productBlock(api, { r, catBy }) {
  const box = api.input('_product')?.el; if (!box) return;
  const formEl = api.root; const block = box.closest('.form-block'); block?.classList.add('pp-first');
  const saveBtn = () => [...(api.root.closest('.drawer')?.querySelectorAll('button.btn-primary') || [])].find((b) => /^(Создать|Выпустить|Сохранить)/.test(b.textContent.trim()));
  let chosen = null; let filterCat = api.get('passportCategory') || ''; let q = api.get('_searchName') || '';
  const lock = (on) => { formEl.classList.toggle('pp-locked', on); const b = saveBtn(); if (b) b.disabled = on; };
  const pic = (p) => (p?.photo ? h('img', { class: 'sg-pic', src: PREFIX + (p.photo.thumb || p.photo.url), alt: '' }) : h('div', { class: 'sg-pic sg-pic-none' }));
  const sub = (p) => [p.sku && 'арт. ' + p.sku, [p.type, p.group].filter(Boolean).join(' › '), `паспортов: ${p.passportsCount || 0}`].filter(Boolean).join(' · ');

  async function pick(p, { apply = true } = {}) {
    if (apply && !r && !(await duplicateCheck(p.id, api.get))) return; // НМ-2: дубль — открыть существующий
    chosen = p; api.set('productId', p.id); lock(false); render();
    if (apply) await applyProduct(api, p, catBy);
  }
  function render() {
    if (r) { // правка: изделие только показываем; без изделия — подсказка (привязать — в карточке)
      box.replaceChildren(chosen ? h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', null, h('b', null, chosen.name), h('div', { class: 'muted' }, sub(chosen))))
        : h('p', { class: 'muted' }, 'Паспорт без изделия — «Привязать к изделию» или «Создать изделие из паспорта» в карточке'));
      return;
    }
    if (chosen) {
      box.replaceChildren(h('div', { class: 'pp-prod-sel' }, pic(chosen), h('div', { style: { flex: '1' } }, h('b', null, chosen.name), h('div', { class: 'muted' }, sub(chosen))),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { chosen = null; render(); } }, 'Сменить')));
      return;
    }
    const cats = V2_CATS.filter((c) => c.value && !LATER_CATS.includes(c.value));
    const seg = h('div', { class: 'fseg', role: 'radiogroup', 'aria-label': 'Категория изделия' },
      ...[{ value: '', label: 'Все' }, ...cats].map((c) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn' + (filterCat === c.value ? ' on' : ''), 'aria-checked': String(filterCat === c.value),
        onclick: () => { filterCat = c.value; if (c.value) api.set('passportCategory', c.value); render(); } }, c.label)));
    const input = h('input', { type: 'text', value: q, placeholder: 'Найти изделие: название или артикул — по всем категориям', 'aria-label': 'Найти изделие', autocomplete: 'off' });
    const list = h('ul', { class: 'pp-prod-list', role: 'listbox', 'aria-label': 'Изделия' });
    const add = h('button', { type: 'button', class: 'btn btn-sm' });
    const fill = async () => {
      const all = await productsAll();
      const tk = searchTokens(q);
      let rows = tk.length ? all.filter((p) => { const s = normSearch([p.name, p.sku, p.type, p.group, p.series].filter(Boolean).join(' ')); return tk.every((t) => s.includes(t)); })
        : all.filter((p) => !filterCat || (p.ppCategory || categoryByName(p.name)) === filterCat);
      rows = rows.sort((a, b) => (b.passportsCount || 0) - (a.passportsCount || 0) || String(a.name).localeCompare(String(b.name), 'ru'));
      const shown = rows.slice(0, 60);
      list.replaceChildren(...(shown.length ? shown.map((p) => h('li', { class: 'sg-row sg-pic-row', role: 'option', tabindex: '0', onclick: () => pick(p), onkeydown: (e) => { if (e.key === 'Enter') pick(p); } },
        pic(p), h('div', null, h('div', { class: 'opt-l' }, p.name), h('small', null, sub(p)))))
        : [h('li', { class: 'sg-row static' }, h('span', { class: 'muted' }, q ? `По «${q}» изделий нет — создайте его кнопкой ниже` : filterCat ? 'В этой категории изделий пока нет — найдите по названию или создайте' : 'Изделий пока нет — создайте первое'))]),
        ...(rows.length > shown.length ? [h('li', { class: 'sg-row muted static' }, `ещё ${rows.length - shown.length} — уточните поиск`)] : []));
      add.textContent = q ? `+ Создать изделие «${q}»` : '+ Создать изделие';
    };
    let t; input.addEventListener('input', () => { q = input.value; clearTimeout(t); t = setTimeout(fill, 150); });
    add.onclick = () => {
      // форма изделия — в правой панели; после «Создать» вернёмся сюда с выбранным изделием и тем, что уже введено
      const stash = Object.fromEntries(['passportCategory', 'orderNo', 'customerName', 'salesOrderId', 'objectName', 'date', 'supplierOrgId'].map((k) => [k, api.get(k)]).filter(([, v]) => v));
      const code = filterCat || api.get('passportCategory');
      const section = String(catBy.get(code)?.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0] || '';
      createProductFor({ name: q, ...(section ? { type: section } : {}) }, (prod) => {
        prodCache = null;
        draft = { ...stash, productId: prod.id };
        patch({ of: 'passports', new: '1', open: undefined });
      });
    };
    const noProduct = h('button', { type: 'button', class: 'link-btn', onclick: () => { lock(false); box.replaceChildren(h('p', { class: 'muted' }, 'Без изделия: начните печатать наименование — возьмите данные из прошлого паспорта.')); setTimeout(() => api.input('name')?.focus?.()); } }, 'Изделия нет в «Продукции» — взять данные из прошлого паспорта');
    box.replaceChildren(h('p', { class: 'hint' }, 'Сначала изделие: выберите — паспорт заполнится из него (серым — подставленное, можно поправить).'),
      seg, h('div', { class: 'pp-prod-tools' }, input, add), list, noProduct);
    fill();
  }

  const pid = api.get('productId');
  if (pid) {
    productsAll().then(async (all) => {
      const p = all.find((x) => x.id === pid) || await api_get(`/showcase/${pid}`).catch(() => null);
      if (p) await pick(p, { apply: !r }); else { lock(!r); render(); }
    });
  } else { lock(!r); render(); }
}

/** Подстановка из изделия (ПИ.3): изделие → passportDefaults → (категория — wireForm) → прошлый паспорт изделия; ручное не трогаем. */
async function applyProduct(api, p, catBy) {
  const full = await api_get(`/showcase/${p.id}`).catch(() => p);
  const d = full.passportDefaults || {};
  const u = full.dimensions?.unit || 'мм';
  const put = (k, v, src, { onlyEmpty = false } = {}) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    const cur = api.get(k);
    if (api.manual(k) && String(cur ?? '').trim() && cur !== '[]') return;
    if (onlyEmpty && String(cur ?? '').trim() && cur !== '[]' && !api.input(k)?.classList?.contains('is-default')) return;
    api.set(k, Array.isArray(v) ? JSON.stringify(v) : v, { auto: true, src });
  };
  const ppCat = d.passportCategory || full.passportCategory?.code || p.ppCategory || categoryByName(full.name) || '';
  // 1. поля изделия
  for (const [k, v] of Object.entries({ name: full.name, article: full.sku, category: full.group || full.type, length: mmOf(full.dimensions?.length, u), width: mmOf(full.dimensions?.width, u),
    height: mmOf(full.dimensions?.height, u), weight: full.weightKg ? num(full.weightKg) : '', purpose: full.purpose, installationMethod: full.installation, description: full.description })) put(k, v, 'из изделия');
  if ((full.photos || []).length && !JSON.parse(api.get('img_overview') || '[]').length) api.set('img_overview', full.photos.map((x) => ({ id: x.id, url: x.url, thumb: x.thumb })), { auto: true, src: 'из изделия' });
  // 2. значения паспорта по умолчанию у изделия; категория — первой (за ней wireForm подставит умолчания категории в пустое)
  if (ppCat && !api.manual('passportCategory')) api.set('passportCategory', ppCat, { auto: true, src: 'из изделия' });
  for (const k of ['elements', 'materialIds']) put(k, (d[k] || []).map(String), 'из изделия');
  put('installationTypeId', d.installationTypeId ? String(d.installationTypeId) : '', 'из изделия');
  if (typeof d.isKit === 'boolean') put('isKit', d.isKit ? 'yes' : 'no', 'из изделия');
  for (const k of [...V2_NUMS.map(([x]) => x), 'warrantyMonths']) put(k, d[k] !== undefined ? num(d[k]) : '', 'из изделия');
  // 4. последний паспорт этого изделия — запасной: только в пустое; картинки по видам — через _copyFrom (wireForm)
  const last = (await models().catch(() => [])).find((m) => m.productId === p.id);
  if (last) {
    for (const [k, v] of Object.entries(last.values)) if (!['name', 'article', 'passportCategory', '_copyFrom', 'bom'].includes(k)) put(k, v, 'из прошлого паспорта', { onlyEmpty: true });
    api.set('_copyFrom', last.values._copyFrom);
  }
  void catBy;
}

/**
 * Связи формы паспорта (ФП), через form mount(api):
 * - категория → элементы / материалы / способы установки только своей категории (чужие выбранные — с пометкой, предупреждение),
 *   нормативы категории, умолчания (срок службы, гарантия, типовые ограничения) — серым, ручное не трогаем;
 * - выбрана модель → её картинки по видам в форму (видно до сохранения, без дублей);
 * - любое изменение → «Готовность к выпуску»: чего не хватает (POST /passports/check), ссылки к полям; кнопка «Выпустить».
 */
function wireForm(api, { r, w, catBy, stdName, inst }) {
  const sel = api.input('installationTypeId');
  const drawer = api.root.closest('.drawer');
  const saveBtn = () => [...(drawer?.querySelectorAll('button.btn-primary') || [])].find((b) => /^(Создать|Выпустить|Сохранить)/.test(b.textContent.trim()));
  let lastCat = api.get('passportCategory');

  const scope = (warn) => {
    const code = api.get('passportCategory');
    const foreign = [...(w.el?.setScope(code) || []), ...(w.mat?.setScope(code) || [])];
    // способ установки: свои + уже выбранный (с пометкой)
    if (sel) {
      const cur = sel.value;
      const own = (o) => !code || !o.cats.length || o.cats.includes(code);
      const list = inst.filter((o) => own(o) || o.value === cur);
      sel.replaceChildren(h('option', { value: '' }, '—'), ...list.map((o) => h('option', { value: o.value }, own(o) ? o.label : `${o.label} — не для этой категории`)));
      sel.value = cur;
      const o = inst.find((x) => x.value === cur); if (o && !own(o)) foreign.push(o.label);
    }
    const c = catBy.get(code);
    const stds = codeList(c?.standards);
    w.std.textContent = !code ? 'Выберите категорию — здесь появятся её нормативы' : stds.length ? stds.map((s) => stdName.get(s) || s).join('; ') : 'У категории не указаны нормативы — «Справочники → Паспорта → Категории паспортов»';
    if (warn && foreign.length) toast(`Не для категории «${CAT_NAMES[code] || code}»: ${foreign.join(', ')}. Оставлено — уберите, если не нужно`, { ms: 8000 });
  };
  // умолчания категории: только в пустые поля или в то, что подставлено нами и не правилось руками
  const defaults = () => {
    const code = api.get('passportCategory'); const c = catBy.get(code);
    const vals = { serviceLifeYears: c?.serviceLifeYears, warrantyMonths: c?.warrantyMonths, ...kvLines(c?.fieldDefaults) };
    for (const [k, v] of Object.entries(vals)) {
      const inp = api.input(k); if (!inp || v === undefined || v === null || v === '') continue;
      if (api.manual(k) || (String(inp.value).trim() && !inp.classList.contains('is-default'))) continue;
      api.set(k, num(v), { auto: true });
    }
  };
  // обязательные картинки категории: «*» в подписи и раскрыть блок, где они лежат (блоки строятся до выбора категории)
  const markReq = () => {
    const rq = reqKinds(catBy.get(api.get('passportCategory')), api.get('isKit') === 'yes');
    for (const [k, label] of kinds()) {
      const sp = api.field('img_' + k)?.querySelector(':scope > span'); if (!sp) continue;
      sp.textContent = label + (rq.includes(k) ? ' *' : '');
      if (rq.includes(k)) api.open('img_' + k);
    }
  };
  // ПК: «Ограничения и техданные» — только поля категории (справочник: «Поля категории», обязательные — *);
  // неприменимое скрыто, уже заполненное — видно с пометкой; подсказки — свои для категории
  const numsByCat = () => {
    const c = catBy.get(api.get('passportCategory'));
    const allowed = keyLines(c?.allowedFields); const req = keyLines(c?.requiredFields); const hints = kvLines(c?.fieldHints);
    for (const [k, label, base] of V2_NUMS) {
      const fld = api.field(k); if (!fld) continue;
      const own = !c || !allowed.length || allowed.includes(k) || req.includes(k);
      const filled = String(api.get(k) ?? '').trim() !== '';
      fld.hidden = !own && !filled;
      const sp = fld.querySelector(':scope > span');
      if (sp) { sp.textContent = label + (req.includes(k) ? ' *' : ''); if (!own && filled) sp.append(h('span', { class: 'muted' }, ' · не для этой категории')); }
      let hn = fld.querySelector(':scope > .hint');
      const text = hints[k] || base || '';
      if (!hn && text) { hn = h('div', { class: 'hint' }); fld.querySelector(':scope > .err')?.before(hn); }
      if (hn) { hn.textContent = text; hn.hidden = !text; }
    }
  };
  // ПК: категория каталога — по категории паспорта (первое из «Категорий каталога»), если не задана изделием или руками
  const catalogByCat = () => {
    if (api.manual('category')) return;
    const cur = api.get('category'); const auto = api.input('category')?.classList?.contains('is-default');
    if (cur && !auto) return;
    const first = String(catBy.get(api.get('passportCategory'))?.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) api.set('category', first, { auto: true, src: 'по категории паспорта' });
  };
  api.on('passportCategory', () => {
    const code = api.get('passportCategory');
    if (code === lastCat) return;
    lastCat = code; scope(true); defaults(); markReq(); numsByCat(); catalogByCat(); check();
  });
  api.on('isKit', markReq);
  // ТЭ: способ установки → эталонный текст «Установки» категории (вариант справочника с тем же способом)
  const INSTALL_VARIANT = { CONCRETE_POSTS: 'Бетонирование опорных стоек', EMBEDDED: 'Закладные детали', ANCHORS: 'Анкерное крепление', FENCE_POSTS: 'Ограждение на опорных стойках', FREESTANDING: 'Свободная установка', ON_SURFACE: 'Свободная установка' };
  api.on('installationTypeId', async () => {
    if (api.manual('installationMethod')) return;
    const code = inst.find((o) => o.value === api.get('installationTypeId'))?.code;
    const variant = INSTALL_VARIANT[code]; if (!variant) return;
    const rows = await dictRows('passportPhrases');
    const hit = rows.find((x) => x.section === 'installation' && x.name === variant && codeList(x.categories).includes(api.get('passportCategory')));
    if (hit) api.set('installationMethod', hit.text, { auto: true, src: 'по способу установки' });
  });

  // модель выбрана → картинки модели по видам (только в пустые виды; своё не трогаем)
  api.on('_copyFrom', async () => {
    const id = api.get('_copyFrom'); if (!id) return;
    try {
      const m = await api_get(`/passports/${id}`);
      const by = modelImagesToForm(m.images || [], kinds().map(([k]) => k));
      for (const [k, list] of Object.entries(by)) { if (!list.length) continue; const cur = JSON.parse(api.get('img_' + k) || '[]'); if (!cur.length) api.set('img_' + k, JSON.stringify(list)); }
      api.set('_imgsFrom', id);
      check();
    } catch { /* картинки добавит сервер при сохранении */ }
  });

  // «Готовность к выпуску»
  let timer; let seq = 0;
  const json = (k) => { try { return JSON.parse(api.get(k) || '[]') || []; } catch { return []; } };
  const goTo = (key) => {
    api.open(key);
    const fld = api.field(key); if (!fld) return;
    fld.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fld.classList.add('fill-here'); setTimeout(() => fld.classList.remove('fill-here'), 2500);
    (api.input(key)?.focus || (() => {})).call(api.input(key));
  };
  const KEYS = ['name', 'category', 'date', 'supplierOrgId', 'height', 'length', 'width', 'weight', 'materials', 'installationMethod', 'purpose', 'description', 'customerName', 'objectName',
    'passportCategory', 'installationTypeId', 'isKit', ...V2_NUMS.map(([k]) => k)];
  const check = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const my = ++seq;
    const body = { ...(r ? { date: r.date } : {}), ...Object.fromEntries(KEYS.map((k) => [k, api.get(k)]).filter(([, v]) => v !== '' && v != null)),
      elements: json('elements'), materialIds: json('materialIds'), images: formImages(Object.fromEntries(kinds().map(([k]) => ['img_' + k, json('img_' + k)])), kinds().map(([k]) => k)) };
    let res; try { res = await api_post('/passports/check', body); } catch { return; }
    if (my !== seq) return;
    const miss = res.missing || [];
    const who = miss.length ? await designerLine(api.get('productId')) : null;
    w.need.className = miss.length ? 'fill-note' : 'muted';
    w.need.replaceChildren(...(miss.length
      ? [h('b', null, `Не хватает для выпуска: ${miss.length}`), h('ul', { class: 'pp-need' }, ...miss.map((m) => h('li', null, m.key ? h('button', { type: 'button', class: 'link-btn', onclick: () => goTo(m.key) }, m.label) : m.label))),
        who, h('div', { class: 'hint' }, 'Черновик сохранить можно; выпустить (скачать PDF) — когда заполните всё отмеченное')]
      : [h('span', null, '✓ Всё есть — паспорт можно выпускать')]));
    const b = saveBtn();
    if (b && !b.disabled && !r) b.textContent = 'Сохранить черновик'; // НМ: номер — потом, кнопкой «Выпустить» в карточке
    // над кнопками — то же коротко: что ещё нужно для выпуска (ПП)
    if (b?.parentElement) {
      let foot = b.parentElement.querySelector('.pp-need-foot');
      if (!foot) { foot = h('div', { class: 'pp-need-foot' }); b.parentElement.prepend(foot); }
      foot.replaceChildren(...(miss.length ? [h('span', { class: 'muted' }, `Не хватает для выпуска: ${miss.slice(0, 4).map((m) => m.label).join(', ')}${miss.length > 4 ? ` и ещё ${miss.length - 4}` : ''}`)] : []));
      foot.hidden = !miss.length;
    }
  }, 500); };
  lockIssued(api, r);
  api.root.addEventListener('input', check); api.root.addEventListener('change', check);
  // ПИ.4: «Запомнить» — только если есть изделие и поправлены поля, которые изделие помнит
  const rememberField = api.field('_remember');
  const showRemember = () => { if (rememberField) rememberField.hidden = !(api.get('productId') && DEFAULT_KEYS.some((k) => api.manual(k))); };
  api.root.addEventListener('input', showRemember); api.root.addEventListener('click', () => setTimeout(showRemember));
  showRemember();
  scope(false); markReq(); numsByCat();
  if (!r && api.get('passportCategory')) { defaults(); catalogByCat(); }
  check();
}
const api_get = (p) => api(p);
/** ТЭ: все тексты справочника «Готовые тексты паспорта» (для пометки «изменено вручную»); заполняется при сборке формы. */
const PHRASE_TEXTS = new Set();
/** НМ: «Выпустить» — номер, талон и номер изделия из счётчика (сервер, одна транзакция); повторное нажатие — тот же номер. */
async function issueAction(row, ctx) {
  if (!(await confirmDlg('Выпустить паспорт?', 'Паспорт получит номер и гарантийный талон, текст будет заморожен. После выпуска номер не меняется; правки — «Новой редакцией».', { okText: 'Выпустить' }))) return;
  const r = await api(`/passports/${row.id}/issue`, { method: 'POST' });
  toast(`Выпущен паспорт № ${r.passportNumber}`); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`));
}
/** НМ: аннулирование выпущенного — причина обязательна (окно: одно поле). */
async function annulDialog(row, ctx) {
  const ta = h('textarea', { rows: 3, 'aria-label': 'Причина', placeholder: 'Например: дубль паспорта № …' });
  const res = await modal({ title: `Аннулировать паспорт № ${row.passportNumber}?`, okText: 'Аннулировать', danger: true,
    body: h('div', null, h('p', null, 'Номер останется занятым и повторно не выдаётся. Паспорт останется в списке со статусом «Аннулирован».'), h('label', { class: 'field wide' }, h('span', null, 'Причина *'), ta)),
    onOk: async () => { if (!ta.value.trim()) throw new Error('Укажите причину'); return api(`/passports/${row.id}/annul`, { method: 'POST', body: { reason: ta.value.trim() } }); } });
  if (res) { toast('Паспорт аннулирован'); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`)); }
}
/** НМ-8: номер выпущенного — только администратор, с проверкой занятости; следующий выпуск всё равно получит max + 1. */
async function numberDialog(row, ctx) {
  const inp = h('input', { type: 'text', inputmode: 'numeric', value: row.passportNumber || '', 'aria-label': 'Номер паспорта' });
  const res = await modal({ title: 'Изменить номер паспорта', okText: 'Сохранить',
    body: h('div', null, h('p', { class: 'hint' }, 'Только для исправления ошибки. Номер проверяется на занятость (в т. ч. у аннулированных и удалённых). Следующий выпуск получит номер больше максимального.'), h('label', { class: 'field wide' }, h('span', null, 'Номер'), inp)),
    onOk: async () => { const v = inp.value.trim(); if (!/^\d+$/.test(v)) throw new Error('Номер — число'); return api(`/passports/${row.id}`, { method: 'PATCH', body: { passportNumber: v, confirmNumbers: true } }); } });
  if (res) { toast('Номер изменён'); ctx.changed(); ctx.setRow(await api(`/passports/${row.id}`)); }
}
/** НМ-2: перед созданием — черновики того же изделия и выпущенные на тот же заказ / покупателя / адрес. true — создавать дальше. */
async function duplicateCheck(productId, get) {
  if (!productId) return true;
  const res = await api('/passports/duplicates', { query: { productId, orderNo: get('orderNo') || undefined, customer: get('customerName') || undefined, objectName: get('objectName') || undefined } }).catch(() => ({ items: [] }));
  if (!res.items?.length) return true;
  const list = h('ul', { class: 'timeline' }, ...res.items.map((x) => h('li', null, h('a', { href: `#passports?open=${x.id}` }, x.passportNumber ? `№ ${x.passportNumber}` : 'черновик'), h('span', { class: 'muted' }, ' · ' + [STATUS_LABEL[x.status] || '', x.name, x.customerName, x.orderNo && 'заказ ' + x.orderNo, date(x.date)].filter(Boolean).join(' · ')))));
  const open = await modal({ title: 'На это изделие паспорт уже есть', okText: 'Открыть существующий', cancelText: 'Всё равно создать',
    body: h('div', null, h('p', null, 'Возможно, это дубль:'), list), onOk: async () => res.items[0].id });
  if (open) { patch({ of: undefined, new: undefined, open }); return false; }
  return true;
}
/** НМ-1: выпущенный паспорт в форме — открыты только «после печати»; остальное — через «Новая редакция». */
function lockIssued(api, r) {
  if (!r || !isIssued(r) || revisionFor === r.id) return;
  for (const blk of api.root.querySelectorAll('.form-block')) {
    const after = /после печати/i.test(blk.textContent.split('\n')[0] || '') || blk.querySelector('[name="saleDate"]');
    if (!after) { blk.inert = true; blk.classList.add('locked'); }
  }
  api.root.prepend(h('div', { class: 'fill-note' }, `Паспорт № ${r.passportNumber} выпущен: меняются только поля «после печати». Остальное — действие «Новая редакция» в карточке (номер тот же, редакция +1).`));
}
/** БЗ-9: поля массового изменения паспортов — общие для всех выбранных. */
async function passportBulkFields() {
  const [els, mats, inst, ours, f, cats] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall'), ourCompanies(), facets(), categories()]);
  const n = (v) => (v === '' ? null : v);
  return [
    { key: 'passportCategory', label: 'Категория паспорта', type: 'select', options: V2_CATS.filter((c) => c.value).map((c) => ({ value: c.value, label: c.label })),
      hint: 'Текст паспорта соберётся заново по новой категории — правки пунктов текста у этих паспортов сбросятся' },
    { key: 'category', label: 'Категория каталога', type: 'combo', options: cats },
    { key: 'installationTypeId', label: 'Способ установки', type: 'select', options: [{ value: '', label: '— не указан —' }, ...inst.map((o) => ({ value: o.value, label: o.label }))] },
    { key: 'elements', label: 'Функциональные элементы', type: 'tags', options: els, modes: true },
    { key: 'materialIds', label: 'Материалы', type: 'tags', options: mats, modes: true },
    { key: 'isKit', label: 'Поставляется разобранным', type: 'select', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' }], map: (v) => v === 'yes' },
    { key: 'serviceLifeYears', label: 'Срок службы, лет', type: 'number', map: n },
    { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', map: n },
    ...V2_NUMS.filter(([k]) => k !== 'serviceLifeYears').map(([k, l]) => ({ key: k, label: l, type: 'number', map: n })),
    { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })) },
    { key: 'customerName', label: 'Покупатель', type: 'combo', options: f.customers.map((c) => c.value) },
    { key: 'orderNo', label: '№ заказа', type: 'text' },
    { key: 'objectName', label: 'Адрес установки', type: 'text' },
    { key: 'installedBy', label: 'Монтаж выполнил', type: 'text' },
    { key: 'saleDate', label: 'Дата продажи', type: 'date', map: n },
    { key: 'installedAt', label: 'Дата монтажа', type: 'date', map: n },
  ];
}
/** ПП: к кому идти, если не хватает данных, — «Кто проектировал» изделие (в паспорт и PDF не входит). */
const designerCache = new Map();
async function designerLine(productId) {
  if (!productId) return null;
  if (!designerCache.has(productId)) designerCache.set(productId, api(`/showcase/${productId}`).then((p) => p.designer || null).catch(() => undefined));
  const d = await designerCache.get(productId);
  if (d === undefined) return null;
  return h('div', { class: 'pp-designer' }, d ? `Спросить: ${d.name}${d.position ? ', ' + d.position : ''} (проектировал изделие)` : 'Проектировщик не указан — ',
    d ? null : h('a', { href: `#products?open=${productId}` }, 'указать в изделии'));
}
/** ПИ.4: значения по умолчанию паспорта — изделию (заменяются целиком; пустые не пишутся сервером). */
async function saveDefaults({ productId, defaults }) {
  try { await api(`/showcase/${productId}/passport-defaults`, { method: 'PUT', body: defaults }); toast('Запомнено для следующих паспортов изделия'); }
  catch (e) { toastError(e); }
}
/** ПИ.5: привязать старый паспорт к изделию — выбор из «Продукции» (окно: одно поле). */
async function linkDialog(r, ctx) {
  const all = await productsAll();
  const input = h('input', { type: 'text', 'aria-label': 'Изделие', placeholder: 'Название или артикул', value: r.name || '' });
  const ids = new Map();
  const field = h('label', { class: 'field wide' }, h('span', null, 'Изделие из «Продукции»'), input);
  attachCombo(input, { options: () => all.map((p) => { const l = `${p.name}${p.sku ? ' · арт. ' + p.sku : ''}`; ids.set(l, p.id); return { label: l, value: p.id, sub: [p.type, p.group].filter(Boolean).join(' › ') }; }) });
  const res = await modal({
    title: 'Привязать к изделию', okText: 'Привязать',
    body: h('div', null, field,
      h('p', { class: 'hint' }, 'Паспорт будет брать данные из изделия; номера, дата и текст не меняются. Нужного нет — «Создать изделие из паспорта».')),
    onOk: async () => {
      const id = ids.get(input.value.trim());
      if (!id) throw new Error('Выберите изделие из списка');
      return api(`/passports/${r.id}`, { method: 'PATCH', body: { productId: id } });
    },
  });
  if (res) { toast('Паспорт привязан к изделию'); ctx.setRow(await api(`/passports/${r.id}`)); }
}
const api_post = (p, body) => api(p, { method: 'POST', body });

/** «<Наименование> (в дальнейшем именуемое «Изделие»), изготовленное из <материалы>. <Установка> <Назначение>» — как на сервере. */
function buildDescription(v) {
  const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const sentence = (s) => (t(s) ? (/[.!?]$/.test(t(s)) ? t(s) : t(s) + '.') : '');
  const name = t(v.name).replace(/[.\s]+$/, '');
  if (!name) return '';
  const mat = t(v.materials).replace(/^изготовлен\S*\s+из\s+/i, '');
  return [`${name} (в дальнейшем именуемое «Изделие»)${mat ? ', изготовленное из ' + sentence(mat) : '.'}`, sentence(v.installationMethod), sentence(v.purpose)].filter(Boolean).join(' ');
}

// safety_zone (v2) показываем в «Зоне безопасности» (safety); без вида — в «Общем виде»
const kindOf = (i) => (i.kind === 'safety_zone' ? 'safety' : i.kind || 'overview');
const imgsOf = (r, kind) => (r.images || []).filter((i) => kindOf(i) === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** Скачать PDF: «Готовлю…» висит, пока сервер собирает файл (на сервере с одним ядром — секунды), потом «Скачан». */
async function download(r, query, what) {
  const done = toast(`Готовлю ${what}… это может занять до минуты`, { ms: 180000 });
  try { const name = await apiFile(`/passports/${r.id}/pdf`, { query, fallback: `Паспорт_${numberOf(r) || 'черновик'}.pdf` }); done(); toast(`Скачан: ${name}`); }
  catch (e) { done(); throw e; }
}

// Значки форматов (замечание пользователя 2026-10-22: «показать визуально, книжная или альбомная»)
const FORMATS = [
  { mode: 'pages', title: 'Файл A5', sub: 'книжный, постранично — отправить по почте', icon: 'sheetA5' },
  { mode: 'print', title: 'Буклет A4', sub: 'альбомный лист, сложить пополам — распечатать', icon: 'sheetBooklet' },
  { mode: 'stand', title: 'Лист для стенда A3', sub: 'правила пользования, книжный, без печати', icon: 'sheetA3' },
];

/**
 * Скачать / распечатать паспорт (замечание пользователя 2026-10-22): сначала — печать и подпись (галочки), потом вид
 * (значками: A5, буклет A4, стенд A3), ч/б — у паспорта нового образца. Окно не закрывается, пока PDF готовится.
 */
async function printDialog(r) {
  const hasCat = !!r.passportCategory; // текст по справочникам сервер соберёт сам, если его ещё нет
  const o = r.supplierOrg;
  const chk = (label, on, note) => { const cb = h('input', { type: 'checkbox', checked: on }); return { cb, el: h('label', null, cb, label, note ? h('span', { class: 'muted small' }, ` (${note})`) : null) }; };
  const seal = chk('Печать', !!o?.hasSeal, !o ? 'поставщик не выбран' : o.hasSeal ? '' : 'не загружена');
  const sign = chk('Подпись', !!o?.hasSignature, !o ? '' : o.hasSignature ? '' : 'не загружена');
  const mono = chk('Чёрно-белый', false);
  let mode = 'print';
  const opts = FORMATS.map((f) => {
    const b = h('button', { type: 'button', class: 'pf-opt', role: 'radio', 'data-mode': f.mode, onclick: () => pick(f.mode) }, icon(f.icon, 'pf-ico'), h('b', null, f.title), h('small', null, f.sub));
    return b;
  });
  const pick = (m) => { mode = m; opts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m))); stampBox.hidden = m === 'stand'; };
  const stampBox = h('div', { class: 'pf-checks' }, seal.el, sign.el);
  const body = h('div', { class: 'pf' },
    h('div', { class: 'section-title' }, 'Печать и подпись'), stampBox,
    h('div', { class: 'section-title' }, 'Вид'), h('div', { class: 'pf-opts', role: 'radiogroup', 'aria-label': 'Вид PDF' }, opts),
    h('div', { class: 'pf-checks' }, mono.el),
    hasCat ? null : h('p', { class: 'form-error' }, 'У паспорта не выбрана категория — PDF собирается по ней. «Выбрать категорию» в действиях карточки.'));
  pick(mode);
  await modal({
    title: `${heading(r)} — PDF`, okText: 'Скачать PDF', wide: true, body,
    onOk: async (form) => {
      if (!hasCat) throw new Error('Сначала выберите категорию паспорта');
      const ok = form.querySelector('[type=submit]');
      ok.textContent = 'Готовлю PDF…'; ok.classList.add('is-busy');
      try {
        if (mode === 'stand') { await download(r, { mode: 'stand' }, 'лист для стенда'); return true; }
        const s = seal.cb.checked, g = sign.cb.checked;
        const q = { ...(s || g ? { stamp: 1, ...(s ? {} : { seal: 0 }), ...(g ? {} : { sign: 0 }) } : {}), ...(mode === 'print' ? { mode: 'print' } : {}), ...(mono.cb.checked ? { bw: 1 } : {}) };
        await download(r, q, mode === 'print' ? 'буклет A4' : 'PDF');
        return true;
      } finally { ok.textContent = 'Скачать PDF'; ok.classList.remove('is-busy'); }
    },
  });
}

/** Паспорт без категории → выбрать категорию (подсказка — по старой категории); сервер соберёт текст по справочникам. */
const OLD_TO_V2 = { 'уличный тренажёр': 'TRN', 'воркаут': 'WRK', 'спортивное оборудование': 'WRK', 'благоустройство': 'MAF', 'маф': 'MAF' };
async function convertDialog(r, ctx) {
  const cats = V2_CATS.filter((c) => c.value && !LATER_CATS.includes(c.value));
  const sel = h('select', { 'aria-label': 'Категория паспорта' }, h('option', { value: '' }, '— выберите —'), cats.map((c) => h('option', { value: c.value }, c.label)));
  sel.value = OLD_TO_V2[String(r.category || '').trim().toLowerCase()] || '';
  const res = await modal({
    title: 'Категория паспорта', okText: 'Сохранить',
    body: h('div', null,
      h('p', null, 'Текст паспорта соберётся по справочникам «Паспорта» для этой категории — PDF будет полным, с цветом категории. Номера, даты, заказчик, картинки не меняются.'),
      h('label', { class: 'field wide' }, h('span', null, 'Категория', r.category ? h('span', { class: 'muted' }, ` (была: ${r.category})`) : null), sel),
      h('p', { class: 'hint' }, 'Потом проверьте блок «Проверка» в карточке — чего не хватает для полного текста.')),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите категорию');
      return api(`/passports/${r.id}`, { method: 'PATCH', body: { passportCategory: sel.value } });
    },
  });
  if (res) { toast('Категория выбрана, текст паспорта собран'); ctx.setRow(await api(`/passports/${r.id}`)); }
}

/** Картинки по видам в карточке: миниатюры (клик — открыть, × — убрать) и своя зона «перетащите / Ctrl+V» у каждого вида. */
function imagesBlock(r, ctx) {
  const save = async (images) => {
    try { ctx.setRow(await api(`/passports/${r.id}`, { method: 'PATCH', body: { images: imagesBody(images) } }).then(() => api(`/passports/${r.id}`))); } catch (e) { toastError(e); }
  };
  return h('div', { class: 'pp-images' }, h('div', { class: 'section-title' }, 'Картинки паспорта'),
    ...kinds(r).map(([kind, label, where]) => {
      const list = imgsOf(r, kind);
      const std = (k) => (r.standardImages || []).filter((x) => x.kind === k && x.url);
      return h('div', { class: 'pp-kind', 'data-kind': kind },
        h('div', { class: 'pp-kind-head' }, h('b', null, label), isRequired(r, kind) ? h('span', { class: 'req' }, ' · обязательно') : null, h('span', { class: 'muted' }, ` · ${where}${list.length ? ' · ' + list.length : ''}`)),
        list.length ? h('div', { class: 'pf-strip' }, ...list.map((i) => h('div', { class: 'pf-item' },
          i.url ? h('a', { href: PREFIX + i.url, target: '_blank', rel: 'noopener', title: i.caption || 'Открыть', 'aria-label': `${label}: открыть картинку` }, h('img', { src: PREFIX + i.url, alt: i.caption || label })) : h('span', { class: 'muted' }, 'нет файла'),
          canEdit() ? h('button', { type: 'button', class: 'pf-del', title: 'Убрать картинку', 'aria-label': 'Убрать картинку', onclick: () => save((r.images || []).filter((x) => x !== i)) }, '×') : null))) : null,
        // Э9.5: своих нет — стандартная схема способа установки (в паспорт попадёт она; своя загруженная её заменит)
        !list.length && std(kind).length ? h('div', null, h('div', { class: 'hint' }, 'Стандартная схема способа установки — попадёт в паспорт; загрузите свою, чтобы заменить'),
          h('div', { class: 'pf-strip' }, ...std(kind).map((i) => h('a', { class: 'pf-item', href: PREFIX + i.url, target: '_blank', rel: 'noopener', 'aria-label': `${label}: стандартная схема` }, h('img', { src: PREFIX + i.url, alt: label }))))) : null,
        canEdit() ? photoDrop({ attach: async (photoId) => { r.images = [...(r.images || []), { kind, photoId, order: list.length }]; return r; }, done: () => save(r.images) }) : null);
    }));
}

/** Паспорт v2 (БЗ-6 Э5a2): «Проверка» — чего не хватает; у рисунка — «Загрузить» (переход к его зоне загрузки ниже). */
// подписи «не хватает» с сервера (passport-rules IMAGE_KIND_LABELS) → вид картинки
const IMG_BY_LABEL = { 'Фото изделия': 'overview', 'Чертёж с размерами': 'dimensions', 'Зона безопасности': 'safety', 'Схема монтажа': 'mounting', 'Схема фундамента': 'foundation', 'Разметка ям под опоры': 'holes', 'Сборка по шагам': 'assembly', 'Фото с подписями частей': 'overview_callouts', 'Где табличка с номером': 'nameplate' };
function checkBlock(r) {
  const miss = r.missing || [];
  const warn = r.standardWarnings || [];
  if (!miss.length && !warn.length) return h('div', null, h('div', { class: 'section-title' }, 'Проверка'), h('p', { class: 'muted' }, 'Всё заполнено — паспорт можно выдавать.'));
  const goTo = (kind) => {
    const zone = document.querySelector(`.pp-kind[data-kind="${kind}"]`);
    if (!zone) return;
    zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    zone.classList.add('fill-here'); setTimeout(() => zone.classList.remove('fill-here'), 2500);
  };
  return h('div', null, h('div', { class: 'section-title' }, miss.length ? (r.strict ? `Не готов к выпуску — не хватает: ${miss.length}` : `Проверка — не хватает: ${miss.length}`) : 'Проверка'),
    r.strict && miss.length ? h('p', { class: 'hint' }, 'PDF и печать станут доступны, когда заполните отмеченное. «Заполняется после печати» (покупатель, адрес, монтаж) выпуск не задерживает.') : null,
    h('ul', { class: 'timeline pp-check' }, ...miss.map((m) => {
      const img = m.startsWith('Рисунок: ') || m === 'Фото изделия' ? IMG_BY_LABEL[m.replace(/^Рисунок: /, '')] : null;
      // не картинка — «Заполнить»: открыть правку паспорта (та же кнопка «Изменить» карточки)
      const fill = () => [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Изменить')?.click();
      return h('li', null, m, !canEdit() ? null : img ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTo(img) }, 'Загрузить') : h('button', { type: 'button', class: 'btn btn-sm', onclick: fill }, 'Заполнить'));
    })),
    warn.length ? h('div', null, h('div', { class: 'section-title' }, 'Нормативы — проверить'), h('p', { class: 'hint' }, 'Статус и дату проверки — в «Справочники → Паспорта → Нормативы». Паспорт выдавать можно.'),
      h('ul', { class: 'timeline' }, ...warn.map((w) => h('li', { class: 'muted' }, w)))) : null);
}

/** Последний номер раздела снимка (ТО и монтаж в PDF идут следующими). */
const lastNo = (t) => Math.max(2, ...(t.sections || []).map((s) => parseInt(s.number, 10) || 0));

/** Таблица ТО одного периода: что проверить · где · мера. */
function periodBlock(m) {
  const row = (x) => h('li', null, x.what, h('span', { class: 'muted' }, [x.where, x.measure].filter(Boolean).map((v) => ' · ' + v).join('')));
  return h('div', null, h('b', null, m.period), h('ul', null, ...m.rows.map(row)));
}

/**
 * Пункт текста в предпросмотре (Э5a3): «Изменить» — правка только для этого паспорта (в снимок), прямо в карточке;
 * правленый пункт помечен «изменён для этого паспорта». Перенос в справочник — «Справочники → Паспорта → Разделы и тексты».
 */
function snapItem(r, ctx, s, i) {
  const view = h('p', { class: 'pp-snap-item' }, i.number ? h('b', null, i.number + ' ') : '— ', i.text,
    i.edited ? h('span', { class: 'muted', title: 'Было: ' + (i.original || '') }, ' · изменён для этого паспорта') : null,
    canEdit() ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon pp-snap-edit', title: `Править пункт ${i.number || ''}`.trim(), 'aria-label': `Править пункт ${i.number || ''}`.trim(), onclick: () => view.replaceWith(editor()) }, '✎') : null,
    canEdit() && i.edited ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Этот текст пункта получат новые паспорта той же категории', onclick: async () => {
      if (!(await confirmDlg('Перенести в справочник?', `Пункт «${s.number} ${s.title}» с этим текстом станет общим для новых паспортов категории. Выданные паспорта не изменятся.`, { okText: 'Перенести' }))) return;
      try { const v = await api(`/passports/${r.id}/snapshot-item/promote`, { method: 'POST', body: { sectionKey: s.key, itemKey: i.key } }); toast(`Перенесено: шаблон категории, версия ${v.version}`); } catch (e) { toastError(e); }
    } }, 'Сделать общим для категории') : null);
  const editor = () => {
    const ta = h('textarea', { rows: 4, value: i.text, 'aria-label': 'Текст пункта' });
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
      save.disabled = true; save.textContent = 'Сохранение…';
      try { await api(`/passports/${r.id}/snapshot-item`, { method: 'PATCH', body: { sectionKey: s.key, itemKey: i.key, text: ta.value } }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Пункт изменён для этого паспорта'); } catch (e) { toastError(e); save.disabled = false; save.textContent = 'Сохранить'; }
    } }, 'Сохранить');
    const box = h('div', { class: 'field wide' }, ta, h('div', { class: 'hint' }, 'Правка только для этого паспорта'),
      h('div', { class: 'rt-acts' }, save, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => box.replaceWith(view) }, 'Отмена')));
    setTimeout(() => ta.focus(), 0);
    return box;
  };
  return view;
}

/** Паспорт v2: текст из снимка (как будет в паспорте) и «Обновить текст по справочникам» (новый снимок). */
function previewBlock(r, ctx) {
  const t = r.textSnapshot;
  const refresh = canEdit() ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Собрать текст заново по справочникам и шаблону категории (выданный текст заменится)', onclick: async (e) => {
    const edited = (t?.sections || []).reduce((n, x) => n + x.items.filter((it) => it.edited).length, 0);
    if (edited && !(await confirmDlg('Пересобрать текст?', `Ручных правок в этом паспорте: ${edited}. После пересборки по справочникам они пропадут.`, { okText: 'Пересобрать' }))) return;
    e.target.disabled = true; e.target.textContent = 'Собираю…';
    try { await api(`/passports/${r.id}/snapshot`, { method: 'POST' }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Текст паспорта собран заново'); } catch (err) { toastError(err); e.target.disabled = false; e.target.textContent = 'Обновить текст по справочникам'; }
  } }, 'Обновить текст по справочникам') : null;
  if (!t) return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'), h('p', { class: 'muted' }, 'Текст ещё не собран.'), refresh);
  const part = (title, body) => (body ? h('details', { class: 'month-group' }, h('summary', null, title), body) : null);
  return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'),
    h('p', { class: 'muted' }, `Текст собран ${t.at ? date(t.at) : ''}${t.missing?.length ? ' · в тексте не заполнено: ' + t.missing.join(', ') : ''}`),
    // порядок и номера — как в PDF: 1 описание, 2 правила, разделы шаблона, затем ТО и монтаж — следующими номерами
    part('1 Описание и назначение', t.description || t.purpose ? h('div', null, t.description ? h('p', null, t.description) : null, t.purpose ? h('p', null, t.purpose) : null) : null),
    part(`2 Правила пользования (${(t.rules || []).length})`, t.rules?.length ? h('ol', null, ...t.rules.map((x) => h('li', null, x))) : null),
    ...(t.sections || []).map((s) => part(`${s.number} ${s.title}`, h('div', null, ...s.items.map((i) => snapItem(r, ctx, s, i))))),
    part(`${lastNo(t) + 1} Обслуживание по периодам (из справочников)`, t.maintenance?.length ? h('div', null, ...t.maintenance.map(periodBlock)) : null),
    part(`${lastNo(t) + 2} Монтаж по способу установки`, t.install?.text ? h('ol', null, ...String(t.install.text).split(/\r?\n/).filter(Boolean).map((x) => h('li', null, x))) : null),
    refresh);
}

function bomBlock(r) {
  if (!r.bom?.length) return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'), h('p', { class: 'muted' }, 'Не заполнена — в PDF будет «И-1 · Изделие в сборе · 1 шт.»'));
  const rows = r.bom;
  return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'),
    h('table', { class: 'so-lines static' }, h('thead', null, h('tr', null, ...['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'].map((x) => h('th', null, x)))),
      h('tbody', null, ...rows.map((b) => h('tr', null, h('td', null, b.pos ?? ''), h('td', null, b.code ?? ''), h('td', null, b.name ?? ''), h('td', { class: 'num' }, b.qty ?? ''), h('td', null, b.unit ?? ''), h('td', { class: 'muted' }, b.note ?? ''))))));
}

/** Комплектность в форме — таблица (ui/rows-table.js) ↔ bom [{ pos, code, name, qty, unit, note }]. */
const BOM_COLS = [
  { key: 'code', label: 'Обозначение', width: '16%', placeholder: 'И-1' },
  { key: 'name', label: 'Наименование', placeholder: 'Изделие в сборе' },
  { key: 'qty', label: 'Кол-во', width: '11%', num: true, placeholder: '1' },
  { key: 'unit', label: 'Ед.', width: '10%', placeholder: 'шт.' },
  { key: 'note', label: 'Примечание', width: '20%' },
];
const bomRows = (bom) => (bom || []).map((b) => ({ code: b.code ?? '', name: b.name ?? '', qty: b.qty == null ? '' : num(b.qty), unit: b.unit ?? '', note: b.note ?? '' }));
const parseBom = (rows) => (rows || []).filter((b) => b.name || b.code).map((b, i) => ({
  pos: i + 1, code: b.code || '', name: b.name || '', qty: Number(String(b.qty || '').replace(',', '.')) || 1, unit: b.unit || 'шт.', ...(b.note ? { note: b.note } : {}) }));

/** Параметры фильтров списка из адреса — для «PDF пакетом». */
function listQuery() {
  const p = current().params || {};
  const q = { search: p.q, year: p.year, month: p.month, category: p.category, supplierOrgId: p.supplierOrgId, customer: p.customer };
  if (p.state === 'incomplete') q.incomplete = 1;
  if (p.state === 'noImages') q.noImages = 1;
  return q;
}

/** Паспорт v2 (БЗ-6 Э5a1): поля формы ↔ тело запроса. */
function v2Initial(r) {
  return {
    passportCategory: r.passportCategory || '', elements: (r.elements || []).map(String), materialIds: (r.materialIds || []).map(String),
    installationTypeId: r.installationTypeId ? String(r.installationTypeId) : '', isKit: r.isKit ? 'yes' : 'no', schemeSource: r.schemeSource === 'own' ? 'own' : 'standard',
    ...Object.fromEntries(V2_NUMS.map(([k]) => [k, num(r[k])])),
    certNumber: r.certificate?.number || '', certUntil: r.certificate?.until ? String(r.certificate.until).slice(0, 10) : '', certEac: r.certificate?.hasEac ? 'yes' : 'no',
  };
}
function v2Body(v) {
  const b = {
    elements: Array.isArray(v.elements) ? v.elements : [], materialIds: Array.isArray(v.materialIds) ? v.materialIds : [],
    isKit: v.isKit === 'yes',
    schemeSource: v.schemeSource === 'own' ? 'own' : 'standard',
    ...Object.fromEntries(V2_NUMS.filter(([k]) => v[k] !== null && v[k] !== undefined && v[k] !== '').map(([k]) => [k, v[k]])),
  };
  if (v.passportCategory) b.passportCategory = v.passportCategory;
  if (v.installationTypeId) b.installationTypeId = v.installationTypeId;
  // сертификат (Э9): без номера — пусто (ЕАС без номера не ставим)
  b.certificate = v.certNumber ? { number: String(v.certNumber).trim(), ...(v.certUntil ? { until: v.certUntil } : {}), hasEac: v.certEac === 'yes' } : {};
  return b;
}

export const passports = {
  id: 'passports',
  title: 'Паспорта',
  newTitle: 'Новый паспорт',
  entityType: 'ProductPassport',
  canEdit,
  historyLabels: { 'passport.created': 'Создан', 'passport.updated': 'Изменён', 'passport.copied': 'Копия', 'passport.deleted': 'Удалён', 'passport.restored': 'Восстановлен', create: 'Создан', update: 'Изменён' },
  get: (id) => api(`/passports/${id}`),

  list: {
    path: '/passports',
    sortDefault: '-passportNo',
    createLabel: 'Паспорт',
    // БЗ-9: отметить паспорта галочками → «Изменить выбранные» (общие поля; номера, талоны, названия, картинки — по одному)
    bulk: { open: (ids, { done }) => openBulk({ ids, done, fields: passportBulkFields,
      apply: (set, arrays) => api('/passports/bulk', { method: 'POST', body: { ids, set, arrays } }),
      restore: (before) => api('/passports/bulk/restore', { method: 'POST', body: { items: before } }) }) }, // права — canEditSection в списке
    searchPlaceholder: 'Поиск: № паспорта, талон, номер изделия, наименование, заказчик, объект…',
    emptyText: 'Паспортов пока нет.',
    query: (P) => ({ ...(P.state === 'incomplete' ? { incomplete: 1 } : {}), ...(P.state === 'noImages' ? { noImages: 1 } : {}) }),
    filters: [
      { key: 'status', label: 'Статус', type: 'select', options: async () => [{ value: 'draft', label: 'Черновики' }, { value: 'issued', label: 'Выпущенные' }, { value: 'annulled', label: 'Аннулированные' }] },
      { key: 'state', label: 'Показать', type: 'chips', options: () => [{ value: 'incomplete', label: 'Неполные' }, { value: 'noImages', label: 'Без картинок' }],
        count: (resp, v) => (v === '' ? undefined : v === 'incomplete' ? resp.incomplete : undefined) },
      { key: 'category', label: 'Категория', type: 'hidden' }, // выбирается плитками над списком
      { key: 'year', label: 'Год', type: 'select', options: async () => (await facets()).years.map((y) => ({ value: String(y.value), label: `${y.value} (${y.n})` })) },
      { key: 'month', label: 'Месяц', type: 'select', options: async () => MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
      { key: 'supplierOrgId', label: 'Поставщик', type: 'select', options: async () => (await facets()).suppliers.map((s) => ({ value: s.value, label: `${s.label} (${s.n})` })) },
      { key: 'customer', label: 'Заказчик', type: 'select', options: async () => (await facets()).customers.map((c) => ({ value: c.value, label: `${c.value} (${c.n})` })) },
    ],
    // паспорта по категориям с фото (основной вид), по 50 на страницу — не все сотни сразу; «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 50, sort: 'category', lastGroup: 'Без категории',
      groupBy: (r) => r.category || 'Без категории',
      card: (r) => ({
        pic: r.thumb ? PREFIX + r.thumb : null,
        title: r.name || 'без названия',
        meta: [numberOf(r) ? `№ ${numberOf(r)}` : 'черновик', date(r.date), r.customerName || r.objectName].filter(Boolean).join(' · '),
        badge: statusOf(r) !== 'issued' ? h('span', { class: 'badge gc-badge ' + (statusOf(r) === 'draft' ? 'warn' : 'dim') }, STATUS_LABEL[statusOf(r)].toLowerCase()) : r.manualText?.length ? h('span', { class: 'badge info gc-badge', title: 'Текст изменён вручную, не из справочника' }, 'изменено вручную') : null,
      }),
    },
    tiles: { key: 'category', load: async () => (await facets()).categories.map((c) => ({ value: c.value, label: c.value, n: c.n })) },
    hints: {
      '': 'Паспорт — на каждое выданное изделие: свой номер, талон и номер изделия (их выдаёт система). Клик — карточка: картинки, «⇩ PDF с печатью», «Создать копию».',
      incomplete: 'Не хватает данных для выдачи: в строке видно, чего именно. Откройте и заполните — PDF соберётся полным.',
      noImages: 'Паспорта без картинок: перетащите или вставьте (Ctrl+V) общий вид в карточке.',
    },
    hintKey: 'state',
    headActions: () => [h('button', { class: 'btn btn-ghost', type: 'button', title: 'Все паспорта по текущим фильтрам — PDF в одном архиве (до 200)', onclick: async (e) => {
      const done = toast('Собираю архив — это может занять несколько минут…', { ms: 600000 }); const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
      try { const name = await apiFile('/passports/zip', { query: { ...listQuery(), stamp: 1 }, timeout: 600000, fallback: 'Паспорта.zip' }); toast(`Скачан: ${name}`); } catch (er) { toastError(er); } finally { done(); b.disabled = false; b.classList.remove('is-busy'); }
    } }, '⇩ PDF пакетом')],
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.thumb ? h('img', { class: 'pic so-pic', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'passportNumber', label: '№', sort: 'passportNo', cls: 'nowrap', render: (r) => h('b', null, numberOf(r) || '—') },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => h('span', null, statusBadge(r), r.manualText?.length ? h('span', { class: 'badge info', title: 'Текст изменён вручную, не из справочника' }, ' изменено вручную') : null) },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name || '' }, r.name || h('span', { class: 'muted' }, 'без названия')) },
      { key: 'category', label: 'Категория', sort: 'category', cls: 'md-hide', render: (r) => r.category || h('span', { class: 'muted' }, '—') },
      { key: 'customerName', label: 'Заказчик / объект', sort: 'customerName', cls: 'clip md-hide', render: (r) => h('span', { title: [r.customerName, r.orderNo && 'заказ ' + r.orderNo, r.objectName].filter(Boolean).join(' · ') }, [r.customerName, r.orderNo && '№' + r.orderNo, r.objectName].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—')) },
      { key: 'warrantyCode', label: 'Талон', cls: 'nowrap md-hide muted', render: (r) => r.warrantyCode || '' },
      { key: 'missing', label: 'Заполнено', cls: 'nowrap', render: (r) => (r.missing?.length ? h('span', { class: 'badge warn', title: 'Не хватает: ' + r.missing.join(', ') }, `нет ${r.missing.length}`) : h('span', { class: 'badge ok' }, 'всё')) },
    ],
    card: {
      thumb: (r) => (r.thumb ? h('img', { class: 'thumb', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
      title: (r) => `${numberOf(r) ? '№ ' + numberOf(r) : 'Черновик'} · ${r.name || 'без названия'}`,
      sub: (r) => [date(r.date), r.customerName || r.objectName, r.missing?.length ? `не хватает: ${r.missing.length}` : ''].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading,
    editTop: true,
    subheading: (r) => [r.name, r.category].filter(Boolean).join(' · '),
    stats: (r) => [['Статус', STATUS_LABEL[statusOf(r)] + (r.revision > 1 ? `, редакция ${r.revision}` : '') + (r.annulReason ? ` — ${r.annulReason}` : '')], ['Талон', r.warrantyCode || '—'], ['Номер изделия', `${r.productCode || '—'}${r.productCodeDuplicate ? ' (дубль)' : ''}`], ['Дата', date(r.date)], ['Гарантия', `${r.warrantyMonths ?? 12} мес.`]],
    view: (r) => [
      ['Наименование', r.name],
      ['Категория', r.category],
      ['Артикул', r.article],
      ['Габариты (В × Д × Ш)', dims(r)],
      ['Вес', r.weight ? num(r.weight) + ' кг' : ''],
      ['Материалы', r.materials],
      ['Установка', r.installationMethod],
      ['Назначение', r.purpose],
      ['Описание', r.description],
      ['Заказчик', r.customerName],
      ['№ заказа', r.orderNo],
      ['Объект', r.objectName],
      ['Заметки', r.note],
      ['Поставщик', r.supplierOrg ? `${r.supplierOrg.name}${r.supplierOrg.hasSeal ? '' : ' (печать не загружена)'}` : r.supplier],
      ['PDF скачан', r.pdfIssuedAt ? date(r.pdfIssuedAt) : ''],
    ],
    actions: (r) => [
      // одно окно: печать/подпись галочками, вид значками (A5, буклет A4, стенд A3), ч/б — у нового образца
      // НМ: черновик — «Выпустить» (номер — сейчас, последним шагом); PDF черновика — с пометкой «ЧЕРНОВИК»
      statusOf(r) === 'draft' && canEdit() && { label: 'Выпустить', primary: true, run: (row, ctx) => issueAction(row, ctx),
        ...(r.missing?.length ? { disabled: true, title: `Не хватает для выпуска: ${r.missing.join(', ')}` } : { title: 'Присвоить номер и талон; текст будет заморожен' }) },
      { label: statusOf(r) === 'draft' ? '⇩ PDF черновика…' : '⇩ PDF и печать…', primary: statusOf(r) !== 'draft', run: (row) => printDialog(row) },
      isIssued(r) && canEdit() && { label: 'Новая редакция', title: 'Изменить выпущенный паспорт: номер тот же, редакция +1, прежняя — в истории', run: (row) => { revisionFor = row.id; [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Изменить')?.click(); } },
      isIssued(r) && canEdit() && { label: 'Аннулировать…', title: 'Номер останется занятым и повторно не выдаётся', run: (row, ctx) => annulDialog(row, ctx) },
      isIssued(r) && (session.user?.role === 'admin' || session.user?.isOwner) && { label: 'Изменить номер…', run: (row, ctx) => numberDialog(row, ctx) },
      !r.passportCategory && canEdit() && { label: 'Выбрать категорию', title: 'Без категории PDF упрощённый — с категорией текст соберётся по справочникам', run: (row, ctx) => convertDialog(row, ctx) },
      // ПИ.5: старый паспорт без изделия — привязать к изделию или создать изделие из него (одна модель, без массовых)
      !r.productId && canEdit() && { label: 'Привязать к изделию', run: (row, ctx) => linkDialog(row, ctx) },
      !r.productId && canEdit() && r.name && { label: 'Создать изделие из паспорта', title: 'Изделие в «Продукции» с данными этого паспорта; паспорта той же модели привяжутся к нему', run: async (row, ctx) => {
        const key = `${String(row.name).replace(/\s+/g, ' ').trim()}\u0000${String(row.article || '').replace(/\s+/g, ' ').trim()}`;
        if (!(await confirmDlg('Создать изделие?', `В «Продукции» появится «${row.name}» с размерами, текстами и фото этого паспорта. Паспорта той же модели (то же наименование и артикул) привяжутся к нему.`, { okText: 'Создать' }))) return;
        try { const res = await api('/showcase/from-passports', { method: 'POST', body: { groups: [{ keys: [key], main: key }] } }); prodCache = null; toast(`Изделие создано, привязано паспортов: ${res.linked}`); ctx.setRow(await api(`/passports/${row.id}`)); } catch (e) { toastError(e); }
      } },
      canEdit() && { label: 'Создать копию', title: 'Новый паспорт на ту же модель: новые номера, дата — сегодня', run: async (row, ctx) => {
        try { const c = await api(`/passports/${row.id}/copy`, { method: 'POST', body: {} }); toast(`Создан паспорт № ${c.passportNumber} — укажите заказчика и дату`); ctx.changed(); go('passports', { ...current().params, open: c.id }); } catch (e) { toastError(e); }
      } },
    ],
    extra: (r, ctx) => h('div', null,
      r.passportCategory ? checkBlock(r) : (r.missing?.length ? h('div', { class: 'fill-note' }, 'Не хватает для выдачи: ', h('b', null, r.missing.join(', '))) : null),
      imagesBlock(r, ctx), bomBlock(r),
      r.passportCategory ? previewBlock(r, ctx) : null),
  },

  form: {
    fields: async (r) => {
      const [cats, ours, f] = await Promise.all([categories(), ourCompanies(), facets()]);
      const [els, mats, inst, catRows, stdRows, phraseRows] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall'), dictRows('passportCategories'), dictRows('passportStandards'), dictRows('passportPhrases')]);
      // ТЭ: «Назначение» и «Установка» — только эталонные тексты справочника для категории паспорта
      PHRASE_TEXTS.clear(); for (const x of phraseRows) PHRASE_TEXTS.add(String(x.text || '').trim());
      const phraseOpts = (section) => (get) => { const cat = get('passportCategory'); return phraseRows.filter((x) => x.section === section && (!cat || codeList(x.categories).includes(cat))).map((x) => ({ value: x.text, label: x.text, sub: x.name })); };
      const catBy = new Map(catRows.map((c) => [String(c.code), c]));
      const stdName = new Map(stdRows.map((s) => [String(s.code), s.name]));
      // ФП: виджеты, которые меняет выбор категории, и «готовность к выпуску»
      const w = { el: null, mat: null, std: h('p', { class: 'muted' }, 'Выберите категорию — здесь появятся её нормативы'), need: h('div', { class: 'muted' }, 'Проверяю…') };
      const startCat = r ? r.passportCategory || '' : newCat;
      const req = reqKinds(catBy.get(startCat), r?.isKit);
      const mainKinds = new Set(['overview', ...req]);
      const v2Fields = [
        { section: 'Категория и состав', tone: 'main', collapsed: !!r && !r.passportCategory },
        // детские (ДИО, ДСО) отложены пользователем (QUESTIONS 2026-10-22) — не предлагаем, но уже выбранную не скрываем
        { key: 'passportCategory', label: 'Категория паспорта', type: 'segment', options: V2_CATS.filter((c) => (c.value && !LATER_CATS.includes(c.value)) || (r && r.passportCategory === c.value) || (!r && newCat === c.value)), wide: true,
          hint: 'От категории зависят разделы, нормативы, обязательные рисунки и поля ниже',
          mount: (api) => wireForm(api, { r, w, catBy, stdName, inst }) },
        { key: '_std', label: 'Нормативы категории', type: 'widget', wide: true, widget: () => ({ el: w.std, value: '' }), summary: () => '' },
        { key: 'elements', label: 'Функциональные элементы', type: 'widget', wide: true, widget: (v) => (w.el = tagPick({ options: els, value: v, label: 'Функциональные элементы' })) },
        { key: 'materialIds', label: 'Материалы', type: 'widget', wide: true, widget: (v) => (w.mat = tagPick({ options: mats, value: v, label: 'Материалы' })) },
        { key: 'installationTypeId', label: 'Способ установки', type: 'select', options: [{ value: '', label: '—' }, ...inst.map((o) => ({ value: o.value, label: o.label }))] },
        { key: 'isKit', label: 'Поставляется разобранным', type: 'segment', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — нужна схема сборки' }] },
        { key: 'schemeSource', label: 'Схемы узлов (фундамент, скважины, монтаж)', type: 'segment', options: [{ value: 'standard', label: 'Стандартные, если нет своих' }, { value: 'own', label: 'Только свои' }],
          hint: 'Стандартные схемы — в «Справочники → Паспорта → Способы установки»' },
        { section: 'Ограничения и техданные', tone: 'info', collapsed: !!r && !r.passportCategory },
        ...V2_NUMS.map(([key, label, hint]) => ({ key, label, type: 'number', min: 0, span: 1, hint: hint || undefined })),
        { section: 'Сертификат / декларация', tone: 'info', collapsed: !r?.certificate?.number },
        { key: 'certNumber', label: 'Номер сертификата или декларации', max: 100, hint: 'Пусто — раздел «Идентификационные сведения» и знак ЕАС не печатаются' },
        { key: 'certUntil', label: 'Действует до', type: 'date' },
        { key: 'certEac', label: 'Знак ЕАС', type: 'segment', options: [{ value: 'no', label: 'Не ставить' }, { value: 'yes', label: 'Ставить' }] },
      ];
      // ПИ.4: правили «умолчательные» поля паспорта с изделием — запомнить их у изделия для следующих паспортов
      const remember = { key: '_remember', label: 'Запомнить для следующих паспортов этого изделия', type: 'segment', wide: true,
        options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — категория, состав, ограничения, срок, гарантия' }],
        hint: 'Появляется, если вы поправили подставленное. Запишется в изделие — следующий паспорт подставит это сам' };
      return [
        // ФП: что ещё нужно для выпуска — ссылки к полям; обновляется при каждом изменении формы
        { key: '_need', label: 'Готовность к выпуску', type: 'widget', wide: true, widget: () => ({ el: w.need, value: '' }), summary: () => '' },
        // ПИ: сначала изделие — из него заполняется паспорт
        { section: 'Изделие', tone: 'main', fixed: true },
        { key: '_product', label: r ? 'Изделие' : 'Изделие из «Продукции»', type: 'widget', wide: true, widget: () => ({ el: h('div', { class: 'pp-prod' }), value: '' }), summary: () => '',
          mount: (api) => productBlock(api, { r, catBy }) },
        { key: '_searchName', type: 'hidden' },
        { section: 'Данные изделия', tone: 'main', fixed: true },
        { key: '_copyFrom', type: 'hidden' }, { key: '_imgsFrom', type: 'hidden' }, { key: 'productId', type: 'hidden' }, { key: 'salesOrderId', type: 'hidden' },
        { key: 'name', label: 'Наименование', required: true, wide: true, max: 500,
          hint: r ? undefined : 'Заполнено из изделия. Запасной путь — начните печатать и возьмите данные из прошлого паспорта с таким наименованием',
          suggest: r ? undefined : models, suggestKeep: true, suggestTitle: 'Взять из прошлого паспорта (запасной путь): подставится всё, кроме заказчика и даты; поправленное вами не затрётся', suggestFocus: 'customerName' },
        { key: 'category', label: 'Категория каталога', type: 'combo', options: cats, max: 200, hint: 'Подставляется из изделия или по категории паспорта; можно выбрать другую' },
        { key: 'article', label: 'Артикул', max: 50 },
        { key: 'height', label: 'Высота, мм', type: 'number', min: 0, span: 1 },
        { key: 'length', label: 'Длина, мм', type: 'number', min: 0, span: 1 },
        { key: 'width', label: 'Ширина, мм', type: 'number', min: 0, span: 1 },
        { key: 'weight', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
        ...v2Fields, remember,
        // ПП: выпуск — дата (номер талона), поставщик, гарантия; кому и куда — в «после печати» (можно от руки)
        { section: 'Выпуск', tone: 'who' },
        ...(r ? [] : [{ key: 'date', label: 'Дата выпуска', type: 'date', required: true, hint: 'По дате и номеру строится гарантийный талон' }]),
        { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })), hint: 'Реквизиты, печать и подпись в PDF — из карточки компании' },
        { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
        { section: 'Описание (раздел 1)', tone: 'info', collapsed: !!r },
        { key: 'materials', label: 'Материалы («изготовленное из …»)', type: 'textarea', wide: true, max: 2000, phrases: { load: phrases('materials'), by: 'passportCategory', label: (c) => CAT_NAMES[c] || c, title: 'Варианты' } },
        { key: '_manualText', label: 'Свой текст для этого паспорта', type: 'segment', options: [{ value: 'no', label: 'Нет — из справочника' }, { value: 'yes', label: 'Да — изменено вручную' }], wide: true,
          hint: 'Только если готового текста нет: паспорт будет помечен «изменено вручную». Новую формулировку лучше добавить в «Справочники → Паспорта → Готовые тексты паспорта»' },
        { key: 'installationMethod', label: 'Установка', type: 'combo', wide: true, max: 1000, options: phraseOpts('installation'), strict: (get) => get('_manualText') !== 'yes', strictText: 'Выберите текст из справочника или включите «Свой текст для этого паспорта»', hint: 'Подставляется по способу установки; список — только для категории паспорта' },
        { key: 'purpose', label: 'Назначение', type: 'combo', wide: true, max: 1000, options: phraseOpts('purpose'), strict: (get) => get('_manualText') !== 'yes', strictText: 'Выберите текст из справочника или включите «Свой текст для этого паспорта»', hint: 'Список — только для категории паспорта' },
        { key: 'description', label: 'Описание целиком (раздел 1.1 паспорта)', type: 'textarea', wide: true, rows: 5, max: 4000, compose: { from: ['name', 'materials', 'installationMethod', 'purpose'], build: buildDescription },
          hint: 'Собирается само из наименования, материалов, установки и назначения; можно поправить вручную' },
        // ФП: обязательные для категории (*) и «Общий вид» — сразу; остальные — в свёрнутом «Ещё картинки»; вставка Ctrl+V — в вид под курсором
        { section: 'Картинки', tone: 'info', collapsed: !!r },
        ...kinds({ requiredImages: req }).filter(([k]) => mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label: `${label}${req.includes(kind) ? ' *' : ''}`, type: 'photos', hint: `${where}${req.includes(kind) ? ' · обязательно для категории' : ''}` })),
        { section: 'Ещё картинки', tone: 'info', collapsed: true },
        ...kinds({ requiredImages: req }).filter(([k]) => !mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label, type: 'photos', hint: where })),
        { section: 'Комплектность', tone: 'who', collapsed: true },
        { key: 'bom', label: 'Комплектность изделия (таблица 5)', type: 'widget', wide: true,
          widget: (v) => rowsTable({ columns: BOM_COLS, rows: v, file: 'Шаблон комплектности', example: ['И-1', 'Изделие в сборе', 1, 'шт.', ''] }),
          hint: 'Пусто — «И-1 · Изделие в сборе · 1 шт.». Можно вставить строки из Excel (Ctrl+V в ячейку) или загрузить заполненный шаблон' },
        // ПП: заполняется после печати — пусто → в PDF линия для ручки, заполнено → значение; выпуск не блокирует
        { section: 'Заполняется после печати — можно от руки', tone: 'info', collapsed: !(r && (r.saleDate || r.customerName || r.orderNo || r.objectName || r.installedBy || r.installedAt || r.note)) },
        { key: '_afterHint', type: 'widget', wide: true, label: '', widget: () => ({ el: h('p', { class: 'hint' }, 'Если заполнить — подставится в паспорт. Пусто — в PDF будет линия, впишут ручкой при продаже и монтаже. Выпуск не задерживает.'), value: '' }), summary: () => '' },
        { key: 'saleDate', label: 'Дата продажи', type: 'date', span: 1 },
        { key: 'customerName', label: 'Покупатель (заказчик)', type: 'combo', options: f.customers.map((c) => c.value), max: 300 },
        { key: 'orderNo', label: '№ заказа', max: 50, span: 1, suggest: orders, suggestTitle: 'Заказы — выбор подставит покупателя', hint: 'Начните печатать номер или заказчика' },
        { key: 'objectName', label: 'Адрес установки', wide: true, max: 500 },
        { key: 'installedBy', label: 'Монтаж выполнил', max: 300 },
        { key: 'installedAt', label: 'Дата монтажа', type: 'date', span: 1 },
        { key: 'note', label: 'Заметки', type: 'textarea', wide: true, rows: 3, max: 4000, hint: 'Попадут в паспорт на лист «Для заметок»; пусто — листа не будет' },
      ];
    },
    // поставщик по умолчанию — наша компания, у которой больше всего паспортов (у модели свой — подставится при выборе)
    // черновик «Выпустить паспорт» (issuePassport) — поверх, пустые значения не затирают умолчания
    initial: async () => {
      const d = draft; draft = null;
      newCat = d?.passportCategory || '';
      return { _manualText: 'no', date: isoDay(), warrantyMonths: '12', supplierOrgId: (await facets()).suppliers[0]?.value || '',
        ...Object.fromEntries(Object.entries(d || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)) };
    },
    toInitial: (r) => ({ ...r, saleDate: r.saleDate ? String(r.saleDate).slice(0, 10) : '', installedAt: r.installedAt ? String(r.installedAt).slice(0, 10) : '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight), warrantyMonths: num(r.warrantyMonths ?? 12), bom: bomRows(r.bom),
      ...v2Initial(r), _manualText: r.manualText?.length ? 'yes' : 'no',
      ...Object.fromEntries(kinds().map(([kind]) => ['img_' + kind, imgsOf(r, kind).filter((i) => i.url).map((i) => ({ id: String(i.photoId), url: i.url, thumb: i.url }))])) }),
    // ФП: картинки — каждая в своём виде (formImages); у модели они уже разложены в форме (_imgsFrom) — отправляем как есть
    toBody: (v, r) => {
      const s = (x) => (x === null || x === undefined ? '' : String(x));
      const body = {
        name: s(v.name), category: s(v.category), article: s(v.article), materials: s(v.materials), installationMethod: s(v.installationMethod), purpose: s(v.purpose),
        customerName: s(v.customerName), orderNo: s(v.orderNo), objectName: s(v.objectName), note: s(v.note),
        saleDate: v.saleDate || null, installedBy: s(v.installedBy), installedAt: v.installedAt || null, // ПП: после печати
        ...(v.supplierOrgId ? { supplierOrgId: v.supplierOrgId } : {}),
        ...Object.fromEntries(['height', 'length', 'width', 'weight', 'warrantyMonths'].filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, v[k]])),
      };
      body.description = s(v.description) || buildDescription(body);
      // ТЭ-2: какие тексты не из справочника — видно в списке «изменено вручную»
      body.manualText = [...(v._manualText === 'yes' ? ['purpose', 'installationMethod'].filter((k) => s(body[k]) && !PHRASE_TEXTS.has(s(body[k]))) : []), ...(s(v.description) && s(v.description) !== buildDescription(body) ? ['description'] : [])];
      const bom = parseBom(v.bom);
      if (bom.length || r) body.bom = bom;
      const shown = new Set(kinds().map(([k]) => k));
      // виды, которых нет в форме, сохраняются как были (safety_zone показан в «Зоне безопасности» — не «чужой»)
      const kept = imagesBody((r?.images || []).filter((i) => !shown.has(kindOf(i))));
      const images = [...formImages(v, kinds().map(([k]) => k)), ...kept];
      Object.assign(body, v2Body(v));
      const fromModel = !r && v._copyFrom && v._imgsFrom === v._copyFrom; // картинки модели уже в форме — список окончательный
      if (images.length || r || fromModel) body.images = images;
      if (fromModel) body._imagesFinal = true;
      if (!r && v.date) body.date = v.date;
      if (!r && v._copyFrom) body._copyFrom = v._copyFrom;
      if (!r && v.productId) body.productId = v.productId;
      if (!r && v.salesOrderId) body.salesOrderId = v.salesOrderId;
      if (r && isIssued(r)) body._issued = true;
      // ПИ.4: «Запомнить» — значения по умолчанию изделию (после сохранения паспорта)
      const pid = v.productId || r?.productId;
      if (v._remember === 'yes' && pid) {
        const b2 = v2Body(v);
        body._remember = { productId: String(pid), defaults: { ...(b2.passportCategory ? { passportCategory: b2.passportCategory } : {}), elements: b2.elements, materialIds: b2.materialIds,
          ...(b2.installationTypeId ? { installationTypeId: b2.installationTypeId } : {}), isKit: b2.isKit, ...Object.fromEntries(V2_NUMS.map(([k]) => [k, b2[k]]).filter(([, x]) => x !== undefined)),
          ...(v.warrantyMonths !== null && v.warrantyMonths !== undefined ? { warrantyMonths: v.warrantyMonths } : {}) } };
      }
      return body;
    },
    create: async (body) => {
      const { _copyFrom, _imagesFinal, _remember, ...rest } = body;
      if (_remember) await saveDefaults(_remember);
      // ПП: карточке после сохранения — полный паспорт («не хватает», строгий выпуск), а не голый ответ создания
      const full = async (doc) => (doc?.id || doc?._id ? api(`/passports/${doc.id || doc._id}`) : doc);
      if (!_copyFrom) return full(await api('/passports', { method: 'POST', body: rest }));
      // модель выбрана: сервер берёт её поля; картинки модели уже разложены по видам в форме (_imagesFinal) — их и шлём;
      // не успели загрузиться — свои добавляются к картинкам модели (каждая в своём виде, без дублей)
      if (!_imagesFinal && rest.images?.length) {
        const m = await api(`/passports/${_copyFrom}`);
        const ks = [...new Set([...(m.images || []).map(kindOf), ...rest.images.map((i) => i.kind)])];
        const vals = {};
        for (const i of [...imagesBody(m.images || []).map((x) => ({ ...x, kind: kindOf(x) })), ...rest.images]) (vals['img_' + i.kind] ||= []).push(i.photoId);
        rest.images = formImages(vals, ks);
      }
      return full(await api(`/passports/${_copyFrom}/copy`, { method: 'POST', body: rest }));
    },
    update: async (id, body) => {
      const { _remember, _issued, ...rest } = body; if (_remember) await saveDefaults(_remember);
      const rev = revisionFor === id; revisionFor = null;
      // НМ-1: выпущенный без «Новой редакции» — отправляем только «после печати» (остальное заблокировано в форме)
      const send = _issued && !rev ? Object.fromEntries(Object.entries(rest).filter(([k]) => AFTER_PRINT.includes(k))) : rest;
      await api(`/passports/${id}`, { method: 'PATCH', body: send, query: rev ? { newRevision: 1 } : undefined });
      if (rev) toast('Новая редакция сохранена — номер тот же, прежняя редакция в истории');
      return api(`/passports/${id}`);
    },
  },

  remove: {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.name || 'без названия'}) в корзину? На нумерацию это не влияет.`,
    blocked: (r) => (statusOf(r) !== 'draft' ? 'Выпущенный паспорт не удаляется — «Аннулировать…» (номер останется занятым)' : null),
    run: (r) => api(`/passports/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/passports/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.name || ''}`, sub: [date(r.date), r.customerName || r.objectName, r.warrantyCode].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('passports', { open: id }),
};

