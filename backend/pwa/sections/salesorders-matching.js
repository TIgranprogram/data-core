import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { attachCombo, similarBox, button, funnel, stack, clamp, table } from '../ui/kit/index.js';
import { posPic } from '../ui/pos-pic.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { current, patch } from '../core/router.js';

/**
 * Правая панель «Сопоставление» (`?of=matching&open=<id договора>`): позиции договора ↔ изделия из продукции.
 * `open=<id договора>.<id позиции>` — только эта позиция, список изделий открыт сразу; после выбора панель закрывается.
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
const products = () => (productsCache ??= api('/showcase', { query: { limit: 500 } }).then((r) => (r.items || []).map((p) => ({ value: String(p.id), label: p.name || p.title || '—', sub: p.sku || p.article || '', type: p.type || '', group: p.group || '' }))).catch((e) => { productsCache = null; throw e; }));

/** Кнопка «Сопоставлено N из M» → бейдж для списка договоров. */
export function matchBadge(r) {
  const total = r.lineCount ?? 0;
  const done = r.matchedCount ?? 0;
  if (!total) return null;
  return h('span', { class: 'badge ' + (done >= total ? 'ok' : 'warn') }, `сопоставлено ${qty(done)} из ${qty(total)}`);
}

/** Открыть панель сопоставления договора; lineId — только одна позиция договора. */
export function openMatching(patch, orderId, lineId) { patch({ of: 'matching', open: lineId ? `${orderId}.${lineId}` : orderId, new: undefined }, { replace: false }); }

/** Панель выезжает: список, открытый в движении, встанет не на месте. Ждём, пока поле замрёт. */
function whenStill(el, fn, last = null, tries = 0) {
  const x = el.getBoundingClientRect().left;
  if ((el.isConnected && x === last) || tries > 20) { fn(); return; }
  setTimeout(() => whenStill(el, fn, x, tries + 1), 50);
}

/** «Тип → Группа → Изделие» воронкой (kit.funnel, П-1) по списку изделий; выбор изделия = onPick(id). */
function funnelOf(opts, onPick) {
  const NONE = 'Без типа';
  const sel = { type: '', group: '' };
  const tally = (list, key) => { const m = new Map(); for (const p of list) { const k = p[key] || ''; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, n], i) => ({ name: k, n, i })); };
  const steps = () => {
    const types = tally(opts, 'type').sort((a, b) => b.n - a.n);
    const ofType = sel.type === '' ? [] : opts.filter((p) => (p.type || NONE) === sel.type);
    const groups = tally(ofType, 'group').filter((g) => g.name);
    const ofGroup = ofType.filter((p) => !sel.group || p.group === sel.group);
    return [
      { key: 'type', label: 'Тип', ask: 'выберите тип оборудования', value: sel.type, values: types.map((t) => ({ id: t.name || NONE, label: t.name || NONE, count: t.n })) },
      { key: 'group', label: 'Группа', ask: 'выберите группу или сразу изделие', optional: true, skip: !groups.length, value: sel.group, values: groups.map((g) => ({ id: g.name, label: g.name, count: g.n })) },
      { key: 'product', label: 'Изделие', ask: 'выберите изделие', value: '', values: ofGroup.map((p) => ({ id: p.value, label: p.label + (p.sub ? ` · ${p.sub}` : '') })) },
    ];
  };
  const f = funnel({ steps: steps(), onChange: (key, id) => {
    if (key === 'product') { if (id) onPick(id); return; }
    if (key === 'type') { sel.type = id; sel.group = ''; } else sel.group = id;
    f.update({ steps: steps() });
  } });
  return f;
}

