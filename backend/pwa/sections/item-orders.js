import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/busy.js';
import { date, money, qty } from '../core/format.js';
import { patch } from '../core/router.js';
import { resetStock, stockLookup } from '../core/stock-list.js';
import { modal } from '../ui/dialog.js';
import { enhanceSelect } from '../ui/select.js';
import { toast } from '../ui/toast.js';

/*
 * «Уже заказано» по позиции склада (TASKS ЗП): блок «Заказано» и «Поставщики и цены» в карточке (ЗП.1, ЗП.5),
 * предупреждение против второго заказа (ЗП.3), закрытие заявки приходом (ЗП.4). Сервер: GET /stock/items/:id/ordered.
 */
export const ordered = (id) => api(`/stock/items/${id}/ordered`);

/** Блоки карточки: «Заказано (в пути N)» и «Поставщики и цены». */
export function orderedBlock(r) {
  const box = h('div', null, h('div', { class: 'section-title' }, 'Заказано'), busyBlock('', { tag: 'p', cls: 'muted' }));

  async function acceptReq(x) {
    const qtyInp = h('input', { inputmode: 'decimal', value: String(x.qty || ''), class: 'field-inp' });
    const saved = await modal({
      title: `Принять на склад: №${x.num ?? '—'}`,
      body: h('div', null,
        h('label', { class: 'field' }, h('span', null, `Количество${x.unit ? ', ' + x.unit : ''}`), qtyInp),
        h('p', { class: 'hint' }, 'Товар поступит на склад, заявка станет «Получено».')),
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
      box.replaceChildren(...[
        h('div', { class: 'section-title' }, d.open.length ? `Заказано — в пути ${qty(d.inTransit)} ${r.unit || ''}` : 'Заказано'),
        d.open.length ? h('ul', { class: 'timeline' }, ...d.open.map((x) => {
          const canAccept = x.status === 'ordered' || x.paid;
          return h('li', null,
            h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? '—'}`), h('span', { class: 'num' }, `${qty(x.qty)} ${x.unit}`), h('span', null, x.statusLabel),
            h('span', { class: 'muted' }, [x.invoiceDate ? 'счёт ' + date(x.invoiceDate) : x.requestDate ? 'заявка ' + date(x.requestDate) : '', x.supplier, x.requestedBy].filter(Boolean).join(' · ')),
            canAccept ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => acceptReq(x) }, 'Принять на склад') : null);
        }))
          : h('p', { class: 'muted' }, 'Открытых заявок нет. ', h('a', { href: '#requests?q=' + encodeURIComponent(r.name) }, 'Все заявки по позиции →')),
        d.suppliers.length ? h('div', null, h('div', { class: 'section-title' }, 'Поставщики и цены'),
          h('ul', { class: 'timeline' }, ...d.suppliers.map((s) => h('li', null, h('span', null, s.name), h('span', { class: 'muted' }, `брали ${s.count} раз${s.lastDate ? ' · последний ' + date(s.lastDate) : ''}`),
            session.canMoney && s.lastPrice ? h('span', { class: 'num' }, money(s.lastPrice) + ' / ' + (r.unit || 'шт')) : null)))) : null].filter(Boolean));
    }).catch((e) => box.replaceChildren(failBlock(e, load, { text: 'Заказы не загрузились' })));
  }

  load();
  return box;
}

/** «Заказать» с защитой от дубля (ЗП.3): уже есть открытая заявка — окно «Открыть заявку» / «Всё равно заказать». */
export async function orderItem(r) {
  const go = () => patch({ of: 'requests', new: '1', open: undefined, title: r.name, unit: r.unit || '', categoryName: r.categoryName || '' });
  if (!(r.ordered > 0)) { go(); return; }
  const d = await ordered(r.id).catch(() => null);
  if (!d?.open.length) { go(); return; }
  const first = d.open[0];
  const ok = await modal({
    title: 'Уже заказано', okText: 'Всё равно заказать', cancelText: 'Не заказывать',
    body: h('div', null, h('p', null, `По «${r.name}» уже заказано ${qty(d.inTransit)} ${r.unit || ''}:`),
      h('ul', { class: 'timeline' }, ...d.open.map((x) => h('li', null, h('a', { href: '#requests?open=' + x.id, onclick: () => document.querySelector('.modal-back')?.remove() }, `Открыть заявку №${x.num ?? '—'}`),
        h('span', { class: 'muted' }, `${qty(x.qty)} ${x.unit} · ${x.statusLabel}`)))),
      h('p', { class: 'hint' }, `Скорее всего, вторая заявка не нужна — откройте №${first.num ?? ''} и при необходимости поменяйте количество.`)),
  });
  if (ok) go();
}

/** Поле «Закрыть заявку» в окне прихода (ЗП.4): { el, value() → заявка | null }. */
export function receiveField(r, onOnly) {
  if (!(r.ordered > 0)) return null;
  const sel = h('select', null, h('option', { value: '' }, '— приход без заявки —'));
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
