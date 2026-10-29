import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { qty, parseNum } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { opThumb } from '../ui/op-row.js';
import { toast } from '../ui/toast.js';

/**
 * «Требуют заполнения» по категориям (TASKS ТЗ.3–ТЗ.4). Данные — `/api/fill-audit`: группа = что не заполнено,
 * зачем это нужно и какое поле. Клик по строке — карточка справа сразу в правке с подсвеченным полем
 * (of=<раздел>&open=<id>&fill=<поле>, см. ui/card.js markFill). Заполнили и сохранили — строка уходит из списка.
 * Адрес страницы: #fill (все группы) или #fill?g=<ключ> (одна раскрыта).
 */
const openRow = (g, x) => patch({ of: g.section, open: x.id, fill: g.field, new: undefined });

/**
 * Быстрый ввод прямо в строке (группы с `quick`, к показу директорам): у заявки — № счёта, дата, сумма; у позиции заказа — цена → PATCH `quickPath`.
 * Сохранили — строка уходит, число группы уменьшается; полная карточка — кнопка «Открыть».
 */
const QUICK = { invoiceNo: ['№ счёта', 'text'], invoiceDate: ['Дата счёта', 'date'], priceHint: ['Сумма, ₽', 'text'], unitPrice: ['Цена за ед., ₽', 'text'] };
const NUMERIC = new Set(['priceHint', 'unitPrice']);
function quickRow(g, x, done) {
  const v = x.values || {};
  const inputs = Object.fromEntries(g.quick.map((k) => [k, h('input', { type: QUICK[k][1], value: v[k] ?? '', placeholder: QUICK[k][0], 'aria-label': QUICK[k][0], ...(NUMERIC.has(k) ? { inputmode: 'decimal' } : {}), onkeydown: (e) => { if (e.key === 'Enter') save(); } })]));
  const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => save() }, 'Сохранить');
  async function save() {
    const body = {};
    Object.values(inputs).forEach((i) => i.classList.remove('err'));
    for (const k of g.quick) {
      const raw = inputs[k].value.trim();
      if (raw === String(v[k] ?? '')) continue;
      if (NUMERIC.has(k)) { const n = parseNum(raw); if (raw && !(n > 0)) { toast('Сумма и цена — число больше нуля', { error: true }); inputs[k].classList.add('err'); inputs[k].focus(); return; } body[k] = raw ? n : null; } else body[k] = raw || null;
    }
    if (!Object.keys(body).length) { toast(g.quick.includes('unitPrice') ? 'Впишите цену' : 'Впишите № счёта, дату или сумму'); inputs[g.quick[0]].focus(); return; }
    btn.disabled = true;
    try { await api(`${g.quickPath || '/supply/requests'}/${x.id}`, { method: 'PATCH', body }); toast('Сохранено'); done(); }
    catch (e) { toast(e.message || 'Не сохранилось', { error: true }); btn.disabled = false; }
  }
  return h('li', { class: 'q-row fill-qrow' + (x.thumb ? ' has-pic' : '') },
    opThumb(x.thumb),
    h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, x.title), x.sub ? h('div', { class: 'q-sub' }, x.sub) : null,
      h('div', { class: 'fill-quick' }, ...g.quick.map((k) => inputs[k]), btn)),
    h('div', { class: 'q-side' }, h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => openRow(g, x) }, 'Открыть')));
}

function groupBlock(g, open, onToggle, onSaved) {
  const head = h('button', { type: 'button', class: 'fill-head', 'aria-expanded': String(open), onclick: onToggle },
    h('span', { class: 'fill-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
    h('span', { class: 'fill-t' }, h('b', null, g.title), h('span', { class: 'muted' }, g.why)),
    h('span', { class: 'q-n' }, qty(g.count)));
  const body = open ? h('ul', { class: 'q-list' }, ...g.items.map((x) => g.quick?.length ? quickRow(g, x, () => onSaved(g, x)) : h('li', { class: 'q-row' + (x.thumb ? ' has-pic' : ''), tabindex: '0', onclick: () => openRow(g, x), onkeydown: (e) => { if (e.key === 'Enter') openRow(g, x); } },
    opThumb(x.thumb),
    h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, x.title), x.sub ? h('div', { class: 'q-sub' }, x.sub) : null),
    h('div', { class: 'q-side' }, h('span', { class: 'btn btn-sm row-act' }, 'Заполнить')))),
  g.count > g.items.length ? h('li', { class: 'q-empty' }, `Показаны первые ${g.items.length} из ${qty(g.count)}. Заполните эти — список обновится.`) : null) : null;
  return h('section', { class: 'panel fill-group' + (open ? ' open' : '') }, head, body);
}

