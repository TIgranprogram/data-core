import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { attachCombo } from './kit/index.js';
import { tagPick } from './kit/index.js';
import { toast, toastError } from './kit/toast.js';

/*
 * Материалы изделия таблицей (Фаза МИ.2/МИ.4/МИ.5): поле `type: 'widget'` правой панели, вид — как «Комплектность» (.rt-table).
 * Строка (C055 Э0): Часть (метки, «Части изделия») · Материал (тип «материал») · Размеры (из «Сортамента» или свои) · ×;
 * ниже — Покрытие (тип «покрытие») и собранный текст (POST /showcase/materials-text).
 * Новое значение, которого нет в справочнике, — «Сохранить в справочник?» (директор / админ; без дублей — поиск «как на складе»);
 * остальным размер остаётся просто значением строки, часть без справочника в изделие не попадает (сервер берёт только записи).
 *   materialsSpec({ value, dicts, text?, scope?(), actions?: [{ label, title, run(w) }], preview = true, onText?(t) })
 *   → { el, value — JSON { rows, coatingIds } или '', set value, spec(), focus, onText }
 */
const MAX_ROWS = 50, MAX_SIZES = 20, MAX_PARTS = 30;
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Размер — одно написание, как на сервере (normSize): без «мм», ∅ и ×, десятичная запятая. */
export const normSize = (v) => s(v).replace(/\s*мм\.?$/i, '').replace(/^[∅Ø⌀ø]\s*/, '∅').replace(/(\d)\s*[xхXХ*×]\s*(?=\d)/g, '$1×').replace(/(\d)\.(?=\d)/g, '$1,');
const sizeKey = (v) => normSearch(normSize(v));
/** «∅89×3; ∅33,5×2,8» или «2, 6» → список (запятая между цифрами — десятичная, не разделитель). */
export const splitSizes = (t) => String(t ?? '').split(/\s*;\s*|,\s+|\n/).map(normSize).filter(Boolean);
const codes = (v) => String(v || '').split(/[,;\s]+/).filter(Boolean);

/** Директор и админ правят справочники группы «Паспорта» (editRoles: director). */
export const canEditPassportDicts = () => session.canEdit && (session.user?.isOwner === true || ['admin', 'director'].includes(session.role));

/** Справочники таблицы — при каждом открытии формы (свежие: новые значения видны сразу). */
export async function loadMaterialDicts() {
  const get = (k) => api('/dicts/' + k).then((r) => r.items || []).catch(() => []);
  const [mats, sortament, parts] = await Promise.all([get('passportMaterials'), get('passportSortament'), get('passportParts')]);
  return { mats, sortament, parts };
}

const parseSpec = (v) => {
  let x = v;
  if (typeof x === 'string') { try { x = JSON.parse(x || 'null'); } catch { x = null; } }
  return x && typeof x === 'object' && !Array.isArray(x) ? { rows: Array.isArray(x.rows) ? x.rows : [], coatingIds: Array.isArray(x.coatingIds) ? x.coatingIds.map(String) : [] } : { rows: [], coatingIds: [] };
};