function lineRow(it, run, write, single) {
  const st = STATE[it.state] || STATE.unmatched;
  const acts = h('div', { class: 'mt-acts' });
  const pickBox = h('div', { class: 'mt-pick', hidden: true });
  const confirm = (productId) => run(() => api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId } }));
  const sugg = (it.suggestions || []).slice(0, 3);
  const sugList = !it.matched && sugg.length
    ? h('ul', { class: 'mt-sug' }, sugg.map((s, i) => h('li', null, posPic(s.photo),
      h('div', { class: 'mt-sug-main' }, h('span', { class: 'muted' }, i ? 'Или: ' : 'Похоже: '), clamp(h('span', null, h('b', null, s.name), s.sku ? h('span', { class: 'muted' }, ' · ' + s.sku) : null), { lines: 2 }), h('div', { class: 't-sub' }, `${qty(s.percent)}% · ${s.label || ''}`)),
      write ? button({ label: 'Да, верно', kind: 'primary', size: 'S', onClick: (e) => { e.currentTarget.classList.add('is-busy'); confirm(s.productId); } }) : null)))
    : null;
  const sim = similarBox({ pickLabel: 'Взять это', onPick: (p) => confirm(p.id) });
  if (write) {
    if (it.state === 'auto' && it.productId) acts.append(button({ label: 'Подтвердить', kind: 'primary', size: 'S', onClick: () => confirm(it.productId) }));
    const input = h('input', { type: 'search', placeholder: 'Название или артикул изделия', 'aria-label': 'Поиск изделия' });
    let ready = false;
    const togglePick = async () => {
      pickBox.hidden = !pickBox.hidden;
      if (pickBox.hidden || ready) return;
      ready = true;
      try {
        const opts = await products();
        const fun = funnelOf(opts, confirm);
        pickBox.replaceChildren(stack(fun.el, h('label', { class: 'field' }, h('span', null, 'или найти по названию'), input))); // kit stack — зазор между воронкой и поиском
        attachCombo(input, { options: () => opts, onPick: (o) => confirm(o.value), free: false, empty: () => 'Такого изделия нет' });
        if (single && !fun.el.querySelector('[data-step]')) whenStill(input, () => { input.focus(); input.click(); });
      } catch (e) { ready = false; toastError(e, 'загрузить изделия'); }
    };
    if (single) togglePick();
    else acts.append(button({ label: 'Выбрать другое изделие', size: 'S', onClick: togglePick }));
    // подходящего нет — создать изделие; сначала всегда проверка похожих (C017), второй клик — «Всё равно создать»
    let warned = false;
    acts.append(button({ label: '+ Изделие', size: 'S', onClick: async (e) => {
      const b = e.currentTarget;
      if (!warned) {
        b.classList.add('is-busy');
        try {
          const found = await sim.load(it.title);
          if (found.length) {
            warned = true;
            b.textContent = 'Всё равно создать';
            toast(`Похожих изделий: ${found.length}. Возьмите существующее или подтвердите создание.`);
            return;
          }
        } catch (err) {
          warned = true;
          b.textContent = 'Создать без проверки';
          toastError(err, 'проверить похожие изделия');
          return;
        } finally { b.classList.remove('is-busy'); }
      }
      const { createProductFor } = await import('./products.js');
      const back = { of: current().params.of, open: current().params.open };
      createProductFor({ name: it.title, unit: it.unit || 'шт' }, async (prod) => {
        try { await api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId: prod.id } }); toast('Изделие создано и сопоставлено'); } catch (err) { toastError(err, 'сопоставить с новым изделием'); }
        patch({ ...back, new: undefined });
      });
    } }));
    if (it.state !== 'none') acts.append(button({ label: 'Не изделие (монтаж, доставка)', kind: 'ghost', size: 'S', onClick: () => run(() => api('/matching/none', { method: 'POST', body: { lineId: it.lineId } })) }));
  }
  return h('li', { class: 'mt-row' + (it.matched ? '' : ' mt-open') },
    h('div', { class: 'mt-head' }, posPic(it.photo),
      h('div', { class: 'mt-head-main' },
        h('div', { class: 'mt-title' }, clamp((it.lineNo != null ? `поз. ${it.lineNo} · ` : '') + it.title, { lines: 3 })),
        h('div', { class: 't-sub' }, `${qty(it.qty)} ${it.unit || ''}`.trim()))),
    h('div', { class: 'mt-state' }, h('span', { class: 'badge ' + st.tone }, st.label), it.matched && it.productName && it.state !== 'none' ? clamp(' → ' + it.productName + (it.productSku ? ` · арт. ${it.productSku}` : ''), { lines: 2, cls: 'muted' }) : null),
    sugList, acts.childNodes.length ? acts : null, write ? sim.el : null, pickBox);
}

/**
 * Весь договор — компактная таблица (2026-11-10, пользователь: «нет номера позиции, куча пустого места, данные хаотично»):
 * № · позиция договора · наше изделие (фото, название, артикул) · статус · «Выбрать / Заменить». Выбор — в виде «одна позиция».
 */
