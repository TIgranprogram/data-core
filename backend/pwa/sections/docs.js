export { orderpass } from './order-passport-plan.js'; // LAZY.docs в main.js ждёт orderpass из docs.js
import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, go, patch } from '../core/router.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { mountList } from '../ui/kit/list.js';
import { funnelBox } from '../ui/funnel.js';
import { passports, issuePassport } from './passports.js';
import { numbersStrip } from './passports/numbers-strip.js';
import { canEdit as canEditTexts, statusOf, V2_NUMS, passportCategoryOptions } from './passports/common.js';
import { linkDialog, printDialog, previewPassport, passportVariant, VARIANT_HINT } from './passports/dialogs.js';
import { savePd, products, PD_KEYS } from './products.js';
import { passportKindDrop } from './product-files.js';
import { mountOrdersTab } from './docs-orders.js';
import { mountQueueTab } from './docs-queue.js';
import { buildForm, tabs as kitTabs, badge as kitBadge, segmented, sku as kitSku, link as kitLink, crumbTail } from '../ui/kit/index.js';


/*
 * «Документация» (#docs?tab=…): вкладки паспортов.
 *  — «Нужно сделать паспорт» (по умолчанию): очередь по заказам;
 *  — «Шаблоны»: список изделий → панель doctpl (категория и тексты в изделии);
 *  — «По заказам» / «Выпущенные паспорта».
 * Панели: doctpl, passarchive (просмотр/печать), passports (черновик — дописать и выпустить), orderpass.
 */
const TABS = [['queue', 'Нужно сделать паспорт'], ['templates', 'Шаблоны'], ['orders', 'По заказам'], ['archive', 'Выпущенные паспорта']];
const tabOf = (p) => (['archive', 'orders', 'templates'].includes(p.tab) ? p.tab : 'queue');
const isOld = (r) => !!r.source && r.source !== 'app';
const hasTpl = (d) => !!d && (Object.keys(d.textChoices || {}).length > 0 || !!d.passportCategory);

