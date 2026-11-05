import { h } from '../../core/dom.js';
import { qty } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { optBtn } from './list-tiles.js';

/** Чипы-фильтры списка: варианты загружены один раз (chipOpts), счётчики — с каждым ответом (lastResp). */
export function paintChips({ chipsBox, chipFilters, chipOpts, sideChips, P, isBoard, lastResp }) {
  if (!chipOpts) return;
  const pickValue = (f, o, isAct, isAll) => { if (isAct && isAll) return; patch({ [f.key]: isAct ? undefined : (isAll && f.defaultValue ? 'all' : o.value), page: undefined }); }; // активная «Все» — ничего (иначе при defaultValue фильтр возвращался к «В работе»)
  chipsBox.replaceChildren(...chipFilters.flatMap((f, i) => {
    if (isBoard && f.key === 'status') return [];
    const cur = P[f.key] !== undefined ? P[f.key] : (f.defaultValue || '');
    const curIsAll = cur === '' || cur === 'all';
    const opts = [...(f.noAll ? [] : [{ value: '', label: f.allLabel || 'Все' }]), ...chipOpts[i]].map((o) => {
      const isAll = o.value === ''; const isAct = isAll ? curIsAll : String(o.value) === cur;
      const n = f.count && lastResp ? f.count(lastResp, o.value) : undefined;
      if (sideChips) return optBtn(o.label, n, isAct, () => pickValue(f, o, isAct, isAll), '', o.hint || '');
      return h('button', { type: 'button', class: 'chip' + (isAct ? ' active' : ''), title: o.hint, onclick: () => pickValue(f, o, isAct, isAll) },
        o.label, n !== undefined ? h('b', null, qty(n)) : null);
    });
    return sideChips ? [h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, f.label), h('div', { class: 'ls-list' }, ...opts))] : opts;
  }));
}
