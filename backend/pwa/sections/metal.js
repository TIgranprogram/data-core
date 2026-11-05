import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { newUid, parseNum, qty } from '../core/format.js';
import { modal } from '../ui/kit/dialog.js';
import { toast } from '../ui/kit/toast.js';
import { dictNames } from '../ui/dict-options.js';

/*
 * Металл на складе (TASKS СМ.1–СМ.2 / C022): сортамент, марка, размеры у труб и листов; обрезки.
 * Сервер: `assortment`, `materialGrade`, `dims` (мм), вид `metal` (pipe | sheet — по категории),
 * обрезок — POST /stock/items/:id/offcut. Воронка полей: вид → только свои поля (C022 FIX-TZ).
 */
const m = (mm) => (mm ? (mm / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) : '');
const mm = (v) => (v ? `${qty(v)} мм` : '');

/** Тот же смысл, что backend stock/metal.ts metalKind — без импорта сервера. */
export function metalKindUi(categoryName, unit) {
  const c = String(categoryName ?? '').toLowerCase();
  if (/труб/.test(c)) return 'pipe';
  if (/лист/.test(c) || String(unit ?? '').toLowerCase() === 'лист') return 'sheet';
  return null;
}

/** Строки карточки: только если сервер уже дал r.metal (C022-6). */
export function metalView(r) {
  if (r.metal !== 'pipe' && r.metal !== 'sheet') return [];
  const d = r.dims || {};
  const size = r.metal === 'sheet'
    ? [d.thickness && `толщина ${mm(d.thickness)}`, d.length && d.width && `формат ${m(d.length)}×${m(d.width)} м`].filter(Boolean).join(', ')
    : [d.diameter && `Ø ${mm(d.diameter)}`, d.thickness && `стенка ${mm(d.thickness)}`, d.length && `хлыст ${m(d.length)} м`].filter(Boolean).join(', ');
  return [
    ['Сортамент / сечение', r.assortment],
    ['Марка стали', r.materialGrade],
    r.metal === 'pipe' ? ['Мойка', r.washed == null ? '' : r.washed ? 'Мытая' : 'Не мытая'] : null,
    ['Размеры', size],
    ['Обрезки', (r.offcuts || []).length ? h('span', null, ...r.offcuts.flatMap((o, i) => [i ? ', ' : '', h('a', { href: '#stock?open=' + o.id }, `${o.name.split(' — обрезок ')[1] || o.name} × ${qty(o.qty)}`)]), h('span', { class: 'muted' }, ' — берите сначала их')) : ''],
    ['Обрезок от', r.offcutOf ? h('a', { href: '#stock?open=' + r.offcutOf }, 'основная позиция →') : ''],
  ].filter(Boolean);
}

const METAL_KEYS = ['assortment', 'materialGrade', 'thickness', 'lengthM', 'wash', 'widthM'];

