import { h } from '../core/dom.js';
import { badge, button } from '../ui/kit/index.js';

/** Сортировка «Группы изделий»: по номеру (пусто — в конце) или по названию. */
export function sortProductGroups(rows, mode) {
  return rows.slice().sort((a, b) => {
    if (mode === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    const na = Number(a.groupNo); const nb = Number(b.groupNo);
    const aa = Number.isFinite(na) ? na : 999; const bb = Number.isFinite(nb) ? nb : 999;
    return aa - bb || String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
}

export function productGroupTitle(r) {
  return r.groupNo ? `${r.groupNo} · ${r.name}` : r.name;
}

/** Мета строки группы: бейдж номера + раздел. */
export function productGroupMeta(r) {
  const bits = [r.groupNo ? badge(`№ ${r.groupNo}`, 'info') : badge('без номера', 'warn')];
  if (r.parentName) bits.push(h('span', { class: 'muted' }, String(r.parentName)));
  return bits.flatMap((x, i) => (i ? [' · ', x] : [x]));
}

/** Кнопки «По номеру» / «По названию». */
export function productGroupSortBtns(mode, onChange) {
  return [
    button({ label: 'По номеру', kind: mode === 'no' ? 'primary' : 'ghost', size: 'S', onClick: () => onChange('no') }),
    button({ label: 'По названию', kind: mode === 'name' ? 'primary' : 'ghost', size: 'S', onClick: () => onChange('name') }),
  ];
}
