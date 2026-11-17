import { PREFIX, session } from '../core/api.js';
import { sku as kitSku, button as kitButton, toast, confirmDlg } from '../ui/kit/index.js';
import { h } from '../core/dom.js';
import { money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { pic } from './stock.js';
import { kpAdd, kpCount } from './kp.js';
import { setCompositionTarget } from './composition.js';
// УПР-1/Д11: issuePassport и passports.canEdit() убраны — вход только через панель паспорта
import { printDialog, downloadCombined } from './passports/dialogs.js';
import { openTechSheet } from './tech-sheet.js';
import { toastError } from '../ui/kit/toast.js';
import { openBulk } from './bulk-edit.js';
import { qrBulkAction, qrPrintAction } from './qr.js';
import * as data from './products/data.js';
import { productForm, productBulkFields } from './products/form-fields.js';
import { prodFunnel, catLanding, deepGroup } from './products/landing.js';
import { STATUS, dims, openPassportTemplate } from './products/card-blocks.js';
import { openPassportFunnel, openReadyPassport } from './passports/funnel/open.js';
import { productTabs, productWarns } from './products/tabs.js';
import { screenCard } from '../ui/kit/screens/card.js';

/*
 * «Продукция» (TASKS БЗ-4) — витрина изделий компании: разделы плитками, поиск, фото; карточка — правка (артикул,
 * наименование, раздел → группа, серия, цена, описание, фото); «В КП» в строке — собрать коммерческое предложение;
 * «⇩ Загрузить каталог» — Excel / вставка (колонки как в «Перечне изделий»: Тип · Группа · Артикул · Наименование · Серия · Цена).
 * Сервер — /api/showcase (поверх общей коллекции CRM products).
 * Здесь только сборка: запросы — products/data.js, форма — products/form-fields.js, первая страница — products/landing.js,
 * блоки карточки — products/card-blocks.js.
 */
export { PD_KEYS, savePd, createProductFor } from './products/data.js';

const thumb = (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + (r.photo.thumb || r.photo.url), alt: '', loading: 'lazy', decoding: 'async' }) : null);
const refreshKpButtons = () => document.querySelectorAll('.kp-open').forEach((b) => { b.textContent = `КП (${kpCount()})`; });

