import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, plural, qty } from '../core/format.js';
import { toast, toastError } from '../ui/toast.js';
import { issueDialog } from './issue.js';
import { errText } from '../ui/errors.js';

/*
 * «Активные брони» в «Операциях → Бронь по списку» (TASKS МВ.4, Б.2, Б.3).
 * Строка брони раскрывается — путь целиком: кто поставил, под какой заказ, что забронировано и сколько уже выдано,
 * кому выдавали, заявки на недостающее. «Выдать всё» / «выдать» — списание по брони (кому выдано), «Отменить» — вернуть.
 */
const REQ = { in_progress: 'ожидает', requested: 'заказать', ordered: 'в работе', received: 'получено', cancelled: 'отменено' };

export function reservationsPanel({ onChange }) {
  const el = h('section', { class: 'panel ops-arrivals', hidden: true });
  const changed = async () => { await onChange(); await load(); window.dispatchEvent(new CustomEvent('data-changed')); };

  async function issue(title, lines) {
    try {
      const r = await issueDialog(title, lines);
      if (!r) return;
      toast(`Выдано со склада: ${r.issued} ${plural(r.issued, 'позиция', 'позиции', 'позиций')}`, {
        undo: async () => { await api(`/stock/batch/${r.batchId}/cancel`, { method: 'POST' }); toast('Выдача отменена, бронь возвращена'); await changed(); },
      });
      await changed();
    } catch (e) { toastError(e); }
  }

  /** Раскрытая бронь: подробности грузятся по требованию. */
  function detail(g, box) {
    const key = g.batchId || g.lines[0]?.id;
    api(`/stock/reservations/group/${key}`).then((d) => {
      const so = d.salesOrder;
      box.replaceChildren(...[
        h('div', { class: 'res-meta muted' }, [d.createdBy && `поставил: ${d.createdBy}`, d.createdAt && date(d.createdAt)].filter(Boolean).join(' · '),
          so ? [' · под заказ ', h('a', { href: '#salesorders?open=' + so.id }, so.label || 'заказ'), so.customer ? ` (${so.customer})` : ''] : ''),
        ...d.lines.map((l) => h('div', { class: 'ops-res-line' }, h('span', { class: 'clip', title: l.name }, l.name),
          h('span', { class: 'num' }, l.left ? `${qty(l.left)} ${l.unit}` : 'выдано'),
          h('span', { class: 'muted num small' }, l.issued ? `выдано ${qty(l.issued)}` : ''),
          session.canEdit && l.canIssue ? h('span', { class: 'res-acts' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => issue(`Выдать: ${l.name}`, [{ id: l.id, name: l.name, unit: l.unit, qty: l.left }]) }, 'выдать'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => { await api(`/stock/reservations/${l.id}/release`, { method: 'POST' }); toast('Бронь снята'); await changed(); } }, 'снять')) : h('span'))),
        d.issues.length ? h('div', null, h('div', { class: 'section-title' }, 'Выдано'),
          h('ul', { class: 'timeline' }, ...d.issues.map((x) => h('li', null, h('span', { class: 'when' }, date(x.date)), `${x.name} — ${qty(x.qty)} ${x.unit}`, h('span', { class: 'muted' }, x.to ? ` · ${x.to}` : ' · кому — не указано'))))) : null,
        d.requests.length ? h('div', null, h('div', { class: 'section-title' }, 'Заказано недостающее'),
          h('ul', { class: 'timeline' }, ...d.requests.map((x) => h('li', null, h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? ''} ${x.title}`), h('span', { class: 'muted' }, ` · ${qty(x.qty)} ${x.unit} · ${REQ[x.status] || x.status}`))))) : null].filter(Boolean));
    }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, 'Не загрузилось: ' + errText(e))));
  }

  async function load() {
    let res; try { res = await api('/stock/reservations'); } catch { el.hidden = true; return; }
    el.hidden = !res.items.length;
    el.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', null, `Активные брони: ${res.items.length}`), h('span', { class: 'muted small' }, 'Откройте бронь — кто поставил, что выдано и кому. «Выдать» — списание по брони; «Снять» — товар снова свободен')),
      h('div', { class: 'ops-arr-list' }, ...res.items.map((g) => {
        const box = h('div', { class: 'res-detail' }, h('span', { class: 'skel', style: { width: '40%' } }));
        const det = h('details', { class: 'ops-res', ontoggle: (e) => { if (e.target.open && !box.dataset.loaded) { box.dataset.loaded = '1'; detail(g, box); } } },
          h('summary', null, h('b', null, g.name), h('span', { class: 'muted' }, ` · ${g.lines.length} ${plural(g.lines.length, 'позиция', 'позиции', 'позиций')}${g.salesOrder ? ' · ' + g.salesOrder : ''}${g.createdBy ? ' · ' + g.createdBy : ''}${g.createdAt ? ' · ' + date(g.createdAt) : ''}`),
            session.canEdit ? h('span', { class: 'res-acts' },
              h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.preventDefault(); issue(`Выдать всю бронь «${g.name}»`, g.lines.map((l) => ({ id: l.id, name: l.name, unit: l.unit, qty: l.qty }))); } }, 'Выдать всё'),
              g.batchId ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => { e.preventDefault(); await api(`/stock/reservations/group/${g.batchId}/release`, { method: 'POST' }); toast(`Бронь «${g.name}» снята`); await changed(); } }, 'Снять всю') : null) : null),
          box);
        return det;
      })));
  }
  return { el, load };
}
