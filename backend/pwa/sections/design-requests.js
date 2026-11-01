import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { attachCombo, tabs, table, tabs as kitTabs } from '../ui/kit/index.js';
import { modal } from '../ui/dialog.js';
import { carousel } from '../ui/gallery.js';
import { toastError } from '../ui/toast.js';

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
  const S = { status: 'open', search: '', page: 1, seq: 0 };
  const LIMIT = 30;
  const box = h('div', { class: 'state' });
  const search = h('input', { type: 'search', placeholder: 'Поиск по названию…', 'aria-label': 'Поиск заявок', maxlength: 100 });
  let timer = 0;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.search = search.value.trim(); S.page = 1; load(); }, 300); });
  const statusTabs = tabs({ items: FILTERS.map(([key, label]) => ({ key, label })), value: S.status, label: 'Состояние заявок', onChange: (k) => { S.status = k; S.page = 1; load(); } });
  const chips = statusTabs.el;
  const paintChips = () => statusTabs.set(S.status);
  const el = h('div', { class: 'dr-view' }, h('div', { class: 'dr-bar' }, search, chips), box);

  function paint(r) {
    const items = r.items || [];
    if (!items.length) {
      box.replaceChildren(h('div', null, S.status === 'open' && !S.search ? 'Заявок нет. Менеджер отправляет новое изделие из заказа: позиция «Новое изделие».' : 'Ничего не найдено'));
      return;
    }
    const rows = items.map((x) => h('tr', { tabindex: '0', class: 'clickable', onclick: () => openCard(x.id), onkeydown: (e) => { if (e.key === 'Enter') openCard(x.id); } },
      h('td', { class: 'pic-cell' }, x.photo ? h('img', { class: 'pic', src: PREFIX + x.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
      h('td', { class: 'clip' }, h('b', null, clean(x.title) || 'Без названия'), x.status && x.status !== 'open' ? h('small', { class: 'muted' }, ' ' + (STATUS[x.status] || '')) : null),
      h('td', { class: 'num nowrap' }, qty(x.qtyTotal || 0)),
      h('td', { class: 'nowrap' }, `${x.lineCount || 0} поз.`),
      h('td', { class: 'clip md-hide' }, (x.orderNos || []).filter(Boolean).map((n) => '№ ' + n).join(', ') || `${x.orderCount || 0} зак.`),
      h('td', { class: 'nowrap md-hide' }, x.createdAt ? date(x.createdAt) : '')));
    const pages = Math.max(1, Math.ceil((r.total || items.length) / LIMIT));
    box.replaceChildren(table({ clickable: true, columns: [{ label: '' }, { label: 'Изделие' }, { label: 'Кол-во', num: true }, { label: 'Позиций' }, { label: 'Заказы', hide: true }, { label: 'Создана', hide: true }], rows }),
    pages > 1 ? h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: S.page <= 1, onclick: () => { S.page--; load(); } }, '← Назад'),
      h('span', { class: 'muted' }, ` ${S.page} из ${pages} `),
      h('button', { type: 'button', class: 'btn btn-sm', disabled: S.page >= pages, onclick: () => { S.page++; load(); } }, 'Дальше →')) : null);
  }
  async function load() {
    const my = ++S.seq;
    box.replaceChildren(h('div', { class: 'skel', style: { margin: '8px 4px' } }));
    try {
      const r = await api('/product-requests', { query: { status: S.status, ...(S.search ? { search: S.search } : {}), page: S.page, limit: LIMIT } });
      if (my !== S.seq) return;
      paint(r);
    } catch (e) { if (my === S.seq) { box.replaceChildren(h('div', null, 'Не удалось загрузить заявки. '), h('button', { type: 'button', class: 'btn btn-sm', onclick: load }, 'Повторить')); toastError(e, 'загрузить заявки'); } }
    requestsCount().then(onCount);
  }
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
    const canSettings = session.role === 'admin' || session.user?.isOwner === true;
    const tabs = h('div');
    const holder = h('div', { class: 'dr-holder', hidden: true });
    const el = h('div', { class: 'dr-wrap' }, tabs, inner.el, holder);
    let n = 0, view = null;
    const isReq = () => current().params.tab === 'requests';
    const pick = (req) => { const P = current().params; go('design', { ...P, tab: req ? 'requests' : undefined, of: undefined, open: undefined, new: undefined }, { replace: true }); };
    function paintTabs() {
      const req = isReq();
      tabs.replaceChildren(kitTabs({ label: 'Раздел проектирования', items: [{ key: 'tasks', label: 'Задачи' }, { key: 'requests', label: `Заявки на создание изделия (${n})` }], value: req ? 'requests' : 'tasks', onChange: (k) => pick(k === 'requests') }).el,
        canSettings ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Какие стикеры показывать на карточках', onclick: () => { const P = current().params; go('design', { ...P, of: 'designsettings', open: 'board', new: undefined }, { replace: !!P.open, kind: 'card' }); } }, 'Настройки доски') : null)
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
  api('/showcase', { query: { limit: 500 } }).then((r) => { items = (r.items || []).map((p) => ({ value: p.id, label: clean(p.name) || 'Без названия', sub: clean(p.sku) ? '№ ' + clean(p.sku) : '' })); }).catch((e) => toastError(e, 'загрузить изделия'));
  attachCombo(inp, { options: () => items, onPick: (o) => { picked = o.value; }, empty: () => 'Изделий не найдено' });
  inp.addEventListener('input', () => { picked = null; });
  return modal({ title: 'Это дубль существующего', body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Какое изделие уже есть?'), inp),
    h('p', { class: 'hint' }, 'Все позиции заявки привяжутся к выбранному изделию. Новое изделие не создаётся.')), okText: 'Привязать',
  onOk: () => { if (!picked) throw new Error('Выберите изделие из списка.'); return picked; } });
}

