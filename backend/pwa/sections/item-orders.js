import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { resetStock, stockLookup } from '../core/stock-list.js';
import { modal } from '../ui/kit/dialog.js';
import { enhanceSelect, button, qtyInput, select, section, stack } from '../ui/kit/index.js';
import { toast } from '../ui/kit/toast.js';

/*
 * «Уже заказано» по позиции склада (TASKS ЗП): блок «Заказано» и «Поставщики и цены» в карточке (ЗП.1, ЗП.5),
 * предупреждение против второго заказа (ЗП.3), закрытие заявки приходом (ЗП.4). Сервер: GET /stock/items/:id/ordered.
 */
export const ordered = (id) => api(`/stock/items/${id}/ordered`);

/** Блоки карточки: «Заказано (в пути N)» и «Поставщики и цены». */
export function orderedBlock(r) {
  const box = stack(section({ tone: 'who', title: 'Заказано', body: busyBlock('', { tag: 'p', cls: 'muted' }) }));

  async function acceptReq(x) {
    const qtyInp = h('input', { inputmode: 'decimal', value: String(x.qty || ''), class: 'field-inp' });
    const saved = await modal({
      title: `Принять на склад: №${x.num ?? '—'}`,
      body: h('div', null,
        h('label', { class: 'field' }, h('span', null, `Количество${x.unit ? ', ' + x.unit : ''}`), qtyInp),
        h('p', { class: 'hint' }, 'Позиция поступит на склад, заявка станет «Получено».')),
      okText: 'Принять на склад',
      onOk: async () => {
        const n = Number(String(qtyInp.value).replace(',', '.').replace(/\s/g, ''));
        if (!(n > 0)) throw new Error('Укажите количество больше нуля');
        return api(`/supply/requests/${x.id}/receive`, { method: 'POST', body: { qty: n, toStock: true, materialId: r.id, costCenter: 'workshop' } });
      },
    });
    if (saved) { toast('Принято на склад'); window.dispatchEvent(new CustomEvent('data-changed')); load(); }
  }

  function load() {
    ordered(r.id).then((d) => {
      const was = [...box.querySelectorAll('details.k-sec')].map((el) => el.open);
      box.replaceChildren(...[
        section({ tone: 'who', title: 'Заказано', count: d.open.length, open: was[0] ?? d.open.length > 0, body: [
        d.open.length ? h('p', { class: 'hint' }, `В пути ${qty(d.inTransit)} ${r.unit || ''}`) : null,
        d.open.length ? h('ul', { class: 'timeline' }, ...d.open.map((x) => {
          const canAccept = x.status === 'ordered' || x.paid;
          return h('li', null,
            h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? '—'}`), h('span', { class: 'num' }, `${qty(x.qty)} ${x.unit}`), h('span', null, x.statusLabel),
            h('span', { class: 'muted' }, [x.invoiceDate ? 'счёт ' + date(x.invoiceDate) : x.requestDate ? 'заявка ' + date(x.requestDate) : '', x.supplier, x.requestedBy].filter(Boolean).join(' · ')),
            canAccept ? button({ label: 'Принять на склад', kind: 'primary', size: 'S', onClick: () => acceptReq(x) }) : null);
        }))
          : h('p', { class: 'muted small' }, 'Открытых заявок нет. ', h('a', { href: '#requests?q=' + encodeURIComponent(r.name) }, 'Все заявки по позиции →'))] }),
        d.suppliers.length ? section({ tone: 'money', title: 'Поставщики и цены', count: d.suppliers.length, open: was[1] || false, body:
          h('ul', { class: 'timeline' }, ...d.suppliers.map((s) => h('li', null, h('span', null, s.name), h('span', { class: 'muted' }, `брали ${s.count} раз${s.lastDate ? ' · последний ' + date(s.lastDate) : ''}`),
            session.canMoney && s.lastPrice ? h('span', { class: 'num' }, money(s.lastPrice) + ' / ' + (r.unit || 'шт')) : null))) }) : null].filter(Boolean));
    }).catch((e) => box.replaceChildren(section({ tone: 'who', title: 'Заказано', open: true, body: failBlock(e, load, { text: 'Заказы не загрузились' }) })));
  }

  load();
  return box;
}

const num = (v) => Number(String(v ?? '').replace(',', '.').replace(/\s/g, ''));
const OTHER = '__other';

/** Сколько заказать по умолчанию: добрать до минимума, иначе как в прошлый раз, иначе 1. */
export function suggestQty(r, last) {
  const need = (Number(r.minQuantity) || 0) - (Number(r.free ?? r.quantity) || 0);
  if (need > 0) return Math.ceil(need * 1000) / 1000;
  return Number(last) > 0 ? Number(last) : 1;
}

/**
 * «Заказать» со склада (пользователь 2026-11-06: «нажал — не все данные подставляются, много лишнего; нужен быстрый заказ,
 * если брали у нескольких — предложить, у кого»). Окно в 2–3 поля: количество, поставщик из прошлых закупок
 * (чаще и свежее — первым, с последней ценой), сумма по этой цене. «Создать заявку» — сразу, позиция склада привязана.
 * «Полная форма…» — та же заявка в правой панели со всеми подставленными полями. Уже есть открытая заявка — предупреждение (ЗП.3).
 */
export async function orderItem(r) {
  const d = await ordered(r.id).catch(() => ({ open: [], suppliers: [], inTransit: 0 }));
  const sups = (d.suppliers || []).filter((s) => s.name && s.name !== 'Поставщик не указан')
    .sort((a, b) => b.count - a.count || new Date(b.lastDate || 0) - new Date(a.lastDate || 0));
  const unit = r.unit || 'шт';
  const qtyBox = qtyInput({ value: String(suggestQty(r, sups[0]?.lastQty)), label: 'Количество', plusLabel: 'Ещё 1' });
  const qtyInp = qtyBox.input;
  const sel = select({ label: 'Поставщик', options: [
    ...sups.map((s) => [s.name, `${s.name} · брали ${s.count} раз${s.lastDate ? ', ' + date(s.lastDate) : ''}${session.canMoney && s.lastPrice ? ' · ' + money(s.lastPrice) + ' / ' + unit : ''}`]),
    [OTHER, sups.length ? 'Другой поставщик… (полная форма)' : 'Указать поставщика… (полная форма)'], ['', 'Пока без поставщика']] });
  sel.value = sups[0]?.name ?? ''; enhanceSelect(sel);
  const sumNote = h('p', { class: 'hint' });
  const price = () => sups.find((s) => s.name === sel.value)?.lastPrice ?? null;
  const paint = () => {
    const p = price(), n = num(qtyInp.value);
    sumNote.textContent = session.canMoney && p && n > 0 ? `Сумма по прошлой цене ≈ ${money(Math.round(p * n * 100) / 100)} — уточните по счёту` : '';
  };
  qtyInp.addEventListener('input', paint); paint();
  const supplier = () => (sel.value === OTHER ? '' : sel.value);
  const body = () => {
    const n = num(qtyInp.value);
    if (!(n > 0)) throw new Error('Укажите количество больше нуля');
    const p = price();
    return { materialId: r.id, qty: n, unit, requestedBy: session.name, requestDate: isoDay(),
      ...(supplier() ? { supplierName: supplier() } : {}), ...(session.canMoney && p ? { priceHint: Math.round(p * n * 100) / 100 } : {}) };
  };
  let full = false;
  const openFull = (e) => { full = true; (e.currentTarget || e.target).closest('.modal')?.querySelector('.modal-foot .btn:not(.btn-primary)')?.click(); };
  sel.addEventListener('change', (e) => { if (sel.value === OTHER) openFull(e); else paint(); }); // другой поставщик — в полной форме (там список с поиском)
  const warn = d.open?.length ? h('div', { class: 'warn-note' },
    h('p', null, `Уже заказано ${qty(d.inTransit)} ${unit}: `, ...d.open.slice(0, 3).flatMap((x, i) => [i ? ', ' : '', h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? '—'} (${x.statusLabel})`)])),
    h('p', { class: 'hint' }, 'Скорее всего, вторая заявка не нужна — откройте заявку и поменяйте количество.')) : null;
  const saved = await modal({
    title: 'Заказать: ' + r.name, okText: 'Создать заявку',
    body: h('div', null, warn,
      h('label', { class: 'field' }, h('span', null, `Количество, ${unit}`), qtyBox),
      h('label', { class: 'field' }, h('span', null, 'Поставщик'), sel),
      sumNote,
      button({ label: 'Полная форма…', kind: 'ghost', size: 'S', title: 'Открыть заявку целиком: приоритет, заказ, примечание', onClick: openFull })),
    onOk: () => api('/supply/requests', { method: 'POST', body: body() }),
  });
  if (saved) { toast(`Заявка №${saved.num ?? ''} создана — «${r.name}», ${qty(saved.qty)} ${unit}`); window.dispatchEvent(new CustomEvent('data-changed')); return; }
  if (!full) return;
  const b = (() => { try { return body(); } catch { return { qty: suggestQty(r) }; } })();
  patch({ of: 'requests', new: '1', open: undefined, materialId: r.id, title: r.name, unit, categoryName: r.categoryName || '', qty: String(b.qty || ''),
    supplierName: b.supplierName || '', priceHint: b.priceHint ? String(b.priceHint) : '' });
}

/** Поле «Закрыть заявку» в окне прихода (ЗП.4): { el, value() → заявка | null }. */
export function receiveField(r, onOnly) {
  if (!(r.ordered > 0)) return null;
  const sel = select({ label: 'Закрыть заявку', options: [['', '— приход без заявки —']] });
  const list = [];
  ordered(r.id).then((d) => { for (const x of d.open) { list.push(x); sel.append(h('option', { value: x.id }, `№${x.num ?? '—'} · ${qty(x.qty)} ${x.unit} · ${x.statusLabel}`)); } if (list.length === 1) { sel.value = list[0].id; onOnly?.(list[0]); } enhanceSelect(sel); }).catch(() => {});
  return { el: h('label', { class: 'field wide' }, h('span', null, 'Закрыть заявку'), sel), value: () => list.find((x) => x.id === sel.value) || null };
}

/**
 * Строка счёта / «Вставить список» (ЗП.3): выбранная позиция уже заказана — предупреждение в строке со ссылкой на заявку.
 * const w = orderedNote(); row.append(w.el); w.check('Болт М8') — после выбора позиции.
 */
export function orderedNote() {
  const el = h('div', { class: 'inv-badge warn-note', hidden: true });
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  async function check(name) {
    el.hidden = true;
    if (!name) return;
    const it = (await stockLookup().catch(() => [])).find((x) => norm(x.name) === norm(name));
    // короткий список склада (/stock/lookup) поля ordered не несёт — тогда спросить «уже заказано» по позиции
    if (!it || (it.ordered !== undefined && !(it.ordered > 0))) return;
    const d = await ordered(it.id).catch(() => null);
    if (!d?.open.length) return;
    el.hidden = false;
    el.replaceChildren(`⚠ Уже заказано ${qty(d.inTransit)} ${it.unit || ''}: `, ...d.open.slice(0, 3).flatMap((x, i) => [i ? ', ' : '', h('a', { href: '#requests?open=' + x.id, target: '_blank', rel: 'noopener' }, `№${x.num ?? '—'} (${x.statusLabel})`)]),
      h('span', { class: 'muted' }, ' — проверьте, не дубль ли это'));
  }
  return { el, check, reset: () => resetStock() };
}
