import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money } from '../core/format.js';
import { INVOICE_STATUS, SUPPLY_STATUS, badge } from '../ui/badges.js';
import { actions, enhanceSelect, empty, modal, openCard, confirmDlg, badge as kitBadge } from '../ui/kit/index.js';

const PARTIAL_TEXT = 'Часть строк скрыта (другой склад)';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';
import { patch } from '../core/router.js';
import { opThumb } from '../ui/op-row.js';
import { canContract, contractView } from './contracts.js';

/**
 * Вкладка «Счета» в «Заявках» (CHAIN-AUDIT З8–З12): список счетов с фильтрами и суммой;
 * клик по строке раскрывает её под собой — позиции, файлы, цепочка «Заказ → договоры», кнопки по состоянию.
 * Сервер: GET /supply/invoices, GET /supply/invoices/:id, PATCH …/:id {issue}, POST …/:id/pay, POST …/:id/receive.
 */
const LIMIT = 30;
const STATUS_OPTS = [['', 'Все статусы'], ['draft', 'Черновик'], ['issued', 'Выставлен'], ['paid', 'Оплачен'], ['cancelled', 'Отменён']];
const cut = (v) => String(v || '').slice(0, 10);
const ruDate = (v) => (v ? isoDay(v).split('-').reverse().join('.') : '—');
const r2 = (n) => Math.round(n * 100) / 100;

/** Окно «Цена позиции»: цена за единицу ↔ сумма строки; amount счёта пересчитывает сервер. */
async function editLine(inv, x, after) {
  const qtyInput = h('input', { type: 'number', step: 'any', min: '0.001', inputmode: 'decimal', value: String(Number(x.qty) || 0) });
  const qty = () => Number(qtyInput.value) || 0;
  const total = Number(x.priceHint) || 0;
  const unit = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: String(qty() > 0 ? r2(total / qty()) : 0) });
  const sum = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', value: String(total) });
  const reason = inv.status === 'paid' ? h('input', { type: 'text', maxlength: '500', placeholder: 'Причина корректировки (обязательно)' }) : null;
  let syncing = false;
  const updateSum = () => { if (syncing) return; syncing = true; sum.value = String(r2((Number(unit.value) || 0) * qty())); syncing = false; };
  const updateUnit = () => { if (syncing) return; syncing = true; unit.value = String(qty() > 0 ? r2((Number(sum.value) || 0) / qty()) : 0); syncing = false; };
  unit.addEventListener('input', updateSum);
  qtyInput.addEventListener('input', updateSum);
  sum.addEventListener('input', updateUnit);
  const field = (key, label, el) => ({ key, label, type: 'widget', wide: true, widget: () => ({ el, get value() { return JSON.stringify(el.value); }, set value(v) { el.value = v ?? ''; } }) });
  return openCard({
    title: 'Позиция счёта', noun: 'позицию', canEdit: () => session.canMoney,
    get: async () => x,
    card: { heading: () => `${x.num ? `№${x.num} · ` : ''}${x.title || x.materialName || 'Позиция счёта'}`, subheading: () => 'Сумма позиции', view: () => [], noHistory: true, startEdit: () => true },
    form: {
      closeAfterCreate: true,
      fields: () => [field('qty', 'Количество', qtyInput), field('unitPrice', 'Цена за единицу, ₽', unit), field('lineAmount', 'Сумма строки, ₽', sum), reason ? field('reason', 'Причина корректировки', reason) : null,
        { note: 'Сумма счёта пересчитается из строк. Цена за единицу = сумма ÷ количество.' }].filter(Boolean),
      toBody: () => {
      const u = Number(unit.value);
      const lineAmount = Number(sum.value);
      if (!Number.isFinite(u) || u < 0) throw new Error('Цена не может быть отрицательной');
      if (!Number.isFinite(lineAmount) || lineAmount < 0) throw new Error('Сумма строки не может быть отрицательной');
      if (!(qty() > 0)) throw new Error('Количество должно быть больше нуля');
      if (reason && !reason.value.trim()) throw new Error('Укажите причину корректировки оплаченного счёта');
      // Сумма всей строки — источник истины: 100 / 3 нельзя заново сохранять как 33.33 × 3 = 99.99.
      return { lineAmount, qty: qty(), ...(reason ? { reason: reason.value.trim() } : {}), ...(inv.version != null ? { version: Number(inv.version) } : {}) };
      },
      update: async (_id, body) => { await api(`/supply/invoices/${inv.id}/lines/${x.id}`, { method: 'PATCH', body }); return { id: x.id }; },
    },
  }, { id: x.id }, { close() {}, changed: () => { Promise.resolve().then(after).catch(toastError); } });
}