const norm = (x) => (x === null || x === undefined ? '' : String(x).trim());

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
    extra: (r) => h('div', { class: 'db-blocks' }, h('details', { class: 'db-blk', open: true }, h('summary', null, `Где нужно (${(r.lines || []).length})`),
      h('div', { class: 'db-blk-body' }, (r.lines || []).length ? h('ul', { class: 'timeline' }, (r.lines || []).map((l) => h('li', null,
        l.orderId ? h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`) : h('span', null, '№ —'),
        h('span', { class: 'muted clip' }, [clean(l.customer), clean(l.title), l.qty != null ? `${qty(l.qty)} ${clean(l.unit) || 'шт'}` : ''].filter(Boolean).join(' · '))))) : h('div', { class: 'db-hint' }, 'Позиций нет.')))),
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
        { key: 'type', label: 'Тип оборудования', type: 'combo', required: true, max: 100, options: (fv.sections || []).map((x) => x.value ?? x), hint: 'Из списка или своё' },
        { key: 'group', label: 'Группа изделий', type: 'combo', max: 100, options: (fv.groups || []).map((g) => ({ value: g.value, label: g.value, sub: g.section })) },
        { key: 'sku', label: 'Артикул', max: 64, hint: 'Оставьте пустым — будет присвоен автоматически' },
        { key: 'price', label: 'Цена', type: 'number', hint: 'Пусто — возьмётся из позиций заказов' },
        { key: 'description', label: 'Описание', type: 'textarea', wide: true, rows: 3, max: 2000 },
        { note: 'Фото из заявки перейдут в изделие. Паспорт, размеры и сертификацию можно дополнить в «Продукции».' },
      ];
    },
    initial: () => ({}),
    toInitial: (r) => ({ name: clean(r.title), description: clean(r.description), type: '', group: '', sku: '', price: '' }),
    toBody: (v) => {
      if (!norm(v.name)) throw new Error('Впишите название изделия.');
      if (!norm(v.type)) throw new Error('Выберите тип оборудования.');
      const b = { name: norm(v.name), type: norm(v.type) };
      for (const k of ['group', 'sku', 'description']) if (norm(v[k])) b[k] = norm(v[k]);
      if (v.price !== '' && v.price !== null && v.price !== undefined && Number(v.price) > 0) b.price = Number(v.price);
      return b;
    },
    update: (id, body) => api(`/product-requests/${id}/confirm`, { method: 'POST', body }),
  },
};