export function mountFill(params) {
  let data = null;
  let openKey = params.g || '';
  const box = h('div', { class: 'fill-list' }, h('div', { class: 'panel state' }, 'Проверяю, что не заполнено…'));
  const el = h('div', { class: 'fill-page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Требуют заполнения'),
      h('div', { class: 'sub' }, 'Без этих данных неточно считаются деньги и аналитика. Откройте группу → «Заполнить» — карточка откроется сразу на нужном поле. Счёт можно вписать прямо в строке.'))),
    box);
  function render() {
    if (!data.groups.length) { box.replaceChildren(h('div', { class: 'panel state' }, 'Всё заполнено — аналитика и деньги считаются полностью 👍')); return; }
    const areas = [...new Set(data.groups.map((g) => g.area))];
    box.replaceChildren(...areas.flatMap((a) => [h('h3', { class: 'fill-area' }, a),
      ...data.groups.filter((g) => g.area === a).map((g) => groupBlock(g, openKey === g.key, () => { openKey = openKey === g.key ? '' : g.key; patch({ g: openKey || undefined }); render(); }, saved))]));
  }
  // строка сохранена — убрать её сразу, не дожидаясь перечитывания (другие поля строки могли остаться пустыми — тогда она вернётся)
  function saved(g, x) {
    g.items = g.items.filter((i) => i !== x); g.count = Math.max(0, g.count - 1); data.total = Math.max(0, data.total - 1);
    if (!g.count) data.groups = data.groups.filter((i) => i !== g);
    render(); reload();
  }
  async function reload() {
    try { data = await api('/fill-audit', { query: { limit: 50 } }); render(); }
    catch (e) { box.replaceChildren(failBlock(e, () => reload(), { cls: 'panel state' })); }
  }
  reload();
  return { el, reload, update: (p) => { if ((p.g || '') !== openKey) { openKey = p.g || ''; if (data) render(); } } };
}

/** Блок для «Сегодня»: самые большие группы с числами — «чем заняться сегодня»; клик — к заполнению. */
export function fillToday() {
  const list = h('ul', { class: 'q-list' }, h('li', { class: 'q-empty' }, h('span', { class: 'skel', style: { width: '50%' } })));
  const n = h('span', { class: 'q-n', hidden: true });
  const el = h('section', { class: 'panel queue', id: 'q-fill' },
    h('header', { class: 'q-head' }, h('div', null, h('h3', null, 'Требуют заполнения ', n), h('div', { class: 'q-hint' }, 'Чем заняться: дозаполнить — и деньги с аналитикой посчитаются верно')),
      h('a', { href: '#fill', class: 'q-link' }, 'Все →')), list);
  const load = () => api('/fill-audit', { query: { limit: 1 } }).then((r) => {
    n.hidden = !r.total; n.textContent = qty(r.total);
    if (!r.groups.length) { list.replaceChildren(h('li', { class: 'q-empty' }, 'Всё заполнено 👍')); return; }
    const top = [...r.groups].sort((a, b) => b.count - a.count).slice(0, 5);
    list.replaceChildren(...top.map((g) => h('li', { class: 'q-row', tabindex: '0', onclick: () => go('fill', { g: g.key }) },
      h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, g.title), h('div', { class: 'q-sub' }, [g.area, g.why].join(' · '))),
      h('div', { class: 'q-side' }, h('span', { class: 'num' }, qty(g.count))))),
    r.groups.length > top.length ? h('li', { class: 'q-empty' }, `ещё групп: ${r.groups.length - top.length} — «Все →»`) : '');
  }).catch((e) => list.replaceChildren(failBlock(e, null, { tag: 'li', cls: 'q-empty' })));
  return { el, load };
}
