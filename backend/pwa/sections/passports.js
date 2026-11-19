import { stack } from '../ui/kit/index.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date } from '../core/format.js';
import { current, go } from '../core/router.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { openBulk } from './bulk-edit.js';
import { MONTHS, STATUS_LABEL, canEdit, canWorkPassport, dims, facetsFor, heading, isIssued, num, numberOf, statusBadge, statusOf } from './passports/common.js';
import { resetProducts } from './passports/models.js';
import { annulDialog, convertDialog, issueAction, linkDialog, numberDialog, printDialog } from './passports/dialogs.js';
import { passportBulkFields } from './passports/bulk.js';
import { bomBlock, checkBlock, imagesBlock, printFileBlock } from './passports/card-blocks.js';
import { pdfBlock } from './passports/pdf-block.js';
import { revisionsBlock } from './passports/revisions.js';
import { numbersStrip } from './passports/numbers-strip.js';
import { stepFunnel } from '../ui/kit/index.js';
import { openBookEditor } from './passports/book-editor.js';

/**
 * Раздел «Паспорта изделий» (TASKS ПС.4–ПС.5): паспорт = экземпляр (№, талон, номер изделия, дата, заказчик/объект),
 * модель — общие поля (наименование, габариты, материалы, описание, картинки). Номера выдаёт сервер.
 * Новый паспорт: начните печатать наименование — выберите модель, подставится всё, кроме заказчика и даты.
 * Смотреть — менеджер и выше, создавать и менять — директор и админ (как на сервере).
 */
/** Параметры фильтров списка из адреса — для «PDF пакетом». */
function listQuery() {
  const p = current().params || {};
  const q = { search: p.q, year: p.year, month: p.month, category: p.category, supplierOrgId: p.supplierOrgId, customer: p.customer };
  if (p.state === 'incomplete') q.incomplete = 1;
  if (p.state === 'noImages') q.noImages = 1;
  return q;
}


export { issuePassport } from './passports/models.js';
const newFormat = (r) => r.presentationVersion === 1;
const canWriteDraft = (r) => newFormat(r) && statusOf(r) === 'draft' && canWorkPassport();
const openBook = (row, ctx) => openBookEditor(row.id, {
  onClose: (next, changed) => { if (changed) { ctx.setRow?.(next); ctx.changed?.(); } },
});
const printable = (r) => !!(r.passportCategory || r.printSource === 'file' || r.printFile?.hasFile);

