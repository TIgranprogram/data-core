import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, go, patch } from '../core/router.js';
import { toast } from '../ui/toast.js';
import { mountList } from '../ui/list.js';
import { funnelBox } from '../ui/funnel.js';
import { passports, issuePassport } from './passports.js';
import { canEdit as canEditTexts, statusOf } from './passports/common.js';
import { linkDialog, printDialog } from './passports/dialogs.js';
import { savePd } from './products.js';
import { mountOrdersTab } from './docs-orders.js';
import { mountQueueTab } from './docs-queue.js';

/*
 * «Документация» (NAV F5): две вкладки в адресе #docs?tab=…
 *  — «Паспорта» (по умолчанию): список изделий; клик — правая панель «шаблон паспорта изделия»
 *    (категория + выбор текстов воронкой; хранится в изделии, из него «Выпустить паспорт» подставляет всё);
 *  — «Архив паспортов»: все выпущенные и перенесённые паспорта — только просмотр и печать.
 * Панели справа: of=doctpl (шаблон изделия), of=passarchive (карточка архива, без правки), of=passports (полная карточка —
 * только чтобы дописать черновик).
 */
const TABS = [['queue', 'Нужно сделать паспорт'], ['templates', 'Паспорта'], ['orders', 'По заказам'], ['archive', 'Архив паспортов']];
const tabOf = (p) => (['archive', 'orders', 'templates'].includes(p.tab) ? p.tab : 'queue');
const isOld = (r) => !!r.source && r.source !== 'app';
const hasTpl = (d) => !!d && (Object.keys(d.textChoices || {}).length > 0 || !!d.passportCategory);

// ─── вкладка «Паспорта»: шаблон паспорта изделия ───────────────────────────────────────────────────
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
    hints: { '': 'У каждого изделия свой шаблон паспорта: категория и выбранные тексты (монтаж, назначение…). Клик — открыть и поправить; «Выпустить паспорт» в «Продукции» и в заказе подставит его.' },
    columns: [
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => r.sku },
      { key: 'name', label: 'Изделие', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'tpl', label: 'Шаблон', cls: 'nowrap', render: (r) => (r.hasPassportDefaults === undefined ? h('span', { class: 'muted' }, '—') : r.hasPassportDefaults ? h('span', { class: 'badge ok' }, 'задан') : h('span', { class: 'badge dim', title: 'Категория определится по разделу и группе; тексты выбираются при выпуске' }, 'не задан')) },
      { key: 'passportsCount', label: 'Выпущено', cls: 'num right nowrap', render: (r) => r.passportsCount || h('span', { class: 'muted' }, '—') },
    ],
    card: {
      title: (r) => r.name,
      sub: (r) => [r.sku && `арт. ${r.sku}`, r.hasPassportDefaults === undefined ? '' : r.hasPassportDefaults ? 'шаблон задан' : 'шаблон не задан'].filter(Boolean).join(' · '),
      side: (r) => [h('span', { class: 'muted' }, r.passportsCount ? `паспортов: ${r.passportsCount}` : '')],
    },
  },
  card: {
    heading: (r) => r.name,
    subheading: (r) => [r.sku && `арт. ${r.sku}`, [r.type, r.group].filter(Boolean).join(' → ')].filter(Boolean).join(' · '),
    editTop: true,
    noHistory: true,
    actions: (r) => [
      session.sees('docs') && canEditTexts() && { label: 'Выпустить паспорт', run: async (row) => {
        if (!(await issuePassport({ productId: row.id, name: row.name, article: row.sku }))) toast('Паспортов этой модели ещё не было — заполните габариты, описание и картинки');
      } },
      { label: 'Открыть изделие', run: (row) => go('products', { open: row.id }) },
    ],
    view: (r) => {
      const d = r.passportDefaults;
      const n = Object.keys(d?.textChoices || {}).length;
      return [
        ['Шаблон', hasTpl(d) ? 'задан' : h('span', { class: 'muted' }, 'не задан — «Изменить», чтобы выбрать категорию и тексты')],
        ['Категория паспорта', r.passportCategory ? `${r.passportCategory.name || r.passportCategory.code}` : h('span', { class: 'muted' }, 'не определена — добавьте раздел или группу изделия в «Категории каталога»')],
        ['Выбрано текстов', n ? String(n) : h('span', { class: 'muted' }, 'нет — при выпуске подставятся варианты «по умолчанию»')],
        ['Выпущено паспортов', r.passports?.total ? String(r.passports.total) : null],
        ['Общие тексты категории', h('a', { href: '#dicts?d=passportPhrases' }, 'Справочники → Тексты паспорта')],
      ];
    },
  },
  form: {
    build: async (r) => {
      const cats = (await api('/dicts/passportCategories').then((x) => x.items || []).catch(() => [])).filter((c) => c.code && c.code !== 'ALL');
      const derived = r.passportCategory?.code || '';
      const sel = h('select', null, h('option', { value: '' }, '— по разделу и группе —'), ...cats.map((c) => h('option', { value: String(c.code) }, c.name)));
      sel.value = r.passportDefaults?.passportCategory || derived || '';
      const fb = funnelBox({ value: JSON.stringify(r.passportDefaults?.textChoices || {}), category: sel.value, canEditText: canEditTexts() });
      sel.addEventListener('change', () => fb.setCategory(sel.value));
      const el = h('div', { class: 'form-grid' },
        h('p', { class: 'hint wide' }, `Шаблон паспорта изделия «${r.name}». Он подставляется, когда вы выпускаете паспорт из «Продукции» или из заказа; выданные паспорта не меняются.`),
        h('label', { class: 'field wide' }, h('span', null, 'Категория паспорта'), sel,
          h('div', { class: 'hint' }, 'Обычно определяется по разделу и группе; укажите, если нужна другая. От неё зависят варианты ниже.')),
        h('div', { class: 'field wide' }, h('span', null, 'Тексты паспорта — выбор (монтаж, назначение…)'), fb.el));
      const values = () => ({ category: sel.value, choices: JSON.parse(fb.value || '{}') });
      const start = JSON.stringify(values());
      return { el, focus: () => sel.focus(), dirty: () => JSON.stringify(values()) !== start, read: () => ({ values: values() }) };
    },
    toInitial: (r) => r,
    toBody: (v, r) => ({ category: v.category || '', choices: v.choices || {}, derived: r?.passportCategory?.code || '', prev: r?.passportDefaults || {} }),
    update: async (id, b) => { await savePd(id, b); return api(`/showcase/${id}`); },
  },
};

