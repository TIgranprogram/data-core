import { api, PREFIX, session } from '../core/api.js';
import { stepFunnel } from '../ui/step-funnel.js';
import { h } from '../core/dom.js';
import { date, money, plural, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { toast } from '../ui/toast.js';
import { skuKey } from '../core/facets.js';
import { pic } from './stock.js';
import { kpAdd, kpCount } from './kp.js';
import { setCompositionTarget } from './composition.js';
import { suggestLink } from '../ui/composition-suggest.js';
// УПР-1/Д11: issuePassport и passports.canEdit() убраны — вход только через панель паспорта
import { printDialog } from './passports/dialogs.js';
import { openTechSheet } from './tech-sheet.js';
import { openBulk } from './bulk-edit.js';
import { dictNames } from '../ui/dict-options.js';
import { loadMaterialDicts, materialsSpec, specSummary } from '../ui/materials-spec.js';
import { confirmDlg } from '../ui/dialog.js';
import { funnelBox } from '../ui/funnel.js';
import { V2_NUMS, canEdit as canEditPassportTexts, dictOpts } from './passports/common.js';
import { tagPick } from '../ui/tag-pick.js';
import { catArt } from '../ui/cat-art.js';
import { routeBlock } from './work-route.js';

/*
 * «Продукция» (TASKS БЗ-4) — витрина изделий компании: разделы плитками, поиск, фото; карточка — правка (артикул,
 * наименование, раздел → группа, серия, цена, описание, фото); «В КП» в строке — собрать коммерческое предложение;
 * «⇩ Загрузить каталог» — Excel / вставка (колонки как в «Перечне изделий»: Тип · Группа · Артикул · Наименование · Серия · Цена).
 * Сервер — /api/showcase (поверх общей коллекции CRM products).
 */
const thumb = (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + (r.photo.thumb || r.photo.url), alt: '', loading: 'lazy', decoding: 'async' }) : null);
// подсказки формы (ФИ): один запрос на 30 с — карточка зовёт fields() и ради подписей истории
let fvCache = null; let fvAt = 0;
const formValues = () => {
  if (!fvCache || Date.now() - fvAt > 30000) { fvAt = Date.now(); fvCache = api('/showcase/form-values').catch(() => { fvCache = null; return { sections: [], groups: [], series: [], colors: [], sizes: [] }; }); }
  return fvCache;
};
const dims = (d) => (d ? `${['length', 'width', 'height'].map((k) => (d[k] ? qty(d[k]) : '—')).join(' × ')} ${d.unit || 'мм'}` : null);
// ФИ2: «Назначение» и «Монтаж» — готовые тексты паспортов (GET /passports/phrases), один запрос в минуту
let phrasesP = null; let phrasesAt = 0;
const phrases = (field) => async () => {
  if (!phrasesP || Date.now() - phrasesAt > 60000) { phrasesAt = Date.now(); phrasesP = api('/passports/phrases').catch(() => { phrasesP = null; return {}; }); }
  return (await phrasesP)[field] || [];
};
// «Цена и себестоимость» в форме: себестоимость — только показ расчёта по составу (поле CRM costPrice не пишем)
const costInfo = (r) => {
  const c = r?.cost;
  const text = !r ? 'Посчитается по составу — состав добавляется в карточке после «Создать»'
    : c?.total ? `≈ ${money(c.total)} по составу${c.missing ? ` · без цены: ${c.missing}` : ''}`
      : r.composition?.length ? 'У материалов состава нет цен закупки — сумма не считается' : 'Состав не заполнен — «Изменить состав» в карточке';
  return { el: h('p', { class: 'muted' }, text), value: '' };
};
/** МИ.2: «Взять из состава» — предложение таблицы по материалам «Состава изделия»; запишется по «Сохранить». */
const fromComposition = (r) => ({ label: 'Взять из состава', busy: 'Собираю…', title: 'Строки по материалам «Состава изделия»: труба 89×3 → Труба стальная ∅89×3',
  run: async (w) => {
    const res = await api(`/showcase/${r.id}/materials-spec/from-composition`);
    const rows = res.materialsSpec?.rows || [];
    if (!rows.length) { toast(res.unmatched?.length ? `Материалы состава не нашлись в справочнике: ${res.unmatched.join(', ')} — заполните строки вручную` : 'В составе нет материалов склада — «Изменить состав» в карточке', { ms: 8000 }); return; }
    if (!w.isEmpty() && !(await confirmDlg('Заменить таблицу материалов?', 'Строки заменятся предложением по «Составу изделия». В изделие запишется по «Сохранить».', { okText: 'Заменить' }))) return;
    const hint = res.hinted?.length ? ' Подсказка по названию, проверьте: ' + res.hinted.join(', ') + '.' : '';
    w.set({ rows, coatingIds: [...new Set([...(JSON.parse(w.value || 'null')?.coatingIds || []), ...(res.materialsSpec.coatingIds || [])])] });
    toast((res.unmatched?.length ? `Строк: ${rows.length}. Не нашлись в справочнике: ${res.unmatched.join(', ')} — добавьте вручную` : `Строк из состава: ${rows.length} — проверьте и сохраните`) + hint, { ms: res.unmatched?.length || hint ? 9000 : undefined });
  } });
