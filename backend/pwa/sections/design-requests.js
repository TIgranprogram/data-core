import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { attachCombo, tabs, table, empty, autoMore, section, stack, tabs as kitTabs } from '../ui/kit/index.js';
import { modal } from '../ui/kit/dialog.js';
import { funnel } from '../ui/kit/funnel.js';
import { carousel } from '../ui/kit/gallery.js';
import { toastError } from '../ui/kit/toast.js';

/**
 * «Заявки на создание изделия» в разделе «Проектирование» (ORDER-LINES шаг 7): менеджер в заказе добавил «новое изделие»,
 * проектировщик подтверждает его (создаётся изделие в «Продукции») или отмечает дублем существующего.
 * Вкладка: `#design?tab=requests`; панель справа: `?of=prodreq&open=<id заявки>`.
 * Сервер: GET /product-requests/count, GET /product-requests, GET /product-requests/:id, POST …/confirm, POST …/reject {productId}.
 */
const clean = (v) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s === 'null' || s === 'undefined' ? '' : s; };
const STATUS = { open: 'Ждёт решения', confirmed: 'Изделие создано', rejected: 'Дубль существующего' };
const FILTERS = [['open', 'Ждут решения'], ['confirmed', 'Создано'], ['rejected', 'Дубли'], ['all', 'Все']];

export const requestsCount = () => api('/product-requests/count').then((r) => r?.open || 0).catch(() => 0);

const openCard = (id) => { const P = current().params; go('design', { ...P, of: 'prodreq', open: id, new: undefined }, { replace: !!P.open, kind: 'card' }); };