// ─── вкладка «Архив паспортов»: только просмотр и печать ────────────────────────────────────────────
const archiveActions = (r) => [
  { label: statusOf(r) === 'draft' ? '⇩ PDF черновика…' : '⇩ PDF и печать…', primary: true, run: (row) => printDialog(row) },
  // черновик, не доведённый до выпуска, — дописывается в полной карточке (она остаётся как рабочая форма выпуска)
  statusOf(r) === 'draft' && canEditTexts() && { label: 'Дописать и выпустить', title: 'Черновик ещё без номера — откроется форма паспорта', run: () => patch({ of: 'passports' }) },
  !r.productId && canEditTexts() && { label: 'Привязать к изделию', run: (row, ctx) => linkDialog(row, ctx) },
].filter(Boolean);

const oldBadge = (r) => (isOld(r) ? h('span', { class: 'badge dim', title: 'Перенесён из прежней таблицы паспортов' }, 'старый') : null);

export const passarchive = {
  ...passports,
  id: 'passarchive',
  title: 'Архив паспортов',
  form: undefined,
  remove: undefined,
  open: (id) => go('docs', { tab: 'archive', of: 'passarchive', open: id }),
  list: {
    ...passports.list,
    createLabel: false,
    bulk: undefined,
    emptyText: 'Паспортов пока нет — они появятся здесь, когда вы выпустите паспорт из «Продукции» или заказа.',
    hints: { ...passports.list.hints, '': 'Журнал паспортов: выпущенные здесь и перенесённые старые. Клик — карточка, «⇩ PDF и печать…». Новый паспорт выпускается из изделия («Продукция» или заказ).' },
    columns: passports.list.columns.map((c) => (c.key === 'status'
      ? { ...c, render: (r) => h('span', null, c.render(r), oldBadge(r) ? ' ' : null, oldBadge(r)) } : c)),
  },
  card: { ...passports.card, editTop: false, actions: archiveActions },
};

// ─── экран ────────────────────────────────────────────────────────────────────────────────────────────
/** Параметры внутреннего списка: без вкладки и панели справа, иначе открытие карточки перезагружало бы список. */
const listParams = (p) => { const { tab, of, ...rest } = p; return rest; };

export function mountDocs(params, { onChanged } = {}) {
  let tab = tabOf(params);
  let inner = null;
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Документация' });
  const body = h('div', { class: 'docs-body' });
  const el = h('div', { class: 'docs' }, h('div', { class: 'page-head' }, seg), body);

  const drawTabs = () => seg.replaceChildren(...TABS.map(([k, label]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'active' : '', onclick: () => { if (tab !== k) go('docs', k === 'queue' ? {} : { tab: k }, { replace: true }); } }, label)));

  function mountTab(p) {
    inner?.destroy?.();
    if (tab === 'queue') { inner = mountQueueTab(p); body.replaceChildren(inner.el); drawTabs(); return; }
    if (tab === 'orders') { inner = mountOrdersTab(p, { onChanged }); body.replaceChildren(inner.el); drawTabs(); return; }
    const sec = tab === 'archive' ? passarchive : doctpl;
    const secId = sec.id;
    inner = mountList(sec, listParams(p), {
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
