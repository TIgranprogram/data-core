/**
 * C134: содержимое страниц окна паспорта — блоки в порядке PDF (passport-pdf-v2-layout): обложка, описание, правила, разделы,
 * ТО, монтаж, комплектность, журналы, заметки, рисунки, талон. Правка — через ctx.editable(view, spec).
 * ctx: { S, can, canNumber, editable, patchPassport, imageStrip(kind,label,full) }.
 */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { table as kitTable } from '../../ui/kit/index.js';
import { srcPaint } from '../../ui/kit/src.js';
import { imgsOf, isRequired, kinds, numberOf, statusOf, bomRows, parseBom } from './common.js';
import { numbersOf } from './traits.js';
import { SRC_LABEL } from './card-blocks.js';
import { tableNumbers, figureNumbers, refsOf } from './book-refs.js';
import { compositionSheet } from './book-composition-tree.js';
import { passportNamePatch } from './book-inline-events.js';
import { exerciseBookBlocks } from './book-exercise.js';

const numText = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const SPEC = [['Длина (L), мм', 'length', 1], ['Ширина (B), мм', 'width', 1], ['Высота (H), мм', 'height', 1], ['Ширина посадки (Bп), мм', 'seatWidth'],
  ['Высота посадки (Hп), мм', 'seatHeight'], ['Количество опор, шт', 'supports'], ['Объём перевозки (V), куб. м', 'shipVolume'], ['Масса, кг', 'weight', 1]];
const dashed = (x) => /^\s*[—–-]\s/.test(String(x ?? ''));
const BLANK = ' ';
const JOURNALS = [
  ['storage', 'Сведения о хранении', ['Дата установки на хранение', 'Дата снятия с хранения', 'Условия хранения', 'Должность, ФИО, подпись ответственного лица'], 9],
  ['faults', 'Учёт неисправностей', ['Дата', 'Вид неисправности', 'Принятые меры', 'Должность, ФИО, подпись ответственного лица'], 9],
  ['service', 'Журнал технического обслуживания', ['Дата', 'Вид работ (осмотр, обслуживание)', 'Результат, выполненные работы', 'Должность, ФИО, подпись ответственного лица'], 6],
  ['repairs', 'Журнал ремонтов', ['Дата', 'Вид ремонта', 'Заменённые части', 'Исполнитель: должность, ФИО, подпись'], 6],
];

/** Спецификации правок: что и куда сохранять. */
export function specsOf(ctx) {
  const pid = () => ctx.S.r.id;
  const template = ctx.S.template;
  const manualKeys = { description: 'manualDescription', purpose: 'manualPurpose', install: 'manualInstall' };
  const templateField = (key, text, label, rows) => ({
    text: String(text ?? ''), label, rows, templateEdit: !!key,
    save: (value) => ctx.exclusive(() => ctx.patchTemplate({ [key]: value || null }, template.defaults)),
  });
  const field = (name, index, text, ref, rows, original, extra = {}) => {
    if (template) return templateField(manualKeys[name], text,
      { description: 'Описание изделия', purpose: 'Назначение', install: 'Текст монтажа' }[name] || extra.label, rows);
    const url = '/passports/' + pid() + '/snapshot-field';
    const part = extra.part && extra.part !== 'what' ? extra.part : undefined;
    const key = { field: name, ...(index === undefined ? {} : { index }), ...(part ? { part } : {}) };
    const shared = part ? null : { needsSource: !ref, sources: () => api(url + '/sources', { method: 'POST', body: key }).then((x) => x.items || []),
      target: (t, sourceKey) => api(url + '/target', { method: 'POST', body: { ...key, text: t, ...(sourceKey ? { sourceKey } : {}) } }),
      promote: (t, token, sourceKey) => api(url + '/promote', { method: 'POST', body: { ...key, text: t, token, ...(sourceKey ? { sourceKey } : {}) } }) };
    return { text: String(text ?? ''), label: extra.label || 'Текст строки', rows, original,
      save: (t) => api(url, { method: 'PATCH', body: { ...key, text: t } }),
      remove: extra.remove ? () => api(url, { method: 'PATCH', body: { field: name, index, remove: true } }) : null,
      ...(shared ? { shared } : {}) };
  };
  const item = (s, i) => {
    if (template) return { readonly: true };
    const url = '/passports/' + pid() + '/snapshot-item';
    const key = { sectionKey: s.key, itemKey: i.key };
    return { text: String(i.text ?? ''), label: 'Текст пункта', rows: 3, original: i.edited ? i.original : null, save: (t) => api(url, { method: 'PATCH', body: { ...key, text: t } }),
      shared: { target: (t) => api(url + '/target', { method: 'POST', body: { ...key, text: t } }), promote: (t, token) => api(url + '/promote', { method: 'POST', body: { ...key, text: t, token } }) } };
  };
  const scalar = (label, text, save, extra = {}) => ({ text: String(text ?? ''), label, rows: 1, save, ...extra });
  return { field, item, scalar };
}