export function materialsSpec({ value, dicts, text = '', scope = () => '', actions = [], preview: showPreview = true, onText }) {
  const d = { mats: dicts?.mats || [], sortament: dicts?.sortament || [], parts: dicts?.parts || [] };
  const isCoat = (m) => m.kind === 'coating';
  // МИ: «Не предлагать в новых» — нет в выборе; где уже выбрано — показывается как есть. «Неполный размер» — ниже полных
  const yes = (v) => v === true || v === 'true';
  const offered = (m, keep = []) => !yes(m.hideInNew) || keep.includes(String(m.id));
  const matBy = () => new Map(d.mats.map((m) => [String(m.id), m]));
  const partBy = () => new Map(d.parts.map((p) => [String(p.id), p]));
  const findMat = (t, keep) => { const k = normSearch(t); return k ? d.mats.find((m) => !isCoat(m) && offered(m, [keep]) && normSearch(m.name) === k) : null; };
  const findSize = (code, t) => d.sortament.find((x) => String(x.material || '').toUpperCase() === code && sizeKey(x.name) === sizeKey(t));
  const partKeys = (p) => [p.name, p.genSingular, p.genPlural].map(normSearch).filter(Boolean);
  const findPart = (t) => { const k = normSearch(t); return k ? d.parts.find((p) => partKeys(p).includes(k)) : null; };
  const canDict = canEditPassportDicts();
  // материалы/покрытия: пустые categories = «для всех»; части: пустые = «ещё не размечены» — при категории не показываем
  const own = (cats, { strict = false } = {}) => {
    const c = scope(); if (!c) return true;
    const list = codes(cats); if (!list.length) return !strict;
    return list.includes(c);
  };
  const sorted = (list, strict = false) => {
    const c = scope(); if (!c) return list;
    return [...list.filter((x) => own(x.categories, { strict })), ...list.filter((x) => !own(x.categories, { strict }))];
  };
  const groupOf = (x, strict = false) => (scope() ? (own(x.categories, { strict }) ? 'Для категории паспорта' : 'Другие') : undefined);
  let showAllParts = false;
  const partsBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, onclick: () => {
    showAllParts = !showAllParts; partsBtn.textContent = showAllParts ? 'Только части категории' : 'Показать все части';
    rows.forEach((r) => r.paint?.());
  } }, 'Показать все части');
  const syncPartsBtn = () => {
    const c = scope();
    const foreign = c ? d.parts.filter((p) => !own(p.categories, { strict: true })).length : 0;
    partsBtn.hidden = !c || (!foreign && !showAllParts);
    if (!showAllParts) partsBtn.textContent = foreign ? `Показать все части (ещё ${foreign})` : 'Показать все части';
  };

  const body = h('tbody');
  const rows = []; // { tr, materialId, sizes[], parts[{ id, name }], matIn, paint() }
  const pending = []; // МИ.5: новые значения «Сохранить в справочник?» — { type: 'size'|'part', name, code?, mat? }
  const newBox = h('div', { class: 'ms-new', hidden: true, role: 'status' });
  const el = h('div', { class: 'rt ms' });
  let emitting = false;
  const changed = () => { if (emitting) return; el.dispatchEvent(new Event('input', { bubbles: true })); preview(); };

  /** Ячейка меток: выбранные — метками с «×», поле «+ …» со списком; Enter / уход из поля — добавить вписанное. */
  function chipCell({ label, placeholder, options, empty, chips, onAdd, onRemove }) {
    const list = h('span', { class: 'ms-chip-list' });
    const input = h('input', { class: 'ms-add', placeholder, 'aria-label': label });
    const wrap = h('span', { class: 'ms-add-wrap' }, input);
    attachCombo(input, { options, empty: () => empty(input.value.trim()) });
    const take = () => { const t = input.value.trim(); if (!t) return; input.value = ''; input.title = ''; onAdd(t); };
    input.addEventListener('change', take);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); take(); }
      else if (e.key === 'Backspace' && !input.value && chips().length) onRemove(chips().length - 1);
    });
    const paint = () => list.replaceChildren(...chips().map((c, i) => h('span', { class: 'ms-chip' + (c.foreign ? ' foreign' : ''), title: c.title || '' }, c.text,
      h('button', { type: 'button', class: 'ms-x', title: `Убрать ${c.text}`, 'aria-label': `Убрать ${c.text}`, onclick: () => { onRemove(i); input.focus(); } }, '×'))));
    return { el: h('div', { class: 'ms-chips' }, list, wrap), paint, input };
  }

  function addRow(data = {}) {
    if (rows.length >= MAX_ROWS) { toast(`Не больше ${MAX_ROWS} строк`); return null; }
    const pb = partBy();
    const row = {
      materialId: String(data.materialId || ''), sizes: (data.sizes || []).map(normSize).filter(Boolean),
      parts: (data.partIds || []).map((id) => ({ id: String(id), name: pb.get(String(id))?.name || 'запись удалена из справочника' })).concat((data.partNames || []).map((n) => { const p = findPart(n); return p ? { id: String(p.id), name: p.name } : { id: null, name: s(n) }; })),
    };
    const code = () => String(matBy().get(row.materialId)?.code || '').toUpperCase();
    const matIn = h('input', { value: data.matText ?? (row.materialId ? matBy().get(row.materialId)?.name || '' : ''), placeholder: row.materialId && !matBy().get(row.materialId) ? 'запись удалена — выберите заново' : 'Материал', 'aria-label': 'Материал' });
    const matWrap = h('span', { class: 'ms-add-wrap' }, matIn);
    attachCombo(matIn, {
      options: () => sorted(d.mats.filter((m) => !isCoat(m) && offered(m))).map((m) => ({ value: String(m.id), label: m.name, group: groupOf(m) })),
      empty: () => (matIn.value.trim() ? 'Нет в справочнике — выберите из списка (новый материал добавляют в «Справочники → Паспорта → Материалы и покрытия»)' : 'В справочнике «Материалы и покрытия» нет материалов'),
    });
    const resolveMat = () => {
      const t = matIn.value.trim(); const hit = findMat(t, row.materialId);
      if (hit) { row.materialId = String(hit.id); matIn.value = hit.name; } else row.materialId = '';
      matIn.classList.toggle('ms-bad', !!t && !hit);
      matIn.title = t && !hit ? 'Только из справочника «Материалы и покрытия»' : matIn.value;
      // размеры, что есть в «Сортаменте» нового материала, — без пометки; остальные — свои значения
      sizes.paint(); changed();
    };
    matIn.addEventListener('change', resolveMat);

    const sizes = chipCell({
      label: 'Размеры', placeholder: '+ размер',
      options: () => {
        const list = d.sortament.filter((x) => code() && String(x.material || '').toUpperCase() === code() && !row.sizes.some((z) => sizeKey(z) === sizeKey(x.name)));
        return [...list.filter((x) => !yes(x.incomplete)), ...list.filter((x) => yes(x.incomplete))].map((x) => ({ value: x.name, label: x.name, ...(yes(x.incomplete) ? { sub: 'неполный размер' } : {}) }));
      },
      empty: (t) => (t ? 'Нет в «Сортаменте» — Enter добавит как написали' : !row.materialId ? 'Сначала выберите материал' : 'У материала нет размеров в «Сортаменте» — впишите свой и нажмите Enter'),
      chips: () => row.sizes.map((z) => { const known = !!findSize(code(), z); return { text: z, foreign: !known, title: known ? '' : 'Нет в справочнике «Сортамент» — останется значением этой строки' }; }),
      onAdd: (t) => {
        for (const z0 of splitSizes(t)) {
          const hit = code() ? findSize(code(), z0) : null; const z = hit ? hit.name : z0;
          if (row.sizes.some((x) => sizeKey(x) === sizeKey(z))) { toast(`«${z}» уже есть в строке`); continue; }
          if (row.sizes.length >= MAX_SIZES) { toast(`Размеров в строке — не больше ${MAX_SIZES}`); break; }
          if (z.length > 40) { toast('Размер длиннее 40 знаков — сократите'); continue; }
          row.sizes.push(z);
          if (!hit && canDict && code()) ask({ type: 'size', name: z, code: code(), mat: matBy().get(row.materialId)?.name || '' });
        }
        sizes.paint(); changed();
      },
      onRemove: (i) => { row.sizes.splice(i, 1); sizes.paint(); paintNew(); changed(); },
    });
    const parts = chipCell({
      label: 'Часть', placeholder: '+ часть',
      options: () => {
        const free = d.parts.filter((p) => !row.parts.some((x) => x.id === String(p.id)));
        const list = (scope() && !showAllParts) ? free.filter((p) => own(p.categories, { strict: true })) : sorted(free, true);
        syncPartsBtn();
        return list.map((p) => ({ value: String(p.id), label: p.name, group: groupOf(p, true) }));
      },
      empty: (t) => {
        if (t) return canDict ? 'Нет в «Частях изделия» — Enter добавит, справочник предложит сохранить' : 'Нет в «Частях изделия» — добавить может директор или администратор';
        if (scope() && !showAllParts) return 'Нет частей этой категории — «Показать все части» или добавьте свою';
        return 'Справочник «Части изделия» пуст';
      },
      chips: () => row.parts.map((p) => {
        const rec = p.id ? partBy().get(String(p.id)) : null;
        const foreign = !p.id || (scope() && rec && !own(rec.categories, { strict: true }));
        return { text: p.name, foreign, title: !p.id ? (canDict ? 'Нет в справочнике — сохраните ниже' : 'Нет в справочнике — в изделие не попадёт') : foreign ? 'Не для этой категории паспорта' : '' };
      }),
      onAdd: (t) => {
        for (const n of t.split(/\s*[;,]\s*/).map(s).filter(Boolean)) {
          const hit = findPart(n); const p = hit ? { id: String(hit.id), name: hit.name } : { id: null, name: n };
          if (row.parts.some((x) => (p.id ? x.id === p.id : normSearch(x.name) === normSearch(p.name)))) { toast(`«${p.name}» уже есть в строке`); continue; }
          if (row.parts.length >= MAX_PARTS) { toast(`Частей в строке — не больше ${MAX_PARTS}`); break; }
          row.parts.push(p);
          if (!p.id) { if (canDict) ask({ type: 'part', name: p.name }); else toast(`«${p.name}» нет в справочнике «Части изделия» — в изделие не попадёт. Добавить может директор или администратор`, { ms: 7000 }); }
        }
        parts.paint(); changed();
      },
      onRemove: (i) => { row.parts.splice(i, 1); parts.paint(); paintNew(); changed(); },
    });
    const tr = h('tr', null,
      h('td', { class: 'rt-n' }),
      h('td', { 'data-label': 'Часть' }, parts.el),
      h('td', { 'data-label': 'Материал' }, matWrap),
      h('td', { 'data-label': 'Размеры' }, sizes.el),
      h('td', { class: 'ms-del' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', title: 'Убрать строку', 'aria-label': 'Убрать строку',
        onclick: () => { rows.splice(rows.indexOf(row), 1); tr.remove(); if (!rows.length) addRow(); renum(); paintNew(); changed(); } }, '×')));
    Object.assign(row, { tr, matIn, paint: () => { sizes.paint(); parts.paint(); } });
    rows.push(row); body.append(tr); row.paint(); renum();
    if (data.matText && !row.materialId) resolveMat(); // вставка из Excel: название → запись справочника
    return row;
  }
  const renum = () => rows.forEach((r, i) => {
    r.tr.firstChild.textContent = String(i + 1);
    r.matIn.setAttribute('aria-label', `Материал, строка ${i + 1}`);
    const x = r.tr.querySelector('.ms-del button'); x.setAttribute('aria-label', `Убрать строку ${i + 1}`); x.title = `Убрать строку ${i + 1}`;
  });

  // МИ.5: «Сохранить в справочник?» — строка под таблицей на каждое новое значение
  function ask(p) {
    if (pending.some((x) => x.type === p.type && (p.type === 'size' ? x.code === p.code && sizeKey(x.name) === sizeKey(p.name) : normSearch(x.name) === normSearch(p.name)))) return;
    pending.push(p); paintNew();
  }
  const stillUsed = (p) => (p.type === 'size'
    ? rows.some((r) => String(matBy().get(r.materialId)?.code || '').toUpperCase() === p.code && r.sizes.some((z) => sizeKey(z) === sizeKey(p.name)) && !findSize(p.code, p.name))
    : rows.some((r) => r.parts.some((x) => !x.id && normSearch(x.name) === normSearch(p.name))));
  function paintNew() {
    for (let i = pending.length - 1; i >= 0; i--) if (!stillUsed(pending[i])) pending.splice(i, 1);
    newBox.hidden = !pending.length;
    newBox.replaceChildren(...(pending.length ? [h('b', null, 'Нет в справочнике — сохранить?'),
      ...pending.map((p) => h('div', { class: 'ms-new-row' },
        h('span', null, `«${p.name}» · ${p.type === 'size' ? `Сортамент${p.mat ? ', ' + p.mat : ''}` : 'Части изделия'}`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => save(p, e.currentTarget) }, 'Сохранить в справочник'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Оставить только в этой строке', onclick: () => { pending.splice(pending.indexOf(p), 1); paintNew(); } }, 'Не надо')))] : []));
  }
  async function save(p, btn) {
    btn.disabled = true; btn.classList.add('is-busy'); btn.textContent = 'Сохраняю…';
    const reload = async (k) => (await api('/dicts/' + k).catch(() => ({ items: [] }))).items || [];
    try {
      if (p.type === 'size') {
        if (!findSize(p.code, p.name)) {
          try { d.sortament.push(await api('/dicts/passportSortament', { method: 'POST', body: { name: p.name, material: p.code } })); }
          catch (e) { if (e.status !== 409) throw e; d.sortament = await reload('passportSortament'); } // уже добавил кто-то другой — берём его
        }
        // одно написание — как в справочнике
        const hit = findSize(p.code, p.name);
        if (hit) for (const r of rows) if (String(matBy().get(r.materialId)?.code || '').toUpperCase() === p.code) r.sizes = r.sizes.map((z) => (sizeKey(z) === sizeKey(hit.name) ? hit.name : z));
        toast(`«${hit?.name || p.name}» — в справочнике «Сортамент»`);
      } else {
        let hit = findPart(p.name);
        if (!hit) {
          try { hit = await api('/dicts/passportParts', { method: 'POST', body: { name: p.name } }); d.parts.push(hit); }
          catch (e) { if (e.status !== 409) throw e; d.parts = await reload('passportParts'); hit = findPart(p.name); }
        }
        if (hit) for (const r of rows) r.parts = r.parts.map((x) => (!x.id && normSearch(x.name) === normSearch(p.name) ? { id: String(hit.id), name: hit.name } : x));
        toast(`«${hit?.name || p.name}» — в справочнике «Части изделия»`);
      }
      pending.splice(pending.indexOf(p), 1);
      rows.forEach((r) => r.paint()); paintNew(); changed();
    } catch (e) { toastError(e); btn.disabled = false; btn.classList.remove('is-busy'); btn.textContent = 'Сохранить в справочник'; }
  }

  // покрытия — метками (обычно одно-два)
  const coatOpts = d.mats.filter((m) => isCoat(m) && offered(m, parseSpec(value).coatingIds)).map((m) => ({ value: String(m.id), label: m.name, cats: codes(m.categories) }));
  const coat = tagPick({ options: coatOpts, value: [], label: 'Покрытие' });
  const syncCoat = () => { try { coat.setScope(scope() || ''); } catch { /* scope ещё не готов */ } };
  syncCoat();
  coat.el.addEventListener('change', (e) => { e.stopPropagation(); changed(); });
  const coatLink = h('a', { href: '#dicts?d=passportMaterials', class: 'hint', title: 'Справочники → Паспорта → Материалы и покрытия. Поиск: «цинк» или GALV_HOT' }, 'Править в справочнике');
  const coatBox = h('div', { class: 'ms-coat' }, h('div', { class: 'ms-sub' }, 'Покрытие · ', coatLink),
    coatOpts.length ? coat.el : h('span', { class: 'muted' }, 'В «Материалах и покрытиях» нет записей с типом «покрытие»'));

  // вставка из Excel: по умолчанию Часть · Материал · Размеры; шапка или старый порядок Материал · Размеры · Часть — тоже
  body.addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(t.trim()) || !e.target.closest('td')) return;
    e.preventDefault();
    let lines = t.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
    let order = 'part-mat-size'; // C055 Э0
    if (lines.length) {
      const hdr = lines[0].map((c) => normSearch(c));
      const looksHead = hdr.some((c) => /материал|размер|часть|изчего/.test(c));
      if (looksHead) {
        const iP = hdr.findIndex((c) => /часть|изчего/.test(c));
        const iM = hdr.findIndex((c) => /материал/.test(c));
        const iZ = hdr.findIndex((c) => /размер/.test(c));
        lines = lines.slice(1);
        if (iM === 0 && (iZ === 1 || iP === 2)) order = 'mat-size-part';
        else if (iP >= 0 || iM >= 0) {
          for (const cols of lines) {
            const p = iP >= 0 ? cols[iP] : ''; const m = iM >= 0 ? cols[iM] : ''; const z = iZ >= 0 ? cols[iZ] : '';
            cols[0] = p; cols[1] = m; cols[2] = z;
          }
          order = 'part-mat-size';
        }
      }
    }
    // строка, в которую вставили, пустая — её заменяют вставленные; иначе строки добавляются в конец
    const r0 = rows.find((r) => r.tr === e.target.closest('tr'));
    if (r0 && !r0.materialId && !r0.sizes.length && !r0.parts.length && !r0.matIn.value.trim()) { rows.splice(rows.indexOf(r0), 1); r0.tr.remove(); }
    emitting = true;
    for (const cols of lines) {
      const [a = '', b = '', c = ''] = cols;
      const [p, m, z] = order === 'mat-size-part' ? [c, a, b] : [a, b, c];
      if (!addRow({ matText: m.trim(), sizes: splitSizes(z), partNames: String(p).split(/\s*[;,]\s*/).filter(Boolean) })) break;
    }
    if (!rows.length) addRow();
    renum();
    emitting = false;
    if (canDict) rows.forEach((r) => {
      const c = String(matBy().get(r.materialId)?.code || '').toUpperCase();
      if (c) for (const z of r.sizes) if (!findSize(c, z)) ask({ type: 'size', name: z, code: c, mat: matBy().get(r.materialId)?.name || '' });
      for (const x of r.parts) if (!x.id) ask({ type: 'part', name: x.name });
    });
    changed();
  });

  // собранный текст «Изготовлено из…» — тем же сервером, что печать (по изменению, с задержкой)
  const textEl = h('p', { class: 'ms-text' });
  const textNote = h('small', { class: 'muted' }, 'собрано автоматически');
  const textBox = h('div', { class: 'ms-preview', hidden: !showPreview }, h('div', { class: 'ms-sub' }, 'Текст для паспорта'), textEl, textNote);
  let cur = text || ''; let seq = 0; let timer;
  const problem = () => { const i = rows.findIndex((r) => !r.materialId && (r.sizes.length || r.parts.length || r.matIn.value.trim())); return i < 0 ? '' : `Строка ${i + 1}: выберите материал из списка`; };
  // без предпросмотра (паспорт: текст — в своём поле) блок виден только с ошибкой строки
  const show = (t, bad = false) => { textEl.textContent = t; textEl.classList.toggle('ms-bad-text', bad); textNote.hidden = bad || !cur; textBox.hidden = !showPreview && !bad; };
  const emitText = (t) => { cur = t; w.onText?.(t); };
  function preview() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq; const sp = spec(); const bad = problem();
      if (bad) { show(bad, true); return; }
      if (!sp) { cur = ''; show('Таблица пуста — текст не собирается'); emitText(''); return; }
      show(cur ? cur : 'Собираю…');
      try {
        const r = await api('/showcase/materials-text', { method: 'POST', body: { materialsSpec: sp } });
        if (my !== seq) return;
        emitText(r.materialsText || ''); show(cur || 'По таблице текст не получился — проверьте материалы');
      } catch (e) { if (my === seq) show(e.message || 'Не удалось собрать текст', true); }
    }, 600);
  }

  function spec() {
    const out = rows.map((r) => ({ materialId: r.materialId, sizes: [...r.sizes], partIds: r.parts.filter((p) => p.id).map((p) => p.id) }))
      .filter((r) => r.materialId || r.sizes.length || r.partIds.length);
    const coatingIds = JSON.parse(coat.value || '[]');
    return out.length || coatingIds.length ? { rows: out, coatingIds } : null;
  }
  function set(v, { fetch = true } = {}) {
    const sp = parseSpec(v);
    emitting = true;
    rows.splice(0); body.replaceChildren(); pending.splice(0);
    (sp.rows.length ? sp.rows : [{}]).forEach((r) => addRow(r));
    coat.value = sp.coatingIds;
    emitting = false;
    paintNew();
    if (fetch) { el.dispatchEvent(new Event('input', { bubbles: true })); preview(); }
  }

  // «Скопировать таблицу из изделия»: строки выбранного изделия добавляются в конец, части, что уже есть в таблице, пропускаются
  const copyIn = h('input', { class: 'ms-copy-in', placeholder: 'Изделие: название или артикул', 'aria-label': 'Изделие, из которого копировать' });
  const copyBox = h('div', { class: 'ms-copy', hidden: true }, copyIn, h('span', { class: 'hint' }, 'Выберите изделие — его строки добавятся в таблицу, поправить можно до сохранения'));
  let products = null;
  attachCombo(copyIn, {
    options: () => (products || []).map((p) => ({ value: String(p.id), label: p.name, sub: p.sku || '' })),
    empty: () => (products ? 'Изделий не найдено' : 'Загружаю…'),
  });
  copyIn.addEventListener('change', async () => {
    const t = copyIn.value.trim(); const hit = (products || []).find((p) => p.name === t);
    if (!hit) return;
    copyIn.value = ''; copyBox.hidden = true;
    try {
      const sp = parseSpec((await api(`/showcase/${hit.id}`)).materialsSpec);
      if (!sp.rows.length && !sp.coatingIds.length) { toast(`У изделия «${hit.name}» таблица материалов не заполнена`, { ms: 6000 }); return; }
      const have = new Set(rows.flatMap((r) => r.parts.map((p) => p.id).filter(Boolean)));
      const fresh = sp.rows.filter((r) => !(r.partIds || []).length || (r.partIds || []).some((id) => !have.has(String(id))));
      const cur = parseSpec(w.value);
      const room = MAX_ROWS - cur.rows.length;
      const take = fresh.map((r) => ({ ...r, partIds: (r.partIds || []).filter((id) => !have.has(String(id))) })).slice(0, Math.max(room, 0));
      w.set({ rows: [...cur.rows, ...take], coatingIds: [...new Set([...cur.coatingIds, ...sp.coatingIds])] });
      toast(take.length ? `Добавлено строк: ${take.length} — проверьте и сохраните` : 'Все части уже есть в таблице — ничего не добавлено');
    } catch (e) { toastError(e); }
  });
  const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Добавить строки таблицы другого изделия', onclick: async (e) => {
    const b = e.currentTarget;
    if (!copyBox.hidden) { copyBox.hidden = true; return; }
    b.classList.add('is-busy');
    try { if (!products) products = (await api('/showcase?limit=200')).items || []; } catch (er) { toastError(er); b.classList.remove('is-busy'); return; }
    b.classList.remove('is-busy'); copyBox.hidden = false; copyIn.focus();
  } }, 'Скопировать таблицу из изделия');

  // «Шаблон по категории»: строки шаблона категории добавляются так же, как при копировании из изделия
  const mergeSpec = (sp) => {
    const have = new Set(rows.flatMap((r) => r.parts.map((p) => p.id).filter(Boolean)));
    const cur = parseSpec(w.value);
    const take = sp.rows.filter((r) => !(r.partIds || []).length || (r.partIds || []).some((id) => !have.has(String(id))))
      .map((r) => ({ ...r, partIds: (r.partIds || []).filter((id) => !have.has(String(id))) })).slice(0, Math.max(MAX_ROWS - cur.rows.length, 0));
    w.set({ rows: [...cur.rows, ...take], coatingIds: [...new Set([...cur.coatingIds, ...sp.coatingIds])] });
    return take.length;
  };
  const tplUrl = () => '/passports/template?category=' + encodeURIComponent(scope());
  const busy = async (b, fn) => { b.disabled = true; b.classList.add('is-busy'); try { await fn(); } catch (er) { toastError(er); } finally { b.disabled = false; b.classList.remove('is-busy'); } };
  const tplBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, title: 'Подставить строки шаблона категории изделия', onclick: (e) => busy(e.currentTarget, async () => {
    const sp = parseSpec((await api(tplUrl())).materialsSpec);
    if (!sp.rows.length) { tplBtn.hidden = true; toast('У категории нет шаблона таблицы'); return; }
    const n = mergeSpec(sp);
    toast(n ? `Добавлено строк из шаблона: ${n} — проверьте и сохраните` : 'Все части шаблона уже есть в таблице');
  }) }, 'Шаблон по категории');
  const tplSave = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, title: 'Запомнить текущую таблицу как шаблон для всех изделий этой категории', onclick: (e) => busy(e.currentTarget, async () => {
    const sp = spec();
    if (!sp?.rows.length) { toast('Таблица пуста — шаблон не из чего собрать'); return; }
    await api('/passports/template', { method: 'PUT', body: { category: scope(), materialsSpec: sp } }); // категория — в теле: query сервер не читает
    tplBtn.hidden = false;
    toast('Таблица сохранена как шаблон категории');
  }) }, 'Сохранить как шаблон категории');
  // категорию узнаём при показе (она может смениться в форме); шаблон проверяется один раз на категорию
  let tplFor = null;
  const tplCheck = async () => {
    let c = ""; try { c = scope() || ""; } catch {} tplSave.hidden = !c || !canDict;
    syncCoat(); syncPartsBtn();
    if (!c) { tplBtn.hidden = true; tplFor = null; return; }
    if (tplFor === c) return; tplFor = c;
    try { tplBtn.hidden = !parseSpec((await api(tplUrl())).materialsSpec).rows.length; } catch { tplBtn.hidden = true; }
  };
  el.addEventListener('focusin', tplCheck);
  setTimeout(tplCheck, 300);

  el.append(
    h('div', { class: 'rt-wrap' }, h('table', { class: 'rt-table ms-table' },
      h('thead', null, h('tr', null, h('th', { class: 'rt-n' }, '№'), h('th', { class: 'ms-c-p' }, 'Часть'), h('th', { class: 'ms-c-mat' }, 'Материал'), h('th', { class: 'ms-c-z' }, 'Размеры'), h('th'))),
      body)),
    h('div', { class: 'rt-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const r = addRow(); r?.tr.querySelector('.ms-add')?.focus(); changed(); } }, '+ Строка'),
      copyBtn, tplBtn, tplSave, partsBtn,
      ...actions.map((a) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: a.title || '', onclick: async (e) => {
        const b = e.currentTarget; const label = b.textContent;
        b.disabled = true; b.classList.add('is-busy'); b.textContent = a.busy || 'Готовлю…';
        try { await a.run(w); } catch (er) { toastError(er); } finally { b.disabled = false; b.classList.remove('is-busy'); b.textContent = label; }
      } }, a.label)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'hint' }, 'Сначала часть, потом материал и размер; из Excel — Ctrl+V: Часть · Материал · Размеры')),
    copyBox, newBox, coatBox, textBox);

  const w = {
    el,
    get value() { const sp = spec(); return sp ? JSON.stringify(sp) : ''; },
    set value(v) { set(v); },
    spec,
    get text() { return cur; },
    isEmpty: () => !spec(),
    set: (v) => set(v),
    onText,
    focus: () => rows[0]?.matIn.focus(),
  };
  set(value, { fetch: false });
  if (cur) show(cur); else if (spec()) preview(); else show('Таблица пуста — текст не собирается');
  return w;
}

/** Сводка свёрнутого блока: «Материалы: 2 строки, покрытие». */
export const specSummary = (raw) => {
  const sp = parseSpec(raw); const n = sp.rows.length;
  if (!n && !sp.coatingIds.length) return '';
  return `Материалы: ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'строка' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'строки' : 'строк'}${sp.coatingIds.length ? ', покрытие' : ''}`;
};
