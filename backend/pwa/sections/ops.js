import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, plural } from '../core/format.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

/* Приёмка машины по счёту — блок «Ждём поставку» в правой панели «Принять» (sections/stock-ops.js). Раздел «Операции» упразднён (SK-4b). */
export function arrivalsBlock(onDone) {
  const box = h('section', { class: 'panel ops-arrivals' });
  async function load() {
    let res;
    try { res = await api('/supply/requests', { query: { status: 'ordered,paid', limit: 500 } }); }
    catch { box.hidden = true; return; }
    const groups = new Map();
    for (const r of res.items) {
      const inv = String(r.invoiceNo || '').replace(/^\s*сч[её]т\s*№?\s*/i, '').trim();
      const key = (inv ? 'Счёт № ' + inv : 'Без номера счёта') + ' · ' + (r.supplierName || 'поставщик не указан');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    box.hidden = !groups.size;
    box.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', null, `Ждём поставку: ${groups.size} ${plural(groups.size, 'счёт', 'счёта', 'счетов')}`),
        h('span', { class: 'muted small' }, 'Приехала машина — найдите счёт и примите всё разом')),
      h('div', { class: 'ops-arr-list' }, ...[...groups].map(([key, rs]) => h('div', { class: 'ops-arr' },
        h('div', { class: 'ops-name' }, h('div', { class: 'clip' }, key),
          h('small', null, rs.slice(0, 3).map((r) => r.title).join(' · ') + (rs.length > 3 ? ` · ещё ${rs.length - 3}` : ''))),
        h('span', { class: 'muted small nowrap' }, `${rs.length} ${plural(rs.length, 'позиция', 'позиции', 'позиций')}`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => acceptGroup(key, rs) }, 'Принять…')))));
  }
  async function acceptGroup(key, rs) {
    if (await acceptRequests('Приёмка: ' + key, rs)) { await load(); onDone(); }
  }
  box.hidden = true;
  return { el: box, load };
}

/** Принять несколько заявок разом: галочка — приехало, количество правится. Возвращает, сколько принято. */
export async function acceptRequests(title, rs) {
    const rows = rs.map((r) => ({ r, on: h('input', { type: 'checkbox', checked: true }), q: h('input', { inputmode: 'decimal', value: String(r.qty ?? ''), class: 'ops-arr-q' }) }));
    const done = await modal({
      title,
      okText: 'Принять отмеченное',
      body: h('div', null,
        h('p', { class: 'hint' }, 'Снимите галочку с того, что не приехало; поправьте количество, если пришло меньше. Отмеченное поступит на склад, заявки станут «Получено».'),
        h('div', { class: 'ops-arr-dlg' }, ...rows.map(({ r, on, q }) => h('label', { class: 'ops-arr-row' }, on,
          h('span', { class: 'ops-name' }, h('span', { class: 'clip' }, r.title), h('small', null, [r.paid ? 'оплачено' : 'не оплачено', r.orderLabel].filter(Boolean).join(' · '))),
          q, h('span', { class: 'ops-unit' }, r.unit || ''))))),
      onOk: async () => {
        const pickd = rows.filter((x) => x.on.checked).map((x) => ({ r: x.r, n: parseNum(x.q.value) }));
        if (!pickd.length) throw new Error('Ничего не отмечено');
        const bad = pickd.find((x) => !(x.n > 0));
        if (bad) throw new Error(`Укажите количество для «${bad.r.title}»`);
        let ok = 0;
        for (const x of pickd) {
          await api(`/supply/requests/${x.r.id}/receive`, { method: 'POST', body: { qty: x.n, clientUid: 'arr-' + x.r.id + '-' + x.n } });
          ok++;
        }
        return ok;
      },
    });
    if (done) toast(`Принято на склад: ${done} ${plural(done, 'позиция', 'позиции', 'позиций')}`);
    return done || 0;
}
