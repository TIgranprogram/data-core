/**
 * C134: паспорт «как в PDF» — большое окно со страницами А5; любое поле правится на месте.
 * Данные: GET /passports/:id; правки — snapshot-item / snapshot-field (этот паспорт или справочник), PATCH /passports/:id (шапка, размеры, комплектность, картинки).
 * Порядок и номера разделов — как в PDF (traits.numbersOf). Цвета источника текста — kit/src.js (те же, что в «Текст паспорта»).
 */
import { api, PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, badge, select, table as kitTable, iconButton } from '../../ui/kit/index.js';
import { buildForm } from '../../ui/kit/form.js';
import { photoDrop } from '../../ui/kit/photos.js';
import { srcPaint, srcLegend } from '../../ui/kit/src.js';
import { imagesBody } from '../../core/passport-images.js';
import { canEdit, canWorkPassport, heading, humanBlanks, imgsOf, isRequired, kinds, numberOf, ourCompanies, statusOf, bomRows, parseBom } from './common.js';
import { numbersOf } from './traits.js';
import { passportAction } from './field-edit.js';
import { pickSourceKey } from './book-shared.js';
import { printDialog } from './dialogs.js';
import { SRC_LABEL } from './card-blocks.js';

let tabNo = {};
/** Как в PDF: {tab:ключ} → «табл. N» (исходный текст остаётся в поле правки). */
const shown = (text) => humanBlanks(text).replace(/{tab:([^}]+)}/g, (m, k) => (tabNo[k] ? 'табл. ' + tabNo[k] : '')).replace(/s+([.,;])/g, '$1');
const hhmm = () => new Date().toTimeString().slice(0, 5);
const numText = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const SPEC = [['Длина (L), мм', 'length', 1], ['Ширина (B), мм', 'width', 1], ['Высота (H), мм', 'height', 1], ['Ширина посадки (Bп), мм', 'seatWidth'],
  ['Высота посадки (Hп), мм', 'seatHeight'], ['Количество опор, шт', 'supports'], ['Объём перевозки (V), куб. м', 'shipVolume'], ['Масса, кг', 'weight', 1]];

