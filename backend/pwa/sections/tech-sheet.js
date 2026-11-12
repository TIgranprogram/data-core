import { api, apiFile, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { sideForm, openSide } from '../ui/kit/side-form.js';
import { button, hint, iconButton, stack, table, textInput } from '../ui/kit/index.js';
import { loadMaterialDicts, materialsSpec, specSummary } from '../ui/materials-spec.js';
import { toast } from '../ui/kit/toast.js';
import { fromComposition } from './products/form-fields.js';
import { patchProduct } from './products/data.js';

/**
 * «Техническое описание» изделия (PDF) — правая панель `of=techsheet&open=<id изделия>` (2026-11-10: было окно посреди экрана
 * со строками вручную — «система не подсказывает, что выбрать»).
 *   1) Части и материалы — тот же редактор, что «Описание и материалы» в форме изделия: части, материал, размеры, покрытие
 *      из справочников; «Взять из состава». Сохраняется в изделие (materialsSpec) — паспорт берёт его же.
 *   2) Габариты, вес, назначение, монтаж — подставляются из изделия сами (правятся в карточке изделия).
 *   3) Строки только для этого PDF — по желанию, в изделие не пишутся.
 * Допуски ориентировочные: стенка ±1 мм, габариты ±10 %.
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

/** Строки материалов из таблицы изделия. */
export function specRows(spec, dicts) {
  const matBy = new Map(dicts.mats.map((m) => [String(m.id), m]));
  const partBy = new Map(dicts.parts.map((p) => [String(p.id), p]));
  const materials = (spec?.rows || []).map((row) => {
    const mat = matBy.get(String(row.materialId))?.name || '';
    const sizes = (row.sizes || []).join(', ');
    const wall = wallOf(row.sizes?.[0]);
    const tol = wall && wall > 1 ? `, толщина ${range(wall - 1, wall + 1, 'мм')}` : '';
    return { name: (row.partIds || []).map((id) => partBy.get(String(id))?.name).filter(Boolean).join(', ') || 'Материал', text: String(row.techText || '').trim() || [mat, sizes].filter(Boolean).join(' ') + tol };
  });
  const coatings = (spec?.coatingIds || []).flatMap((id) => {
    const texts = (spec.coatingTexts || []).filter((r) => String(r.materialId) === String(id)).map((r) => String(r.techText || '').trim()).filter(Boolean);
    return texts.length ? texts : [matBy.get(String(id))?.name || ''];
  }).filter(Boolean);
  return [...materials, ...(coatings.length ? [{ name: 'Покрытие', text: [...new Set(coatings)].join(', ') }] : [])];
}

/** Строки, которые подставляются из изделия: габариты (±10 %), вес, назначение, монтаж. */
export function productRows(r) {
  const rows = [];
  const d = r.dimensions;
  for (const [k, label] of [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота']]) {
    if (d?.[k] > 0) rows.push({ name: label, text: range(round10(d[k] * 0.9), round10(d[k] * 1.1), d.unit || 'мм') });
  }
  if (r.weightKg) rows.push({ name: 'Вес', text: `${String(r.weightKg).replace('.', ',')} кг` });
  if (r.purpose) rows.push({ name: 'Назначение', text: r.purpose });
  if (r.installation) rows.push({ name: 'Установка', text: r.installation });
  return rows;
}

/** Все строки PDF (прежнее имя для печати пакета). */
export const draftRows = (r, dicts) => [...specRows(r.materialsSpec, dicts), ...productRows(r)];

export function openTechSheet(r) { openSide('techsheet', r.id); }

const rowsWidget = (rows) => {
  const box = h('div', { class: 'ts-rows' });
  const paint = () => box.replaceChildren(...rows.map((row, i) => h('div', { class: 'ts-row' },
    stack(
      textInput({ label: 'Часть', placeholder: 'Например, Табличка', value: row.name, onInput: (v) => { row.name = v; } }).el,
      textInput({ label: 'Что напечатать', placeholder: 'Описание для заказчика', value: row.text, max: 500, onInput: (v) => { row.text = v; } }).el),
    iconButton({ icon: '×', label: 'Убрать строку', size: 'S', onClick: () => { rows.splice(i, 1); paint(); } }))));
  paint();
  const el = h('div', null, box, button({ label: '+ Строка', kind: 'ghost', size: 'S', onClick: () => { rows.push({ name: '', text: '' }); paint(); } }));
  return { el, get value() { return ''; }, set value(_) { /* строки живут в rows */ } };
};

export const techSheet = sideForm({
  id: 'techsheet', title: 'Техническое описание', noun: 'техописание',
  get: async (id) => {
    const [r, dicts] = await Promise.all([api(`/showcase/${id}`), loadMaterialDicts()]);
    return { ...r, dicts, extra: [] };
  },
  heading: (r) => `Техническое описание · ${r.name || 'изделие'}`,
  subheading: () => 'PDF для заказчика: части и материалы — из справочников, габариты и вес — из изделия',
  saveLabel: '⇩ Сохранить и скачать PDF',
  fields: (r) => {
    const auto = productRows(r);
    return [
      { section: 'Части и материалы', tone: 'main', fixed: true },
      { key: 'materialsSpec', label: 'Из чего сделано', type: 'widget', wide: true, summary: specSummary,
        hint: 'Часть, материал, размер и покрытие — выберите из списков или впишите (Enter). «Взять из состава» переносит материалы и их ручные тексты; размеры к ручному тексту не дописываются. Сохранится в изделие — паспорт возьмёт то же.',
        widget: (v) => materialsSpec({ value: v, dicts: r.dicts, text: r.materialsText || '', scope: () => r.passportCategory?.code || '', actions: session.canEdit ? [fromComposition(r)] : [] }) },
      { section: 'Подставится из изделия', tone: 'info' },
      { key: '_auto', label: '', type: 'widget', wide: true, widget: () => ({
        el: auto.length
          ? h('div', null, table({ columns: [{ label: 'Строка' }, { label: 'В PDF' }], rows: auto.map((x) => ({ cells: [x.name, x.text] })) }),
            hint('Габариты, вес, назначение и монтаж правятся в карточке изделия: «Изменить». Допуск габаритов — ±10 %.'))
          : hint('Габариты и вес не заполнены — впишите их в карточке изделия: «Изменить».'),
        get value() { return ''; }, set value(_) { /* только показ */ },
      }) },
      { section: 'Строки только для этого PDF', tone: 'info', collapsed: true },
      { key: '_extra', label: '', type: 'widget', wide: true, hint: 'Например, табличка или комплект поставки. В изделие не пишутся.', widget: () => rowsWidget(r.extra) },
      { key: 'title', label: 'Заголовок PDF', max: 300, wide: true },
    ];
  },
  toInitial: (r) => ({ materialsSpec: r.materialsSpec ? JSON.stringify(r.materialsSpec) : '', title: r.name || '' }),
  toBody: (v) => ({ spec: v.materialsSpec ?? null, title: String(v.title || '').trim() }),
  save: async (body, r) => {
    if (session.canEdit && JSON.stringify(body.spec) !== JSON.stringify(r.materialsSpec ?? null)) {
      await patchProduct(r.id, { materialsSpec: body.spec });
      r.materialsSpec = body.spec;
    }
    const rows = [...specRows(body.spec, r.dicts), ...productRows(r), ...r.extra.map((x) => ({ name: x.name.trim(), text: x.text.trim() }))].filter((x) => x.name || x.text);
    if (!rows.length) throw new Error('Добавьте хотя бы одну строку: часть и материал');
    await apiFile(`/showcase/${r.id}/tech-sheet`, { method: 'POST', body: { title: body.title || r.name, rows }, fallback: 'Техническое описание.pdf' });
    toast('Техническое описание скачано');
    return r;
  },
});