/** materialsSpec — при создании, а при правке — только если таблицу меняли (не трогаем изделие с удалённой записью справочника). */
const specBody = (v, r) => {
  const next = v.materialsSpec ?? null;
  return !r || JSON.stringify(next) !== JSON.stringify(r.materialsSpec ?? null) ? { materialsSpec: next } : {};
};
/** БЗ-9: поля массового изменения изделий — общие для всех выбранных. */
async function productBulkFields() {
  const fv = await formValues();
  const staff = await api('/dicts/persons').then((x) => (x.items || []).filter((p) => p.status !== 'fired').map((p) => ({ id: p.id, label: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '' }))).catch(() => []);
  const ids = new Map(staff.map((p) => [p.label, p.id]));
  const cats = await api('/dicts/passportCategories').then((x) => (x.items || []).map((c) => ({ value: c.code, label: c.name }))).catch(() => []);
  const n = (v) => (v === '' ? null : v);
  return [
    { key: 'type', label: 'Тип оборудования', type: 'combo', options: fv.sections.map((x) => x.value), hint: 'Группа у каждого изделия останется своя' },
    { key: 'group', label: 'Группа изделий', type: 'combo', options: fv.groups.map((g) => ({ value: g.value, label: g.value, sub: g.section })), hint: 'Тип у каждого изделия останется свой' },
    { key: 'series', label: 'Название серии', type: 'combo', options: fv.series.map((x) => x.value), strict: true, strictText: 'Выберите серию из справочника', extra: () => [{ label: 'Открыть справочник серий', run: () => go('dicts', { d: 'productSeries' }) }], hint: 'Нет нужной — добавьте в справочнике' },
    { key: 'status', label: 'Статус', type: 'select', options: [{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'В продаже' }, { value: 'archived', label: 'Архив' }] },
    { key: 'price', label: 'Цена, ₽ — одна для всех', type: 'number', map: n },
    { key: 'designerId', label: 'Кто проектировал', type: 'combo', options: staff.map((p) => ({ value: p.id, label: p.label, sub: p.sub })), map: (v) => (v ? ids.get(v) || '' : ''), hint: 'Пусто — снять' },
    { key: 'unit', label: 'Ед. изм.', type: 'combo', options: (fv.units || []).map((x) => x.value) },
    { key: 'ralCode', label: 'RAL', type: 'combo', options: (fv.ral || []).map((x) => x.value) },
    { key: 'colors', label: 'Цвета (варианты)', type: 'list', modes: true, map: (v) => v },
    { key: 'sizes', label: 'Размеры (варианты)', type: 'list', modes: true, map: (v) => v },
    { key: 'pd.passportCategory', label: 'Паспорт по умолчанию: категория', type: 'select', options: cats.filter((c) => c.value !== 'ALL') },
    { key: 'pd.serviceLifeYears', label: 'Паспорт по умолчанию: срок службы, лет', type: 'number', map: n },
    { key: 'pd.warrantyMonths', label: 'Паспорт по умолчанию: гарантия, мес.', type: 'number', map: n },
  ];
}
/** Паспорт по умолчанию у изделия: категория и выбор текстов воронки (passportDefaults.textChoices). Заменяется целиком — берём известные поля. */
export const PD_KEYS = ['passportCategory', 'elements', 'materialIds', 'installationTypeId', 'isKit', 'warrantyMonths', ...V2_NUMS.map(([k]) => k)];
export async function savePd(id, pd) {
  const prev = pd.prev || {};
  const cat = pd.category && (pd.category !== pd.derived || prev.passportCategory) ? pd.category : prev.passportCategory || '';
  const over = pd.over || {};
  const empty = (x) => x === undefined || x === null || x === '' || x === false || (Array.isArray(x) && !x.length);
  const sameOver = Object.entries(over).every(([k, v]) => (empty(v) && empty(prev[k])) || JSON.stringify(v) === JSON.stringify(prev[k]));
  if (sameOver && JSON.stringify(prev.textChoices || {}) === JSON.stringify(pd.choices) && cat === (prev.passportCategory || '')) return;
  const merged = { ...prev, ...over };
  const body = { ...Object.fromEntries(PD_KEYS.filter((k) => merged[k] !== undefined && merged[k] !== null && merged[k] !== '').map((k) => [k, merged[k]])), ...(cat ? { passportCategory: cat } : {}), textChoices: pd.choices };
  await api(`/showcase/${id}/passport-defaults`, { method: 'PUT', body });
}
/** Категория паспорта в карточке: что задано в изделии, что унаследовано от группы/раздела, куда идти, если не задано. */
function passportCatView(r, ctx) {
  const pc = r.passportCategory;
  const lbl = (c) => (c ? `${c.name || c.code}` : '');
  const where = r.group ? `группы «${r.group}»` : r.type ? `раздела «${r.type}»` : '';
  if (pc?.own) {
    const inh = pc.inherited;
    const reset = h('button', { type: 'button', class: 'link-btn', onclick: async () => {
      const pd = r.passportDefaults || {};
      const body = { ...Object.fromEntries(PD_KEYS.filter((k) => k !== 'passportCategory' && pd[k] !== undefined && pd[k] !== null && pd[k] !== '').map((k) => [k, pd[k]])), textChoices: pd.textChoices || {} };
      try { await api(`/showcase/${r.id}/passport-defaults`, { method: 'PUT', body }); toast('Категория сброшена'); ctx?.setRow?.(await api(`/showcase/${r.id}`)); } catch (e) { toast(e.message || 'Не удалось сбросить'); }
    } }, 'Сбросить');
    return h('span', null, `${lbl(pc.own)} — задана в самом изделии`, inh && inh.code !== pc.own.code ? ` (${r.group ? `у группы «${r.group}»` : 'по группе'}: ${lbl(inh)})` : '', ' ', reset);
  }
  const cur = pc?.inherited || (pc && pc.code ? pc : null);
  if (cur) return `${cur.name || cur.code}${cur.via ? ` (${cur.via})` : ''}`;
  if (!where) return null;
  return h('span', { class: 'muted' }, `У ${where} не задана категория паспорта. Выберите её в «Продукция → Категории» (строка ${r.group ? 'группы' : 'раздела'}, поле «Категория паспорта»)`);
}
// заголовок блока в списке полей карточки (стиль .fields-grp в panels.css)
const grp = (t) => [h('span', { class: 'fields-grp' }, t), h('span', { class: 'fields-grp-end' })];
const STATUS = { draft: 'черновик · нет цены', active: 'в продаже', new: 'новое', archived: 'архив' };

