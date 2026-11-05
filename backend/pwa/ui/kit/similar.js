import { api } from '../../core/api.js';
import { mark } from './mark.js';
import { h } from '../../core/dom.js';
import { posPic } from '../pos-pic.js';
import { row, sku } from './index.js';

/**
 * similarBox({ onPick, pickLabel? }) → { el, check(name, excludeId) }
 * «Похожее уже есть — может, это оно?»: GET /showcase/similar (до 5), строки kit.row. Название < 3 символов или ничего нет — блок скрыт.
 * onPick(item) — клик по строке; pickLabel — кнопка «Взять это» в строке (тогда клик по строке не нужен, но тоже работает).
 */
export function similarBox({ onPick, pickLabel } = {}) {
  const list = h('div', { class: 'k-sim-list' });
  const el = mark(h('div', { class: 'k-sim', hidden: true }, h('div', { class: 'hint' }, 'Похожее уже есть — может, это оно?'), list), 'similarBox');
  let timer = 0; let seq = 0;
  const paint = (items) => {
    list.replaceChildren(...items.map((it) => row({
      lead: posPic(it.photo, 'sm'), title: [sku(it.sku), it.sku ? ' ' : null, it.name], meta: it.groupName || null, tag: 'div', onClick: () => onPick?.(it),
      action: pickLabel ? h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => { e.stopPropagation(); onPick?.(it); } }, pickLabel) : null,
    })));
    el.hidden = !items.length;
  };
  const check = (name, excludeId) => {
    clearTimeout(timer);
    const q = String(name || '').trim();
    if (q.length < 3) { seq++; paint([]); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const res = await api('/showcase/similar', { query: { name: q, ...(excludeId ? { excludeId } : {}) } });
        if (my === seq) paint((Array.isArray(res) ? res : res?.items || []).slice(0, 5));
      } catch { if (my === seq) paint([]); }
    }, 400);
  };
  /** сразу, без задержки; вернёт найденное (и покажет блок) */
  const load = async (name, excludeId) => {
    const res = await api('/showcase/similar', { query: { name: String(name || '').trim(), ...(excludeId ? { excludeId } : {}) } });
    const items = (Array.isArray(res) ? res : res?.items || []).slice(0, 5);
    seq++; paint(items); return items;
  };
  return { el, check, load, show: paint };
}