export const products = {
  id: 'products',
  kind: 'Изделие',
  title: 'Продукция',
  newTitle: 'Новое изделие',
  entityType: 'Product',
  get: data.getProduct,

  list: {
    path: '/showcase',
    export: 'admin',
    sortDefault: 'withPhoto',
    viewKey: 'products',
    createLabel: 'Изделие',
    // БЗ-9: отметить изделия → «Изменить выбранные» (артикул, наименование, фото, состав — по одному)
    bulk: { extra: [qrBulkAction('P')], open: (ids, { done }) => openBulk({ ids, done, fields: productBulkFields,
      // «pd.*» — значения паспорта по умолчанию: собираем в один объект (сервер дополняет, не заменяет)
      apply: (set, arrays) => {
        const pd = Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('pd.')).map(([k, v]) => [k.slice(3), v]));
        const rest = Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('pd.')));
        return data.bulkApply(ids, { ...rest, ...(Object.keys(pd).length ? { passportDefaults: pd } : {}) }, arrays);
      },
      restore: data.bulkRestore }),
      extra: [{ label: 'В КП', run: (_ids, rows) => { rows.forEach(kpAdd); toast(`В КП: ${rows.length} изд. — всего ${kpCount()}`); refreshKpButtons(); } }] }, // права — canEditSection в списке
    searchPlaceholder: 'Поиск: наименование, артикул, серия…',
    emptyText: 'Изделий пока нет.', emptyHint: 'Нажмите «⇩ Загрузить каталог»: Excel с колонками Тип, Группа, Артикул, Наименование, Серия, Цена.',
    // левая панель (NAV F3): поиск → «Раздел → Группа» → «Серия» → «Состояние»; цену и габариты не фильтруем
    sidebar: true,
    chipsTop: true, // «Состояние» — строкой над списком, слева — только «что ищем»
    extraKeys: ['sec', 'grp', 'sub'],
    toolbarExtra: prodFunnel,
    filters: [
      { key: 'series', label: 'Серия', type: 'hidden' }, // ПРД.6: последний шаг воронки слева (toolbarExtra)
      { key: 'status', label: 'Статус', type: 'chips', allLabel: 'Все', options: () => data.statusChips() },
    ],
    limit: 100, // таблица: по умолчанию 100 строк, меньше — выбор внизу
    // серия — точное совпадение на сервере (query series)
    query: (P) => ({ ...(P.series ? { series: P.series } : {}), ...(deepGroup(P) ? { groupId: deepGroup(P) } : {}) }),
    // ФИ2: основной вид — карточки с фото по разделам и группам, как «Паспорта»; «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 100, sort: 'category', lastGroup: 'Без типа',
      groupBy: (r) => [r.type, r.group].filter(Boolean).join(' › ') || 'Без типа',
      card: (r) => ({
        pic: r.photo ? PREFIX + (r.photo.thumb || r.photo.url) : null,
        title: r.name,
        meta: h('span', null, kitSku(r.sku), r.sku && r.series ? ' · ' : null, r.series),
        price: r.price ? money(r.price) : null,
        badge: r.status === 'archived' ? h('span', { class: 'badge dim gc-badge' }, 'архив') : !r.price ? h('span', { class: 'badge warn gc-badge', title: 'Цена не указана — изделие ещё не в продаже' }, 'без цены') : null,
      }),
    },
    landing: { when: (P) => !deepGroup(P) && !P.groupId && !P.q && !P.series && !P.status && !P.all, render: catLanding },
    // П2/Д12: в шапке «КП» и главная «+ Изделие»; весь импорт — одним пунктом в «Ещё ▾»
    headActions: () => {
      const b = kitButton({ label: `КП (${kpCount()})`, title: 'Собранное коммерческое предложение', onClick: () => patch({ of: 'kp', new: '1', open: undefined }) });
      b.classList.add('kp-open'); // по классу обновляется счётчик после «В КП»
      return [b];
    },
    moreActions: () => [{ title: 'Импорт', items: [
      { label: 'Загрузить каталог…', onSelect: () => patch({ of: 'catalogimport', new: '1', open: undefined }) },
      session.canEdit ? { label: 'Из заказов…', onSelect: () => patch({ of: 'fromorders', new: '1', open: undefined }) } : null,
      session.canEdit ? { label: 'Из паспортов…', onSelect: () => patch({ of: 'frompassports', new: '1', open: undefined }) } : null] }],
    hints: {},
    rowAction: () => ({ label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`«${row.name}» в КП — всего ${kpCount()}`); refreshKpButtons(); return false; } }),
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', export: false, render: (r) => { const p = pic(r.photo); p?.classList.add('pic-lg'); return p; } },
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => kitSku(r.sku) },
      { key: 'name', label: 'Название', sort: 'name', cls: 'name-2', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Раздел · Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'series', label: 'Серия', sort: 'series', cls: 'md-hide', render: (r) => r.series || '' },
      { key: 'price', money: true, label: 'Цена', sort: 'price', cls: 'num right', render: (r) => (r.price ? money(r.price) : h('span', { class: 'muted' }, 'нет цены')) },
    ],
    card: {
      thumb,
      title: (r) => r.name,
      sub: (r) => h('span', null, kitSku(r.sku), r.sku && (r.group || r.series) ? ' · ' : null, [r.group, r.series].filter(Boolean).join(' · ')),
      side: (r) => [h('b', { class: 'num' }, r.price ? money(r.price) : '—')],
    },
  },

  // C118 W5: шаблон «Карточка объекта» — шапка → пометка переноса → «Что дальше» (заполнение) → сведения → вкладки; все кнопки, кроме главной «Заполнить», — в «⋯»
  card: {
    ...screenCard({
      title: (r) => [kitSku(r.sku), r.sku ? ' ' : null, r.name],
      sub: (r) => STATUS[r.status] || r.status || '',
      warns: (r, ctx) => productWarns(r, ctx),
      facts: (r) => [
        ['Цена', r.price ? h('span', { class: 'kv-qty' }, money(r.price)) : h('span', { class: 'muted' }, 'не указана — изделие ещё не в продаже')],
        ['Себестоимость материалов', session.canMoney && r.cost?.total ? `≈ ${money(r.cost.total)}${r.price ? ` · наценка ${Math.round((r.price / r.cost.total - 1) * 100)}%` : ''}` : ''],
        ['Раздел · Группа', [r.type, r.group].filter(Boolean).join(' → ')],
        ['Габариты (Д×Ш×В)', dims(r.dimensions)],
        ['Вес', r.weightKg ? `${qty(r.weightKg)} кг` : null],
      ],
      more: (r) => [
        r.photoSource === 'passport' ? ['Обложка', h('span', null,
          h('span', { class: 'muted' }, 'фото из паспорта'),
          session.canEdit ? kitButton({ label: '← своей обложкой', size: 'S', title: 'Скопировать фото из паспорта в карточку изделия — станет «своим»',
            onClick: async () => { await data.setPhotoOrder(r, [r.photo.id]); patch({}); } }) : null)] : null,
        ['Ед. изм.', r.unit], ['RAL', r.ralCode], ['Цвета', (r.colors || []).join(', ')], ['Размеры', (r.sizes || []).join(', ')],
        ['Название в договоре', r.orderName && r.orderName !== r.name ? r.orderName : null], ['Название серии', r.series],
        ['Кто проектировал', r.designer ? `${r.designer.name}${r.designer.position ? ' · ' + r.designer.position : ''}` : h('span', { class: 'muted' }, 'не указан — к кому идти, если в паспорте не хватает данных')],
        ['Примечание', r.notes && !r.notes.startsWith('⚠') ? r.notes : null],
        ['Назначение', r.purpose], ['Монтаж', r.installation], ['Описание', r.description], // бывшая вкладка «Описание» (C119 шаг 3)
      ],
      menu: (r) => [...(session.canEdit ? [{ label: 'Изменить', title: 'Правка полей изделия', run: (row, ctx) => ctx.edit() }] : []),
      { label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`В КП — всего ${kpCount()}`); } },
      ...(session.canEdit ? [{ label: 'Изменить состав', run: (row) => { setCompositionTarget(row); patch({ of: 'composition', new: '1', open: undefined }); } }] : []),
      { label: 'Заказы с этим изделием', run: (row) => go('salesorders', { productId: row.id }) }, // ПМ-1: на виду ≤ 3 кнопок, связь — секция «В заказах»
      // C055: три печати на виду — паспорт, техническое описание, оба вместе
      // скачать = только выпущенный; черновик — в «Править шаблон» / «Предпросмотр», не сюда (урок: «Паспорт» скачивал черновик — шок)
      ...(session.seesDocs() ? [{ label: 'Скачать паспорт', title: 'PDF выпущенного паспорта. Если паспортов ещё нет — сначала «Выпустить паспорт»', run: async (row) => {
        const last = (row.passports?.items || []).find((x) => x.status === 'issued' || (x.passportNumber && !String(x.passportNumber).startsWith('draft-')))
          || (row.passports?.items || [])[0];
        if (last) { printDialog(await data.getPassport(last.id)); return; }
        toast('Паспортов ещё нет. Нажмите «Выпустить паспорт» — появится номер и PDF для скачивания.', { ms: 9000 });
      } }] : []),
      ...(session.canEdit && session.seesDocs() ? [
        { label: 'Выпустить паспорт', title: 'Новый паспорт с номером по этой модели', run: (row) => openPassportFunnel({ productId: row.id }) },
        { label: 'Загрузить готовый паспорт (PDF)', title: 'Паспорт сделан отдельно: приложить файл PDF к этому изделию', run: (row) => openReadyPassport({ productId: row.id }) }] : []),
      ...(session.seesDocs() ? [{ label: 'Править шаблон паспорта', title: 'Тексты и рисунки по разделам паспорта', run: (row, ctx) => openPassportTemplate(row, ctx) }] : []),
      { label: 'Техническое описание', title: 'Части и материалы из справочников, габариты и вес из изделия — в правой панели', run: (row) => openTechSheet(row) },
      ...(session.seesDocs() ? [{ label: 'Паспорт + техописание', title: 'Один PDF: паспорт, затем техническое описание', run: async (row) => {
        try { await downloadCombined(row, data.getPassport); } catch (e) { toastError(e); }
      } }] : []),
      // ПРЖ-4: артикул по номеру группы (сервер: assign-sku; без confirm — только проверка и число паспортов)
      ...(session.canEdit ? [{ label: 'Присвоить артикул группы', title: 'Новый артикул по номеру группы изделия (например 34 → 3411)', run: async (row, ctx) => {
        const chk = await data.assignSku(row.id);
        if (!chk.confirmRequired) { toast(chk.changed ? `Артикул: ${chk.sku}` : `Артикул ${chk.sku} уже по номеру группы`); return; }
        if (!(await confirmDlg('Присвоить новый артикул?', `Сейчас: ${chk.sku || 'нет'}. ${chk.warning || ''}`, { okText: 'Присвоить' }))) return;
        const res = await data.assignSku(row.id, true);
        toast(`Новый артикул: ${res.sku}`); ctx.changed(); ctx.reload();
      } }] : []),
      // копия изделия целиком (поля, фото, настройки паспорта) — быстрый способ сделать похожее; откроется копия
      qrPrintAction('P'),
      ...(session.canEdit ? [{ label: 'Клонировать', title: 'Копия со всеми полями, фото и настройками паспорта — потом поправьте название, размеры и артикул', run: async (row, ctx) => {
        const c = await data.cloneProduct(row.id);
        ctx.changed();
        toast('Копия создана — проверьте название, размеры и артикул', { ms: 8000 });
        patch({ open: c.id, of: undefined, new: undefined });
      } }, { label: 'Сделать вариант', title: 'То же изделие с другими размерами или цветом: создаётся новая карточка со своим артикулом (3404.1) и связью с основным', run: async (row, ctx) => {
        const v = await data.makeVariant(row.id);
        ctx.changed();
        toast(`Вариант ${v.sku} создан — поправьте размеры и цвет`, { ms: 8000 });
        patch({ open: v.id, of: undefined, new: undefined });
      } }] : []),
      ],
      // вкладки: Описание · Состав и работы · Техописание · Паспорт · Файлы · Заказы (C055)
      tabs: (r) => productTabs(r),
    }),
    editTop: true,
    editable: () => false, // «Изменить» — в «⋯»: внизу панели одна главная «Заполнить»
    zones: { fields: 'wide' },
    gallery: (r) => r.photos || [],
    photoAdd: data.photoAdd, photoSearch: (r) => r.name, // «Найти фото в интернете»
    photoMain: data.photoMain,
    photoRemove: data.photoRemove,
  },

  form: productForm(),

  remove: {
    text: (r) => `Удалить изделие «${r.name}»?`,
    run: data.removeProduct,
    restore: data.restoreProduct,
  },

  searchRow: (r) => ({ title: r.name, sub: [r.sku && `арт. ${r.sku}`, r.group].filter(Boolean).join(' · '), side: r.price ? money(r.price) : '' }),
  open: (id) => go('products', { open: id }),
  canEdit: () => session.canEdit,
};