// «Состав» (БЗ-5): материалы склада, из которых сделано изделие; правка — в правой панели.
// Себестоимость материалов (тем, кто видит деньги): цена — последняя закупка, иначе справочник материалов
// Пометка скрипта переноса каталога («⚠ Проверить …»): жёлтая плашка; «Готово» снимает строки с ⚠ из примечания
function warnNote(r) {
  if (!r.notes || !r.notes.startsWith('⚠')) return null;
  const rest = r.notes.split('\n').filter((l) => !l.trim().startsWith('⚠')).join('\n').trim();
  return h('div', { style: 'background:var(--warn-soft);border:1px solid var(--warn);border-radius:8px;padding:.6rem .8rem;margin-bottom:.8rem;display:flex;gap:.8rem;align-items:flex-start;justify-content:space-between' },
    h('div', { style: 'white-space:pre-wrap' }, r.notes),
    session.canEdit ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Проверено — убрать пометку',
      onclick: async () => { await api(`/showcase/${r.id}`, { method: 'PATCH', body: { notes: rest } }); patch({}); } }, 'Готово') : null);
}

function compositionBlock(r) {
  const items = r.composition || [];
  const cost = session.canMoney ? r.cost : null;
  // СИ: строки трёх видов; цена — по виду и ссылке (материал — закупка/справочник, изделие — по его составу)
  const price = new Map((cost?.lines || []).map((x) => [`${x.lineType || 'material'}:${x.refId || x.materialId}`, x]));
  const priceText = (l) => {
    const p = price.get(`${l.lineType || 'material'}:${l.refId || l.materialId}`);
    if (!cost || l.raw) return '';
    if (!p || p.price == null) return ' · цены нет';
    const src = p.source === 'reference' ? ' (справочник)' : p.source === 'composition' ? ` (по составу${p.partial ? ', не всё с ценой' : ''})` : p.date ? ` (закупка ${date(p.date)})` : '';
    return ` · ${money(p.price)}/${l.unit} = ${money(p.sum)}${src}`;
  };
  const line = (l) => h('li', null, l.name, h('span', { class: 'muted' }, ` · ${qty(l.quantity)} ${l.unit}${l.article ? ' · ' + l.article : ''}${priceText(l)}`),
    l.lineType === 'product' && l.children?.length ? h('details', { class: 'comp-nested' }, h('summary', null, `его состав: ${l.children.length}`),
      h('ul', null, ...l.children.map((c) => h('li', null, `${c.name} · ${qty(c.quantity)} ${c.unit}`)))) : null);
  const groups = [['material', 'Материалы'], ['product', 'Изделия'], ['module', 'Модули (CRM)']].map(([t, title]) => [title, items.filter((l) => (l.lineType || 'material') === t || (t === 'module' && l.raw))]).filter(([, l]) => l.length);
  return h('div', null, h('div', { class: 'section-title' }, `Состав${items.length ? ` (${items.length})` : ''}`),
    items.length ? h('div', null, ...groups.map(([title, list]) => h('div', null, groups.length > 1 ? h('b', null, title) : null, h('ul', { class: 'timeline' }, ...list.map(line)))))
      : h('p', { class: 'muted' }, 'Состав не заполнен — «Изменить состав» в действиях карточки'),
    cost ? h('p', null, h('b', null, `Себестоимость ≈ ${money(cost.total)}`),
      h('span', { class: 'muted' }, cost.missing ? ` · без цены: ${cost.missing} — в сумму не вошли` : ' · материалы — по последним закупкам, изделия — по их составу')) : null);
}

// «Паспорта» (БЗ-5): выпущенные паспорта этого изделия — по ссылке или по названию
function passportsBlock(r) {
  const p = r.passports;
  if (!p?.total) return h('p', { class: 'muted' }, 'Паспортов пока нет — «Документация → Паспорта» → изделие → «Выпустить паспорт»');
  return h('div', null, h('div', { class: 'section-title' }, `Паспорта (${p.total})`),
    h('ul', { class: 'timeline' }, ...p.items.map((x) => h('li', null,
      h('a', { href: '#passports?open=' + x.id }, `№ ${x.passportNumber || '—'}`),
      h('span', { class: 'muted clip' }, [date(x.date), x.customer, x.orderNo ? 'заказ ' + x.orderNo : ''].filter(Boolean).join(' · '))))),
    p.total > p.items.length ? h('p', { class: 'muted' }, `показаны последние ${p.items.length}`) : null);
}

