import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { date, isoDay } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { photoDrop } from '../ui/photos.js';
import { rowsTable } from '../ui/rows-table.js';
import { tagPick } from '../ui/tag-pick.js';
import { CAT_NAMES, KINDS, KINDS_V2, catNames } from '../core/passport-kinds.js';
import { formImages, imagesBody, modelImagesToForm } from '../core/passport-images.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';

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
  { value: 'DSP', label: 'Детское спортивное' }, { value: 'DIO', label: 'Детское игровое' }, { value: 'MAF', label: 'МАФ' },
];
const V2_NUMS = [
  ['ageFrom', 'Возраст от, лет', 'Детское: от 3 (игровое), от 7 (спортивное)'], ['ageTo', 'Возраст до, лет', ''],
  ['heightMin', 'Рост пользователя от, мм', 'Тренажёр: обычно от 1400'], ['heightMax', 'Рост до, мм', ''],
  ['weightMax', 'Вес пользователя до, кг', 'Тренажёр: обычно до 120–150'], ['maxUsers', 'Пользователей одновременно', ''],
  ['fallHeight', 'Высота свободного падения, мм', 'Детское игровое'], ['siteLength', 'Площадка: длина, мм', 'С зоной безопасности'],
  ['siteWidth', 'Площадка: ширина, мм', ''], ['serviceLifeYears', 'Срок службы, лет', 'По умолчанию: 10, МАФ — 5'],
];
const dictRows = async (key) => (await api(`/dicts/${key}`).catch(() => ({ items: [] }))).items || [];
const codeList = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean);
/** Записи справочника для выбора: cats — к каким категориям паспорта относится (пусто — ко всем; ФП — фильтр по категории). */
const dictOpts = async (key) => (await dictRows(key)).map((d) => ({ value: d.id, label: d.name, sub: catNames(d.categories), cats: codeList(d.categories) }));
/** Обязательные виды картинок категории — как на сервере (requiredImageKinds): по строке, «(если разборное)» — только у разборных; safety_zone = safety. */
const reqKinds = (cat, isKit) => {
  const out = [];
  for (const line of String(cat?.requiredImages || '').split(/\r?\n/)) {
    if (/если разборн/i.test(line) && !isKit) continue;
    for (const k of line.replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x))) { const kk = k === 'safety_zone' ? 'safety' : k; if (!out.includes(kk)) out.push(kk); }
  }
  return out;
};
/** Умолчания категории, которых нет в справочнике (подсказки V2_NUMS) — серым «по умолчанию», правятся (ФП). */
const CAT_DEFAULTS = { TRN: { heightMin: 1400, weightMax: 120 }, DIO: { ageFrom: 3 }, DSP: { ageFrom: 7 } };
/** Категория нового паспорта (из черновика «Выпустить паспорт») — форма строится до того, как видны значения. */
let newCat = '';
/** Единый список категорий (решение 2026-10-21: без дублей и грамотно) — дополняется тем, что уже есть в паспортах. */
const CATEGORIES = ['Уличный тренажёр', 'Спортивное оборудование', 'Воркаут', 'Благоустройство', 'МАФ', 'Качели', 'Карусель', 'Детский игровой комплекс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const canEdit = () => ['admin', 'director'].includes(session.user?.role) || session.user?.isOwner === true;
const num = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const dims = (r) => (r.height || r.length || r.width ? `${num(r.height) || '—'} × ${num(r.length) || '—'} × ${num(r.width) || '—'} мм` : '');
const heading = (r) => `Паспорт № ${r.passportNumber || '—'}`;

let facetsCache = null; let facetsAt = 0;
const facets = async () => {
  if (facetsCache && Date.now() - facetsAt < 60000) return facetsCache;
  facetsCache = await api('/passports/facets').catch(() => ({ years: [], categories: [], customers: [], suppliers: [] }));
  facetsAt = Date.now();
  return facetsCache;
};
let oursCache = null;
const ourCompanies = async () => (oursCache ??= await api('/partners', { query: { type: 'our' } }).then((r) => r.items).catch(() => []));
const categories = async () => [...new Set([...CATEGORIES, ...(await facets()).categories.map((c) => c.value)])];

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
  return (await phrasesP)[field] || [];
};

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
  const all = await models().catch(() => []);
  const n = (s) => normSearch(s || '');
  const m = (productId && all.find((x) => x.productId === productId))
    || (article && all.find((x) => x.values.article && n(x.values.article) === n(article)))
    || (name && all.find((x) => n(x.values.name) === n(name)));
  // значения паспорта по умолчанию у изделия каталога (БЗ-6 Э4b) — поверх полей модели; форма v1 берёт только свои поля
  const prod = productId ? await api(`/showcase/${productId}`).catch(() => null) : null;
  const defaults = prod?.passportDefaults || {};
  // ФП: из изделия «Продукции» — то, чего нет у модели: размеры (в мм), вес, назначение, монтаж, описание, фото на обложку
  const mm = (v) => { const u = prod?.dimensions?.unit || 'мм'; const n = Number(v); return n > 0 ? num(Math.round(n * (u === 'м' ? 1000 : u === 'см' ? 10 : 1))) : ''; };
  const fromProd = prod ? Object.fromEntries(Object.entries({
    name: prod.name, article: prod.sku, length: mm(prod.dimensions?.length), width: mm(prod.dimensions?.width), height: mm(prod.dimensions?.height),
    weight: prod.weightKg ? num(prod.weightKg) : '', purpose: prod.purpose || '', installationMethod: prod.installation || '', description: prod.description || '',
    img_overview: (prod.photos || []).length ? prod.photos.map((p) => ({ id: p.id, url: p.url, thumb: p.thumb })) : '',
  }).filter(([, v]) => v)) : {};
  const base = m ? m.values : { name: name || '', article: article || '' };
  draft = { ...fromProd, ...Object.fromEntries(Object.entries(base).filter(([, v]) => v !== '' && v != null)), ...defaults, productId, salesOrderId, orderNo, customerName };
  patch({ of: 'passports', new: '1', open: undefined });
  return !!m;
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
    const vals = { serviceLifeYears: c?.serviceLifeYears, warrantyMonths: c?.warrantyMonths, ...(CAT_DEFAULTS[code] || {}) };
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
  api.on('passportCategory', () => {
    const code = api.get('passportCategory');
    if (code === lastCat) return;
    lastCat = code; scope(true); defaults(); markReq(); check();
  });
  api.on('isKit', markReq);

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
    w.need.className = miss.length ? 'fill-note' : 'muted';
    w.need.replaceChildren(...(miss.length
      ? [h('b', null, `Не хватает для выпуска: ${miss.length}`), h('ul', { class: 'pp-need' }, ...miss.map((m) => h('li', null, m.key ? h('button', { type: 'button', class: 'link-btn', onclick: () => goTo(m.key) }, m.label) : m.label))),
        h('div', { class: 'hint' }, 'Можно сохранить и дополнить позже — PDF покажет пустые места')]
      : [h('span', null, '✓ Всё есть — паспорт можно выпускать')]));
    const b = saveBtn();
    if (b && !b.disabled && !r) b.textContent = miss.length ? 'Сохранить, дополнить позже' : 'Выпустить';
  }, 500); };
  api.root.addEventListener('input', check); api.root.addEventListener('change', check);
  scope(false); markReq();
  if (!r && api.get('passportCategory')) defaults();
  check();
}
const api_get = (p) => api(p);
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
  try { const name = await apiFile(`/passports/${r.id}/pdf`, { query, fallback: `Паспорт_${r.passportNumber}.pdf` }); done(); toast(`Скачан: ${name}`); }
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
    title: `Паспорт № ${r.passportNumber || '—'} — PDF`, okText: 'Скачать PDF', wide: true, body,
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
  return h('div', null, h('div', { class: 'section-title' }, miss.length ? `Проверка — не хватает: ${miss.length}` : 'Проверка'),
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
    searchPlaceholder: 'Поиск: № паспорта, талон, номер изделия, наименование, заказчик, объект…',
    emptyText: 'Паспортов пока нет.',
    query: (P) => ({ ...(P.state === 'incomplete' ? { incomplete: 1 } : {}), ...(P.state === 'noImages' ? { noImages: 1 } : {}) }),
    filters: [
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
        meta: [`№ ${r.passportNumber}`, date(r.date), r.customerName || r.objectName].filter(Boolean).join(' · '),
        badge: r.missing?.length ? h('span', { class: 'badge warn gc-badge', title: 'Не хватает: ' + r.missing.join(', ') }, `не хватает ${r.missing.length}`) : null,
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
      { key: 'passportNumber', label: '№', sort: 'passportNo', cls: 'nowrap', render: (r) => h('b', null, r.passportNumber || '—') },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name || '' }, r.name || h('span', { class: 'muted' }, 'без названия')) },
      { key: 'category', label: 'Категория', sort: 'category', cls: 'md-hide', render: (r) => r.category || h('span', { class: 'muted' }, '—') },
      { key: 'customerName', label: 'Заказчик / объект', sort: 'customerName', cls: 'clip md-hide', render: (r) => h('span', { title: [r.customerName, r.orderNo && 'заказ ' + r.orderNo, r.objectName].filter(Boolean).join(' · ') }, [r.customerName, r.orderNo && '№' + r.orderNo, r.objectName].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—')) },
      { key: 'warrantyCode', label: 'Талон', cls: 'nowrap md-hide muted', render: (r) => r.warrantyCode || '' },
      { key: 'missing', label: 'Заполнено', cls: 'nowrap', render: (r) => (r.missing?.length ? h('span', { class: 'badge warn', title: 'Не хватает: ' + r.missing.join(', ') }, `нет ${r.missing.length}`) : h('span', { class: 'badge ok' }, 'всё')) },
    ],
    card: {
      thumb: (r) => (r.thumb ? h('img', { class: 'thumb', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
      title: (r) => `№ ${r.passportNumber} · ${r.name || 'без названия'}`,
      sub: (r) => [date(r.date), r.customerName || r.objectName, r.missing?.length ? `не хватает: ${r.missing.length}` : ''].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading,
    editTop: true,
    subheading: (r) => [r.name, r.category].filter(Boolean).join(' · '),
    stats: (r) => [['Талон', r.warrantyCode || '—'], ['Номер изделия', `${r.productCode || '—'}${r.productCodeDuplicate ? ' (дубль)' : ''}`], ['Дата', date(r.date)], ['Гарантия', `${r.warrantyMonths ?? 12} мес.`]],
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
      { label: '⇩ PDF и печать…', primary: true, run: (row) => printDialog(row) },
      !r.passportCategory && canEdit() && { label: 'Выбрать категорию', title: 'Без категории PDF упрощённый — с категорией текст соберётся по справочникам', run: (row, ctx) => convertDialog(row, ctx) },
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
      const [els, mats, inst, catRows, stdRows] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall'), dictRows('passportCategories'), dictRows('passportStandards')]);
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
          hint: 'От категории зависят разделы, нормативы, обязательные рисунки и что показывать ниже. Детские (игровое, спортивное) — позже',
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
      return [
        // ФП: что ещё нужно для выпуска — ссылки к полям; обновляется при каждом изменении формы
        { key: '_need', label: 'Готовность к выпуску', type: 'widget', wide: true, widget: () => ({ el: w.need, value: '' }), summary: () => '' },
        { section: 'Изделие (модель)', tone: 'main', fixed: true },
        { key: '_copyFrom', type: 'hidden' }, { key: '_imgsFrom', type: 'hidden' }, { key: 'productId', type: 'hidden' }, { key: 'salesOrderId', type: 'hidden' },
        { key: 'name', label: 'Наименование', required: true, wide: true, max: 500,
          hint: r ? undefined : 'Начните печатать и выберите модель — подставятся габариты, материалы, описание и картинки (серым — по умолчанию, можно поправить)',
          suggest: r ? undefined : models, suggestKeep: true, suggestTitle: 'Модели: выберите — подставится всё, кроме заказчика и даты; поправленное вами не затрётся', suggestFocus: 'customerName' },
        { key: 'category', label: 'Категория', type: 'select', options: cats },
        { key: 'article', label: 'Артикул', max: 50 },
        { key: 'height', label: 'Высота, мм', type: 'number', min: 0, span: 1 },
        { key: 'length', label: 'Длина, мм', type: 'number', min: 0, span: 1 },
        { key: 'width', label: 'Ширина, мм', type: 'number', min: 0, span: 1 },
        { key: 'weight', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
        ...v2Fields,
        { section: 'Кому и когда', tone: 'who' },
        { key: 'customerName', label: 'Заказчик', type: 'combo', options: f.customers.map((c) => c.value), max: 300 },
        { key: 'orderNo', label: '№ заказа', max: 50, suggest: orders, suggestTitle: 'Заказы — выбор подставит заказчика', hint: 'Начните печатать номер или заказчика' },
        { key: 'objectName', label: 'Объект / адрес', wide: true, max: 500 },
        ...(r ? [] : [{ key: 'date', label: 'Дата', type: 'date', required: true, hint: 'По дате и номеру строится гарантийный талон' }]),
        { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })), hint: 'Реквизиты, печать и подпись в PDF — из карточки компании' },
        { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
        { section: 'Описание (раздел 1)', tone: 'info', collapsed: !!r },
        { key: 'materials', label: 'Материалы («изготовленное из …»)', type: 'textarea', wide: true, max: 2000, phrases: { load: phrases('materials'), by: 'category', title: 'Варианты' } },
        { key: 'installationMethod', label: 'Установка', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('installationMethod'), by: 'category', title: 'Варианты' } },
        { key: 'purpose', label: 'Назначение', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('purpose'), by: 'category', title: 'Варианты' } },
        { key: 'description', label: 'Описание целиком (раздел 1.1 паспорта)', type: 'textarea', wide: true, rows: 5, max: 4000, compose: { from: ['name', 'materials', 'installationMethod', 'purpose'], build: buildDescription },
          hint: 'Собирается само из наименования, материалов, установки и назначения; можно поправить вручную' },
        // ФП: обязательные для категории (*) и «Общий вид» — сразу; остальные — в свёрнутом «Ещё картинки»; вставка Ctrl+V — в вид под курсором
        { section: 'Картинки', tone: 'info', collapsed: !!r },
        ...kinds({ requiredImages: req }).filter(([k]) => mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label: `${label}${req.includes(kind) ? ' *' : ''}`, type: 'photos', hint: `${where}${req.includes(kind) ? ' · обязательно для категории' : ''}` })),
        { section: 'Ещё картинки', tone: 'info', collapsed: true },
        ...kinds({ requiredImages: req }).filter(([k]) => !mainKinds.has(k)).map(([kind, label, where]) => ({ key: 'img_' + kind, label, type: 'photos', hint: where })),
        { section: 'Комплектность и заметки', tone: 'who', collapsed: true },
        { key: 'bom', label: 'Комплектность изделия (таблица 5)', type: 'widget', wide: true,
          widget: (v) => rowsTable({ columns: BOM_COLS, rows: v, file: 'Шаблон комплектности', example: ['И-1', 'Изделие в сборе', 1, 'шт.', ''] }),
          hint: 'Пусто — «И-1 · Изделие в сборе · 1 шт.». Можно вставить строки из Excel (Ctrl+V в ячейку) или загрузить заполненный шаблон' },
        { key: 'note', label: 'Заметки', type: 'textarea', wide: true, rows: 3, max: 4000, hint: 'Попадут в паспорт на лист «Для заметок»; пусто — листа не будет' },
      ];
    },
    // поставщик по умолчанию — наша компания, у которой больше всего паспортов (у модели свой — подставится при выборе)
    // черновик «Выпустить паспорт» (issuePassport) — поверх, пустые значения не затирают умолчания
    initial: async () => {
      const d = draft; draft = null;
      newCat = d?.passportCategory || '';
      return { date: isoDay(), warrantyMonths: '12', supplierOrgId: (await facets()).suppliers[0]?.value || '',
        ...Object.fromEntries(Object.entries(d || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)) };
    },
    toInitial: (r) => ({ ...r, height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight), warrantyMonths: num(r.warrantyMonths ?? 12), bom: bomRows(r.bom),
      ...v2Initial(r),
      ...Object.fromEntries(kinds().map(([kind]) => ['img_' + kind, imgsOf(r, kind).filter((i) => i.url).map((i) => ({ id: String(i.photoId), url: i.url, thumb: i.url }))])) }),
    // ФП: картинки — каждая в своём виде (formImages); у модели они уже разложены в форме (_imgsFrom) — отправляем как есть
    toBody: (v, r) => {
      const s = (x) => (x === null || x === undefined ? '' : String(x));
      const body = {
        name: s(v.name), category: s(v.category), article: s(v.article), materials: s(v.materials), installationMethod: s(v.installationMethod), purpose: s(v.purpose),
        customerName: s(v.customerName), orderNo: s(v.orderNo), objectName: s(v.objectName), note: s(v.note),
        ...(v.supplierOrgId ? { supplierOrgId: v.supplierOrgId } : {}),
        ...Object.fromEntries(['height', 'length', 'width', 'weight', 'warrantyMonths'].filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, v[k]])),
      };
      body.description = s(v.description) || buildDescription(body);
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
      return body;
    },
    create: async (body) => {
      const { _copyFrom, _imagesFinal, ...rest } = body;
      if (!_copyFrom) return api('/passports', { method: 'POST', body: rest });
      // модель выбрана: сервер берёт её поля; картинки модели уже разложены по видам в форме (_imagesFinal) — их и шлём;
      // не успели загрузиться — свои добавляются к картинкам модели (каждая в своём виде, без дублей)
      if (!_imagesFinal && rest.images?.length) {
        const m = await api(`/passports/${_copyFrom}`);
        const ks = [...new Set([...(m.images || []).map(kindOf), ...rest.images.map((i) => i.kind)])];
        const vals = {};
        for (const i of [...imagesBody(m.images || []).map((x) => ({ ...x, kind: kindOf(x) })), ...rest.images]) (vals['img_' + i.kind] ||= []).push(i.photoId);
        rest.images = formImages(vals, ks);
      }
      return api(`/passports/${_copyFrom}/copy`, { method: 'POST', body: rest });
    },
    update: (id, body) => api(`/passports/${id}`, { method: 'PATCH', body }),
  },

  remove: {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.name || 'без названия'}) в корзину? Номер не освободится — новый паспорт получит следующий.`,
    run: (r) => api(`/passports/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/passports/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.name || ''}`, sub: [date(r.date), r.customerName || r.objectName, r.warrantyCode].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('passports', { open: id }),
};

