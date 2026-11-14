export { orderpass } from './order-passport-plan.js'; // LAZY.docs в main.js ждёт orderpass из docs.js
import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, go, patch } from '../core/router.js';
import { toast } from '../ui/kit/toast.js';
import { mountList } from '../ui/kit/list.js';
import { passports, issuePassport } from './passports.js';
import { numbersStrip } from './passports/numbers-strip.js';
import { canWorkPassport as canEditTexts, statusOf } from './passports/common.js';
import { linkDialog, printDialog, previewPassport } from './passports/dialogs.js';
import { passportFill } from './passports/template-form.js';
import { savePd } from './products.js';
import { mountOrdersTab } from './docs-orders.js';
import { mountQueueTab } from './docs-queue.js';
import { openPassportFunnel, openReadyPassport } from './passports/funnel/open.js';
import { lastNumbersTop, passnums } from './passports/numbers-view.js';
import { tabs as kitTabs, sku as kitSku, crumbTail, button } from '../ui/kit/index.js';


/*
 * «Документация» (#docs?tab=…): вкладки паспортов (C114 G).
 *  — «К выпуску» (queue, по умолчанию): очередь по заказам;
 *  — «Выпущенные» (archive): журнал от новых номеров к старым, поиск по номеру, отбор «№ от — до», полоска последних номеров;
 *  — «Паспорта по заказам» (orders);
 *  — «Настройки изделий» (templates): список изделий → панель doctpl (тип паспорта и тексты в изделии).
 *  Старый tab=numbers открывает «Выпущенные».
 * Панели: doctpl, passarchive (просмотр/печать), passports (черновик — дописать и выпустить), orderpass.
 */
const TABS = [['queue', 'К выпуску'], ['archive', 'Выпущенные'], ['orders', 'Паспорта по заказам'], ['templates', 'Настройки изделий']];
// старые адреса: «По номерам» — теперь сортировка и отбор «№ от — до» внутри «Выпущенных»
const tabOf = (p) => (['archive', 'orders', 'templates'].includes(p.tab) ? p.tab : p.tab === 'numbers' ? 'archive' : 'queue');
const isOld = (r) => !!r.source && r.source !== 'app';
const hasTpl = (d) => !!d && (Object.keys(d.textChoices || {}).length > 0 || !!d.passportCategory);
const canTpl = () => session.canEdit && canEditTexts();