export function mountInvoicesTab(params = {}) {
  let focusId = params.open || ''; // #requests?tab=invoices&open=<id счёта> — из уведомления
  const F = { status: '', supplierId: '', q: '', from: '', to: '', contract: '' };
  let page = 1; let seq = 0; let timer = null;
  const openIds = new Set();

  const sel = (opts, key, title) => {
    const s = h('select', { class: 'invl-f', 'aria-label': title, onchange: () => { F[key] = s.value; reload(); } }, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  const statusSel = sel(STATUS_OPTS, 'status', 'Статус');
  const supSel = sel([['', 'Все поставщики']], 'supplierId', 'Поставщик');
  lookups().then((lk) => {
    const list = (lk.suppliers || []).map((s) => (typeof s === 'string' ? [s, s] : [String(s.value ?? s.id), s.label ?? s.name])).filter(([v]) => v);
    supSel.append(...list.map(([v, l]) => h('option', { value: v }, l)));
    enhanceSelect(supSel);
  }).catch(() => {});
  // «Договор»: сервер фильтрует параметром contract=none|has
  const ctrSel = h('select', { class: 'invl-f', 'aria-label': 'Договор поставщика', onchange: () => { F.contract = ctrSel.value; reload(); } },
    h('option', { value: '' }, 'Договор поставщика: все'), h('option', { value: 'has' }, 'Договор поставщика: есть'), h('option', { value: 'none' }, 'Без договора'));
  const q = h('input', { type: 'search', class: 'invl-f', placeholder: 'Поиск: № счёта, поставщик…', oninput: () => { clearTimeout(timer); timer = setTimeout(() => { F.q = q.value.trim(); reload(); }, 300); } });
  const from = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'С даты', onchange: () => { F.from = from.value; reload(); } });
  const to = h('input', { type: 'date', class: 'invl-f', 'aria-label': 'По дату', onchange: () => { F.to = to.value; reload(); } });
  const bar = h('div', { class: 'invl-bar' }, q, statusSel, supSel, ctrSel, h('span', { class: 'invl-period' }, from, h('span', { class: 'muted' }, '—'), to));

  const rows = h('div', { class: 'invl-list' });
  const foot = h('div', { class: 'invl-foot' });
  const el = h('div', { class: 'invl-tab' }, h('p', { class: 'hint' }, 'Счета поставщиков по заявкам. Нажмите на счёт — увидите его позиции.'), bar, rows, foot);

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
      rows.replaceChildren(empty({
        title: filtered ? 'По этим условиям счетов нет' : 'Счетов пока нет',
        hint: filtered ? 'Снимите часть фильтров или измените период.' : 'Счёт появляется, когда заявки переводят в «В работе» (заказано у поставщика). Или нажмите «Счёт без заявок» на вкладке «Заявки».',
      }));
      foot.replaceChildren();
      return;
    }
    rows.replaceChildren(...items.map(rowEl));
    if (focusId) showFocused(items);
    const pages = Math.ceil((r.total || 0) / LIMIT);
    foot.replaceChildren(
      h('div', { class: 'invl-sum' }, `Счетов: ${r.total ?? items.length} · Итого: `, h('b', null, money(r.sum ?? 0))),
      pages > 1 ? h('div', { class: 'invl-pager' },
        h('button', { class: 'btn', type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, '‹ Назад'),
        h('span', { class: 'muted' }, `${page} из ${pages}`),
        h('button', { class: 'btn', type: 'button', disabled: page >= pages, onclick: () => { page++; load(); } }, 'Далее ›')) : null);
  }

  /** Счёт из ссылки: раскрыть; нет на странице — подгрузить и поставить первым. */
  async function showFocused(items) {
    const id = focusId; focusId = '';
    const found = rows.querySelectorAll('.invl-row')[items.findIndex((i) => i.id === id)];
    if (found) { found.querySelector('.invl-head')?.click(); found.scrollIntoView?.({ block: 'center' }); return; }
    try { const inv = await api(`/supply/invoices/${id}`); openIds.add(id); const row = rowEl({ ...inv, id }); rows.prepend(row); row.scrollIntoView?.({ block: 'center' }); } catch { toast('Счёт не найден'); }
  }

  function rowEl(inv) {
    const detail = h('div', { class: 'invl-detail' });
    const head = h('button', { type: 'button', class: 'invl-head', 'aria-expanded': 'false', onclick: () => toggle() },
      h('span', { class: 'invl-chev', 'aria-hidden': 'true' }, '▸'),
      h('span', { class: 'invl-no' }, inv.no ? `№ ${inv.no}` : 'без номера'),
      h('span', { class: 'invl-date muted' }, ruDate(inv.date)),
      h('span', { class: 'invl-sup' }, inv.supplierName || '—'),
      h('span', { class: 'invl-amt num' }, inv.amount > 0 ? money(inv.amount) : '—'),
      badge(INVOICE_STATUS, inv.status),
      contractView(inv),
      inv.partial ? kitBadge(PARTIAL_TEXT, 'warn') : null,
      h('span', { class: 'invl-meta muted' }, [inv.payerName && `платит: ${inv.payerName}`, (inv.orders || []).length && `заказы: ${inv.orders.join(', ')}`, `позиций: ${inv.requestsCount ?? 0}`].filter(Boolean).join(' · ')));
    const box = h('div', { class: 'invl-row' }, head, detail);
    function toggle(force) {
      const on = force ?? !box.classList.contains('open');
      box.classList.toggle('open', on);
      head.setAttribute('aria-expanded', String(on));
      if (on) { openIds.add(inv.id); fill(); } else { openIds.delete(inv.id); detail.replaceChildren(); }
    }
    async function fill() {
      detail.replaceChildren(h('div', { class: 'muted' }, 'Загружаю счёт…'));
      try { detail.replaceChildren(detailEl(await api(`/supply/invoices/${inv.id}`), fill, () => { toggle(false); head.focus(); })); } catch (e) { detail.replaceChildren(h('div', { class: 'err' }, e?.message || 'Не удалось загрузить счёт')); }
    }
    if (openIds.has(inv.id)) toggle(true);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('open') && !document.querySelector('.modal-back')) { e.stopPropagation(); toggle(false); head.focus(); } });
    return box;
  }

  /** Окно «Добавить позиции»: заявки без счёта (В заказ / В работе / Оплачено) этого поставщика; true — добавлено. */
  async function addPositions(inv) {
    const r = await api('/supply/requests', { query: { status: 'requested,in_progress,paid', ...(inv.supplierId ? { supplierId: String(inv.supplierId) } : {}), limit: 200 } });
    const rows = (r.items || []).filter((x) => !x.invoiceId);
    if (!rows.length) { toast('Нет подходящих позиций: нужны заявки «В заказ», «В работе» или «Оплачено» без счёта' + (inv.supplierName ? ` у «${inv.supplierName}»` : '')); return false; }
    const cbs = rows.map((x) => ({ x, cb: h('input', { type: 'checkbox' }) }));
    const reason = inv.status === 'paid' ? h('input', { type: 'text', maxlength: '500', placeholder: 'Причина добавления (обязательно)' }) : null;
    const body = h('div', null,
      h('p', { class: 'muted' }, 'Отметьте позиции — они войдут в этот счёт' + (inv.status === 'paid' ? '. Исходный платёж не изменится; укажите причину для последующей сверки.' : '.')),
      reason ? h('label', { class: 'field' }, h('span', null, 'Причина корректировки'), reason) : null,
      h('ul', { class: 'q-list' }, ...cbs.map(({ x, cb }) => h('li', { class: 'q-row' }, cb,
        h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, (x.num ? `№${x.num} · ` : '') + (x.title || '—')), h('div', { class: 'q-sub' }, `${x.qty ?? ''} ${x.unit || ''}`.trim())),
        h('div', { class: 'q-side' }, Number(x.priceHint) > 0 ? h('span', { class: 'num' }, money(x.priceHint)) : null, badge(SUPPLY_STATUS, x.status === 'ordered' && x.paid ? 'paid' : x.status))))));
    return !!(await modal({ title: 'Добавить позиции в счёт', okText: 'Добавить', wide: true, body, onOk: async () => {
      const ids = cbs.filter(({ cb }) => cb.checked).map(({ x }) => x.id);
      if (!ids.length) throw new Error('Отметьте хотя бы одну позицию');
      if (reason && !reason.value.trim()) throw new Error('Укажите причину добавления к оплаченному счёту');
      await api(`/supply/invoices/${inv.id}/requests`, { method: 'POST', body: { requestIds: ids, ...(reason ? { reason: reason.value.trim() } : {}) } });
      toast(`Добавлено позиций: ${ids.length}`);
      return true;
    } }));
  }

  /** Раскрытая часть: позиции, файлы, цепочка, кнопки. */
  function detailEl(inv, refresh, collapse) {
    const reqs = inv.requests || [];
    const canAct = session.canEdit && inv.status !== 'cancelled';
    const run = async (btn, fn) => { btn.disabled = true; btn.classList.add('is-busy'); try { await fn(); } catch (e) { toastError(e); } finally { btn.disabled = false; btn.classList.remove('is-busy'); } };
    const after = async () => { await load(); };

    const checks = new Map();
    const pending = reqs.filter((x) => x.status !== 'received' && x.status !== 'cancelled');
    // Финансовые поля можно править после оплаты до первой приёмки; первая приёмка фиксирует счёт.
    const finLocked = reqs.some((x) => x.status === 'received');
    const editable = canAct && !finLocked;
    // строки — как операции в «Деньгах» (ui/op-row.js): фото, «№ · название», подпись; клик — заявка справа
    const list = h('ul', { class: 'q-list invl-reqs' }, ...reqs.map((x) => {
      const can = pending.includes(x) && canAct && inv.status !== 'draft';
      let cb = null;
      if (can) { cb = h('input', { type: 'checkbox', class: 'invl-cb', checked: true, 'aria-label': 'Принять позицию' }); checks.set(x.id, cb); }
      // priceHint — сумма по строке, а не цена за штуку (СМ.8)
      const total = Number(x.priceHint) || 0;
      const price = total > 0 && x.qty > 0 ? total / x.qty : 0;
      const sum = total > 0 ? money(total) : '';
      const pic = x.photo || x.materialPhoto;
      const open = () => patch({ of: 'requests', open: x.id });
      const edit = editable ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Изменить цену позиции', 'aria-label': 'Изменить цену позиции', onclick: (e) => { e.stopPropagation(); editLine(inv, x, async () => { await refresh(); await after(); }); } }, 'цена') : null;
      const del = editable && inv.status !== 'paid' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Убрать позицию из счёта', 'aria-label': 'Убрать позицию из счёта', onclick: async (e) => {
        e.stopPropagation();
        const name = (x.num ? `№${x.num} · ` : '') + (x.title || x.materialName || 'позиция');
        if (!(await confirmDlg('Убрать позицию из счёта?', `${name}\n\nЗаявка останется и вернётся в «В заказ». Сумма счёта пересчитается.`, { okText: 'Убрать', danger: true }))) return;
        try { await api(`/supply/invoices/${inv.id}/lines/${x.id}`, { method: 'DELETE' }); toast('Позиция убрана из счёта'); await refresh(); await after(); } catch (err) { toastError(err); }
      } }, '×') : null;
      return h('li', { class: 'q-row' + (pic ? ' has-pic' : ''), tabindex: '0', onclick: (e) => { if (!e.target.closest('input, button')) open(); }, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
        cb, opThumb(pic?.thumb || pic?.url),
        h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, (x.num ? `№${x.num} · ` : '') + (x.title || x.materialName || x.name || '—')),
          h('div', { class: 'q-sub' }, `${x.qty ?? ''} ${x.unit || ''}`.trim() + (price > 0 ? ` × ${money(price)}` : ''))),
        h('div', { class: 'q-side' }, editable ? actions(edit, del) : null, sum ? h('span', { class: 'num' }, sum) : null, badge(SUPPLY_STATUS, x.status === 'ordered' && x.paid ? 'paid' : x.status)));
    }));

    const partialNote = inv.partial ? h('div', { class: 'hint' }, PARTIAL_TEXT + '. Сумма — по строкам, которые вы видите.') : null;
    const paymentNote = session.canMoney && inv.paymentSnapshot ? h('div', { class: 'hint' },
      `Фактически оплачено: ${money(inv.paymentSnapshot.amount)} (${ruDate(inv.paymentSnapshot.paidAt)}). Текущая сумма строк: ${money(inv.amount)}. Изменения после оплаты требуют сверки; они не меняют банковский платёж.`,
      ...(inv.paymentAdjustments || []).map((a) => h('div', { class: 'muted' }, `${ruDate(a.at)} · ${a.reason} · изменение ${money(a.delta)}`))) : null;
    const lockNote = finLocked ? h('div', { class: 'hint' }, 'По счёту уже есть приёмка — сумма и позиции зафиксированы.')
      : inv.status === 'paid' ? h('div', { class: 'hint' }, 'Счёт оплачен; до первой приёмки можно изменить суммы или добавить позиции. Удаление оплаченных строк недоступно.') : null;

    const files = (inv.files || []).length
      ? h('div', { class: 'invl-files' }, h('span', { class: 'muted' }, 'Файлы: '), ...inv.files.map((f) => h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.name || 'файл')))
      : h('div', { class: 'muted' }, 'Файла счёта нет.');

    const chain = (inv.orders || []).length
      ? h('div', { class: 'invl-chain' }, h('span', { class: 'muted' }, 'Заказ → договоры: '), ...inv.orders.map((o) => h('span', { class: 'invl-chain-i' },
        h('a', { href: '#salesorders?q=' + encodeURIComponent(o.productionNo) }, `Заказ № ${o.productionNo}`),
        (o.contracts || []).length ? ` → ${o.contracts.join(', ')}` : '')))
      : h('div', { class: 'muted' }, 'Не привязан к заказу.');

    // договор счёта: «Привязать» открывает заявку счёта справа — там поле «Договор»
    const firstReq = reqs[0]?.id;
    const contractLine = h('div', { class: 'invl-contract' }, h('span', { class: 'muted' }, 'Договор поставщика: '), contractView(inv),
      firstReq && canContract() && inv.status !== 'cancelled' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ of: 'requests', open: firstReq }) }, inv.contractId ? 'Изменить' : 'Привязать') : null);

    const actions = [];
    if (canAct && inv.status === 'draft') {
      const b = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(b, async () => { await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { issue: true } }); toast('Счёт выставлен'); await after(); }) }, 'Выставить');
      actions.push(b);
    }
    if (canAct && session.canMoney && (inv.status === 'draft' || inv.status === 'issued')) {
      const b = h('button', { class: 'btn', type: 'button', onclick: () => run(b, async () => { await api(`/supply/invoices/${inv.id}/pay`, { method: 'POST' }); toast('Счёт оплачен'); await after(); }) }, 'Счёт оплачен');
      actions.push(b);
    }
    if (canAct && !finLocked) {
      const b = h('button', { class: 'btn', type: 'button', onclick: () => run(b, async () => { if (await addPositions(inv)) await after(); }) }, 'Добавить позиции');
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

    return h('div', { class: 'invl-body' },
      partialNote,
      lockNote,
      paymentNote,
      reqs.length ? list : h('div', { class: 'muted' }, 'В счёте нет позиций.'),
      pending.length && checks.size ? h('div', { class: 'muted' }, 'Галочки — что приехало. По умолчанию все неполученные.') : null,
      files, contractLine, chain,
      actions.length ? h('div', { class: 'invl-actions' }, ...actions) : null,
      collapse ? h('button', { class: 'btn btn-ghost invl-collapse', type: 'button', onclick: collapse }, 'Свернуть ▴') : null);
  }

  load();

  return {
    el,
    reload: load,
    update: (p) => { if (p?.open && p.open !== focusId) { focusId = p.open; load(); } },
    focusSearch: () => q.focus(),
    destroy: () => { seq++; clearTimeout(timer); },
  };
}