// ---------- вкладка со списком ----------
/** Тело вкладки: поиск, фильтр по состоянию, таблица. */
function requestsView(onCount) {
  const S = { status: 'open', search: '' };
  const box = h('div', { class: 'state' });
  const search = h('input', { type: 'search', placeholder: 'Поиск по названию…', 'aria-label': 'Поиск заявок', maxlength: 100 });
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.search = search.value.trim(); load(); }, 300); });
  const statusTabs = tabs({ items: FILTERS.map(([key, label]) => ({ key, label })), value: S.status, label: 'Состояние заявок', onChange: (k) => { S.status = k; load(); } });
  const chips = statusTabs.el;
  const paintChips = () => statusTabs.set(S.status);

  // ПГ-1c: порции при прокрутке вниз — kit.autoMore
  const more = autoMore({
    root: box, skeleton: true, limit: 30, text: { fail: 'Заявки не загрузились', moreFail: 'Не удалось подгрузить заявки' },
    load: (page, { limit }) => api('/product-requests', { query: { status: S.status, ...(S.search ? { search: S.search } : {}), page, limit } }),
    onError: (e) => toastError(e, 'загрузить заявки'),
    render: (items) => {
      if (!items.length) {
        box.replaceChildren(S.status === 'open' && !S.search
          ? empty({ title: 'Заявок на новые изделия нет', hint: 'Появятся, когда менеджер добавит в заказ позицию «Новое изделие».' })
          : empty({ title: 'Ничего не найдено', hint: 'Смените состояние или поисковый запрос.' }));
        return;
      }
      const rows = items.map((x) => h('tr', { tabindex: '0', class: 'clickable', onclick: () => openCard(x.id), onkeydown: (e) => { if (e.key === 'Enter') openCard(x.id); } },
        h('td', { class: 'pic-cell' }, x.photo ? h('img', { class: 'pic', src: PREFIX + x.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
        h('td', { class: 'clip' }, h('b', null, clean(x.title) || 'Без названия'), x.status && x.status !== 'open' ? h('small', { class: 'muted' }, ' ' + (STATUS[x.status] || '')) : null),
        h('td', { class: 'num nowrap' }, qty(x.qtyTotal || 0)),
        h('td', { class: 'nowrap' }, `${x.lineCount || 0} поз.`),
        h('td', { class: 'clip md-hide' }, (x.orderNos || []).filter(Boolean).map((n) => '№ ' + n).join(', ') || `${x.orderCount || 0} зак.`),
        h('td', { class: 'nowrap md-hide' }, x.createdAt ? date(x.createdAt) : '')));
      box.replaceChildren(table({ clickable: true, columns: [{ label: '' }, { label: 'Изделие' }, { label: 'Кол-во', num: true }, { label: 'Позиций' }, { label: 'Заказы', hide: true }, { label: 'Создана', hide: true }], rows }));
    },
  });
  const el = h('div', { class: 'dr-view' }, h('div', { class: 'dr-bar' }, search, chips), box, more.el);
  const load = async () => { await more.reload(); requestsCount().then(onCount); };
  paintChips();
  load();
  return { el, reload: load };
}

/**
 * Обёртка над доской: полоса вкладок «Задачи | Заявки на создание изделия (N)». Открывается по ссылке `#design?tab=requests`.
 * mountInner — прежняя доска (mountDesignBoard / mountBoard).
 */
export function withRequestsTab(mountInner) {
  return (b, path, q, o) => {
    const inner = mountInner(b, path, q, o);
    const tabs = h('div');
    const holder = h('div', { class: 'dr-holder', hidden: true });
    const el = h('div', { class: 'dr-wrap' }, tabs, inner.el, holder);
    let n = 0, view = null;
    const isReq = () => current().params.tab === 'requests';
    const pick = (req) => { const P = current().params; go('design', { ...P, tab: req ? 'requests' : undefined, of: undefined, open: undefined, new: undefined }, { replace: true }); };
    function paintTabs() {
      const req = isReq();
      tabs.replaceChildren(kitTabs({ label: 'Раздел проектирования', items: [{ key: 'tasks', label: 'Задачи' }, ...(n > 0 || req ? [{ key: 'requests', label: `Заявки на создание изделия (${n})` }] : [])], value: req ? 'requests' : 'tasks', onChange: (k) => pick(k === 'requests') }).el);
    }
    function show() {
      const req = isReq();
      inner.el.hidden = req; holder.hidden = !req;
      if (req && !view) { view = requestsView((c) => { n = c; paintTabs(); }); holder.append(view.el); }
      paintTabs();
    }
    requestsCount().then((c) => { n = c; paintTabs(); });
    show();
    return {
      ...inner, el,
      reload: () => { inner.reload?.(); view?.reload(); requestsCount().then((c) => { n = c; paintTabs(); }); },
      setQuery: (qq) => { inner.setQuery?.(qq); show(); },
    };
  };
}

// ---------- панель заявки ----------
let fvCache = null;
const formValues = () => (fvCache ||= api('/showcase/form-values').catch(() => { fvCache = null; return { sections: [], groups: [] }; }));

/** Окно «Это дубль»: выбор изделия из списка (поиск по названию и артикулу) → id или null. */
function askProduct() {
  let picked = null;
  const inp = h('input', { placeholder: 'Начните вводить название или артикул', 'aria-label': 'Изделие', maxlength: 200 });
  let items = [];
  api('/showcase', { query: { limit: 500 } }).then((r) => { items = (r.items || []).map((p) => ({ value: p.id, label: clean(p.name) || 'Без названия', sub: clean(p.sku) })); }).catch((e) => toastError(e, 'загрузить изделия'));
  attachCombo(inp, { options: () => items, onPick: (o) => { picked = o.value; }, empty: () => 'Изделий не найдено' });
  inp.addEventListener('input', () => { picked = null; });
  return modal({ title: 'Это дубль существующего', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Какое изделие уже есть?'), inp),
    h('p', { class: 'hint' }, 'Все позиции заявки привяжутся к выбранному изделию. Новое изделие не создаётся.')), okText: 'Привязать',
  onOk: () => { if (!picked) throw new Error('Выберите изделие из списка.'); return picked; } });
}

const norm = (x) => (x === null || x === undefined ? '' : String(x).trim());
const sameName = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

/** «Раздел → Группа» воронкой (kit.funnel, П-1): группы — только выбранного раздела, с числом изделий. value поля = JSON {type, group}. */
function typeGroupWidget(fv) {
  const types = (fv.sections || []).map((x) => ({ name: norm(x.value ?? x), n: x.n })).filter((x) => x.name);
  return () => {
    let type = '', group = '';
    const groupsOf = (t) => (fv.groups || []).filter((g) => sameName(g.section, t) && norm(g.value)).map((g) => ({ name: norm(g.value), n: g.n }));
    const steps = () => {
      const gs = type ? groupsOf(type) : [];
      return [
        { key: 'type', label: 'Раздел', ask: 'выберите раздел продукции', value: type ? String(types.findIndex((x) => x.name === type)) : '', values: types.map((x, i) => ({ id: String(i), label: x.name, count: x.n })) },
        { key: 'group', label: 'Группа', ask: 'выберите группу или оставьте без группы', optional: true, skip: !gs.length, value: group ? String(gs.findIndex((x) => x.name === group)) : '', values: gs.map((x, i) => ({ id: String(i), label: x.name, count: x.n })) },
      ];
    };
    const f = funnel({ steps: steps(), onChange: (key, id) => {
      if (key === 'type') { type = id === '' ? '' : types[Number(id)]?.name || ''; group = ''; }
      else { const gs = groupsOf(type); group = id === '' ? '' : gs[Number(id)]?.name || ''; }
      f.update({ steps: steps() });
    } });
    return { el: f.el, get value() { return JSON.stringify({ type, group }); }, set value(_) { /* только показ */ } };
  };
}

export const designRequest = {
  id: 'prodreq',
  title: 'Заявка на создание изделия',
  get: (id) => api(`/product-requests/${id}`),
  card: {
    heading: (r) => clean(r.title) || 'Заявка на создание изделия',
    subheading: (r) => STATUS[r.status] || '',
    noHistory: true,
    top: (r) => (r.photos?.length ? h('div', { class: 'dc-top' }, carousel(r.photos.map((p) => ({ url: p.url || p.thumb, thumb: p.thumb || p.url })), {}).el) : null),
    view: (r) => [
      ['Состояние', STATUS[r.status]],
      ['Всего нужно', r.qtyTotal != null ? qty(r.qtyTotal) + ' шт.' : ''],
      ['Описание', clean(r.description)],
      ['Создана', r.createdAt ? date(r.createdAt) : ''],
      ['Изделие', r.productId ? h('a', { href: '#products?open=' + r.productId }, 'Открыть в «Продукции»') : ''],
    ],
    extra: (r) => stack(section({ title: 'Где нужно', tone: 'who', count: (r.lines || []).length, open: true, body: (r.lines || []).length ? h('ul', { class: 'timeline' }, (r.lines || []).map((l) => h('li', null,
        l.orderId ? h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`) : h('span', null, '№ —'),
        h('span', { class: 'muted clip' }, [clean(l.customer), clean(l.title), l.qty != null ? `${qty(l.qty)} ${clean(l.unit) || 'шт'}` : ''].filter(Boolean).join(' · '))))) : h('p', { class: 'muted small' }, 'Позиций нет.') })),
    actions: (r) => {
      if (r.status !== 'open' || !session.canEdit) return [];
      return [
        { label: 'Создать изделие', primary: true, title: 'Откроется форма изделия: название, описание и фото уже подставлены', run: (_row, ctx) => ctx.edit() },
        { label: 'Это дубль существующего', title: 'Изделие уже есть — привязать позиции к нему', run: async (row, ctx) => {
          const pid = await askProduct();
          if (!pid) return;
          const btn = document.activeElement?.closest?.('.actions button') || [...document.querySelectorAll('.actions button')].find((b) => b.textContent.includes('дубль'));
          btn?.classList.add('is-busy');
          try { ctx.setRow(await api(`/product-requests/${row.id}/reject`, { method: 'POST', body: { productId: pid } })); } catch (e) { toastError(e, 'привязать к изделию'); } finally { btn?.classList.remove('is-busy'); }
        } },
      ];
    },
  },
  form: {
    saveLabel: 'Создать изделие',
    fields: async () => {
      const fv = await formValues();
      return [
        { section: 'Новое изделие', tone: 'main', fixed: true },
        { key: 'name', label: 'Название', wide: true, required: true, max: 300 },
        { key: 'tg', label: 'Раздел и группа', type: 'widget', wide: true, required: true, hint: 'Сначала раздел продукции, затем группа этого раздела. Число — сколько изделий уже есть', widget: typeGroupWidget(fv), summary: () => '' },
        { key: 'sku', label: 'Артикул', max: 64, hint: 'Оставьте пустым — будет присвоен автоматически' },
        { key: 'price', money: true, label: 'Цена', type: 'number', hint: 'Пусто — возьмётся из позиций заказов' },
        { key: 'description', label: 'Описание', type: 'textarea', wide: true, rows: 3, max: 2000 },
        { note: 'Фото из заявки перейдут в изделие. Паспорт, размеры и сертификацию можно дополнить в «Продукции».' },
      ];
    },
    initial: () => ({}),
    toInitial: (r) => ({ name: clean(r.title), description: clean(r.description), tg: null, sku: '', price: '' }),
    toBody: (v) => {
      if (!norm(v.name)) throw new Error('Впишите название изделия.');
      const tg = v.tg || {};
      if (!norm(tg.type)) throw new Error('Выберите раздел продукции.');
      const b = { name: norm(v.name), type: norm(tg.type) };
      if (norm(tg.group)) b.group = norm(tg.group);
      for (const k of ['sku', 'description']) if (norm(v[k])) b[k] = norm(v[k]);
      if (v.price !== '' && v.price !== null && v.price !== undefined && Number(v.price) > 0) b.price = Number(v.price);
      return b;
    },
    update: (id, body) => api(`/product-requests/${id}/confirm`, { method: 'POST', body }),
  },
};