function contractTable(items, orderId, write, run) {
  const sug = (it) => (!it.matched && it.state !== 'none' ? (it.suggestions || [])[0] : null);
  const ourPic = (it) => (it.matched && it.productName && it.state !== 'none' ? posPic(it.productPhoto || it.photo) : sug(it) ? posPic(sug(it).photo) : '');
  const ourCell = (it) => {
    if (it.state === 'none') return h('span', { class: 'muted' }, 'не изделие — монтаж, доставка');
    if (it.matched && it.productName) return h('div', null, clamp(it.productName, { lines: 2 }), it.productSku ? h('div', { class: 't-sub' }, 'арт. ' + it.productSku) : null);
    const s = sug(it);
    if (!s) return h('span', { class: 'muted' }, 'похожих нет — выберите');
    return h('div', null, h('div', { class: 't-sub' }, `Похоже · ${qty(s.percent)}%`), clamp(s.name, { lines: 2 }),
      write ? button({ label: 'Да, верно', kind: 'primary', size: 'S', onClick: (e) => { e.stopPropagation(); e.currentTarget.classList.add('is-busy'); run(() => api('/matching/confirm', { method: 'POST', body: { lineId: it.lineId, productId: s.productId } })); } }) : null);
  };
  const open = (it) => openMatching(patch, orderId, it.lineId);
  return table({
    clickable: write, cls: 'k-table-stack', // на телефоне — строка-карточка, без горизонтальной прокрутки
    columns: [{ label: '№', nowrap: true }, { label: 'Позиция договора', wrap: true }, { label: '', pic: true }, { label: 'Наше изделие', wrap: true }, { label: 'Статус', nowrap: true }, ...(write ? [{ label: '' }] : [])],
    rows: items.map((it, i) => {
      const st = STATE[it.state] || STATE.unmatched;
      return {
        onClick: write ? () => open(it) : undefined,
        cells: [
          { v: it.lineNo ?? i + 1, cls: 'muted' },
          h('div', null, clamp(it.title, { lines: 2 }), h('div', { class: 't-sub' }, `${qty(it.qty)} ${it.unit || ''}`.trim())),
          ourPic(it),
          ourCell(it),
          h('span', { class: 'badge ' + st.tone }, st.label),
          ...(write ? [button({ label: it.matched ? 'Заменить' : 'Выбрать', size: 'S', onClick: (e) => { e.stopPropagation(); open(it); } })] : []),
        ],
      };
    }),
  });
}

export const matching = {
  id: 'matching',
  title: 'Сопоставление',
  get: async (id) => {
    const [orderId, lineId] = String(id).split('.');
    const d = await api('/matching/suggest', { query: { orderId } });
    return { ...d, id, orderId, lineId };
  },
  card: {
    heading: (r) => `Договор ${r.orderNo || '—'}`,
    subheading: (r) => r.customer || 'Сопоставление позиций с продукцией',
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => {
      const write = canWrite();
      const all = r.items || [];
      const one = r.lineId ? all.filter((x) => String(x.lineId) === r.lineId) : [];
      const single = one.length === 1;
      const items = single ? one : all;
      const run = async (fn) => {
        try {
          await fn(); changed();
          if (single) patch({ of: undefined, open: undefined }); else ctx.reload();
        } catch (e) { toastError(e, 'сохранить сопоставление'); }
      };
      const sure = items.filter((x) => x.confident && x.state !== 'confirmed' && x.state !== 'none' && (x.suggestions?.[0]?.productId || x.productId));
      const bulk = write && !single && sure.length
        ? button({ label: `Подтвердить все уверенные (${sure.length})`, kind: 'primary', onClick: (e) => { e.currentTarget.classList.add('is-busy'); run(() => api('/matching/bulk', { method: 'POST', body: { items: sure.map((x) => ({ lineId: x.lineId, productId: x.suggestions?.[0]?.productId || x.productId })) } })); } })
        : null;
      return h('div', { class: 'mt' },
        single
          ? h('div', { class: 'mt-top' }, h('b', null, 'Выбор изделия для позиции'), h('span', { class: 'muted' }, ' · '), button({ label: 'Весь договор', kind: 'ghost', size: 'S', onClick: () => openMatching(patch, r.orderId) }))
          : h('div', { class: 'mt-top' }, h('b', null, `Сопоставлено ${qty(r.matched ?? 0)} из ${qty(r.total ?? items.length)}`), r.unmatched ? h('span', { class: 'muted' }, ` · осталось ${qty(r.unmatched)}`) : null),
        write ? null : h('p', { class: 'hint' }, 'Только просмотр: сопоставлять могут администратор и менеджер.'),
        bulk,
        !items.length ? h('p', { class: 'muted' }, 'В договоре нет позиций.')
          : single ? h('ul', { class: 'mt-list' }, items.map((it) => lineRow(it, run, write, single)))
            : contractTable(items, r.orderId, write, run));
    },
  },
};