export const doctpl = {
  id: 'doctpl',
  title: 'Паспорта',
  entityType: 'Product',
  canEdit: canTpl,
  get: (id) => api(`/showcase/${id}`),
  list: {
    path: '/showcase',
    sortDefault: 'name',
    createLabel: false,
    export: false,
    searchPlaceholder: 'Поиск: изделие, артикул, серия…',
    emptyText: 'Изделий пока нет.', emptyHint: 'Сначала добавьте их в разделе «Продукция».',
    hints: { '': 'Настройки паспорта по изделиям. Клик — открыть и поправить.' },
    columns: [
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => kitSku(r.sku) },
      { key: 'name', label: 'Изделие', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'tpl', label: 'Настройки', cls: 'nowrap', render: (r) => (r.hasPassportDefaults === undefined ? h('span', { class: 'muted' }, '—') : r.hasPassportDefaults ? h('span', { class: 'badge ok' }, 'задан') : h('span', { class: 'badge dim', title: 'Тип паспорта определится по разделу и группе; тексты выбираются при выпуске' }, 'не задан')) },
      { key: 'passportsCount', label: 'Выпущено', cls: 'num right nowrap', render: (r) => r.passportsCount || h('span', { class: 'muted' }, '—') },
    ],
    card: {
      title: (r) => r.name,
      sub: (r) => h('span', null, kitSku(r.sku), r.sku ? ' · ' : null, r.hasPassportDefaults === undefined ? '' : r.hasPassportDefaults ? 'настройки заданы' : 'настройки не заданы'),
      side: (r) => [h('span', { class: 'muted' }, r.passportsCount ? `паспортов: ${r.passportsCount}` : '')],
    },
  },
  card: {
    heading: (r) => [kitSku(r.sku), r.sku ? ' ' : null, r.name],
    editTitle: (r) => ['Настройки паспорта · ', kitSku(r.sku), r.sku ? ' ' : null, r.name],
    editSub: () => 'Ответы записываются сразу',
    editLabel: 'Редактировать шаблон паспорта', // нижняя кнопка — одна (правило 2026-10-28), но понятная: «Изменить» не говорило что
    subheading: (r) => [r.type, r.group].filter(Boolean).join(' → '),
    editTop: true,
    startEdit: () => canTpl(),
    noHistory: true,
    actions: (r) => [
      { label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК» по текущему шаблону изделия; паспорт не выпускается', run: (row) => previewPassport(row.id) },
      // 2026-11-13: «Печать паспорта» с шаблона убрана — печатала последний выпущенный паспорт без номера и заказа на экране;
      // выпущенные печатаются из заказа или «Архива». Здесь: посмотреть черновик или выпустить новый.
      session.sees('docs') && canEditTexts() && { label: 'Выпустить паспорт', primary: true, title: 'Новый паспорт с номером по этому шаблону', run: async (row) => {
        if (!(await issuePassport({ productId: row.id, name: row.name, article: row.sku }))) toast('Паспортов этой модели ещё не было — заполните габариты, описание и картинки');
      } },
      { label: 'Открыть изделие', more: true, run: (row) => go('products', { open: row.id }) },
    ],
    view: (r) => {
      const d = r.passportDefaults;
      const n = Object.keys(d?.textChoices || {}).length;
      return [
        ['Настройки', hasTpl(d) ? 'задан' : h('span', { class: 'muted' }, 'не задан — «Изменить», чтобы выбрать тексты')],
        ['Тип паспорта', r.passportCategory ? `${r.passportCategory.name || r.passportCategory.code}` : h('span', { class: 'muted' }, 'не задан — его задают в группе или виде изделия')],
        ['Выбрано текстов', n ? String(n) : h('span', { class: 'muted' }, 'нет — при выпуске подставятся варианты «по умолчанию»')],
        ['Выпущено паспортов', r.passports?.total ? String(r.passports.total) : null],
        ['Общие тексты типа паспорта', h('a', { href: '#dicts?d=passportPhrases' }, 'Справочники → Тексты паспорта')],
      ];
    },
  },
  form: {
    build: (r) => passportFill({ prod: r, mode: 'template' }),
    toInitial: (r) => r,
    toBody: (v, r) => ({ category: v.category || '', choices: v.choices || {}, over: v.over || {}, derived: r?.passportCategory?.code || '', prev: r?.passportDefaults || {} }),
    update: async (id, b) => { await savePd(id, b); return api(`/showcase/${id}`); },
  },
};

// ─── вкладка «Выпущенные паспорта»: только просмотр и печать ────────────────────────────────────────────
const archiveActions = (r) => [
  { label: statusOf(r) === 'draft' ? '⇩ PDF черновика…' : '⇩ PDF и печать…', primary: true, run: (row) => printDialog(row) },
  // черновик, не доведённый до выпуска, — дописывается в полной карточке (она остаётся как рабочая форма выпуска)
  statusOf(r) === 'draft' && canEditTexts() && { label: 'Дописать и выпустить', title: 'Черновик ещё без номера — откроется форма паспорта', run: (row) => patch({ of: 'passports', open: row.id }) },
  !r.productId && canEditTexts() && { label: 'Привязать к изделию', run: (row, ctx) => linkDialog(row, ctx) },
].filter(Boolean);

const oldBadge = (r) => (isOld(r) ? h('span', { class: 'badge dim', title: 'Перенесён из прежней таблицы паспортов' }, 'старый') : null);

