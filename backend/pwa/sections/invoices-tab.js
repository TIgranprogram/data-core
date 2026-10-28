import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money } from '../core/format.js';
import { INVOICE_STATUS, SUPPLY_STATUS, badge } from '../ui/badges.js';
import { enhanceSelect } from '../ui/select.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';

/**
 * Вкладка «Счета» в «Заявках» (CHAIN-AUDIT З8–З12): список счетов с фильтрами и суммой;
 * клик по строке раскрывает её под собой — позиции, файлы, цепочка «Заказ → договоры», кнопки по состоянию.
 * Сервер: GET /supply/invoices, GET /supply/invoices/:id, PATCH …/:id {issue}, POST …/:id/pay, POST …/:id/receive.
 */
const LIMIT = 30;
const STATUS_OPTS = [['', 'Все статусы'], ['draft', 'Черновик'], ['issued', 'Выставлен'], ['paid', 'Оплачен'], ['cancelled', 'Отменён']];
const cut = (v) => String(v || '').slice(0, 10);
const ruDate = (v) => (v ? isoDay(v).split('-').reverse().join('.') : '—');

export function mountInvoicesTab() {
  const F = { status: '', supplierId: '', q: '', from: '', to: '' };
  let page = 1; let seq = 0; let timer = null;
  const openIds = new Set();

  const sel = (opts, key, title) => {
    const s = h('select', { class: 'inv-f', 'aria-label': title, onchange: () => { F[key] = s.value; reload(); } }, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  const statusSel = sel(STATUS_OPTS, 'status', 'Статус');
  const supSel = sel([['', 'Все поставщики']], 'supplierId', 'Поставщик');
  lookups().then((lk) => {
    const list = (lk.suppliers || []).map((s) => (typeof s === 'string' ? [s, s] : [String(s.value ?? s.id), s.label ?? s.name])).filter(([v]) => v);
    supSel.append(...list.map(([v, l]) => h('option', { value: v }, l)));
    enhanceSelect(supSel);
  }).catch(() => {});
  const q = h('input', { type: 'search', class: 'inv-f', placeholder: 'Поиск: № счёта, поставщик…', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { F.q = q.value.trim(); reload(); }, 300); } });
  const from = h('input', { type: 'date', class: 'inv-f', 'aria-label': 'С даты', onchange: () => { F.from = from.value; reload(); } });
  const to = h('input', { type: 'date', class: 'inv-f', 'aria-label': 'По дату', onchange: () => { F.to = to.value; reload(); } });
  const bar = h('div', { class: 'inv-bar' }, q, statusSel, supSel, h('span', { class: 'inv-period' }, from, h('span', { class: 'muted' }, '—'), to));

  const rows = h('div', { class: 'inv-list' });
  const foot = h('div', { class: 'inv-foot' });
  const el = h('div', { class: 'inv-tab' }, bar, rows, foot);

  function reload() { page = 1; load(); }

  async function load() {
    const my = ++seq;
    rows.classList.add('is-busy');
    try {
      const query = { page, limit: LIMIT, ...Object.fromEntries(Object.entries(F).filter(([, v]) => v)) };
      const r = await api('/supply/invoices', { query });
      if (my !== seq) return;
      paint(r);
    } catch (e) {
      if (my !== seq) return;
      rows.replaceChildren(h('div', { class: 'panel state' }, h('div', { class: 'err' }, e?.message || 'Не удалось загрузить счета'), h('button', { class: 'btn', type: 'button', onclick: load }, 'Повторить')));
      foot.replaceChildren();
    } finally { if (my === seq) rows.classList.remove('is-busy'); }
  }

  function paint(r) {
    const items = r.items || [];
    if (!items.length) {
      const filtered = Object.values(F).some(Boolean);
      rows.replaceChildren(h('div', { class: 'panel state' },
        h('div', null, filtered ? 'По этим условиям счетов нет.' : 'Счетов пока нет.'),
        h('div', { class: 'muted' }, filtered ? 'Снимите часть фильтров или измените период.' : 'Счёт появляется, когда заявки переводят в «В работе» (заказано у поставщика). Или нажмите «Счёт без заявок» на вкладке «Заявки».')));
      foot.replaceChildren();
      return;
    }
    rows.replaceChildren(...items.map(rowEl));
    const pages = Math.ceil((r.total || 0) / LIMIT);
    foot.replaceChildren(
      h('div', { class: 'inv-sum' }, `Счетов: ${r.total ?? items.length} · Итого: `, h('b', null, money(r.sum ?? 0))),
      pages > 1 ? h('div', { class: 'inv-pager' },
        h('button', { class: 'btn', type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, '‹ Назад'),
        h('span', { class: 'muted' }, `${page} из ${pages}`),
        h('button', { class: 'btn', type: 'button', disabled: page >= pages, onclick: () => { page++; load(); } }, 'Далее ›')) : null);
  }

  function rowEl(inv) {
    const detail = h('div', { class: 'inv-detail' });
    const head = h('button', { type: 'button', class: 'inv-head', 'aria-expanded': 'false', onclick: () => toggle() },
      h('span', { class: 'inv-no' }, inv.no ? `№ ${inv.no}` : 'без номера'),
      h('span', { class: 'inv-date muted' }, ruDate(inv.date)),
      h('span', { class: 'inv-sup' }, inv.supplierName || '—'),
      h('span', { class: 'inv-amt num' }, inv.amount > 0 ? money(inv.amount) : '—'),
      badge(INVOICE_STATUS, inv.status),
      h('span', { class: 'inv-meta muted' }, [inv.payerName && `платит: ${inv.payerName}`, (inv.orders || []).length && `заказы: ${inv.orders.join(', ')}`, `позиций: ${inv.requestsCount ?? 0}`].filter(Boolean).join(' · ')));
    const box = h('div', { class: 'inv-row' }, head, detail);
    function toggle(force) {
      const on = force ?? !box.classList.contains('open');
      box.classList.toggle('open', on);
      head.setAttribute('aria-expanded', String(on));
      if (on) { openIds.add(inv.id); fill(); } else { openIds.delete(inv.id); detail.replaceChildren(); }
    }
    async function fill() {
      detail.replaceChildren(h('div', { class: 'muted' }, 'Загружаю счёт…'));
      try { detail.replaceChildren(detailEl(await api(`/supply/invoices/${inv.id}`), fill)); } catch (e) { detail.replaceChildren(h('div', { class: 'err' }, e?.message || 'Не удалось загрузить счёт')); }
    }
    if (openIds.has(inv.id)) toggle(true);
    return box;
  }

  /** Раскрытая часть: позиции, файлы, цепочка, кнопки. */
  function detailEl(inv, refresh) {
    const reqs = inv.requests || [];
    const canAct = session.canEdit && inv.status !== 'cancelled';
    const run = async (btn, fn) => { btn.disabled = true; btn.classList.add('is-busy'); try { await fn(); } catch (e) { toastError(e); } finally { btn.disabled = false; btn.classList.remove('is-busy'); } };
    const after = async () => { await load(); };

    const checks = new Map();
    const pending = reqs.filter((x) => x.status !== 'received' && x.status !== 'cancelled');
    const list = h('ul', { class: 'inv-reqs' }, ...reqs.map((x) => {
      const can = pending.includes(x) && canAct && inv.status !== 'draft';
      let cb = null;
      if (can) { cb = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Принять позицию' }); checks.set(x.id, cb); }
      const price = x.price ?? x.priceHint;
      const sum = price > 0 && x.qty > 0 ? money(price * x.qty) : '';
      return h('li', null, cb,
        h('a', { href: '#requests?open=' + x.id }, x.title || x.materialName || x.name || '—'),
        h('span', { class: 'muted' }, ` · ${x.qty ?? ''} ${x.unit || ''}` + (price > 0 ? ` × ${money(price)}` : '') + (sum ? ` = ${sum}` : '') + ' · '),
        badge(SUPPLY_STATUS, x.status === 'ordered' && x.paid ? 'paid' : x.status));
    }));

    const files = (inv.files || []).length
      ? h('div', { class: 'inv-files' }, h('span', { class: 'muted' }, 'Файлы: '), ...inv.files.map((f) => h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.name || 'файл')))
      : h('div', { class: 'muted' }, 'Файла счёта нет.');

    const chain = (inv.orders || []).length
      ? h('div', { class: 'inv-chain' }, h('span', { class: 'muted' }, 'Заказ → договоры: '), ...inv.orders.map((o) => h('span', { class: 'inv-chain-i' },
        h('a', { href: '#salesorders?q=' + encodeURIComponent(o.productionNo) }, `Заказ № ${o.productionNo}`),
        (o.contracts || []).length ? ` → ${o.contracts.join(', ')}` : '')))
      : h('div', { class: 'muted' }, 'Не привязан к заказу.');

    const actions = [];
    if (canAct && inv.status === 'draft') {
      const b = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(b, async () => { await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { issue: true } }); toast('Счёт выставлен'); await after(); }) }, 'Выставить');
      actions.push(b);
    }
    if (canAct && session.canMoney && (inv.status === 'draft' || inv.status === 'issued')) {
      const b = h('button', { class: 'btn', type: 'button', onclick: () => run(b, async () => { await api(`/supply/invoices/${inv.id}/pay`, { method: 'POST' }); toast('Счёт оплачен'); await after(); }) }, 'Счёт оплачен');
      actions.push(b);
    }
    if (checks.size) {
      const b = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(b, async () => {
        const ids = [...checks].filter(([, c]) => c.checked).map(([id]) => id);
        if (!ids.length) { toast('Отметьте позиции, которые приехали'); return; }
        try {
          await api(`/supply/invoices/${inv.id}/receive`, { method: 'POST', body: { requestIds: ids } });
        } catch (e) {
          if (e?.status === 409) { toast('Эти позиции уже приняты на склад. Список обновлён.', { error: true }); await refresh(); await after(); return; }
          throw e;
        }
        toast(`Принято на склад: ${ids.length}`); await after();
      }) }, 'Принять на склад');
      actions.push(b);
    }
    if (inv.status === 'draft' && !actions.length) { /* только просмотр */ }

    return h('div', { class: 'inv-body' },
      reqs.length ? list : h('div', { class: 'muted' }, 'В счёте нет позиций.'),
      pending.length && checks.size ? h('div', { class: 'muted' }, 'Галочки — что приехало. По умолчанию все неполученные.') : null,
      files, chain,
      actions.length ? h('div', { class: 'inv-actions' }, ...actions) : null);
  }

  load();

  return {
    el,
    reload: load,
    update: () => {},
    focusSearch: () => q.focus(),
    destroy: () => { seq++; clearTimeout(timer); },
  };
}
