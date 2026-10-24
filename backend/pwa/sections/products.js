import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { toast } from '../ui/toast.js';
import { skuKey } from '../core/facets.js';
import { pic } from './stock.js';
import { kpAdd, kpCount } from './kp.js';
import { setCompositionTarget } from './composition.js';
import { suggestLink } from '../ui/composition-suggest.js';
import { issuePassport, passports } from './passports.js';
import { openBulk } from './bulk-edit.js';
import { dictNames } from '../ui/dict-options.js';
import { loadMaterialDicts, materialsSpec, specSummary } from '../ui/materials-spec.js';
import { confirmDlg } from '../ui/dialog.js';

/*
 * «Продукция» (TASKS БЗ-4) — витрина изделий компании: разделы плитками, поиск, фото; карточка — правка (артикул,
 * наименование, раздел → группа, серия, цена, описание, фото); «В КП» в строке — собрать коммерческое предложение;
 * «⇩ Загрузить каталог» — Excel / вставка (колонки как в «Перечне изделий»: Тип · Группа · Артикул · Наименование · Серия · Цена).
 * Сервер — /api/showcase (поверх общей коллекции CRM products).
 */
const thumb = (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + (r.photo.thumb || r.photo.url), alt: '', loading: 'lazy' }) : null);
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
    w.set({ rows, coatingIds: [...new Set([...(JSON.parse(w.value || 'null')?.coatingIds || []), ...(res.materialsSpec.coatingIds || [])])] });
    toast(res.unmatched?.length ? `Строк: ${rows.length}. Не нашлись в справочнике: ${res.unmatched.join(', ')} — добавьте вручную` : `Строк из состава: ${rows.length} — проверьте и сохраните`, { ms: res.unmatched?.length ? 9000 : undefined });
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
    { key: 'type', label: 'Раздел', type: 'combo', options: fv.sections.map((x) => x.value), hint: 'Группа у каждого изделия останется своя' },
    { key: 'group', label: 'Группа', type: 'combo', options: fv.groups.map((g) => ({ value: g.value, label: g.value, sub: g.section })), hint: 'Раздел у каждого изделия останется свой' },
    { key: 'series', label: 'Серия', type: 'combo', options: fv.series.map((x) => x.value) },
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
const STATUS = { draft: 'черновик · нет цены', active: 'в продаже', new: 'новое', archived: 'архив' };

// «Состав» (БЗ-5): материалы склада, из которых сделано изделие; правка — в правой панели.
// Себестоимость материалов (тем, кто видит деньги): цена — последняя закупка, иначе справочник материалов
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
  if (!p?.total) return h('p', { class: 'muted' }, 'Паспортов пока нет — «Выпустить паспорт» в действиях карточки');
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

