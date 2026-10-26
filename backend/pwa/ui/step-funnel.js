import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { busyBlock } from './busy.js';

/**
 * Воронка по шагам (Б2, по образцу склада — facet-filter inlineFilter): для левой панели списка (L.sidebar, toolbarExtra).
 * Каждый шаг — свой параметр адреса (category, year…). Выбранные шаги — строками «Год: 2026 ×» сверху; ниже — не выбранные,
 * первый раскрыт («следующий шаг»), остальные свёрнуты; у вариантов — число записей при уже выбранном (считает сервер).
 *   stepFunnel({ steps: [{ key, label, when?(P) }], load: async (P) → { [key]: [{ value, label?, n }] } }) → { el, update(P) }
 * when(P) — шаг виден только при условии (месяц — после года). Выбор — один в шаге, повторный клик снимает.
 */
export function stepFunnel({ steps, load, title = 'Уточнить' }) {
  let P = {}; let seq = 0;
  const folded = new Map();
  const crumbs = h('div', { class: 'ff-crumbs', hidden: true });
  const body = h('div', { class: 'ff-body' });
  const el = h('div', { class: 'ff ff-inline' }, h('div', { class: 'ls-h' }, title), crumbs, body);
  const set = (k, v) => patch({ [k]: String(P[k] ?? '') === String(v) ? undefined : String(v), page: undefined });
  async function render() {
    const my = ++seq;
    if (!body.children.length) body.replaceChildren(busyBlock('', { cls: 'muted small' }));
    let data;
    try { data = await load(P); } catch { data = {}; }
    if (my !== seq) return;
    const fk = document.activeElement?.dataset?.fk;
    const vis = steps.filter((s) => !s.when || s.when(P));
    const label = (s, v) => (data[s.key] || []).find((o) => String(o.value) === String(v))?.label ?? v;
    const chosen = vis.filter((s) => P[s.key]);
    crumbs.hidden = !chosen.length;
    crumbs.replaceChildren(...chosen.map((s) => h('button', { type: 'button', class: 'ff-step', title: 'Убрать: ' + s.label, 'data-fk': 'x:' + s.key, onclick: () => set(s.key, P[s.key]) },
      h('span', { class: 'ff-step-l' }, s.label), h('span', { class: 'ff-step-v' }, String(label(s, P[s.key]))), h('span', { class: 'ff-step-x', 'aria-hidden': 'true' }, '×'))));
    let first = true;
    const groups = vis.filter((s) => !P[s.key]).map((s) => {
      const vals = data[s.key] || [];
      if (vals.length < 2) return null; // один вариант — выбирать нечего
      const open = folded.has(s.key) ? folded.get(s.key) : first;
      first = false;
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + s.key, 'aria-expanded': String(open), onclick: () => { folded.set(s.key, !open); render(); } },
          h('span', { class: 'ff-gl' }, s.label), h('span', { class: 'ff-gn' }, String(vals.length)), h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        open ? h('div', { class: 'ff-checks', role: 'radiogroup', 'aria-label': s.label }, ...vals.map((o) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'sf-' + s.key, 'data-fk': 'v:' + s.key + ':' + o.value, onclick: (e) => { e.preventDefault(); set(s.key, o.value); } }),
          h('span', { class: 'ff-cv' }, String(o.label ?? o.value)), h('b', { class: 'ff-cn' }, String(o.n))))) : null);
    }).filter(Boolean);
    body.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted small' }, chosen.length ? 'Уточнять больше нечего' : 'Вариантов нет')]));
    if (fk) [...el.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === fk)?.focus({ preventScroll: true });
  }
  return { el, update: (next) => { P = { ...next }; render(); } };
}