export const passarchive = {
  ...passports,
  id: 'passarchive',
  title: 'Выпущенные',
  form: undefined,
  remove: undefined,
  open: (id) => go('docs', { tab: 'archive', of: 'passarchive', open: id }),
  list: {
    ...passports.list,
    createLabel: false,
    bulk: undefined,
    headActions: () => [numbersStrip()],
    top: () => lastNumbersTop(),
    extraKeys: passnums.list.extraKeys,
    toolbarExtra: () => { const a = passports.list.toolbarExtra(); const b = passnums.list.toolbarExtra(); return { el: h('div', null, a.el, b.el), update: (P) => { a.update?.(P); b.update?.(P); } }; },
    filters: [...passports.list.filters, ...passnums.list.filters.filter((f) => f.type === 'hidden')],
    emptyText: 'Паспортов пока нет.', emptyHint: 'Они появятся здесь, когда вы выпустите паспорт: вкладка «К выпуску» или кнопка «Новый паспорт».',
    hints: { ...passports.list.hints, '': 'Выпущенные паспорта. Найти — по номеру в поиске. Клик — карточка.' },
    columns: passports.list.columns.map((c) => (c.key === 'status'
      ? { ...c, render: (r) => h('span', null, c.render(r), oldBadge(r) ? ' ' : null, oldBadge(r)) } : c)),
  },
  card: { ...passports.card, editTop: false, actions: archiveActions },
};

// ─── экран ────────────────────────────────────────────────────────────────────────────────────────────
/** Параметры внутреннего списка: без вкладки и панели справа, иначе открытие карточки перезагружало бы список. */
const listParams = (p) => { const { tab, sec, of, ...rest } = p; return rest; }; // sec — устаревший адрес заглушек

// Только паспорта: заглушки «Акты / Накладные / Сертификаты» убраны (нет API, путали меню)
const TAB_NAME = Object.fromEntries(TABS);

export function mountDocs(params, { onChanged } = {}) {
  let tab = tabOf(params);
  let inner = null;
  const seg = h('div');
  const body = h('div', { class: 'docs-body' });
  const el = h('div', { class: 'docs' }, h('div', { class: 'page-head' }, seg, canTpl() ? button({ label: 'Новый паспорт', kind: 'primary', title: 'Выбрать изделие по шагам и выпустить PDF', onClick: () => openPassportFunnel() }) : null, canTpl() ? button({ label: 'Загрузить готовый паспорт (PDF)', title: 'Паспорт сделан отдельно: приложить файл PDF, указать фирму, изделие, заказ и номер', onClick: () => openReadyPassport() }) : null), body);

  const drawTabs = () => {
    seg.replaceChildren(kitTabs({ label: 'Паспорта', items: TABS.map(([key, label]) => ({ key, label })), value: tab, onChange: (k) => { if (tab !== k) go('docs', k === 'queue' ? {} : { tab: k }, { replace: true }); } }).el);
    crumbTail('Паспорта › ' + TAB_NAME[tab]);
  };

  function mountTab(p) {
    inner?.destroy?.();
    inner = null;
    if (tab === 'queue') { inner = mountQueueTab(p); body.replaceChildren(inner.el); drawTabs(); return; }
    if (tab === 'orders') { inner = mountOrdersTab(p, { onChanged }); body.replaceChildren(inner.el); drawTabs(); return; }
    const section = tab === 'archive' ? passarchive : doctpl;
    const secId = section.id;
    inner = mountList(section, listParams(p), {
      onOpen: (row) => go('docs', { tab, of: secId, open: row.id }, { replace: !!current().params.open, kind: 'card' }),
      onCreate: () => {},
      onChanged,
    });
    body.replaceChildren(inner.el);
    drawTabs();
  }
  mountTab(params);

  return {
    el,
    reload: () => inner?.reload?.(),
    focusSearch: () => inner?.focusSearch?.(),
    destroy: () => inner?.destroy?.(),
    update: (p) => {
      if (tabOf(p) !== tab) { tab = tabOf(p); mountTab(p); return; }
      if (tab === 'orders' || tab === 'queue') { inner.update(p); return; }
      inner.update(listParams({ ...p, open: p.of === (tab === 'archive' ? 'passarchive' : 'doctpl') ? p.open : undefined }));
    },
  };
}