export const products = {
  id: 'products',
  title: 'Продукция',
  newTitle: 'Новое изделие',
  entityType: 'Product',
  get: (id) => api(`/showcase/${id}`),

  list: {
    path: '/showcase',
    sortDefault: 'name',
    createLabel: 'Изделие',
    // БЗ-9: отметить изделия → «Изменить выбранные» (артикул, наименование, фото, состав — по одному)
    bulk: { open: (ids, { done }) => openBulk({ ids, done, fields: productBulkFields,
      // «pd.*» — значения паспорта по умолчанию: собираем в один объект (сервер дополняет, не заменяет)
      apply: (set, arrays) => {
        const pd = Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('pd.')).map(([k, v]) => [k.slice(3), v]));
        const rest = Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('pd.')));
        return api('/showcase/bulk', { method: 'POST', body: { ids, set: { ...rest, ...(Object.keys(pd).length ? { passportDefaults: pd } : {}) }, arrays } });
      },
      restore: (before) => api('/showcase/bulk/restore', { method: 'POST', body: { items: before } }) }) }, // права — canEditSection в списке
    searchPlaceholder: 'Поиск: наименование, артикул, серия…',
    emptyText: 'Изделий пока нет. «⇩ Загрузить каталог» — Excel с колонками Тип, Группа, Артикул, Наименование, Серия, Цена.',
    filters: [{ key: 'groupId', label: 'Раздел', type: 'hidden' }],
    // ФИ2: основной вид — карточки с фото по разделам и группам, как «Паспорта»; «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 100, sort: 'category', lastGroup: 'Без раздела',
      groupBy: (r) => [r.type, r.group].filter(Boolean).join(' › ') || 'Без раздела',
      card: (r) => ({
        pic: r.photo ? PREFIX + (r.photo.thumb || r.photo.url) : null,
        title: r.name,
        meta: [r.sku && `арт. ${r.sku}`, r.series, r.price ? money(r.price) : ''].filter(Boolean).join(' · '),
        badge: r.status === 'archived' ? h('span', { class: 'badge dim gc-badge' }, 'архив') : !r.price ? h('span', { class: 'badge warn gc-badge', title: 'Нет цены — изделие в черновиках' }, 'черновик') : null,
      }),
    },
    tiles: {
      key: 'groupId',
      // разделы — первыми, затем их группы (подпись — раздел), как категории у «Паспортов»
      load: async () => {
        const all = await api('/showcase/groups'); const name = new Map(all.map((g) => [g.id, g.name]));
        return [...all.filter((g) => !g.parentId), ...all.filter((g) => g.parentId)]
          .map((g) => ({ value: g.id, label: g.name, n: g.count, sub: g.parentId ? name.get(g.parentId) || 'группа' : 'раздел' }));
      },
    },
    headActions: () => [
      h('button', { class: 'btn', type: 'button', title: 'Excel или вставка из таблицы', onclick: () => patch({ of: 'catalogimport', new: '1', open: undefined }) }, '⇩ Загрузить каталог'),
      session.canEdit ? h('button', { class: 'btn', type: 'button', title: 'Создать изделия из позиций заказов', onclick: () => patch({ of: 'fromorders', new: '1', open: undefined }) }, 'Из заказов') : null,
      session.canEdit ? h('button', { class: 'btn', type: 'button', title: 'Изделия из паспортов — похожие объединить без дублей', onclick: () => patch({ of: 'frompassports', new: '1', open: undefined }) }, 'Из паспортов') : null,
      h('button', { class: 'btn kp-open', type: 'button', title: 'Собранное коммерческое предложение', onclick: () => patch({ of: 'kp', new: '1', open: undefined }) }, `КП (${kpCount()})`),
    ],
    hints: { '': 'Изделия компании. «В КП» в строке — добавить в коммерческое предложение; кнопка «КП» сверху — открыть и напечатать.' },
    rowAction: (r) => ({ label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`«${row.name}» в КП — всего ${kpCount()}`); document.querySelectorAll('.kp-open').forEach((b) => { b.textContent = `КП (${kpCount()})`; }); return false; } }),
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', export: false, render: (r) => pic(r.photo) },
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => r.sku },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
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
    // SK-8d: «В заказах» и «Паспорта» — только если эти разделы открыты роли
    extra: (r) => h('div', null, compositionBlock(r), session.sees('salesorders') ? inOrders(r) : null, session.sees('passports') ? passportsBlock(r) : null),
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: [...(r.photos || []).map((p) => p.id), photoId] } }),
    photoRemove: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: (r.photos || []).map((p) => p.id).filter((x) => x !== photoId) } }),
    view: (r) => [
      ['Артикул', r.sku], ['Раздел', r.type], ['Группа', r.group], ['Серия', r.series],
      // ФИ2: связь с категорией паспорта — по «Категориям каталога»; нет — подсказка, куда добавить название
      ['Категория паспорта', r.passportCategory ? `${r.passportCategory.code} · ${r.passportCategory.name} (${r.passportCategory.via})`
        : (r.type || r.group) ? h('span', { class: 'muted' }, 'не найдена — добавьте название раздела или группы в «Справочники → Паспорта → Категории паспорта → Категории каталога»') : null],
      ['Статус', STATUS[r.status] || r.status],
      ['Кто проектировал', r.designer ? `${r.designer.name}${r.designer.position ? ' · ' + r.designer.position : ''}` : h('span', { class: 'muted' }, 'не указан — к кому идти, если в паспорте не хватает данных')],
      ['Цена', r.price ? money(r.price) : h('span', { class: 'muted' }, 'не указана — изделие в черновиках')],
      ...(session.canMoney && r.cost?.total ? [['Себестоимость материалов', `≈ ${money(r.cost.total)}${r.price ? ` · наценка ${Math.round((r.price / r.cost.total - 1) * 100)}%` : ''}`]] : []),
      ['Габариты', dims(r.dimensions)], ['Вес', r.weightKg ? `${qty(r.weightKg)} кг` : null], ['Ед. изм.', r.unit], ['RAL', r.ralCode],
      ['Цвета', (r.colors || []).join(', ')], ['Размеры', (r.sizes || []).join(', ')],
      ['Назначение', r.purpose], ['Монтаж', r.installation],
      ['Материалы', r.materialsText || (r.materialsSpec ? null : h('span', { class: 'muted' }, 'таблица не заполнена — «Изменить» → «Для паспорта»'))],
      ['Описание', r.description],
    ],
    actions: (r) => [...(session.canEdit ? [{ label: 'Изменить состав', run: (row) => { setCompositionTarget(row); patch({ of: 'composition', new: '1', open: undefined }); } }] : []),
      ...(session.sees('passports') && passports.canEdit() ? [{ label: 'Выпустить паспорт', run: async (row) => {
        if (!(await issuePassport({ productId: row.id, name: row.name, article: row.sku }))) toast('Паспортов этой модели ещё не было — заполните габариты, описание и картинки');
      } }] : []),
      { label: 'В коммерческое предложение', run: (row) => { kpAdd(row); toast(`В КП — всего ${kpCount()}`); } },
      { label: 'Заказы с этим изделием', run: (row) => go('salesorders', { q: row.name }) }],
  },

  form: {
    // ФИ: раздел, группа, серия, цвета, размеры — списки из того, что уже есть (одно написание); своё вписать можно
    fields: async (r) => {
      const [fv, md] = await Promise.all([formValues(), loadMaterialDicts()]);
      // ПП: «Кто проектировал» — из «Сотрудников», выбор с поиском; пусто — можно
      const staff = await api('/dicts/persons').then((x) => (x.items || []).map((p) => ({ value: p.id, label: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '', fired: p.status === 'fired' }))).catch(() => []);
      const people = staff.filter((p) => !p.fired); // в выборе — работающие; уже указанный уволенный остаётся (сопоставление — по всем)
      designerIds = new Map(staff.map((p) => [p.label, p.value]));
      const opt = (x) => ({ value: x.value, label: x.value, sub: [x.n ? `${qty(x.n)} изд.` : '', x.sub].filter(Boolean).join(' · ') });
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
      return [
      { section: 'Изделие', tone: 'main', fixed: true },
      { key: 'sku', label: 'Артикул', required: true, max: 64, span: 1, warn: skuTaken },
      { key: 'name', label: 'Наименование', required: true, max: 256, span: 3 },
      { key: 'type', label: 'Раздел', type: 'combo', required: true, max: 100, options: fv.sections.map(opt), hint: 'Из списка или своё; серым — сколько изделий и категория паспорта' },
      { key: 'group', label: 'Группа', type: 'combo', max: 100, options: groups, hint: 'Сверху — группы выбранного раздела' },
      { key: 'series', label: 'Серия', type: 'combo', max: 100, options: fv.series.map(opt) },
      { key: 'status', label: 'Статус', type: 'segment', options: [{ value: 'draft', label: 'Черновик' }, { value: 'active', label: 'В продаже', tone: 'ok' }, { value: 'archived', label: 'Архив' }],
        hint: 'С ценой черновик сам становится «в продаже»' },
      { key: 'description', label: 'Описание', type: 'textarea', wide: true, hint: r ? '' : 'Фото и состав — в карточке сразу после «Создать»' },
      { key: 'designerName', label: 'Кто проектировал', type: 'combo', options: people, strict: true, strictText: 'Выберите сотрудника из списка или оставьте пустым', hint: 'К кому идти, если в паспорте не хватает данных. В паспорт не входит' },
      { section: 'Характеристики', tone: 'info' },
      { key: 'dimL', label: 'Длина', type: 'number', min: 0, span: 1 },
      { key: 'dimW', label: 'Ширина', type: 'number', min: 0, span: 1 },
      { key: 'dimH', label: 'Высота', type: 'number', min: 0, span: 1 },
      { key: 'dimUnit', label: 'Ед. габаритов', type: 'combo', max: 10, span: 1, options: ['мм', 'см', 'м'] },
      { key: 'weightKg', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
      { key: 'unit', label: 'Ед. изм.', type: 'combo', max: 20, span: 1, options: (fv.units || []).map(opt) },
      { key: 'ralCode', label: 'RAL', type: 'combo', max: 100, options: (fv.ral || []).map(opt), load: dictNames('colors'), hint: 'Основной цвет покрытия: RAL 6005' },
      { key: 'colors', label: 'Цвета (варианты)', type: 'combo', multi: true, max: 500, options: fv.colors.map(opt), load: dictNames('colors'), hint: 'Выберите несколько или впишите через запятую' },
      { key: 'sizes', label: 'Размеры (варианты)', type: 'combo', multi: true, max: 500, options: fv.sizes.map(opt), hint: 'Выберите несколько или впишите через запятую: 3×2 м, 4×2 м' },
      { section: 'Цена и себестоимость', tone: 'money' },
      { key: 'price', label: 'Цена, ₽', type: 'money', min: 0, hint: 'Без цены изделие — черновик' },
      ...(session.canMoney ? [{ key: '_cost', type: 'widget', label: 'Себестоимость материалов', wide: true, widget: () => costInfo(r), summary: () => '' }] : []),
      { section: 'Для паспорта', tone: 'info', collapsed: !(r?.purpose || r?.installation || r?.materialsSpec) },
      // МИ.2: материалы таблицей — текст «Изготовлено из…» собирается сам (сервер), паспорт берёт его из изделия
      { key: 'materialsSpec', label: 'Материалы изделия', type: 'widget', wide: true, summary: specSummary,
        widget: (v) => materialsSpec({ value: v, dicts: md, text: r?.materialsText || '', scope: () => r?.passportCategory?.code || '', actions: r ? [fromComposition(r)] : [] }),
        hint: r ? 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — строки по материалам состава изделия' : 'Материал — из справочника; размеры и части — выбрать или вписать (Enter). «Взять из состава» — после «Создать», когда заполнен состав' },
      { key: 'purpose', label: 'Назначение', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('purpose'), by: 'group', title: 'Варианты' } },
      { key: 'installation', label: 'Монтаж', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('installationMethod'), by: 'group', title: 'Варианты' } },
      ];
    },
    initial: () => ({ status: 'draft', unit: 'шт', dimUnit: 'мм', ...(pending()?.initial || {}) }),
    toInitial: (r) => ({ ...r, designerName: r.designer?.name || '', colors: (r.colors || []).join(', '), sizes: (r.sizes || []).join(', '),
      status: ['draft', 'active', 'archived'].includes(r.status) ? r.status : r.price ? 'active' : 'draft',
      dimL: r.dimensions?.length ?? '', dimW: r.dimensions?.width ?? '', dimH: r.dimensions?.height ?? '', dimUnit: r.dimensions?.unit || 'мм', weightKg: r.weightKg ?? '' }),
    toBody: (v, r) => ({ ...specBody(v, r), sku: v.sku, name: v.name, type: v.type || '', group: v.group || '', series: v.series || '', price: v.price ?? null, colors: v.colors || '', sizes: v.sizes || '', description: v.description || '',
      designerId: v.designerName ? designerIds.get(String(v.designerName).trim()) || null : '',
      status: v.status || 'draft', unit: v.unit || 'шт', ralCode: v.ralCode || '', weightKg: v.weightKg ?? null, purpose: v.purpose || '', installation: v.installation || '',
      dimensions: { length: v.dimL ?? null, width: v.dimW ?? null, height: v.dimH ?? null, unit: v.dimUnit || 'мм' } }),
    create: async (b) => {
      const res = await api('/showcase', { method: 'POST', body: b });
      const p = pending(); pendingCreate = null;
      if (p) setTimeout(() => p.then(res), 50); // вернуться в паспорт, из которого создавали
      return res;
    },
    update: (id, b) => api(`/showcase/${id}`, { method: 'PATCH', body: b }),
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