// «Где в заказах» (БЗ-5): позиции заказов с этим изделием (по ссылке или по совпадению названия) — только просмотр
function inOrders(r) {
  const items = r.orderLines || [];
  if (!items.length) return h('p', { class: 'muted' }, 'В заказах не встречается');
  return h('div', null, h('div', { class: 'section-title' }, `В заказах (${items.length})`),
    h('ul', { class: 'timeline' }, ...items.map((l) => h('li', null,
      h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`),
      h('span', { class: 'muted clip' }, [l.customer, l.qty != null ? `${qty(l.qty)} шт.` : '', l.color, l.size, l.shipDate ? 'отгрузка ' + date(l.shipDate) : ''].filter(Boolean).join(' · ')),
      l.linked ? suggestLink(l.id) : null))));
}

/**
 * «+ Создать изделие» из «Нового паспорта» (ПИ): форма изделия в правой панели с готовыми разделом и названием;
 * после «Создать» — then(изделие) (паспорт открывается снова с выбранным изделием). Запрос живёт 15 минут.
 */
let pendingCreate = null;
/** ПП: ФИО → id сотрудника для поля «Кто проектировал» (заполняется при сборке формы). */
let designerIds = new Map();
export function createProductFor(initial, then) {
  pendingCreate = { initial, then, at: Date.now() };
  patch({ of: 'products', new: '1', open: undefined });
}
const pending = () => (pendingCreate && Date.now() - pendingCreate.at < 15 * 60000 ? pendingCreate : null);

// Первая страница «Продукции»: разделы и их группы плитками с рисунком; клик — тот же фильтр, что дерево слева.
// Раздел без групп — плиткой в «Другие разделы». «Все изделия списком» (?all=1) — прежняя галерея.
const nItems = (n) => `${qty(n)} ${plural(n, 'изделие', 'изделия', 'изделий')}`;
const catTile = (g, pick) => {
  const art = h('div', { class: 'cat-art' });
  art.innerHTML = catArt(g.name); // свой статичный SVG, данных пользователя нет
  return h('button', { type: 'button', class: 'cat-tile', title: g.name, onclick: () => pick(g.id) }, art,
    h('div', { class: 'cat-body' }, h('div', { class: 'cat-name' }, g.name), h('div', { class: 'cat-n' }, nItems(g.count || 0))));
};
const SEC_KEY = 'dc-prod-sec'; // раскрытый раздел — «назад» из галереи видит то же
const secOpen = () => { try { return sessionStorage.getItem(SEC_KEY) || ''; } catch { return ''; } };
const secSave = (id) => { try { if (id) sessionStorage.setItem(SEC_KEY, id); else sessionStorage.removeItem(SEC_KEY); } catch { /* приватный режим */ } };
async function catLanding({ pick }) {
  const all = await api('/showcase/groups').catch(() => null);
  if (!all?.length) return h('div', { class: 'state' }, h('div', null, 'Разделов пока нет — изделия покажутся списком.'),
    h('button', { class: 'btn', type: 'button', onclick: () => patch({ all: '1' }) }, 'Все изделия'));
  const tops = all.filter((g) => !g.parentId);
  const kids = (t) => all.filter((g) => g.parentId === t.id);
  const total = tops.reduce((a, t) => a + (t.count || 0), 0);
  const items = []; // { id, tile, panel } — панель раскрывается переключением класса, запрос не повторяется
  const setOpen = (id) => {
    secSave(id);
    for (const it of items) {
      const on = it.id === id;
      it.tile.classList.toggle('active', on); it.tile.setAttribute('aria-expanded', String(on));
      it.panel.classList.toggle('open', on); if (on) it.panel.removeAttribute('inert'); else it.panel.setAttribute('inert', '');
    }
  };
  const secItem = (t) => {
    const ks = kids(t);
    const art = h('div', { class: 'sec-art' });
    art.innerHTML = catArt(t.name); // свой статичный SVG, данных пользователя нет
    const pid = 'sec-p-' + t.id;
    const body = h('span', { class: 'sec-body' }, h('span', { class: 'sec-name' }, t.name), h('span', { class: 'sec-n' }, nItems(t.count || 0)));
    const tile = h('button', { type: 'button', class: 'sec-tile sec-products', title: t.name, 'aria-expanded': 'false', 'aria-controls': ks.length ? pid : undefined,
      onclick: () => (ks.length ? setOpen(secOpen() === t.id ? '' : t.id) : pick(t.id)) }, art, body, ks.length ? h('span', { class: 'sec-chev', 'aria-hidden': 'true' }, '▾') : null);
    const panel = h('div', { class: 'sec-panel', id: pid, inert: '' }, h('div', { class: 'sec-panel-in' },
      h('div', { class: 'sec-panel-head' }, h('h3', null, 'Группы раздела «' + t.name + '»'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => pick(t.id) }, 'Весь раздел →')), // «Все изделия списком» — один раз, сверху (аудит Д12)
      h('div', { class: 'cat-grid' }, ...ks.map((g) => catTile(g, pick)))));
    items.push({ id: t.id, tile, panel });
    return h('div', { class: 'sec-item' }, tile, ks.length ? panel : null);
  };
  const main = tops.slice(0, 3); const rest = tops.slice(3);
  const node = h('div', { class: 'cat-landing' },
    h('div', { class: 'cat-top' }, h('p', { class: 'muted' }, `Выберите раздел · всего ${nItems(total)}`),
      h('button', { class: 'btn', type: 'button', onclick: () => patch({ all: '1' }) }, 'Все изделия списком')),
    h('div', { class: 'sec-grid' }, ...main.map(secItem)),
    rest.length ? h('section', { class: 'cat-sec' }, h('div', { class: 'cat-sec-head' }, h('h3', null, 'Другие разделы')), h('div', { class: 'sec-grid' }, ...rest.map(secItem))) : null);
  const was = secOpen(); setOpen(items.some((it) => it.id === was) ? was : '');
  return node;
}

export const products = {
  id: 'products',
  kind: 'Изделие',
  title: 'Продукция',
  newTitle: 'Новое изделие',
  entityType: 'Product',
  get: (id) => api(`/showcase/${id}`),

  list: {
    path: '/showcase',
    export: 'admin',
    sortDefault: 'withPhoto',
    viewKey: 'products',
    createLabel: 'Изделие',
    // БЗ-9: отметить изделия → «Изменить выбранные» (артикул, наименование, фото, состав — по одному)
    bulk: { open: (ids, { done }) => openBulk({ ids, done, fields: productBulkFields,
      // «pd.*» — значения паспорта по умолчанию: собираем в один объект (сервер дополняет, не заменяет)
      apply: (set, arrays) => {
        const pd = Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('pd.')).map(([k, v]) => [k.slice(3), v]));
        const rest = Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('pd.')));
        return api('/showcase/bulk', { method: 'POST', body: { ids, set: { ...rest, ...(Object.keys(pd).length ? { passportDefaults: pd } : {}) }, arrays } });
      },
      restore: (before) => api('/showcase/bulk/restore', { method: 'POST', body: { items: before } }) }),
      extra: [{ label: 'В КП', run: (_ids, rows) => { rows.forEach(kpAdd); toast(`В КП: ${rows.length} изд. — всего ${kpCount()}`); document.querySelectorAll('.kp-open').forEach((b) => { b.textContent = `КП (${kpCount()})`; }); } }] }, // права — canEditSection в списке
    searchPlaceholder: 'Поиск: наименование, артикул, серия…',
    emptyText: 'Изделий пока нет.', emptyHint: 'Нажмите «⇩ Загрузить каталог»: Excel с колонками Тип, Группа, Артикул, Наименование, Серия, Цена.',
    // левая панель (NAV F3): поиск → «Тип · Группа изделий» → «Серия» → «Состояние»; цену и габариты не фильтруем
    sidebar: true,
    chipsTop: true, // «Состояние» — строкой над списком, слева — только «что ищем»
    toolbarExtra: () => stepFunnel({
      steps: [{ key: 'series', label: 'Серия' }],
      load: async (P) => {
        const r = await api('/showcase', { query: { facets: 1, limit: 1, ...(P.groupId ? { groupId: P.groupId } : {}), ...(P.status ? { status: P.status } : {}), ...(P.q ? { search: P.q } : {}), ...(P.series ? { series: P.series } : {}) } });
        return { series: r.facets?.series || [] };
      },
    }),
    filters: [
      { key: 'groupId', label: 'Тип · Группа', type: 'hidden' }, // выбирается деревом «Тип · Группа изделий»
      { key: 'series', label: 'Серия', type: 'hidden' }, // Б1: шаг воронки слева (toolbarExtra), числа — при выбранной группе
      { key: 'status', label: 'Статус', type: 'chips', allLabel: 'Все', options: () => [{ value: 'draft', label: 'Черновики (нет цены)' }, { value: 'archived', label: 'Архив' }] },
    ],
    limit: 100, // таблица: по умолчанию 100 строк, меньше — выбор внизу
    // серия — точное совпадение на сервере (query series)
    query: (P) => (P.series ? { series: P.series } : {}),
    // ФИ2: основной вид — карточки с фото по разделам и группам, как «Паспорта»; «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 100, sort: 'category', lastGroup: 'Без типа',
      groupBy: (r) => [r.type, r.group].filter(Boolean).join(' › ') || 'Без типа',
      card: (r) => ({
        pic: r.photo ? PREFIX + (r.photo.thumb || r.photo.url) : null,
        title: r.name,
        meta: [r.sku && `арт. ${r.sku}`, r.series].filter(Boolean).join(' · '),
        price: r.price ? money(r.price) : null,
        badge: r.status === 'archived' ? h('span', { class: 'badge dim gc-badge' }, 'архив') : !r.price ? h('span', { class: 'badge warn gc-badge', title: 'Нет цены — изделие в черновиках' }, 'черновик') : null,
      }),
    },
    landing: { when: (P) => !P.groupId && !P.q && !P.series && !P.status && !P.all, render: catLanding },
    tiles: {
      key: 'groupId', title: 'Тип · Группа изделий',
      // раздел — заголовок, под ним его группы; группа без известного раздела — в конце с подписью
      load: async () => {
        const all = await api('/showcase/groups'); const tops = all.filter((g) => !g.parentId); const known = new Set(tops.map((g) => g.id));
        return [...tops.flatMap((t) => [{ value: t.id, label: t.name, n: t.count, head: true }, ...all.filter((g) => g.parentId === t.id).map((g) => ({ value: g.id, label: g.name, n: g.count, sub: ' ' }))]),
          ...all.filter((g) => g.parentId && !known.has(g.parentId)).map((g) => ({ value: g.id, label: g.name, n: g.count, sub: 'группа' }))];
      },
    },
    // П2/Д12: в шапке «КП» и главная «+ Изделие»; весь импорт — одним пунктом в «Ещё ▾»
    headActions: () => [h('button', { class: 'btn kp-open', type: 'button', title: 'Собранное коммерческое предложение', onclick: () => patch({ of: 'kp', new: '1', open: undefined }) }, `КП (${kpCount()})`)],
    moreActions: () => [{ title: 'Импорт', items: [
      { label: 'Загрузить каталог…', onSelect: () => patch({ of: 'catalogimport', new: '1', open: undefined }) },
      session.canEdit ? { label: 'Из заказов…', onSelect: () => patch({ of: 'fromorders', new: '1', open: undefined }) } : null,
      session.canEdit ? { label: 'Из паспортов…', onSelect: () => patch({ of: 'frompassports', new: '1', open: undefined }) } : null] }],
    hints: {},
    rowAction: (r) => ({ label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`«${row.name}» в КП — всего ${kpCount()}`); document.querySelectorAll('.kp-open').forEach((b) => { b.textContent = `КП (${kpCount()})`; }); return false; } }),
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', export: false, render: (r) => { const p = pic(r.photo); p.classList.add('pic-lg'); return p; } },
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => r.sku },
      { key: 'name', label: 'Название', sort: 'name', cls: 'name-2', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Тип · Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'series', label: 'Серия', sort: 'series', cls: 'md-hide', render: (r) => r.series || '' },
      { key: 'price', label: 'Цена', sort: 'price', cls: 'num right', render: (r) => (r.price ? money(r.price) : h('span', { class: 'muted' }, 'нет цены')) },
    ],
    card: {
      thumb,
      title: (r) => r.name,
      sub: (r) => [r.sku && `арт. ${r.sku}`, r.group, r.series].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, r.price ? money(r.price) : '—')],
    },
  },

  card: {
    heading: (r) => r.name,
    subheading: (r) => [r.sku && `арт. ${r.sku}`, STATUS[r.status] || r.status].filter(Boolean).join(' · '),
    editTop: true,
    zones: { extra: 'side' },
    // SK-8d: «В заказах» и «Паспорта» — только если эти разделы открыты роли
    extra: (r) => h('div', null, warnNote(r), compositionBlock(r), session.sees('work') ? routeBlock(r) : null, session.sees('salesorders') ? inOrders(r) : null, session.seesDocs() ? passportsBlock(r) : null),
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: [...(r.photos || []).map((p) => p.id), photoId] } }),
    photoMain: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: [photoId, ...(r.photos || []).map((p) => p.id).filter((x) => x !== photoId)] } }),
    photoRemove: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: (r.photos || []).map((p) => p.id).filter((x) => x !== photoId) } }),
    // ИЗ-4: порядок как в форме — изделие, цена, паспорт, характеристики, описание, дополнительно
    view: (r, ctx) => [
      grp('Изделие'),
      r.photoSource === 'passport' ? ['Обложка', h('span', null,
        h('span', { class: 'muted' }, 'фото из паспорта'),
        session.canEdit ? h('button', { class: 'btn btn-sm', type: 'button', style: 'margin-left:.5rem',
          title: 'Скопировать фото из паспорта в карточку изделия — станет «своим»',
          onclick: async () => { await api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: [r.photo.id] } }); patch({}); } }, '← своей обложкой') : null)] : null,
      ['Короткое название', r.name], ['Тип оборудования', r.type], ['Группа изделий', r.group], ['Артикул', r.sku],
      ['Статус', STATUS[r.status] || r.status],
      grp('Цена'),
      ['Цена', r.price ? money(r.price) : h('span', { class: 'muted' }, 'не указана — изделие в черновиках')],
      ...(session.canMoney && r.cost?.total ? [['Себестоимость материалов', `≈ ${money(r.cost.total)}${r.price ? ` · наценка ${Math.round((r.price / r.cost.total - 1) * 100)}%` : ''}`]] : []),
      grp('Паспорт'),
      ['Категория паспорта', passportCatView(r, ctx)],
      ['Гарантия', r.passportDefaults?.warrantyMonths ? `${r.passportDefaults.warrantyMonths} мес.` : null],
      ['Срок службы', r.passportDefaults?.serviceLifeYears ? `${r.passportDefaults.serviceLifeYears} лет` : null],
      ['Поставляется разобранным', r.passportDefaults?.isKit ? 'да' : null],
      grp('Характеристики'),
      ['Габариты (Д×Ш×В)', dims(r.dimensions)], ['Вес', r.weightKg ? `${qty(r.weightKg)} кг` : null], ['Ед. изм.', r.unit], ['RAL', r.ralCode],
      grp('Описание и материалы'),
      ['Материалы', r.materialsText || (r.materialsSpec ? null : h('span', { class: 'muted' }, 'таблица не заполнена — «Изменить» → «Описание и материалы»'))],
      ['Назначение', r.purpose], ['Монтаж', r.installation], ['Описание', r.description],
      grp('Дополнительно'),
      ['Название в договоре', r.orderName || r.name], ['Название серии', r.series],
      ['Цвета', (r.colors || []).join(', ')], ['Размеры', (r.sizes || []).join(', ')],
      ['Кто проектировал', r.designer ? `${r.designer.name}${r.designer.position ? ' · ' + r.designer.position : ''}` : h('span', { class: 'muted' }, 'не указан — к кому идти, если в паспорте не хватает данных')],
      ['Примечание', r.notes && !r.notes.startsWith('⚠') ? r.notes : null],
    ],
    // главное → связанное → редкое в «⋯» (ПРД.4)
    actions: (r) => [{ label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`В КП — всего ${kpCount()}`); } },
      ...(session.canEdit ? [{ label: 'Изменить состав', run: (row) => { setCompositionTarget(row); patch({ of: 'composition', new: '1', open: undefined }); } }] : []),
      { label: 'Заказы с этим изделием', run: (row) => go('salesorders', { productId: row.id }) },
      ...(session.seesDocs() && r.passports?.items?.[0] ? [{ label: 'Печать паспорта', title: 'Последний выпущенный паспорт этого изделия: PDF и печать', run: async (row) => {
        printDialog(await api(`/passports/${row.passports.items[0].id}`));
      } }] : []),
      // УПР-1/Д11: «Выпустить паспорт» убрана — единственный вход в passports.js (панель паспорта)
      { label: 'Техническое описание', title: 'PDF для заказчика: фото, части, материалы и допуски', run: (row) => openTechSheet(row) },
      ...(session.seesDocs() ? [{ label: 'Паспорт →', title: 'Список паспортов этого изделия', run: (row) => { go('docs', { tab: 'archive', q: row.name }); } }] : []),
      // ПРЖ-4: артикул по номеру группы (сервер: assign-sku; без confirm — только проверка и число паспортов)
      ...(session.canEdit ? [{ label: 'Присвоить артикул группы', more: true, title: 'Новый артикул по номеру группы изделия (например 34 → 3411)', run: async (row, ctx) => {
        const chk = await api(`/showcase/${row.id}/assign-sku`, { method: 'POST', body: {} });
        if (!chk.confirmRequired) { toast(chk.changed ? `Артикул: ${chk.sku}` : `Артикул ${chk.sku} уже по номеру группы`); return; }
        if (!(await confirmDlg('Присвоить новый артикул?', `Сейчас: ${chk.sku || 'нет'}. ${chk.warning || ''}`, { okText: 'Присвоить' }))) return;
        const res = await api(`/showcase/${row.id}/assign-sku`, { method: 'POST', body: { confirm: true } });
        toast(`Новый артикул: ${res.sku}`); ctx.changed(); ctx.reload();
      } }] : []),
      // копия изделия целиком (поля, фото, настройки паспорта) — быстрый способ сделать похожее; откроется копия
      ...(session.canEdit ? [{ label: 'Клонировать', more: true, title: 'Копия со всеми полями, фото и настройками паспорта — потом поправьте название, размеры и артикул', run: async (row, ctx) => {
        const c = await api(`/showcase/${row.id}/clone`, { method: 'POST' });
        ctx.changed();
        toast('Копия создана — проверьте название, размеры и артикул', { ms: 8000 });
        patch({ open: c.id, of: undefined, new: undefined });
      } }] : []),
    ],
  },

  form: {
    // ФИ: раздел, группа, серия, цвета, размеры — списки из того, что уже есть (одно написание); своё вписать можно
    fields: async (r) => {
      const [fv, md] = await Promise.all([formValues(), loadMaterialDicts()]);
      // ПП: «Кто проектировал» — из «Сотрудников», выбор с поиском; пусто — можно
      const staff = await api('/dicts/persons').then((x) => (x.items || []).map((p) => ({ value: p.id, label: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '', fired: p.status === 'fired' }))).catch(() => []);
      const people = staff.filter((p) => !p.fired); // в выборе — работающие; уже указанный уволенный остаётся (сопоставление — по всем)
      designerIds = new Map(staff.map((p) => [p.label, p.value]));
      const opt = (x) => ({ value: x.value, label: x.value, sub: x.n ? `${qty(x.n)} изд.` : '' });
      const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      // группы выбранного раздела — сверху, остальные — «Все» (с разделом в подписи); одно название — один раз
      const groups = (get) => {
        const sec = get('type').trim(); const seen = new Set();
        const mine = sec ? fv.groups.filter((g) => same(g.section, sec)).map((g) => ({ ...opt(g), group: `Раздел «${sec}»` })) : [];
        mine.forEach((g) => seen.add(g.value.toLowerCase()));
        const rest = fv.groups.filter((g) => !seen.has(g.value.toLowerCase()) && (seen.add(g.value.toLowerCase()), true))
          .map((g) => ({ ...opt(g), sub: [opt(g).sub, g.section].filter(Boolean).join(' · '), group: mine.length ? 'Все' : undefined }));
        return [...mine, ...rest];
      };
      // дубль артикула — по тому же правилу, что на сервере (регистр, KC-01 = КС-01), и в корзине тоже
      const skuTaken = async (v) => {
        const q = `search=${encodeURIComponent(v)}&limit=20`;
        const [live, trash] = await Promise.all([api(`/showcase?${q}`), api(`/showcase?${q}&deleted=1`).catch(() => ({ items: [] }))]);
        const hit = (x) => skuKey(x.sku) === skuKey(v) && x.id !== r?.id;
        const a = (live.items || []).find(hit); const b = (trash.items || []).find(hit);
        if (a) return `Такой артикул уже есть: «${a.name}» (арт. ${a.sku}) — сохранить с ним не получится`;
        if (b) return `Такой артикул у изделия в корзине: «${b.name}» — восстановите его вместо нового`;
        return null;
      };
      // «Паспорт»: категория и выбор текстов воронки — паспорт возьмёт их из изделия сам
      const pdCats = (await api('/dicts/passportCategories').then((x) => x.items || []).catch(() => [])).filter((c) => c.code && c.code !== 'ALL').map((c) => ({ value: String(c.code), label: c.name }));
      const pd0 = r?.passportDefaults || {}; let pdFunnel = null;
      const [els, inst] = await Promise.all([dictOpts('passportElements'), dictOpts('passportInstall')]);
      const pc = r?.passportCategory;
      const catHint = pc?.own ? 'Задана в самом изделии. Паспорт берёт категорию отсюда' : pc?.inherited || pc?.code ? 'Сейчас — по группе или разделу. Укажите свою, если нужна другая. Паспорт берёт категорию отсюда' : 'Обычно определяется по разделу и группе; укажите, если нужна другая. Паспорт берёт категорию отсюда';
      // ИЗ-4: Изделие → Цена → Паспорт → Характеристики → Описание и материалы → Дополнительно
      return [
      { section: 'Изделие', tone: 'main', fixed: true },
      { key: 'photos', label: 'Фото изделия', type: 'photos', main: true, hint: 'Первое фото — главное: оно на обложке в списках. Чтобы выбрать другое, нажмите ☆ на нужном фото.' },
      { key: 'name', label: 'Короткое название', required: true, max: 256, span: 3, hint: 'Для списков, фильтров, поиска и паспорта' },
      { key: 'type', label: 'Тип оборудования', type: 'combo', required: true, max: 100, options: fv.sections.map(opt), hint: 'Из списка или своё; серым — сколько изделий и категория паспорта' },
      { key: 'group', label: 'Группа изделий', type: 'combo', max: 100, options: groups, hint: 'Сверху — группы выбранного типа' },
      { key: 'sku', label: 'Артикул', max: 64, span: 1, warn: skuTaken, hint: 'Оставьте пустым — будет присвоен автоматически по номеру группы' },
      { key: 'status', label: 'Статус', type: 'segment', options: [{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'В продаже', tone: 'ok' }, { value: 'archived', label: 'Архив' }],
        hint: 'С ценой черновик сам становится «в продаже»' },
      { section: 'Цена', tone: 'money' },
      { key: 'price', label: 'Цена, ₽', type: 'money', min: 0, hint: 'Без цены изделие — черновик' },
      ...(session.canMoney ? [{ key: '_cost', type: 'widget', label: 'Себестоимость материалов', wide: true, widget: () => costInfo(r), summary: () => '' }] : []),
      { section: 'Паспорт', tone: 'info', collapsed: !Object.keys(pd0).length },
      { key: 'pdCategory', label: 'Категория паспорта', type: 'select', options: pdCats, hint: catHint,
        mount: (api) => api.on('pdCategory', () => pdFunnel?.setCategory(api.get('pdCategory'))) },
      { key: 'pdChoices', label: 'Тексты паспорта — выбор (монтаж, назначение…)', type: 'widget', wide: true, summary: () => '',
        widget: (v) => (pdFunnel = funnelBox({ value: v, category: pd0.passportCategory || r?.passportCategory?.code || '', canEditText: canEditPassportTexts() })) },
      { key: 'pdWarranty', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
      { key: 'pdLife', label: 'Срок службы, лет', type: 'number', min: 0, span: 1 },
      { key: 'pdInstall', label: 'Способ установки', type: 'select', options: [{ value: '', label: '—' }, ...inst.map((o) => ({ value: o.value, label: o.label }))], hint: 'Определяет схему монтажа в паспорте' },
      { key: 'pdElements', label: 'Функциональные элементы', type: 'widget', wide: true, summary: () => '', widget: (v) => tagPick({ options: els, value: v, label: 'Функциональные элементы' }) },
      { key: 'pdKit', label: 'Поставляется разобранным', type: 'segment', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — нужна схема сборки' }] },
      { section: 'Характеристики', tone: 'info' },
      { key: 'dimL', label: 'Длина', type: 'number', min: 0, span: 1 },
      { key: 'dimW', label: 'Ширина', type: 'number', min: 0, span: 1 },
      { key: 'dimH', label: 'Высота', type: 'number', min: 0, span: 1 },
      { key: 'dimUnit', label: 'Ед. изм. габаритов', type: 'combo', max: 10, span: 1, options: ['мм', 'см', 'м'] },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
      { key: 'unit', label: 'Ед. изм.', type: 'combo', max: 20, span: 1, options: (fv.units || []).map(opt) },
      { key: 'ralCode', label: 'RAL', type: 'combo', max: 100, options: (fv.ral || []).map(opt), load: dictNames('colors'), hint: 'Основной цвет покрытия: RAL 6005' },
      { section: 'Описание и материалы', tone: 'info', collapsed: !(r?.purpose || r?.installation || r?.materialsSpec || r?.description) },
      // МИ.2: материалы таблицей — текст «Изготовлено из…» собирается сам (сервер), паспорт берёт его из изделия
      { key: 'materialsSpec', label: 'Материалы изделия', type: 'widget', wide: true, summary: specSummary,
        widget: (v) => materialsSpec({ value: v, dicts: md, text: r?.materialsText || '', scope: () => r?.passportCategory?.code || '', actions: r ? [fromComposition(r)] : [] }),
        hint: r ? 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — строки по материалам состава изделия' : 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — после «Создать», когда заполнен состав' },
      { key: 'purpose', label: 'Назначение', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('purpose'), by: 'group', title: 'Варианты' } },
      { key: 'installation', label: 'Монтаж', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('installationMethod'), by: 'group', title: 'Варианты' } },
      { key: 'description', label: 'Описание', type: 'textarea', wide: true, hint: r ? '' : 'Состав — в карточке сразу после «Создать»' },
      { section: 'Дополнительно', tone: 'info', collapsed: !(r?.orderName || r?.series || r?.colors?.length || r?.sizes?.length || r?.designer || r?.notes) },
      { key: 'orderName', label: 'Название в договоре', max: 500, span: 3, hint: 'Как изделие называется в договорах заказчика — по нему система предлагает сопоставление. Пусто — берётся короткое' },
      { key: 'series', label: 'Название серии', type: 'combo', max: 100, options: fv.series.map(opt), strict: true, strictText: 'Выберите серию из справочника', extra: () => [{ label: 'Открыть справочник серий', run: () => go('dicts', { d: 'productSeries' }) }], hint: 'Нет нужной — добавьте в справочнике' },
      { key: 'colors', label: 'Цвета (варианты)', type: 'combo', multi: true, max: 500, options: fv.colors.map(opt), load: dictNames('colors'), hint: 'Выберите несколько или впишите через запятую' },
      { key: 'sizes', label: 'Размеры (варианты)', type: 'combo', multi: true, max: 500, options: fv.sizes.map(opt), hint: 'Выберите несколько или впишите через запятую: 3×2 м, 4×2 м' },
      { key: 'designerName', label: 'Кто проектировал', type: 'combo', options: people, strict: true, strictText: 'Выберите сотрудника из списка или оставьте пустым', hint: 'К кому идти, если в паспорте не хватает данных. В паспорт не входит' },
      { key: 'notes', label: 'Примечание', type: 'textarea', wide: true, rows: 2, max: 2000 },
      ];
    },
    initial: () => ({ status: 'draft', unit: 'шт', dimUnit: 'мм', ...(pending()?.initial || {}) }),
    toInitial: (r) => ({ ...r, pdCategory: r.passportDefaults?.passportCategory || r.passportCategory?.code || '', pdChoices: JSON.stringify(r.passportDefaults?.textChoices || {}), pdWarranty: r.passportDefaults?.warrantyMonths ?? '', pdLife: r.passportDefaults?.serviceLifeYears ?? '', pdInstall: r.passportDefaults?.installationTypeId ? String(r.passportDefaults.installationTypeId) : '', pdKit: r.passportDefaults?.isKit ? 'yes' : 'no', pdElements: (r.passportDefaults?.elements || []).map(String), designerName: r.designer?.name || '', colors: (r.colors || []).join(', '), sizes: (r.sizes || []).join(', '),
      status: ['draft', 'active', 'archived'].includes(r.status) ? r.status : r.price ? 'active' : 'draft',
      dimL: r.dimensions?.length ?? '', dimW: r.dimensions?.width ?? '', dimH: r.dimensions?.height ?? '', dimUnit: r.dimensions?.unit || 'мм', weightKg: r.weightKg ?? '' }),
    toBody: (v, r) => ({ ...specBody(v, r), photoIds: v.photos || [], sku: v.sku, name: v.name, orderName: v.orderName || '', type: v.type || '', group: v.group || '', series: v.series || '', price: v.price ?? null, colors: v.colors || '', sizes: v.sizes || '', description: v.description || '', notes: v.notes || '',
      designerId: v.designerName ? designerIds.get(String(v.designerName).trim()) || null : '',
      status: v.status || 'draft', unit: v.unit || 'шт', ralCode: v.ralCode || '', weightKg: v.weightKg ?? null, purpose: v.purpose || '', installation: v.installation || '',
      dimensions: { length: v.dimL ?? null, width: v.dimW ?? null, height: v.dimH ?? null, unit: v.dimUnit || 'мм' },
      _pd: { over: { warrantyMonths: v.pdWarranty ?? null, serviceLifeYears: v.pdLife ?? null, installationTypeId: v.pdInstall || '', elements: Array.isArray(v.pdElements) ? v.pdElements : [], isKit: v.pdKit === 'yes' }, category: v.pdCategory || '', choices: v.pdChoices && typeof v.pdChoices === 'object' ? v.pdChoices : {}, derived: r?.passportCategory?.code || '', prev: r?.passportDefaults || {} } }),
    create: async (b0) => {
      const { _pd, ...b } = b0;
      const res = await api('/showcase', { method: 'POST', body: b });
      if (_pd.category || Object.keys(_pd.choices).length || Object.values(_pd.over).some((x) => x && !(Array.isArray(x) && !x.length))) await savePd(res.id, { ..._pd, prev: {} });
      const p = pending(); pendingCreate = null;
      if (p) setTimeout(() => p.then(res), 50); // вернуться в паспорт, из которого создавали
      return res;
    },
    update: async (id, b0) => {
      const { _pd, ...b } = b0;
      const res = await api(`/showcase/${id}`, { method: 'PATCH', body: b });
      await savePd(id, _pd);
      return res;
    },
  },

  remove: {
    text: (r) => `Удалить изделие «${r.name}»?`,
    run: (r) => api(`/showcase/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/showcase/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: r.name, sub: [r.sku && `арт. ${r.sku}`, r.group].filter(Boolean).join(' · '), side: r.price ? money(r.price) : '' }),
  open: (id) => go('products', { open: id }),
  canEdit: () => session.canEdit,
};