export const passports = {
  id: 'passports',
  title: 'Паспорта',
  newTitle: 'Новый паспорт',
  entityType: 'ProductPassport',
  canEdit: canWorkPassport,
  historyLabels: { 'passport.created': 'Создан', 'passport.updated': 'Изменён', 'passport.copied': 'Копия', 'passport.deleted': 'Удалён', 'passport.restored': 'Восстановлен', create: 'Создан', update: 'Изменён' },
  get: (id) => api(`/passports/${id}`, { query: { readOnly: 1 } }),

  list: {
    viewKey: 'passports', path: '/passports',
    sortDefault: '-passportNo',
    createLabel: false,
    // БЗ-9: отметить паспорта галочками → «Изменить выбранные» (общие поля; номера, талоны, названия, картинки — по одному)
    bulk: { open: (ids, { done }) => openBulk({ ids, done, fields: passportBulkFields,
      apply: (set, arrays) => api('/passports/bulk', { method: 'POST', body: { ids, set, arrays } }),
      restore: (before) => api('/passports/bulk/restore', { method: 'POST', body: { items: before } }) }) }, // права — canEditSection в списке
    searchPlaceholder: 'Поиск: № паспорта, талон, номер изделия, наименование, заказчик, объект…',
    emptyText: 'Паспортов пока нет.', emptyHint: 'Нажмите «Новый паспорт» и выберите изделие в «Продукции». Нет изделия — сначала создайте его.',
    query: (P) => ({ ...(P.state === 'incomplete' ? { incomplete: 1 } : {}), ...(P.state === 'noImages' ? { noImages: 1 } : {}) }),
    filters: [
      { key: 'status', label: 'Статус', type: 'select', options: async () => [{ value: 'draft', label: 'Черновики' }, { value: 'issued', label: 'Выпущенные' }, { value: 'annulled', label: 'Аннулированные' }] },
      { key: 'state', label: 'Фильтр', type: 'chips', options: () => [{ value: 'incomplete', label: 'Неполные' }, { value: 'noImages', label: 'Без картинок' }],
        count: (resp, v) => (v === '' ? undefined : v === 'incomplete' ? resp.incomplete : undefined) },
      // Б2: категория → год → месяц → поставщик → заказчик — воронкой в левой панели (toolbarExtra); здесь — для «Сбросить всё» и счётчика
      { key: 'category', label: 'Категория', type: 'hidden' },
      { key: 'year', label: 'Год', type: 'hidden' },
      { key: 'month', label: 'Месяц', type: 'hidden' },
      { key: 'supplierOrgId', label: 'Фирма', type: 'hidden' },
      { key: 'customer', label: 'Заказчик', type: 'hidden' },
    ],
    sidebar: true,
    chipsTop: true,
    toolbarExtra: () => stepFunnel({
      steps: [{ key: 'category', label: 'Категория' }, { key: 'year', label: 'Год' }, { key: 'month', label: 'Месяц', when: (P) => !!P.year },
        { key: 'supplierOrgId', label: 'Фирма' }, { key: 'customer', label: 'Заказчик' }],
      load: async (P) => {
        const pick = ['category', 'year', 'month', 'supplierOrgId', 'customer', 'status', 'legacy'];
        const f = await facetsFor(Object.fromEntries(pick.filter((k) => P[k]).map((k) => [k, P[k]])));
        return {
          category: f.categories.map((c) => ({ value: c.value, n: c.n })),
          year: f.years.map((y) => ({ value: String(y.value), n: y.n })),
          month: (f.months || []).map((m) => ({ value: String(m.value), label: MONTHS[m.value - 1], n: m.n })),
          supplierOrgId: f.suppliers.map((x) => ({ value: x.value, label: x.label, n: x.n })),
          customer: f.customers.map((c) => ({ value: c.value, n: c.n })),
        };
      },
    }),
    // паспорта по категориям с фото (основной вид), по 50 на страницу — не все сотни сразу; «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 50, sort: 'category', lastGroup: 'Без категории',
      groupBy: (r) => r.category || 'Без категории',
      card: (r) => ({
        pic: r.thumb ? PREFIX + r.thumb : null,
        title: r.name || 'без названия',
        meta: [numberOf(r) ? `№ ${numberOf(r)}` : 'черновик', date(r.date), r.customerName || r.objectName].filter(Boolean).join(' · '),
        badge: statusOf(r) !== 'issued' ? h('span', { class: 'badge gc-badge ' + (statusOf(r) === 'draft' ? 'warn' : 'dim') }, STATUS_LABEL[statusOf(r)].toLowerCase()) : r.categoryDiffers ? h('span', { class: 'badge warn gc-badge', title: 'Тип паспорта не совпадает с категорией изделия' }, 'тип отличается') : r.manualText?.length ? h('span', { class: 'badge info gc-badge', title: 'Текст изменён вручную, не из справочника' }, 'изменено вручную') : null,
      }),
    },
    hints: {
      '': 'Откройте карточку, чтобы посмотреть паспорт и скачать его PDF.',
      incomplete: 'Причины для черновиков нового формата указаны в книжке.',
      noImages: 'Паспорта с отсутствующими рисунками.',
    },
    hintKey: 'state',
    headActions: () => [numbersStrip()],
    // П2: «⇩ PDF пакетом» — в «Ещё ▾»
    moreActions: () => [{ label: '⇩ PDF пакетом', title: 'Все паспорта по текущим фильтрам — PDF в одном архиве (до 200)', onSelect: async () => {
      const done = toast('Собираю архив — это может занять несколько минут…', { ms: 600000 });
      try { const name = await apiFile('/passports/zip', { query: { ...listQuery(), stamp: 1, readOnly: 1 }, timeout: 600000, fallback: 'Паспорта.zip' }); toast(`Скачан: ${name}`); } catch (er) { toastError(er, 'собрать архив паспортов'); } finally { done(); }
    } }],
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.thumb ? h('img', { class: 'pic so-pic', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'passportNumber', label: '№', sort: 'passportNo', cls: 'nowrap', render: (r) => h('b', null, numberOf(r) || '—') },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => h('span', null, statusBadge(r), r.manualText?.length ? h('span', { class: 'badge info', title: 'Текст изменён вручную, не из справочника' }, ' изменено вручную') : null) },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'name', label: 'Название', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name || '' }, r.name || h('span', { class: 'muted' }, 'без названия')) },
      { key: 'category', label: 'Категория', sort: 'category', cls: 'md-hide', render: (r) => r.category || h('span', { class: 'muted' }, '—') },
      { key: 'customerName', label: 'Заказчик', sort: 'customerName', cls: 'clip md-hide', render: (r) => h('span', { title: [r.customerName, r.orderNo && 'заказ ' + r.orderNo, r.objectName].filter(Boolean).join(' · ') }, [r.customerName, r.orderNo && '№' + r.orderNo, r.objectName].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—')) },
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

  // C118 W6a: шаблон «Карточка объекта» — шапка (статус бейджем) → предупреждения → «Что дальше» (одна главная кнопка) → сведения → вкладки; остальное — в «⋯»
  card: {
    ...screenCard({
      title: heading,
      sub: (r) => [r.name, r.category].filter(Boolean).join(' · '),
      stage: (r) => h('span', null, statusBadge(r), r.revision > 1 ? h('span', { class: 'badge dim', title: 'Версия паспорта' }, ' версия ' + r.revision) : null),
      warns: (r) => [
        statusOf(r) === 'annulled' && r.annulReason ? { tone: 'error', title: 'Аннулирован', sub: r.annulReason } : null,
        canWriteDraft(r) && r.missing?.length ? { title: 'Не хватает для выпуска', sub: r.missing.join(', ') } : null,
        r.productCodeDuplicate ? { title: 'Номер изделия повторяется', sub: `${r.productCode} уже есть в другом паспорте` } : null,
      ],
      next: (r, ctx) => {
        const edit = canWriteDraft(r);
        return {
          text: edit ? 'В книжке указаны данные, необходимые для выпуска.'
            : !newFormat(r) ? 'Паспорт старого образца.' : 'Паспорт доступен для просмотра и печати.',
          primary: { label: edit ? 'Дописать в книжке' : 'Открыть паспорт', run: () => openBook(r, ctx) },
        };
      },
      facts: (r) => [
        ['Талон', r.warrantyCode],
        ['Номер изделия', r.productCode],
        ['Дата', date(r.date)],
        ['Гарантия', `${r.warrantyMonths ?? 12} мес.`],
        ['Заказчик', r.customerName],
        ['Фирма', r.supplierOrg ? `${r.supplierOrg.name}${r.supplierOrg.hasSeal ? '' : ' (печать не загружена)'}` : r.supplier],
      ],
      more: (r) => [
        ['Название', r.name], ['Категория', r.category], ['Артикул', r.article],
        ['Габариты (В × Д × Ш)', dims(r)], ['Вес', r.weight ? num(r.weight) + ' кг' : ''],
        ['Материалы', r.materials], ['Установка', r.installationMethod], ['Назначение', r.purpose], ['Описание', r.description],
        ['№ договора', r.orderNo], ['Объект', r.objectName],
        ['Источник', (r.printSource === 'file' || r.printFile?.hasFile) ? 'Файл' : 'С сайта'],
        ['PDF скачан', r.pdfIssuedAt ? date(r.pdfIssuedAt) : ''], ['Заметки', r.note],
      ],
      menu: (r) => [
        { label: 'PDF и печать…', disabled: !printable(r), title: printable(r) ? undefined : 'Для печати нужен исходный файл или тип паспорта', run: printDialog },
        canWriteDraft(r) && r.readiness?.ready && { label: 'Выпустить…', title: 'Присвоить номер и талон', run: issueAction },
        newFormat(r) && isIssued(r) && canEdit() && { label: 'Аннулировать…', title: 'Номер останется занятым и повторно не выдаётся', run: annulDialog },
        newFormat(r) && isIssued(r) && (session.role === 'admin' || session.user?.isOwner) && { label: 'Изменить номер…', run: numberDialog },
        canWriteDraft(r) && !r.passportCategory && { label: 'Выбрать тип паспорта', run: convertDialog },
        canWriteDraft(r) && !r.productId && { label: 'Привязать к изделию', run: linkDialog },
        canWriteDraft(r) && !r.productId && r.name && { label: 'Создать изделие из паспорта', title: 'Изделие получит размеры, тексты и фото паспорта', run: async (row, ctx) => {
          const key = `${String(row.name).replace(/\s+/g, ' ').trim()}\u0000${String(row.article || '').replace(/\s+/g, ' ').trim()}`;
          if (!(await confirmDlg('Создать изделие?', `В «Продукции» появится «${row.name}» с размерами, текстами и фото этого паспорта. Паспорта той же модели (то же наименование и артикул) привяжутся к нему.`, { okText: 'Создать' }))) return;
          try { const res = await api('/showcase/from-passports', { method: 'POST', body: { groups: [{ keys: [key], main: key }] } }); resetProducts(); toast(`Изделие создано, привязано паспортов: ${res.linked}`); ctx.setRow(await api(`/passports/${row.id}`)); } catch (e) { toastError(e); }
        } },
      ],
      tabs: (r) => {
        const miss = (r.missing?.length || 0) + (r.standardWarnings?.length || 0) + (r.syncWarning ? 1 : 0);
        return [
          { key: 'main', label: 'Паспорт', blocks: (row, ctx) => stack(
            printFileBlock(row, ctx, { readonly: !newFormat(row) }),
            row.passportCategory ? pdfBlock(row, ctx, { readonly: !canWriteDraft(row) }) : null,
            imagesBlock(row, ctx, { readonly: !canWriteDraft(row) }), bomBlock(row),
          ) },
          { key: 'check', label: 'Проверка', count: miss || undefined, tone: miss ? 'warn' : undefined, when: canWriteDraft,
            blocks: (row) => (row.passportCategory ? checkBlock(row) : h('div', { class: 'fill-note' }, row.missing?.length ? ['Не хватает для выдачи: ', h('b', null, row.missing.join(', '))] : 'Нет типа паспорта — проверять нечего.')) },
          { key: 'versions', label: 'Версии', count: (r.revisionList || []).length || undefined, when: (row) => (row.revisionList || []).length > 0,
            blocks: (row, ctx) => revisionsBlock(row, ctx, { readonly: !newFormat(row) }) },
        ];
      },
    }),
    editTitle: (r) => [heading(r), r.name ? ' · ' + r.name : ''],
    // C141: основной путь — книжка (next/menu); form остаётся в коде, но кнопка «Изменить» внизу не зовёт (card.js смотрит editable)
    editTop: false,
    editable: () => false,
  },

  get remove() {
    if (!canEdit()) return null;
    return {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.name || 'без названия'})? На нумерацию это не влияет.`,
    blocked: (r) => !newFormat(r) ? 'Доступен просмотр старого паспорта' : !canEdit() ? 'Удаление доступно директору или администратору'
      : (statusOf(r) !== 'draft' ? 'Выпущенный паспорт не удаляется — «Аннулировать…» (номер останется занятым)' : null),
    run: (r) => api(`/passports/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/passports/${r.id}/restore`, { method: 'POST' }),
    };
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.name || ''}`, sub: [date(r.date), r.customerName || r.objectName, r.warrantyCode].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('passports', { open: id }),
};