/** Поля формы: блок «Труба» / «Лист»; видимость — mount по категории и ед. (C022-1). */
export async function metalFields() {
  const names = await dictNames('metalAssortments')().catch(() => []);
  return [
    { section: 'Труба', tone: 'info' }, // заголовок меняет mount; у не-металла блок скрыт до первой отрисовки
    { key: 'assortment', label: 'Сортамент / сечение', type: 'combo', max: 200, span: 2,
      options: (get) => {
        const k = metalKindUi(get('categoryName'), get('unit'));
        if (k === 'pipe') return names.filter((n) => !/лист/i.test(n));
        if (k === 'sheet') return names.filter((n) => !/труб/i.test(n));
        return names;
      },
      placeholder: 'Выберите или впишите',
      mount: (f) => {
        const unitField = f.field('unit');
        let unitHint = unitField?.querySelector('.hint');
        if (unitField && !unitHint) { unitHint = h('div', { class: 'hint' }); unitField.append(unitHint); }
        const thickHint = () => {
          let el = f.field('thickness')?.querySelector('.hint');
          if (!el && f.field('thickness')) { el = h('div', { class: 'hint' }); f.field('thickness').append(el); }
          return el;
        };
        const apply = () => {
          const kind = metalKindUi(f.get('categoryName'), f.get('unit'));
          const blk = f.field('assortment')?.closest?.('.form-block');
          if (blk) {
            blk.hidden = !kind;
            const title = blk.querySelector('.form-sec-t');
            if (title && kind) title.textContent = kind === 'pipe' ? 'Труба' : 'Лист';
          }
          const show = (key, on) => { const el = f.field(key); if (el) el.hidden = !on; };
          for (const key of METAL_KEYS) show(key, !!kind);
          if (kind === 'pipe') { show('widthM', false); show('wash', true); }
          if (kind === 'sheet') { show('wash', false); show('widthM', true); }
          const th = thickHint();
          if (th) {
            th.hidden = !kind;
            if (kind === 'pipe') th.textContent = 'Стенка трубы. Длина хлыста — обычно 6 или 12 м.';
            else if (kind === 'sheet') th.textContent = 'Толщина, длина и ширина — формат листа.';
            else th.textContent = '';
          }
          if (unitHint) {
            const u = String(f.get('unit') || '').toLowerCase();
            if (kind === 'pipe' && u !== 'м') unitHint.textContent = 'Трубу обычно считают в метрах';
            else if (kind === 'sheet' && u !== 'лист') unitHint.textContent = 'Лист обычно считают в листах';
            else unitHint.textContent = '';
            unitHint.hidden = !unitHint.textContent.trim();
          }
          const inp = f.input('assortment');
          if (inp && inp.placeholder !== undefined) {
            inp.placeholder = kind === 'pipe' ? 'Труба 40×20×2' : kind === 'sheet' ? 'Лист 2 мм' : 'Выберите или впишите';
          }
          if (kind) f.open('assortment');
        };
        // сразу скрыть до paint (блок иначе вспыхивает «Труба»)
        const blk0 = f.field('assortment')?.closest?.('.form-block');
        if (blk0 && !metalKindUi(f.get('categoryName'), f.get('unit'))) blk0.hidden = true;
        f.on('categoryName', apply);
        f.on('unit', apply);
        apply();
      } },
    { key: 'materialGrade', label: 'Марка стали', type: 'combo', max: 100, span: 2, load: dictNames('steelGrades'), placeholder: 'Ст3, 09Г2С, AISI 304' },
    { key: 'thickness', label: 'Толщина, мм', type: 'number', min: 0, span: 1, hint: ' ' },
    { key: 'lengthM', label: 'Длина, м', type: 'number', min: 0, span: 1 },
    { key: 'wash', label: 'Мойка трубы', type: 'select', span: 1, options: [{ value: '1', label: 'Мытая' }, { value: '0', label: 'Не мытая' }] },
    { key: 'widthM', label: 'Ширина, м', type: 'number', min: 0, span: 1 },
  ];
}

export const metalInitial = (r) => ({
  thickness: r.dims?.thickness ?? null,
  lengthM: r.dims?.length ? r.dims.length / 1000 : null,
  widthM: r.dims?.width ? r.dims.width / 1000 : null,
  wash: r.washed == null ? '' : r.washed ? '1' : '0',
});

/**
 * В тело запроса по виду (C022-2). wasKind — вид при открытии формы (null = создаём / не было металла).
 * Пустое число → null. Диаметр не кладём.
 */
export const metalBody = (v, { wasKind = null } = {}) => {
  const kind = metalKindUi(v.categoryName, v.unit);
  const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
  if (!kind) {
    if (!wasKind) return {}; // метиз как был — ключи металла не трогаем
    return { assortment: null, materialGrade: null, washed: null, dims: { thickness: null, length: null, width: null } };
  }
  const thickness = num(v.thickness);
  const length = v.lengthM ? Math.round(num(v.lengthM) * 1000) : null;
  const width = kind === 'sheet' && v.widthM ? Math.round(num(v.widthM) * 1000) : null;
  return {
    assortment: v.assortment || null,
    materialGrade: v.materialGrade || null,
    washed: kind === 'pipe' ? (v.wash === '' || v.wash == null ? null : v.wash === '1') : null,
    dims: { thickness, length, width: kind === 'pipe' ? null : width },
  };
};

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
      return api(`/stock/items/${r.id}/offcut`, { method: 'POST', body: { lengthMm: Math.round(l * 1000), ...(w ? { widthMm: Math.round(w * 1000) } : {}), count: c, clientUid: newUid() } });
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
