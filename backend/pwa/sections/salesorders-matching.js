import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { attachCombo } from '../ui/combo.js';
import { toast, toastError } from '../ui/toast.js';
import { current, patch } from '../core/router.js';

/**
 * Правая панель «Сопоставление» (`?of=matching&open=<id договора>`): позиции договора ↔ изделия из продукции.
 * Сервер: GET /matching/suggest, POST /matching/confirm | none | bulk. Менять могут admin и manager; остальные — только просмотр.
 */
const STATE = {
  confirmed: { label: 'Подтверждено', tone: 'ok' },
  none: { label: 'Не изделие', tone: 'dim' },
  legacy: { label: 'Сопоставлено раньше', tone: 'ok' },
  auto: { label: 'Подобрано, ждёт подтверждения', tone: 'warn' },
  unmatched: { label: 'Не сопоставлено', tone: 'danger' },
};
const canWrite = () => ['admin', 'manager'].includes(session.role) || session.user?.isOwner === true;
const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));

let productsCache = null;
const products = () => (productsCache ??= api('/showcase', { query: { limit: 500 } }).then((r) => (r.items || []).map((p) => ({ value: String(p.id), label: p.name || p.title || '—', sub: p.sku || p.article || '' }))).catch((e) => { productsCache = null; throw e; }));

/** Кнопка «Сопоставлено N из M» → бейдж для списка договоров. */
export function matchBadge(r) {
  const total = r.lineCount ?? 0;
  const done = r.matchedCount ?? 0;
  if (!total) return null;
  return h('span', { class: 'badge ' + (done >= total ? 'ok' : 'warn') }, `сопоставлено ${qty(done)} из ${qty(total)}`);
}

/** Открыть панель сопоставления договора. */
export function openMatching(patch, orderId) { patch({ of: 'matching', open: orderId, new: undefined }, { replace: false }); }

function lineRow(it, run, write) {
  const st = STATE[it.state] || STATE.unmatched;
  const acts = h('div', { class: 'mt-acts' });
  const pickBox = h('div', { class: 'mt-pick', hidden: true });
  const confirm = (productId) => run(() => api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId } }));
  const sugg = (it.suggestions || []).slice(0, 3);
  const sugList = !it.matched && sugg.length
    ? h('ul', { class: 'mt-sug' }, sugg.map((s) => h('li', null,
      h('div', { class: 'mt-sug-main' }, h('b', null, s.name), s.sku ? h('span', { class: 'muted' }, ' · ' + s.sku) : null, h('div', { class: 't-sub' }, `${qty(s.percent)}% · ${s.label || ''}`)),
      write ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: (e) => confirm(s.productId) && e.currentTarget.classList.add('is-busy') }, 'Подтвердить') : null)))
    : null;
  if (write) {
    if (it.state === 'auto' && it.productId) acts.append(h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => confirm(it.productId) }, 'Подтвердить'));
    const input = h('input', { type: 'search', placeholder: 'Название или артикул изделия', 'aria-label': 'Поиск изделия' });
    let ready = false;
    acts.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
      pickBox.hidden = !pickBox.hidden;
      if (pickBox.hidden || ready) return;
      ready = true;
      try {
        const opts = await products();
        pickBox.replaceChildren(h('label', { class: 'field' }, input));
        attachCombo(input, { options: () => opts, onPick: (o) => confirm(o.value), free: false, empty: () => 'Такого изделия нет' });
        input.focus();
      } catch (e) { ready = false; toastError(e, 'загрузить изделия'); }
    } }, 'Выбрать другое изделие'));
    // подходящего нет — создать изделие из названия позиции; после «Создать» позиция сопоставляется с ним и панель возвращается сюда
    acts.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
      const { createProductFor } = await import('./products.js'); // форма изделия — только по нажатию (не грузим при старте)
      const back = { of: current().params.of, open: current().params.open };
      createProductFor({ name: it.title, unit: it.unit || 'шт' }, async (prod) => {
        try { await api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId: prod.id } }); toast('Изделие создано и сопоставлено'); } catch (e) { toastError(e, 'сопоставить с новым изделием'); }
        patch({ ...back, new: undefined });
      });
    } }, '+ Изделие'));
    if (it.state !== 'none') acts.append(h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => run(() => api('/matching/none', { method: 'POST', body: { lineId: it.lineId } })) }, 'Не изделие (монтаж, доставка)'));
  }
  return h('li', { class: 'mt-row' + (it.matched ? '' : ' mt-open') },
    h('div', { class: 'mt-head' },
      h('div', { class: 'mt-title' }, (it.lineNo != null ? `поз. ${it.lineNo} · ` : '') + it.title),
      h('div', { class: 't-sub' }, `${qty(it.qty)} ${it.unit || ''}`.trim())),
    h('div', { class: 'mt-state' }, h('span', { class: 'badge ' + st.tone }, st.label), it.matched && it.productName && it.state !== 'none' ? h('span', { class: 'muted' }, ' → ' + it.productName) : null),
    sugList, acts.childNodes.length ? acts : null, pickBox);
}

export const matching = {
  id: 'matching',
  title: 'Сопоставление',
  get: async (id) => {
    const d = await api('/matching/suggest', { query: { orderId: id } });
    return { ...d, id };
  },
  card: {
    heading: (r) => `Договор ${r.orderNo || '—'}`,
    subheading: (r) => r.customer || 'Сопоставление позиций с продукцией',
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => {
      const write = canWrite();
      const items = r.items || [];
      const run = async (fn) => { try { await fn(); changed(); ctx.reload(); } catch (e) { toastError(e, 'сохранить сопоставление'); } };
      const sure = items.filter((x) => x.confident && x.state !== 'confirmed' && x.state !== 'none' && (x.suggestions?.[0]?.productId || x.productId));
      const bulk = write && sure.length
        ? h('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => { e.currentTarget.classList.add('is-busy'); run(() => api('/matching/bulk', { method: 'POST', body: { items: sure.map((x) => ({ lineId: x.lineId, productId: x.suggestions?.[0]?.productId || x.productId })) } })); } }, `Подтвердить все уверенные (${sure.length})`)
        : null;
      return h('div', { class: 'mt' },
        h('div', { class: 'mt-top' }, h('b', null, `Сопоставлено ${qty(r.matched ?? 0)} из ${qty(r.total ?? items.length)}`), r.unmatched ? h('span', { class: 'muted' }, ` · осталось ${qty(r.unmatched)}`) : null),
        write ? null : h('p', { class: 'hint' }, 'Только просмотр: сопоставлять могут администратор и менеджер.'),
        bulk,
        items.length ? h('ul', { class: 'mt-list' }, items.map((it) => lineRow(it, run, write))) : h('p', { class: 'muted' }, 'В договоре нет позиций.'));
    },
  },
};