/** Открыть окно паспорта. onClose(row, changed) — после закрытия. */
export async function openBookEditor(passport, { onClose } = {}) {
  let row;
  try { row = await api('/passports/' + (passport.id || passport)); } catch (e) { toastError(e); return; }
  const S = { r: row, changed: false, cur: null, fit: true, firms: null };
  const can = canWorkPassport();
  const pid = () => S.r.id;

  // ─── каркас окна ────────────────────────────────────────────────────────────
  const stat = h('span', { class: 'bk-stat', 'aria-live': 'polite' }, 'Правки сохраняются сразу при нажатии «Сохранить».');
  const toc = h('nav', { class: 'bk-toc', 'aria-label': 'Страницы паспорта' });
  const pages = h('div', { class: 'bk-pages bk-fit' });
  const scroller = h('div', { class: 'bk-scroll' }, pages);
  const head = h('div', { class: 'bk-head' });
  const win = h('div', { class: 'modal wide bk', role: 'dialog', 'aria-modal': 'true' },
    head, h('div', { class: 'bk-main' }, toc, scroller),
    h('div', { class: 'bk-foot' }, srcLegend(SRC_LABEL), stat));
  const back = h('div', { class: 'modal-back bk-back' }, win);

  const setStat = (t, tone) => { stat.textContent = t; stat.dataset.tone = tone || ''; };

  async function requestClose() {
    if (S.cur?.dirty() && !(await confirmDlg('Закрыть без сохранения?', 'В открытом поле есть несохранённая правка. Она пропадёт.', { okText: 'Закрыть без сохранения', danger: true }))) return;
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    onClose?.(S.r, S.changed);
  }
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-back:not(.bk-back)')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (S.cur) S.cur.cancel(); else requestClose();
  };

  // ─── правка на месте ────────────────────────────────────────────────────────
  let edits = []; // открывалки по порядку на странице — для Tab
  const patchPassport = (body) => api('/passports/' + pid(), { method: 'PATCH', body });
  async function reload(openNext) {
    S.r = await api('/passports/' + pid());
    S.changed = true;
    render(openNext);
  }

  /**
   * spec: { text, label, rows, options?, original?, save(text), shared?: { target(text), promote(text, token) } }.
   * view — элемент на странице; клик открывает поле вместо него.
   */
  function editable(view, spec) {
    if (!can || spec.readonly) return view;
    const idx = edits.length;
    view.classList.add('bk-edit');
    view.tabIndex = 0;
    view.setAttribute('role', 'button');
    view.title = 'Нажмите, чтобы править' + (view.title ? ' · ' + view.title : '');
    const open = () => openEditor(idx);
    view.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
    view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === view) { e.preventDefault(); open(); } });
    edits.push({ view, spec });
    return view;
  }

  function openEditor(idx) {
    if (S.cur) { if (S.cur.dirty()) { toast('Сначала сохраните или отмените правку в открытом поле'); S.cur.focus(); return; } S.cur.cancel(); }
    const { view, spec } = edits[idx];
    const ctl = spec.options
      ? select({ label: spec.label, value: spec.text, options: spec.options })
      : buildForm([{ key: 'text', label: spec.label, type: 'textarea', rows: spec.rows || 2, wide: true, max: 50000 }], { text: spec.text }).el.querySelector('textarea');
    if (!spec.options) ctl.classList.add('bk-ta');
    const isTa = !spec.options;
    const fit = () => { if (isTa) ctl.rows = Math.min(30, Math.max(spec.rows || 2, ctl.value.split('\n').length + (ctl.value.length > 60 ? 1 : 0))); };
    const st = h('span', { class: 'bk-st' });
    const dirty = () => ctl.value !== spec.text;
    let working = false;
    const srcState = {};
    const lock = (on) => { working = on; [local, shared, reset, cancelBtn].forEach((b) => b && (b.disabled = on)); ctl.disabled = on; };
    const finish = () => { S.cur = null; box.replaceWith(view); };
    const saveLocal = async (next) => {
      if (working) return;
      if (!dirty()) { if (next) goNext(idx, next); else finish(); return; }
      lock(true); st.textContent = 'Сохраняю…'; setStat('Сохраняю…', 'busy');
      try {
        await passportAction(pid(), () => spec.save(ctl.value));
        S.cur = null;
        setStat('Сохранено в ' + hhmm(), 'ok');
        await reload(next ? idx + next : undefined);
      } catch (e) { lock(false); st.textContent = 'Не сохранено'; setStat('Не сохранено', 'err'); toastError(e); }
    };
    const saveShared = async () => {
      if (working) return;
      lock(true); st.textContent = 'Проверяю справочник…';
      try {
        const pick = await pickSourceKey(spec.shared, box, srcState);
        if (pick.stop) { lock(false); st.textContent = pick.stop; return; }
        const sourceKey = pick.key;
        const t = await spec.shared.target(ctl.value, sourceKey);
        const text = 'Источник: ' + t.target + '. Затронет изделий: ' + t.affected + '. Новые сборки паспортов получат этот текст; этот и выданные паспорта не изменятся.';
        if (!(await confirmDlg('Сохранить в справочнике?', text, { okText: 'Сохранить в справочнике' }))) { lock(false); st.textContent = ''; return; }
        await spec.shared.promote(ctl.value, t.token, sourceKey);
        toast('Сохранено: ' + t.target + '. Текст этого паспорта не изменён.');
        setStat('В справочник сохранено в ' + hhmm(), 'ok');
        lock(false); finish();
      } catch (e) { lock(false); st.textContent = ''; toastError(e); }
    };
    const local = button({ label: 'Только в этом паспорте', kind: 'primary', size: 'S', title: 'Enter или Ctrl+Enter', onClick: () => saveLocal() });
    const shared = spec.shared && canEdit() ? button({ label: 'В справочник', size: 'S', title: 'Для всех изделий этой категории или источника', onClick: saveShared }) : null;
    const reset = spec.original != null && spec.original !== '' ? button({ label: 'Вернуть исходный', kind: 'ghost', size: 'S', title: 'Подставить текст из справочника, как было до правки', onClick: () => { ctl.value = spec.original; fit(); ctl.focus(); } }) : null;
    const cancelBtn = button({ label: 'Отмена', kind: 'ghost', size: 'S', title: 'Esc', onClick: () => { if (!working) finish(); } });
    const box = h('div', { class: 'bk-ed' }, ctl,
      h('div', { class: 'bk-ed-row' }, local, shared, reset, cancelBtn, st, h('span', { class: 'bk-keys' }, 'Enter — сохранить · Esc — отмена · Tab — дальше')));
    if (isTa) ctl.addEventListener('input', fit);
    ctl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (!working) finish(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey) && isTa) { e.preventDefault(); saveLocal(); }
      else if (e.key === 'Enter' && !isTa) { e.preventDefault(); saveLocal(); }
      else if (e.key === 'Tab') { e.preventDefault(); saveLocal(e.shiftKey ? -1 : 1); }
    });
    view.replaceWith(box);
    fit();
    S.cur = { dirty, cancel: () => { if (!working) finish(); }, focus: () => ctl.focus() };
    ctl.focus();
    box.scrollIntoView({ block: 'nearest' });
  }
  function goNext(idx, step) {
    S.cur?.cancel();
    const to = idx + step;
    if (edits[to]) openEditor(to);
  }

  // ─── спецификации правок ────────────────────────────────────────────────────
  const fieldSpec = (field, index, text, ref, rows, original) => {
    const url = '/passports/' + pid() + '/snapshot-field';
    const key = { field, ...(index === undefined ? {} : { index }) };
    return { text: String(text ?? ''), label: 'Текст строки', rows, original, save: (t) => api(url, { method: 'PATCH', body: { ...key, text: t } }),
      // нет ref (старый паспорт) — источник выбирается из списка /sources, как в карточке (field-edit.js)
      shared: { needsSource: !ref, sources: () => api(url + '/sources', { method: 'POST', body: key }).then((x) => x.items || []),
        target: (t, sourceKey) => api(url + '/target', { method: 'POST', body: { ...key, text: t, ...(sourceKey ? { sourceKey } : {}) } }),
        promote: (t, token, sourceKey) => api(url + '/promote', { method: 'POST', body: { ...key, text: t, token, ...(sourceKey ? { sourceKey } : {}) } }) } };
  };
  const itemSpec = (s, i) => {
    const url = '/passports/' + pid() + '/snapshot-item';
    const key = { sectionKey: s.key, itemKey: i.key };
    return { text: String(i.text ?? ''), label: 'Текст пункта', rows: 3, original: i.edited ? i.original : null, save: (t) => api(url, { method: 'PATCH', body: { ...key, text: t } }),
      shared: { target: (t) => api(url + '/target', { method: 'POST', body: { ...key, text: t } }), promote: (t, token) => api(url + '/promote', { method: 'POST', body: { ...key, text: t, token } }) } };
  };
  const scalarSpec = (label, text, save, extra = {}) => ({ text: String(text ?? ''), label, rows: 1, save, ...extra });

  // ─── блоки страниц ──────────────────────────────────────────────────────────
  const hd = (t) => h('h3', { class: 'bk-h' }, t);
  const sub = (t) => h('h4', { class: 'bk-sub bk-h' }, t);

  function textP(text, spec, src, { prefix, edited } = {}) {
    const view = h('p', { class: 'bk-p' }, prefix ? h('b', null, prefix + ' ') : null, shown(text) || h('span', { class: 'muted' }, 'пусто — нажмите, чтобы заполнить'),
      edited ? h('span', { class: 'bk-mark' }, ' · изменён для этого паспорта') : null);
    srcPaint(view, edited ? 'manual' : src, SRC_LABEL);
    return editable(view, spec);
  }
  const table = (cols, rows) => kitTable({ columns: cols.map((label) => ({ label })), rows: rows.map((cells) => ({ cells })) });
  const cell = (text, spec) => editable(h('span', { class: 'bk-cell' }, text || h('span', { class: 'muted' }, '—')), spec);

  function build() {
    const r = S.r, t = r.textSnapshot || {};
    const flow = [];
    const push = (...els) => flow.push(...els.filter(Boolean));
    const fe = t.fieldEdits || {}, refs = t.refs || {};
    const orig = (f, i) => { const e = i === undefined ? fe[f] : fe[f]?.[i]; return e ? e.original : null; };
    const edited = (f, i) => !!(i === undefined ? fe[f] : fe[f]?.[i]);
    const own = t.src ? 'product' : '';
    const plan = numbersOf(t);
    tabNo = {}; let tn = 1; tabNo.specs = 1;
    (t.maintenance || []).filter((m) => m.rows?.length).forEach((m, i) => { tn++; tabNo['to:' + m.period] = tn; if (i === 0) { tabNo.to = tn; tabNo.maintenance = tn; } });
    for (const k of ['bom', 'storage', 'faults', 'service', 'repairs']) tabNo[k] = ++tn;

    // обложка
    const org = r.supplierOrg || {};
    const orgName = org.shortName || org.name || '';
    const firmView = h('div', { class: 'bk-firm' }, orgName || h('span', { class: 'muted' }, 'Фирма не выбрана'));
    const cover = h('div', { class: 'bk-cover' },
      h('div', { class: 'bk-band' }, editable(firmView, scalarSpec('Фирма', r.supplierOrgId || org.id || '', (v) => patchPassport({ supplierOrgId: v }), { options: S.firms || [[r.supplierOrgId || '', orgName]], readonly: !S.firms })),
        org.trademark ? h('span', { class: 'bk-tm' }, `«${String(org.trademark).replace(/[«»"]/g, '')}»`) : null),
      [org.phone ? 'Тел.: ' + org.phone : '', org.email ? 'E-mail: ' + org.email : ''].filter(Boolean).length ? h('p', { class: 'bk-contacts' }, [org.phone ? 'Тел.: ' + org.phone : '', org.email ? 'E-mail: ' + org.email : ''].filter(Boolean).join(' · ')) : null,
      h('p', { class: 'bk-ptitle' }, 'ПАСПОРТ № ' + (numberOf(r) || '—')),
      editable(h('p', { class: 'bk-pname' }, r.name || h('span', { class: 'muted' }, 'Название не задано')), scalarSpec('Название изделия', r.name, (v) => patchPassport({ name: v }))),
      r.productCode || statusOf(r) === 'issued'
        ? editable(h('p', { class: 'bk-pcode' }, 'Номер изделия: ', r.productCode || '—'),
          scalarSpec('Номер изделия', r.productCode, (v) => patchPassport({ productCode: v, confirmNumbers: true }), { readonly: !(canEdit() && statusOf(r) === 'issued') }))
        : null,
      imageStrip('overview', 'Общий вид'));
    cover.dataset.title = 'Обложка';
    const pagesOut = [{ blocks: [cover], cover: true }];

    // описание и правила
    const descrSection = () => {
      if (!plan.descrNo) return;
      push(hd(`${plan.descrNo} Описание и назначение`));
      let k = 0;
      if (t.description) { push(sub(`${plan.descrNo}.${++k} Описание изделия`), textP(t.description, fieldSpec('description', undefined, t.description, refs.description, 6, orig('description')), t.src?.description, { edited: edited('description') })); }
      if (t.purpose) { push(sub(`${plan.descrNo}.${++k} Назначение`), textP(t.purpose, fieldSpec('purpose', undefined, t.purpose, refs.purpose, 3, orig('purpose')), t.src?.purpose, { edited: edited('purpose') })); }
      push(sub(`${plan.descrNo}.${++k} Основные технические данные`), specTable());
      if (plan.rulesNo === plan.descrNo && t.rules?.length) { push(sub(`${plan.descrNo}.${++k} Правила пользования`)); rulesList(); }
    };
    const rulesList = () => (t.rules || []).forEach((x, i) => push(textP('— ' + x, { ...fieldSpec('rules', i, x, refs.rules?.[i], 3, orig('rules', i)) }, own, { edited: edited('rules', i) })));
    const rulesSection = () => { if (plan.rulesNo && plan.rulesNo !== plan.descrNo && t.rules?.length) { push(hd(`${plan.rulesNo} Правила пользования`)); rulesList(); } };
    const firstSec = (plan.sectionNo || []).find(Boolean);
    const before = plan.descrNo && firstSec ? parseInt(plan.descrNo, 10) < parseInt(firstSec, 10) : !!plan.descrNo && !firstSec;
    if (before) { descrSection(); rulesSection(); }
    (t.sections || []).forEach((s, si) => {
      if (!plan.sectionNo[si] || !s.items?.length) return;
      push(hd(`${plan.sectionNo[si]} ${s.title}`));
      for (const i of s.items) {
        const no = plan.itemNo(si, i.number);
        push(textP(i.text, itemSpec(s, i), i.src, { prefix: no || (i.bullet ? '—' : ''), edited: i.edited }));
      }
      if (plan.mergeInstall && si === plan.mountIdx) installBlocks(plan.sectionNo[si]);
    });
    if (!before) { descrSection(); rulesSection(); }

    // обслуживание
    const maint = (t.maintenance || []).filter((m) => m.rows?.length);
    if (plan.toNo && maint.length) {
      push(hd(`${plan.toNo} Техническое обслуживание (чек-лист)`));
      let mi = 0;
      for (const m of maint) {
        push(sub('Осмотр и обслуживание: ' + m.period), table(['Отм.', 'Что проверить', 'Где', 'Мера', 'Допуск'], m.rows.map((x) => {
          const index = mi++;
          return ['☐', cell(shown(x.what), fieldSpec('maintenance', index, x.what, refs.maintenance?.[index], 3, orig('maintenance', index))), x.where || '', x.measure || '', x.tolerance || ''];
        })));
      }
    }
    if (!plan.mergeInstall && plan.installNo) { push(hd(`${plan.installNo} Монтаж`)); installBlocks(plan.installNo); }

    function installBlocks() {
      const steps = String(t.install?.text || '').split(/\r?\n/).filter(Boolean);
      const e = edited('install');
      if (steps.length || can) {
        const view = h('div', { class: 'bk-p' }, steps.length ? h('ol', null, ...steps.map((x) => h('li', null, x))) : h('span', { class: 'muted' }, 'Шаги монтажа — нажмите, чтобы заполнить'),
          e ? h('span', { class: 'bk-mark' }, ' · изменено для этого паспорта') : null);
        srcPaint(view, e ? 'manual' : t.src?.install, SRC_LABEL);
        push(editable(view, fieldSpec('install', undefined, t.install?.text || '', refs.install, 8, orig('install'))));
      }
      const req = (t.install?.requirements || []).filter(Boolean);
      if (req.length) { const v = h('div', { class: 'bk-p' }, h('b', null, 'Требования к основанию:'), h('ul', null, ...req.map((x) => h('li', null, String(x))))); srcPaint(v, t.src ? 'product' : '', SRC_LABEL); push(v); }
    }

    // комплектность
    const bomNo = plan.installNo ? String((parseInt(plan.installNo, 10) || 0) + 1) : '';
    push(hd(bomNo ? `${bomNo} Комплектность` : 'Комплектность'), bomTable());

    // приложения: рисунки
    const imgPages = kinds(r).filter(([k]) => k !== 'overview' && (imgsOf(r, k).length || isRequired(r, k)));
    const out = [...pagesOut];
    out.push({ flow });
    for (const [k, label] of imgPages) {
      const blk = h('div', { class: 'bk-appx' }, hd('Рисунок: ' + label), imageStrip(k, label, true));
      blk.dataset.title = 'Рисунок: ' + label;
      out.push({ blocks: [blk], own: true });
    }
    return out;
  }

  function specTable() {
    const r = S.r;
    const rows = SPEC.filter(([, key, always]) => always || r[key] !== undefined && r[key] !== null && r[key] !== '')
      .map(([label, key]) => [label, cell(numText(r[key]), scalarSpec(label, numText(r[key]), (v) => {
        const n = Number(String(v).trim().replace(',', '.'));
        if (!String(v).trim() || !Number.isFinite(n)) throw new Error('Введите число');
        return patchPassport({ [key]: n });
      }))]);
    return table(['Наименование', 'Значение'], rows);
  }
  function bomTable() {
    const r = S.r;
    const rows = bomRows(r.bom?.length ? r.bom : [{ code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }]);
    const save = (i, key, v) => { const next = rows.map((x) => ({ ...x })); next[i][key] = v; return patchPassport({ bom: parseBom(next, r.bom) }); };
    const real = !!r.bom?.length;
    return table(['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'], rows.map((b, i) => [String(i + 1),
      ...['code', 'name', 'qty', 'unit', 'note'].map((key) => cell(String(b[key] ?? ''), scalarSpec('Комплектность', b[key], (v) => save(i, key, v), { readonly: !real })))]));
  }

  /** Картинки вида: показ, «×» — убрать, зона «добавить / заменить». */
  function imageStrip(kind, label, full) {
    const r = S.r;
    const list = imgsOf(r, kind);
    const std = (r.standardImages || []).filter((x) => x.kind === kind && x.url);
    const save = async (images) => { await patchPassport({ images: imagesBody(images) }); S.r = await api('/passports/' + pid()); S.changed = true; };
    const wrap = h('div', { class: 'bk-imgs' + (full ? ' bk-imgs-full' : '') });
    list.forEach((i) => wrap.append(h('figure', { class: 'bk-fig' },
      i.url ? h('img', { src: PREFIX + i.url, alt: i.caption || label }) : h('span', { class: 'muted' }, 'нет файла'),
      can ? iconButton({ icon: '×', label: 'Убрать картинку', size: 'S', onClick: async () => {
        if (!(await confirmDlg('Убрать картинку?', label + ': картинка исчезнет из паспорта.', { okText: 'Убрать' }))) return;
        try { await save((r.images || []).filter((x) => x !== i)); render(); } catch (e) { toastError(e); }
      } }) : null)));
    if (!list.length && std.length) wrap.append(h('p', { class: 'bk-mark' }, 'Стандартная схема попадёт в паспорт; своя картинка её заменит.'), ...std.map((i) => h('figure', { class: 'bk-fig' }, h('img', { src: PREFIX + i.url, alt: label }))));
    if (!list.length && !std.length) wrap.append(h('p', { class: 'bk-noimg' }, (isRequired(r, kind) ? 'Нет картинки — обязательна. ' : 'Нет картинки. ') + label));
    if (can) wrap.append(photoDrop({ attach: async (photoId) => { await save([...(r.images || []), { kind, photoId, order: list.length }]); return S.r; }, done: () => render(), idleText: list.length ? 'Добавить ещё или заменить: перетащите / Ctrl+V' : 'Перетащите или вставьте Ctrl+V' }));
    return wrap;
  }

  // ─── отрисовка и разбивка на страницы ───────────────────────────────────────
  function render(openNext) {
    S.cur = null; edits = [];
    const keep = scroller.scrollTop;
    const defs = build();
    pages.replaceChildren();
    const mk = (title) => {
      const body = h('div', { class: 'bk-body' });
      const page = h('section', { class: 'bk-page', 'aria-label': title || 'Страница' }, body);
      pages.append(page);
      return { page, body };
    };
    // высота тела листа: ширина × 210/148 минус поля (7cqw сверху, 11cqw снизу)
    const room = (p) => p.clientWidth * (210 / 148 - 0.18);
    for (const d of defs) {
      if (d.blocks) { for (const b of d.blocks) { const p = mk(b.dataset.title); p.body.append(b); } continue; }
      let cur = mk();
      for (const b of d.flow) {
        cur.body.append(b);
        if (cur.body.getBoundingClientRect().height > room(cur.page) + 1 && cur.body.children.length > 1) {
          const prev = cur.body.children[cur.body.children.length - 2];
          const move = [b];
          if (prev?.classList.contains('bk-h') && cur.body.children.length > 2) move.unshift(prev);
          cur = (() => { const p = mk(); p.body.append(...move); return p; })();
        }
      }
    }
    [...pages.children].forEach((p, i) => { p.dataset.no = String(i + 1); p.append(h('div', { class: 'bk-pno' }, `${(S.r.supplierOrg?.shortName || S.r.supplierOrg?.name || '')} · ${heading(S.r)} · стр. ${i + 1}/${pages.children.length}`)); });
    toc.replaceChildren(...[...pages.children].map((p, i) => {
      const title = p.querySelector('.bk-h')?.textContent?.split('\n')[0] || p.querySelector('[data-title]')?.dataset.title || p.getAttribute('aria-label');
      return button({ label: 'стр. ' + (i + 1) + ' · ' + title, title, kind: 'ghost', size: 'S', cls: 'bk-toc-i', onClick: () => p.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
    }));
    scroller.scrollTop = keep;
    paintHead();
    if (typeof openNext === 'number' && edits[openNext]) openEditor(openNext);
  }

  function paintHead() {
    const r = S.r;
    const issued = statusOf(r) === 'issued';
    const zoom = (fit) => { S.fit = fit; pages.classList.toggle('bk-fit', fit); pages.classList.toggle('bk-100', !fit); paintHead(); };
    const primary = issued
      ? button({ label: 'Сохранить и выпустить заново', kind: 'primary', disabled: !S.changed, title: S.changed ? 'Номер тот же; PDF соберётся из текущих данных' : 'Сначала измените любое поле — тогда кнопка станет активной', onClick: async () => {
        if (S.cur?.dirty()) { toast('Сначала сохраните или отмените правку в открытом поле'); S.cur.focus(); return; }
        S.r = await api('/passports/' + pid());
        toast('Паспорт № ' + numberOf(S.r) + ' обновлён. Номер тот же.');
        await printDialog(S.r);
      } })
      : button({ label: 'Выпустить', kind: 'primary', onClick: async () => {
        if (S.cur?.dirty()) { toast('Сначала сохраните или отмените правку в открытом поле'); S.cur.focus(); return; }
        if (!(await confirmDlg('Выпустить паспорт?', 'Паспорт получит номер и гарантийный талон. Правки потом остаются доступны.', { okText: 'Выпустить' }))) return;
        try { const x = await api(`/passports/${pid()}/issue`, { method: 'POST' }); toast('Выпущен паспорт № ' + x.passportNumber); S.changed = true; S.r = await api('/passports/' + pid()); render(); } catch (e) { toastError(e); }
      } });
    head.replaceChildren(
      h('h2', null, heading(r), r.name ? ' · ' + r.name : '', ' ', badge(issued ? 'выпущен' : statusOf(r) === 'annulled' ? 'аннулирован' : 'черновик', issued ? 'ok' : 'warn')),
      h('div', { class: 'bk-acts' },
        r.printSource === 'file' || r.printFile?.hasFile ? h('span', { class: 'bk-mark' }, 'К номеру прикреплён свой PDF — печать отдаёт его. ') : null,
        button({ label: 'По ширине', size: 'S', kind: S.fit ? 'primary' : 'ghost', onClick: () => zoom(true) }),
        button({ label: '100 %', size: 'S', kind: S.fit ? 'ghost' : 'primary', onClick: () => zoom(false) }),
        button({ label: 'Скачать PDF', size: 'S', onClick: () => printDialog(S.r) }),
        statusOf(r) === 'annulled' ? null : primary,
        button({ label: 'Закрыть', kind: 'ghost', onClick: requestClose })));
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  try { S.firms = (await ourCompanies()).map((o) => [o.id, o.name]); } catch { S.firms = null; }
  render();
  back.addEventListener('mousedown', (e) => { if (e.target === back) requestClose(); });
}
