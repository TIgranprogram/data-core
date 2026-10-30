import { apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { modal } from '../ui/dialog.js';
import { loadMaterialDicts } from '../ui/materials-spec.js';
import { toast } from '../ui/toast.js';

/**
 * «Техническое описание» изделия: фото слева, справа таблица с допусками. Строки подставляются из изделия, всё правится здесь же,
 * документ собирается по кнопке и не хранится. Допуски ориентировочные: стенка ±1 мм, габариты ±10 %.
 */
const round10 = (n) => Math.round(n / 10) * 10;
const range = (a, b, unit) => `не менее ${String(a).replace('.', ',')} и не более ${String(b).replace('.', ',')} ${unit}`;

/** Толщина стенки из размера: «∅89×3» → 3, «120×60×3» → 3; лист — само число. */
export function wallOf(size) {
  const parts = String(size || '').replace(/^∅/, '').split('×');
  const round = String(size || '').startsWith('∅');
  const raw = round ? parts[1] : parts.length === 3 ? parts[2] : parts.length === 1 ? parts[0] : null;
  const n = Number(String(raw ?? '').replace(',', '.'));
  return n > 0 ? n : null;
}

export function draftRows(r, dicts) {
  const matBy = new Map(dicts.mats.map((m) => [String(m.id), m]));
  const partBy = new Map(dicts.parts.map((p) => [String(p.id), p]));
  const rows = (r.materialsSpec?.rows || []).map((row) => {
    const mat = matBy.get(String(row.materialId))?.name || '';
    const sizes = (row.sizes || []).join(', ');
    const wall = wallOf(row.sizes?.[0]);
    const tol = wall && wall > 1 ? `, толщина ${range(wall - 1, wall + 1, 'мм')}` : '';
    return { name: (row.partIds || []).map((id) => partBy.get(String(id))?.name).filter(Boolean).join(', ') || 'Материал', text: [mat, sizes].filter(Boolean).join(' ') + tol };
  });
  const d = r.dimensions;
  for (const [k, label] of [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота']]) {
    if (d?.[k] > 0) rows.push({ name: label, text: range(round10(d[k] * 0.9), round10(d[k] * 1.1), d.unit || 'мм') });
  }
  if (r.weightKg) rows.push({ name: 'Вес', text: `${String(r.weightKg).replace('.', ',')} кг` });
  if (r.purpose) rows.push({ name: 'Назначение', text: r.purpose });
  if (r.installation) rows.push({ name: 'Установка', text: r.installation });
  return rows.length ? rows : [{ name: '', text: '' }];
}

export async function openTechSheet(r) {
  const dicts = await loadMaterialDicts();
  const rows = draftRows(r, dicts);
  const title = h('input', { value: r.name || '', 'aria-label': 'Название' });
  const box = h('div', { class: 'ts-rows' });
  const paint = () => box.replaceChildren(...rows.map((row, i) => h('div', { class: 'ts-row' },
    h('input', { value: row.name, 'aria-label': 'Часть', placeholder: 'Часть', oninput: (e) => { row.name = e.target.value; } }),
    h('textarea', { rows: 2, value: row.text, 'aria-label': 'Описание', placeholder: 'Материал и допуски', oninput: (e) => { row.text = e.target.value; } }),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Убрать строку', 'aria-label': 'Убрать строку', onclick: () => { rows.splice(i, 1); paint(); } }, '×'))));
  paint();
  await modal({
    title: 'Техническое описание', okText: '⇩ Скачать PDF', wide: true,
    body: h('div', null, h('p', { class: 'hint' }, 'Данные взяты из изделия, допуски примерные — проверьте и поправьте. Документ не сохраняется.'),
      h('label', { class: 'field' }, h('span', null, 'Название'), title),
      h('div', { class: 'ts-row ts-head' }, h('span', null, 'Часть'), h('span', null, 'Материал и допуски'), h('span')), box,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { rows.push({ name: '', text: '' }); paint(); } }, '+ Строка')),
    onOk: async () => {
      const list = rows.map((x) => ({ name: x.name.trim(), text: x.text.trim() })).filter((x) => x.name || x.text);
      if (!list.length) throw new Error('Добавьте хотя бы одну строку');
      await apiFile(`/showcase/${r.id}/tech-sheet`, { method: 'POST', body: { title: title.value.trim() || r.name, rows: list }, fallback: 'Техническое описание.pdf' });
      toast('Техническое описание скачано');
      return true;
    },
  });
}
