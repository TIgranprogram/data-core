import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum, qty } from '../core/format.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { dictNames } from '../ui/dict-options.js';

/*
 * Металл на складе (TASKS СМ.1–СМ.2): сортамент, марка, размеры у труб и листов; обрезки, которые ещё пригодятся.
 * Сервер: поля позиции `assortment`, `materialGrade`, `dims` (мм), вид `metal` (pipe | sheet — по категории),
 * обрезок — POST /stock/items/:id/offcut (своя позиция «… — обрезок 1,2 м», в «Операциях» показывается первой).
 */
const m = (mm) => (mm ? (mm / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '');
const mm = (v) => (v ? `${qty(v)} мм` : '');

/** Строки карточки: сортамент, марка, размеры, обрезки (ссылками). */
export function metalView(r) {
  const d = r.dims || {};
  const size = r.metal === 'sheet' ? [d.thickness && `толщина ${mm(d.thickness)}`, d.length && d.width && `формат ${m(d.length)}×${m(d.width)} м`].filter(Boolean).join(', ')
    : [d.diameter && `Ø ${mm(d.diameter)}`, d.thickness && `стенка ${mm(d.thickness)}`, d.length && `хлыст ${m(d.length)} м`].filter(Boolean).join(', ');
  return [
    ['Сортамент / сечение', r.assortment],
    ['Марка стали', r.materialGrade],
    ['Размеры', size],
    ['Обрезки', (r.offcuts || []).length ? h('span', null, ...r.offcuts.flatMap((o, i) => [i ? ', ' : '', h('a', { href: '#stock?open=' + o.id }, `${o.name.split(' — обрезок ')[1] || o.name} × ${qty(o.qty)}`)]), h('span', { class: 'muted' }, ' — берите сначала их')) : ''],
    ['Обрезок от', r.offcutOf ? h('a', { href: '#stock?open=' + r.offcutOf }, 'основная позиция →') : ''],
  ];
}


/** Поля формы позиции — блок «Металл» (свёрнут; для труб и листов). */
export const metalFields = () => [
  { section: 'Металл: труба, лист', tone: 'info', collapsed: true },
  { key: 'assortment', label: 'Сортамент / сечение', type: 'combo', max: 200, span: 2, load: dictNames('metalAssortments'), placeholder: 'Труба 40×20×2, лист 2 мм' },
  { key: 'materialGrade', label: 'Марка стали', type: 'combo', max: 100, span: 2, load: dictNames('steelGrades'), placeholder: 'Ст3, 09Г2С, AISI 304' },
  { key: 'thickness', label: 'Толщина, мм', type: 'number', min: 0, span: 1 },
  { key: 'lengthM', label: 'Длина, м', type: 'number', min: 0, span: 1 },
  { key: 'widthM', label: 'Ширина, м', type: 'number', min: 0, span: 1 },
  { note: 'Толщина — стенка трубы или лист. Труба обычно 6 м; ширина — только для листа.' },
];
export const metalInitial = (r) => ({ thickness: r.dims?.thickness ?? null, lengthM: r.dims?.length ? r.dims.length / 1000 : null, widthM: r.dims?.width ? r.dims.width / 1000 : null });
/** В тело запроса: метры → мм; пусто — стереть. */
export const metalBody = (v) => ({
  assortment: v.assortment || null, materialGrade: v.materialGrade || null,
  dims: { thickness: v.thickness || null, length: v.lengthM ? Math.round(v.lengthM * 1000) : null, width: v.widthM ? Math.round(v.widthM * 1000) : null },
});

/** «Отложить обрезок»: длина (лист — и ширина), сколько кусков. */
export async function offcutDialog(r, ctx) {
  const sheet = r.metal === 'sheet';
  const len = h('input', { inputmode: 'decimal', placeholder: sheet ? 'например 1' : 'например 1,2' });
  const wid = sheet ? h('input', { inputmode: 'decimal', placeholder: 'например 0,5' }) : null;
  const cnt = h('input', { inputmode: 'numeric', value: '1' });
  const done = await modal({
    title: `Обрезок: ${r.name}`, okText: 'Отложить',
    body: h('div', null, h('p', { class: 'hint' }, sheet ? 'Кусок листа, который пригодится. Лист уже списан — обрезок появится отдельной строкой «… — обрезок 1×0,5 м».'
      : `Кусок трубы, который пригодится: метры уйдут из «${r.name}» (сейчас ${qty(r.quantity)} ${r.unit}) в отдельную строку «… — обрезок 1,2 м».`),
    h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, 'Длина, м'), len), wid ? h('label', { class: 'field' }, h('span', null, 'Ширина, м'), wid) : null,
      h('label', { class: 'field' }, h('span', null, 'Сколько кусков'), cnt))),
    onOk: async () => {
      const l = parseNum(len.value), w = wid ? parseNum(wid.value) : undefined, c = parseNum(cnt.value) || 1;
      if (!(l > 0)) throw new Error('Укажите длину');
      if (sheet && !(w > 0)) throw new Error('Укажите ширину');
      return api(`/stock/items/${r.id}/offcut`, { method: 'POST', body: { lengthMm: Math.round(l * 1000), ...(w ? { widthMm: Math.round(w * 1000) } : {}), count: c } });
    },
  });
  if (done) {
    toast(`Отложен: ${done.offcut.name}`, { undo: async () => { await api(`/stock/batch/${done.batchId}/cancel`, { method: 'POST' }); toast('Обрезок отменён'); ctx.reload(); } });
    ctx.setRow(done.parent);
  }
}

/** Приход трубы хлыстами: «10 хлыстов по 6 м» → 60 м в поле количества. */
export function pipeInHelper(r, qIn) {
  if (r.metal !== 'pipe' || r.offcutOf) return null;
  const pieces = h('input', { inputmode: 'numeric', placeholder: 'хлыстов' });
  const len = h('input', { inputmode: 'decimal', value: r.dims?.length ? String(r.dims.length / 1000).replace('.', ',') : '6' });
  const calc = () => { const p = parseNum(pieces.value), l = parseNum(len.value); if (p > 0 && l > 0) qIn.value = String(Math.round(p * l * 1000) / 1000).replace('.', ','); };
  pieces.addEventListener('input', calc); len.addEventListener('input', calc);
  return h('label', { class: 'field wide' }, h('span', null, 'Хлыстами: сколько × по сколько метров'), h('div', { class: 'issue-to' }, pieces, len));
}