// ─── вкладка «Шаблоны»: шаблон паспорта изделия ───────────────────────────────────────────────────
// подсказки «что ввести и где взять» для полей, которые вводятся прямо в редакторе
const HINTS = {
  serviceLifeYears: 'Сколько лет изделие служит. Для металла с порошковой окраской обычно 10. Уточните у технолога.',
  maxUsers: 'Сколько человек могут заниматься одновременно. Смотрите в чертеже или у проектировщика.',
  siteLength: 'Длина площадки вместе с зоной безопасности, в мм. Берётся из рисунка зоны безопасности.',
  siteWidth: 'Ширина площадки вместе с зоной безопасности, в мм. Берётся из рисунка зоны безопасности.',
  ageFrom: 'Минимальный возраст пользователя. Из описания изделия.', ageTo: 'Максимальный возраст пользователя. Из описания изделия.',
  heightMin: 'Минимальный рост пользователя, мм. Из описания изделия.', heightMax: 'Максимальный рост пользователя, мм. Из описания изделия.',
  weightMax: 'Максимальный вес пользователя, кг. Из описания изделия.', fallHeight: 'Высота свободного падения, мм. Считает проектировщик по чертежу.',
};
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
    // ПН: полоска номеров во вкладке «Шаблоны»
    headActions: () => [numbersStrip()],
    emptyText: 'Изделий пока нет.', emptyHint: 'Сначала добавьте их в разделе «Продукция».',
    hints: { '': 'У каждого изделия свой шаблон паспорта: категория и выбранные тексты (монтаж, назначение…). Клик — открыть, поправить и нажать «Выпустить паспорт»: шаблон подставится в паспорт.' },
    columns: [
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => kitSku(r.sku) },
      { key: 'name', label: 'Изделие', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'tpl', label: 'Шаблон', cls: 'nowrap', render: (r) => (r.hasPassportDefaults === undefined ? h('span', { class: 'muted' }, '—') : r.hasPassportDefaults ? h('span', { class: 'badge ok' }, 'задан') : h('span', { class: 'badge dim', title: 'Категория определится по разделу и группе; тексты выбираются при выпуске' }, 'не задан')) },
      { key: 'passportsCount', label: 'Выпущено', cls: 'num right nowrap', render: (r) => r.passportsCount || h('span', { class: 'muted' }, '—') },
    ],
    card: {
      title: (r) => r.name,
      sub: (r) => h('span', null, kitSku(r.sku), r.sku ? ' · ' : null, r.hasPassportDefaults === undefined ? '' : r.hasPassportDefaults ? 'шаблон задан' : 'шаблон не задан'),
      side: (r) => [h('span', { class: 'muted' }, r.passportsCount ? `паспортов: ${r.passportsCount}` : '')],
    },
  },
  card: {
    heading: (r) => [kitSku(r.sku), r.sku ? ' ' : null, r.name],
    editTitle: (r) => ['Шаблон паспорта · ', kitSku(r.sku), r.sku ? ' ' : null, r.name],
    subheading: (r) => [r.type, r.group].filter(Boolean).join(' → '),
    editTop: true,
    startEdit: () => canTpl(),
    noHistory: true,
    actions: (r) => [
      { label: 'Предпросмотр', title: 'PDF с пометкой «ЧЕРНОВИК» по текущему шаблону изделия; паспорт не выпускается', run: (row) => previewPassport(row.id) },
      { label: 'Печать паспорта', primary: true, run: async (row) => {
        const last = row.passports?.items?.[0];
        if (last) { printDialog(await api(`/passports/${last.id}`)); return; }
        await previewPassport(row.id);
      } },
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
        ['Категория паспорта', r.passportCategory ? `${r.passportCategory.name || r.passportCategory.code}` : h('span', { class: 'muted' }, 'не задана — «Изменить» и выберите категорию')],
        ['Выбрано текстов', n ? String(n) : h('span', { class: 'muted' }, 'нет — при выпуске подставятся варианты «по умолчанию»')],
        ['Выпущено паспортов', r.passports?.total ? String(r.passports.total) : null],
        ['Общие тексты категории', h('a', { href: '#dicts?d=passportPhrases' }, 'Справочники → Тексты паспорта')],
      ];
    },
  },
  form: {
    build: async (r) => {
      const cats = (await passportCategoryOptions()).map((c) => ({ code: c.value, name: c.label }));
      const derived = r.passportCategory?.code || '';
      const sel = h('select', null, h('option', { value: '' }, '— по разделу и группе —'), ...cats.map((c) => h('option', { value: String(c.code) }, c.name)));
      sel.value = r.passportDefaults?.passportCategory || derived || '';
      const fb = funnelBox({ value: JSON.stringify(r.passportDefaults?.textChoices || {}), category: sel.value, canEditText: canEditTexts() });
      sel.addEventListener('change', () => fb.setCategory(sel.value));
      // ── «Собрано автоматически» и «Не хватает для паспорта» (один редактор; ввод — здесь же)
      const NUM_KEYS = new Set(V2_NUMS.map(([k]) => k));
      const autoBox = h('div');
      const needBox = h('div');
      const auto = () => {
        const cat = cats.find((c) => String(c.code) === sel.value);
        const rows = [
          ['Изделие', h('span', null, kitSku(r.sku), r.sku ? ' ' : null, r.name)],
          ['Категория паспорта', cat ? cat.name : (r.passportCategory?.name || '')],
          ['Материалы', r.materialsText],
          ['Выбрано текстов', Object.keys(JSON.parse(fb.value || '{}')).length ? String(Object.keys(JSON.parse(fb.value || '{}')).length) : ''],
        ];
        autoBox.replaceChildren(h('div', { class: 'section-title' }, 'Собрано автоматически'),
          h('dl', { class: 'kv-grid' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || h('span', { class: 'muted' }, 'нет'))])));
      };
      let seq = 0;
      const can = canTpl();
      // Поля — те же компоненты, что в карточке изделия (products.form.fields); запись — в само изделие, второй копии нет
      const FIELD_OF = { height: ['dimL', 'dimW', 'dimH'], weight: ['weightKg'], materials: ['materialsSpec'], installationTypeId: ['pdInstall'], installationMethod: ['pdInstall'],
        elements: ['pdElements'], purpose: ['pdElements'], name: ['name'], description: ['description'] };
      let prodFields = null;
      const productFields = () => (prodFields ??= products.form.fields(r));
      const putPd = async (part) => {
        const merged = { ...(r.passportDefaults || {}), ...part };
        const body = { ...Object.fromEntries(PD_KEYS.filter((k) => merged[k] !== undefined && merged[k] !== null && merged[k] !== '').map((k) => [k, merged[k]])), textChoices: r.passportDefaults?.textChoices || {} };
        await api(`/showcase/${r.id}/passport-defaults`, { method: 'PUT', body });
      };
      const refresh = async () => { Object.assign(r, await api(`/showcase/${r.id}`)); auto(); checkNeed(); };
      const plainItem = (m) => h('div', { class: 'field wide' }, h('span', null, m.label), h('div', { class: 'hint' }, m.hint || HINTS[m.key] || 'Заполняется в изделии.'));
      const needItem = async (m) => {
        const hint = h('div', { class: 'hint' }, m.hint || HINTS[m.key] || '');
        if (!can) return plainItem(m);
        if (String(m.key || '').startsWith('img_')) return h('div', { class: 'field wide' }, h('span', null, m.label), passportKindDrop(r.id, m.key.slice(4), refresh), hint);
        let fields = null;
        if (FIELD_OF[m.key]) { const all = await productFields(); fields = FIELD_OF[m.key].map((k) => all.find((f) => f && f.key === k)).filter(Boolean); }
        else if (NUM_KEYS.has(m.key)) fields = [{ key: m.key, label: m.label, type: 'number', min: 0 }];
        if (!fields?.length) return plainItem(m);
        const one = fields.length === 1;
        const f = buildForm(fields.map((x) => ({ ...x, ...(one ? { label: m.label } : {}), span: undefined, wide: one || x.wide })), NUM_KEYS.has(m.key) ? { [m.key]: r.passportDefaults?.[m.key] ?? '' } : products.form.toInitial(r));
        const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary' }, 'Сохранить в изделии');
        btn.onclick = async () => {
          const res = f.read(); if (res.errors) return;
          const v = res.values; const body = {}; const pd = {};
          for (const x of fields) {
            const k = x.key;
            if (k === 'dimL' || k === 'dimW' || k === 'dimH') body.dimensions = { length: v.dimL ?? null, width: v.dimW ?? null, height: v.dimH ?? null, unit: r.dimensions?.unit || 'мм' };
            else if (k === 'weightKg') body.weightKg = v.weightKg ?? null;
            else if (k === 'materialsSpec') body.materialsSpec = v.materialsSpec ?? null;
            else if (k === 'name' || k === 'description') body[k] = v[k] || '';
            else if (k === 'pdInstall') pd.installationTypeId = v.pdInstall || '';
            else if (k === 'pdElements') pd.elements = Array.isArray(v.pdElements) ? v.pdElements : [];
            else pd[k] = v[k];
          }
          try {
            if (Object.keys(body).length) await api(`/showcase/${r.id}`, { method: 'PATCH', body });
            if (Object.keys(pd).length) { if (body.dimensions || body.weightKg !== undefined) Object.assign(r, await api(`/showcase/${r.id}`)); await putPd(pd); }
            toast('Сохранено в изделии');
            await refresh();
          } catch (e) { toastError(e); }
        };
        return h('div', { class: 'field wide' }, one ? null : h('span', null, m.label), f.el, h('div', { class: 'actions' }, btn), hint);
      };
      const checkNeed = async () => {
        const my = ++seq;
        const body = { productId: r.id, mode: 'template', variant: passportVariant.value };
        let res = null;
        try { res = await api('/passports/check', { method: 'POST', body }); } catch { res = null; }
        if (my !== seq) return;
        const list = (res?.missing || []).filter((m) => m && typeof m === 'object');
        const head = (n) => h('div', { class: 'section-title' }, n ? `Не хватает для паспорта (${n})` : 'Не хватает для паспорта');
        if (!res) { needBox.replaceChildren(head(0), h('p', { class: 'muted' }, 'Не удалось проверить. Попробуйте открыть изделие ещё раз.')); return; }
        if (!list.length) { needBox.replaceChildren(head(0), h('p', null, kitBadge('Всё готово', 'ok'), ' Паспорт можно печатать.')); return; }
        const seen = new Set();
        const items = await Promise.all(list.filter((m) => { const k = FIELD_OF[m.key]?.[0] || m.key; return seen.has(k) ? false : (seen.add(k), true); }).map(needItem));
        if (my !== seq) return;
        needBox.replaceChildren(head(list.length), ...items, h('div', { class: 'hint' }, 'Всё вводится в изделие и сразу пересчитывается. ', kitLink({ label: 'Открыть изделие', onClick: () => go('products', { open: r.id }) })));
      };
      sel.addEventListener('change', () => { auto(); checkNeed(); });
      const seg = segmented({ items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }], value: passportVariant.value, label: 'Вариант паспорта', onChange: (k) => { passportVariant.value = k; checkNeed(); } });
      auto(); checkNeed();
      const el = h('div', { class: 'form-grid' },
        h('div', { class: 'field wide' }, h('span', null, 'Вариант паспорта'), seg.el, h('div', { class: 'hint' }, VARIANT_HINT)),
        h('div', { class: 'wide' }, autoBox), h('div', { class: 'wide' }, needBox),
        h('p', { class: 'hint wide' }, `Шаблон паспорта изделия «${r.name}». Он подставляется, когда вы выпускаете паспорт; выданные паспорта не меняются.`),
        h('label', { class: 'field wide' }, h('span', null, 'Категория паспорта'), sel,
          h('div', { class: 'hint' }, 'Обычно определяется по разделу и группе; укажите, если нужна другая. От неё зависят варианты ниже.')),
        h('div', { class: 'field wide' }, h('span', null, 'Тексты паспорта — выбор (монтаж, назначение…)'), fb.el),
        h('div', { class: 'actions wide' }, h('button', { type: 'button', class: 'btn', title: 'PDF с пометкой «ЧЕРНОВИК» по сохранённому шаблону; паспорт не выпускается', onclick: (e) => { const b = e.currentTarget; b.classList.add('is-busy'); previewPassport(r.id).finally(() => b.classList.remove('is-busy')); } }, 'Предпросмотр')));
      const values = () => ({ category: sel.value, choices: JSON.parse(fb.value || '{}'), over: {} });
      const start = JSON.stringify(values());
      return { el, focus: () => sel.focus(), dirty: () => JSON.stringify(values()) !== start, read: () => ({ values: values() }) };
    },
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
  title: 'Выпущенные паспорта',
  form: undefined,
  remove: undefined,
  open: (id) => go('docs', { tab: 'archive', of: 'passarchive', open: id }),
  list: {
    ...passports.list,
    createLabel: false,
    bulk: undefined,
    headActions: () => [],
    emptyText: 'Паспортов пока нет.', emptyHint: 'Они появятся здесь, когда вы выпустите паспорт на вкладке «Шаблоны» или «Нужно сделать паспорт».',
    hints: { ...passports.list.hints, '': 'Журнал паспортов: выпущенные здесь и перенесённые старые. Клик — карточка, «⇩ PDF и печать…». Новый паспорт — «Нужно сделать паспорт» или «Шаблоны».' },
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
  const el = h('div', { class: 'docs' }, h('div', { class: 'page-head' }, seg), body);

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