export function buildBook(ctx) {
  const { S, can } = ctx;
  const r = S.r, t = r.textSnapshot || {};
  const template = S.template;
  const short = r.presentationVersion === 1 && r.variant === 'short';
  const { field: fieldSpec, item: itemSpec, scalar: scalarSpec } = specsOf(ctx);
  const tabs = tableNumbers(t);
  const plan = numbersOf(t);
  const allTexts = [t.description, t.purpose, ...(t.rules || []), ...(t.sections || []).flatMap((s) => (s.items || []).map((i) => i.text)), t.install?.text, ...(t.install?.requirements || [])];
  const shown = refsOf(tabs, figureNumbers(r, allTexts));
  const flow = [];
  const push = (...els) => flow.push(...els.filter(Boolean));
  const fe = t.fieldEdits || {}, refs = t.refs || {};
  const orig = (f, i) => { const e = i === undefined ? fe[f] : fe[f]?.[i]; return e ? e.original : null; };
  const edited = (f, i) => !!(i === undefined ? fe[f] : fe[f]?.[i]);
  const own = t.src ? 'product' : '';
  const maintCell = (index, part, value, label, { remove } = {}) => {
    const key = part === 'what' ? index : `${index}:${part}`;
    return cell(shown(value), fieldSpec('maintenance', index, value, part === 'what' ? refs.maintenance?.[index] : null, 2, orig('maintenance', key), { label, part, remove }));
  };

  const hd = (s) => h('h3', { class: 'bk-h' }, s);
  const sub = (s) => h('h4', { class: 'bk-sub bk-h' }, s);
  const cap = (key, s) => h('p', { class: 'bk-cap' }, `Таблица ${tabs[key]} — ${s}`);
  const table = (cols, rows) => kitTable({ columns: cols.map((label) => ({ label })), rows: rows.map((cells) => ({ cells })) });
  const cell = (text, spec) => ctx.editable(h('span', { class: 'bk-cell' }, text || h('span', { class: 'muted' }, '—')), spec);
  const textP = (text, spec, src, { prefix, edit } = {}) => {
    const view = h('p', { class: 'bk-p' }, prefix ? h('b', null, prefix + ' ') : null, shown(text) || h('span', { class: 'muted' }, 'Не заполнено'),
      edit ? h('span', { class: 'bk-mark' }, ' · изменён для этого паспорта') : null);
    srcPaint(view, edit ? 'manual' : src, SRC_LABEL);
    return ctx.editable(view, spec);
  };

  // обложка
  const org = r.supplierOrg || {};
  const orgName = org.shortName || org.name || '';
  const contacts = [org.phone ? 'Тел.: ' + org.phone : '', org.email ? 'E-mail: ' + org.email : ''].filter(Boolean).join(' · ');
  const cover = h('div', { class: 'bk-cover' },
    !template ? h('div', { class: 'bk-band' }, ctx.editable(h('div', { class: 'bk-firm' }, orgName || h('span', { class: 'muted' }, 'Фирма не выбрана')),
      scalarSpec('Фирма', r.supplierOrgId || org.id || '', (v) => ctx.patchPassport({ supplierOrgId: v }), { options: ctx.firms || [[r.supplierOrgId || '', orgName]], readonly: !ctx.firms || statusOf(r) === 'issued' })),
    org.trademark ? h('span', { class: 'bk-tm' }, `«${String(org.trademark).replace(/[«»"]/g, '')}»`) : null) : null,
    contacts ? h('p', { class: 'bk-contacts' }, contacts) : null,
    h('p', { class: 'bk-ptitle' }, template ? 'ОБРАЗЕЦ ПАСПОРТА' : 'ПАСПОРТ № ' + (numberOf(r) || '—')),
    ctx.editable(h('p', { class: 'bk-pname' }, r.name || h('span', { class: 'muted' }, 'Название не задано')), scalarSpec('Название в этом паспорте', r.name, (v) => ctx.patchPassport(passportNamePatch(r, v)), { fieldKey: 'name' })),
    r.productCode || statusOf(r) === 'issued'
      ? ctx.editable(h('p', { class: 'bk-pcode' }, 'Номер изделия: ', r.productCode || '—'),
        scalarSpec('Номер изделия', r.productCode, (v) => ctx.patchPassport({ productCode: v, confirmNumbers: true }), { readonly: !(ctx.canNumber && statusOf(r) === 'issued') }))
      : null,
    ctx.imageStrip('overview', 'Общий вид'));
  cover.dataset.title = 'Обложка';

  // таблицы описания
  const specTable = () => {
    const rows = SPEC.filter(([, key, always]) => always || (r[key] !== undefined && r[key] !== null && r[key] !== ''))
      .map(([label, key]) => [label, cell(numText(r[key]), scalarSpec(label, numText(r[key]), (v) => {
        const n = Number(String(v).trim().replace(',', '.'));
        if (!String(v).trim() || !Number.isFinite(n)) throw new Error('Введите число');
        return ctx.patchPassport({ [key]: n });
      }, template ? { open: ctx.openDimensions } : {}))]);
    return [cap('specs', 'Габаритные размеры и масса изделия'), table(['Наименование', 'Значение'], rows)];
  };
  const modules = (r.modules || []).filter((m) => m && String(m.name || '').trim() && Number(m.qty) > 0);
  const modulesBlock = () => h('div', { class: 'bk-p' }, ...modules.map((m, i) => h('p', null, `${i + 1}. ${String(m.name).trim()}${m.dims ? ' · Габариты: ' + m.dims : ''} · Количество: ${numText(m.qty)} шт.`)));

  const rulesList = () => (t.rules || []).forEach((x, i) => push(textP(dashed(x) ? x : '— ' + x, fieldSpec('rules', i, x, refs.rules?.[i], 3, orig('rules', i)), own, { edit: edited('rules', i) })));
  const descrSection = () => {
    if (!plan.descrNo) return;
    push(hd(`${plan.descrNo} Описание и назначение`));
    let k = 0;
    if (template && short) {
      push(sub(`${plan.descrNo}.${++k} Краткое описание`), textP(t.description,
        { open: ctx.openSimple }, t.src?.description));
    } else if (t.description || template) {
      push(sub(`${plan.descrNo}.${++k} Описание изделия`), textP(t.description,
        short && statusOf(r) !== 'issued' ? { readonly: true } : fieldSpec('description', undefined, t.description, refs.description, 6, orig('description')),
        t.src?.description, { edit: edited('description') }));
    }
    if (t.purpose) push(sub(`${plan.descrNo}.${++k} Назначение`), textP(t.purpose, fieldSpec('purpose', undefined, t.purpose, refs.purpose, 3, orig('purpose')), t.src?.purpose, { edit: edited('purpose') }));
    push(sub(`${plan.descrNo}.${++k} Основные технические данные`), ...specTable());
    // C148: проекция из ответа паспорта; у выпущенного — собственный снимок. Старые модули — резерв.
    const live = ctx.compTree;
    if (!short && live?.lines?.length) {
      const sheet = compositionSheet(live.lines);
      if (sheet) push(sub(`${plan.descrNo}.${++k} Состав изделия`), sheet);
    }
    if (!short && modules.length && r.compositionPresentation !== 'tree') {
      push(sub(`${plan.descrNo}.${++k} Модули: сохранённое описание`), modulesBlock());
    }
    if (plan.rulesNo === plan.descrNo && t.rules?.length) { push(sub(`${plan.descrNo}.${++k} Правила пользования`)); rulesList(); }
  };
  const rulesSection = () => { if (plan.rulesNo && plan.rulesNo !== plan.descrNo && t.rules?.length) { push(hd(`${plan.rulesNo} Правила пользования`)); rulesList(); } };
  const installBlocks = () => {
    const steps = String(t.install?.text || '').split(/\r?\n/).filter(Boolean);
    const e = edited('install');
    if (steps.length || can) {
      const view = h('div', { class: 'bk-p' }, steps.length ? h('ol', null, ...steps.map((x) => h('li', null, shown(x)))) : h('span', { class: 'muted' }, 'Шаги монтажа — нажмите, чтобы заполнить'),
        e ? h('span', { class: 'bk-mark' }, ' · изменено для этого паспорта') : null);
      srcPaint(view, e ? 'manual' : t.src?.install, SRC_LABEL);
      push(ctx.editable(view, fieldSpec('install', undefined, t.install?.text || '', refs.install, 8, orig('install'))));
    }
    const req = (t.install?.requirements || []).filter(Boolean);
    if (req.length) { const v = h('div', { class: 'bk-p' }, h('b', null, 'Требования к основанию:'), h('ul', null, ...req.map((x) => h('li', null, shown(x))))); srcPaint(v, t.src ? 'product' : '', SRC_LABEL); push(v); }
  };

  const firstSec = (plan.sectionNo || []).find(Boolean);
  const before = plan.descrNo && firstSec ? parseInt(plan.descrNo, 10) < parseInt(firstSec, 10) : !!plan.descrNo && !firstSec;
  if (before) { descrSection(); rulesSection(); }
  let exerciseShown = false;
  (t.sections || []).forEach((s, si) => {
    if (!plan.sectionNo[si] || !s.items?.length) return;
    push(hd(`${plan.sectionNo[si]} ${shown(s.title)}`));
    for (const i of s.items) push(textP(i.text, itemSpec(s, i), i.src, { prefix: plan.itemNo(si, i.number) || (i.bullet && !dashed(i.text) ? '—' : ''), edit: i.edited }));
    if (s.key === 'use' && !exerciseShown) { push(...exerciseBookBlocks(ctx)); exerciseShown = true; }
    if (plan.mergeInstall && si === plan.mountIdx) installBlocks();
  });
  if (!exerciseShown) { const exercise = exerciseBookBlocks(ctx); if (exercise.length) push(hd('Правила пользования'), ...exercise); }
  if (!before) { descrSection(); rulesSection(); }

  const maint = (t.maintenance || []).filter((m) => m.rows?.length);
  if (plan.toNo && maint.length) {
    push(hd(`${plan.toNo} Техническое обслуживание (чек-лист)`));
    let mi = 0;
    for (const m of maint) {
      push(cap('to:' + m.period, 'Осмотр и обслуживание: ' + m.period), table(['Отм.', 'Что проверить', 'Где', 'Мера', 'Допуск'], m.rows.map((x) => {
        const index = mi++;
        return ['☐',
          maintCell(index, 'what', x.what, 'Что проверить', { remove: true }),
          maintCell(index, 'where', x.where, 'Где'),
          maintCell(index, 'measure', x.measure, 'Мера'),
          maintCell(index, 'tolerance', x.tolerance, 'Допуск')];
      })));
    }
  }
  if (!plan.mergeInstall && plan.installNo) { push(hd(`${plan.installNo} Монтаж`)); installBlocks(); }

  // комплектность и журналы: номера идут за последним разделом (passport-numbering)
  const last = Math.max(0, ...[plan.descrNo, plan.rulesNo, plan.toNo, plan.installNo, ...(plan.sectionNo || [])].map((x) => parseInt(x, 10) || 0));
  const bom = bomRows(r.bom?.length ? r.bom : [{ code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }]);
  const saveBom = (i, key, v) => { const next = bom.map((x) => ({ ...x })); next[i][key] = v; return ctx.patchPassport({ bom: parseBom(next, r.bom) }); };
  push(hd(`${last + 1} Комплектность`), cap('bom', 'Комплектность изделия'),
    table(['Поз.', 'Обозначение', 'Наименование', 'Размеры, мм', 'Кол-во', 'Ед. изм.', 'Примечание'], bom.map((b, i) => [String(i + 1),
      ...['code', 'name', 'size', 'qty', 'unit', 'note'].map((key) => cell(String(b[key] ?? ''), scalarSpec('Комплектность', b[key], (v) => saveBom(i, key, v), { readonly: !r.bom?.length })))])));
  push(hd(`${last + 2} Журналы`));
  for (const [key, title, cols, n] of JOURNALS) push(cap(key, title), table(cols, Array.from({ length: Math.min(n, 3) }, () => cols.map(() => BLANK))));

  const note = String(r.note ?? '').trim();
  if (note) push(hd('Для заметок'), ctx.editable(h('p', { class: 'bk-p' }, note), scalarSpec('Заметка', note, (v) => ctx.patchPassport({ note: v }), { rows: 4 })));

  const out = [{ blocks: [cover] }, { flow }];
  const imageSlots = new Set(r.imageSlots || []);
  for (const [k, label] of kinds(r).filter(([k]) => k !== 'overview' && (
    isRequired(r, k) || (template && imageSlots.has(k)) || ((!short || imageSlots.has(k))
      && (imgsOf(r, k).length || r.standardImages?.some((image) => image.kind === k && image.url)))))) {
    const blk = h('div', { class: 'bk-appx' }, hd('Рисунок: ' + label), ctx.imageStrip(k, label, true));
    blk.dataset.title = 'Рисунок: ' + label;
    out.push({ blocks: [blk] });
  }
  // гарантийный талон — последний лист, как в PDF (данные из паспорта; правятся в карточке)
  const talon = h('div', { class: 'bk-appx' }, hd('Гарантийный талон'),
    h('p', { class: 'bk-p' }, `Изделие: ${r.name || '—'}`), template ? null : h('p', { class: 'bk-p' }, `Паспорт № ${numberOf(r) || '—'}${r.productCode ? ' · номер изделия ' + r.productCode : ''}`),
    r.warrantyMonths ? h('p', { class: 'bk-p' }, `Гарантийный срок: ${numText(r.warrantyMonths)} мес.`) : null,
    h('p', { class: 'bk-p' }, 'Отметки о продаже и установке — заполняются после печати.'));
  talon.dataset.title = 'Гарантийный талон';
  out.push({ blocks: [talon] });
  return out;
}
