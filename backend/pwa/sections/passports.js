import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn } from '../ui/busy.js';
import { date } from '../core/format.js';
import { current, go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDlg } from '../ui/dialog.js';
import { openBulk } from './bulk-edit.js';
import { MONTHS, STATUS_LABEL, canEdit, dims, facets, facetsFor, heading, isIssued, num, numberOf, st, statusBadge, statusOf } from './passports/common.js';
import { resetProducts } from './passports/models.js';
import { annulDialog, convertDialog, issueAction, linkDialog, numberDialog, printDialog } from './passports/dialogs.js';
import { passportBulkFields } from './passports/bulk.js';
import { bomBlock, checkBlock, imagesBlock, previewBlock } from './passports/card-blocks.js';
import { passportForm } from './passports/form.js';
import { stepFunnel } from '../ui/step-funnel.js';

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
    emptyText: 'Паспортов пока нет.', emptyHint: 'Нажмите «Новый паспорт» и выберите изделие в «Продукции». Нет изделия — сначала создайте его.',
    query: (P) => ({ ...(P.state === 'incomplete' ? { incomplete: 1 } : {}), ...(P.state === 'noImages' ? { noImages: 1 } : {}) }),
    filters: [
      { key: 'status', label: 'Статус', type: 'select', options: async () => [{ value: 'draft', label: 'Черновики' }, { value: 'issued', label: 'Выпущенные' }, { value: 'annulled', label: 'Аннулированные' }] },
      { key: 'state', label: 'Показать', type: 'chips', options: () => [{ value: 'incomplete', label: 'Неполные' }, { value: 'noImages', label: 'Без картинок' }],
        count: (resp, v) => (v === '' ? undefined : v === 'incomplete' ? resp.incomplete : undefined) },
      // Б2: категория → год → месяц → поставщик → заказчик — воронкой в левой панели (toolbarExtra); здесь — для «Сбросить всё» и счётчика
      { key: 'category', label: 'Категория', type: 'hidden' },
      { key: 'year', label: 'Год', type: 'hidden' },
      { key: 'month', label: 'Месяц', type: 'hidden' },
      { key: 'supplierOrgId', label: 'Поставщик', type: 'hidden' },
      { key: 'customer', label: 'Заказчик', type: 'hidden' },
    ],
    sidebar: true,
    chipsTop: true,
    toolbarExtra: () => stepFunnel({
      steps: [{ key: 'category', label: 'Категория' }, { key: 'year', label: 'Год' }, { key: 'month', label: 'Месяц', when: (P) => !!P.year },
        { key: 'supplierOrgId', label: 'Поставщик' }, { key: 'customer', label: 'Заказчик' }],
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
        badge: statusOf(r) !== 'issued' ? h('span', { class: 'badge gc-badge ' + (statusOf(r) === 'draft' ? 'warn' : 'dim') }, STATUS_LABEL[statusOf(r)].toLowerCase()) : r.manualText?.length ? h('span', { class: 'badge info gc-badge', title: 'Текст изменён вручную, не из справочника' }, 'изменено вручную') : null,
      }),
    },
    hints: {
      '': 'Паспорт — на каждое выданное изделие: свой номер, талон и номер изделия (их выдаёт система). Клик — карточка: картинки, «⇩ PDF с печатью», «Создать копию».',
      incomplete: 'Не хватает данных для выдачи: в строке видно, чего именно. Откройте и заполните — PDF соберётся полным.',
      noImages: 'Паспорта без картинок: перетащите или вставьте (Ctrl+V) общий вид в карточке.',
    },
    hintKey: 'state',
    headActions: () => [h('button', { class: 'btn btn-ghost', type: 'button', title: 'Все паспорта по текущим фильтрам — PDF в одном архиве (до 200)', onclick: async (e) => {
      const done = toast('Собираю архив — это может занять несколько минут…', { ms: 600000 }); const free = busyBtn(e.currentTarget, null);
      try { const name = await apiFile('/passports/zip', { query: { ...listQuery(), stamp: 1 }, timeout: 600000, fallback: 'Паспорта.zip' }); toast(`Скачан: ${name}`); } catch (er) { toastError(er, 'собрать архив паспортов'); } finally { done(); free(); }
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
      ['№ договора', r.orderNo],
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
      isIssued(r) && canEdit() && { label: 'Новая редакция', title: 'Изменить выпущенный паспорт: номер тот же, редакция +1, прежняя — в истории', run: (row) => { st.revisionFor = row.id; [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.trim() === 'Изменить')?.click(); } },
      isIssued(r) && canEdit() && { label: 'Аннулировать…', title: 'Номер останется занятым и повторно не выдаётся', run: (row, ctx) => annulDialog(row, ctx) },
      isIssued(r) && (session.role === 'admin' || session.user?.isOwner) && { label: 'Изменить номер…', run: (row, ctx) => numberDialog(row, ctx) },
      !r.passportCategory && canEdit() && { label: 'Выбрать категорию', title: 'Без категории PDF упрощённый — с категорией текст соберётся по справочникам', run: (row, ctx) => convertDialog(row, ctx) },
      // ПИ.5: старый паспорт без изделия — привязать к изделию или создать изделие из него (одна модель, без массовых)
      !r.productId && canEdit() && { label: 'Привязать к изделию', run: (row, ctx) => linkDialog(row, ctx) },
      !r.productId && canEdit() && r.name && { label: 'Создать изделие из паспорта', title: 'Изделие в «Продукции» с данными этого паспорта; паспорта той же модели привяжутся к нему', run: async (row, ctx) => {
        const key = `${String(row.name).replace(/\s+/g, ' ').trim()}\u0000${String(row.article || '').replace(/\s+/g, ' ').trim()}`;
        if (!(await confirmDlg('Создать изделие?', `В «Продукции» появится «${row.name}» с размерами, текстами и фото этого паспорта. Паспорта той же модели (то же наименование и артикул) привяжутся к нему.`, { okText: 'Создать' }))) return;
        try { const res = await api('/showcase/from-passports', { method: 'POST', body: { groups: [{ keys: [key], main: key }] } }); resetProducts(); toast(`Изделие создано, привязано паспортов: ${res.linked}`); ctx.setRow(await api(`/passports/${row.id}`)); } catch (e) { toastError(e); }
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

  form: passportForm,

  remove: {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.name || 'без названия'}) в корзину? На нумерацию это не влияет.`,
    blocked: (r) => (statusOf(r) !== 'draft' ? 'Выпущенный паспорт не удаляется — «Аннулировать…» (номер останется занятым)' : null),
    run: (r) => api(`/passports/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/passports/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.name || ''}`, sub: [date(r.date), r.customerName || r.objectName, r.warrantyCode].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('passports', { open: id }),
};
