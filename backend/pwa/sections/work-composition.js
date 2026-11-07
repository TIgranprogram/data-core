import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { failBlock } from '../ui/kit/busy.js';
import { actions, badge, qtyInput, searchBox, stack, busyBlock, button, enhanceSelect, funnel, iconButton, link, modal, section, select, sideForm, sideNote, table, toast, toastError } from '../ui/kit/index.js';
import { workTypes } from './work-route.js';

/*
 * Состав и работы (C041 Э1): части изделия (стойки, навес, наполнение) × виды работ × норма часов, галочка «Проверено».
 * Один компонент `compositionEditor` для двух мест:
 *   — панель «Позиция заказа» (of=workplan&open=<incomeId>): план позиции GET /orderline-plans/by-income/:id; «Проверено» — сразу на сервер;
 *     сохранение PUT плана, затем вопрос «Только в этом заказе / И в продукцию» (apply-to-product);
 *   — карточка изделия (productRoute): GET/PUT /work-routes/:productId, «Проверено» запоминается при сохранении.
 * Воронка П-1 (kit.funnel): часть → виды работ (несколько). Итог — таблица «часть · работа · часы · проверено».
 * Идентификаторы новых строк создаёт экран (24 hex), чтобы шаги могли ссылаться на новую часть до сохранения.
 */
const ALL = '_all';
const uid = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

let partsP = null, partsAt = 0;
/** Справочник частей изделия: [{ value, label }], один запрос на минуту. */
export const partTypes = () => {
  if (!partsP || Date.now() - partsAt > 60000) {
    partsAt = Date.now();
    partsP = api('/dicts/productParts').then((r) => (r.items || []).map((x) => ({ value: String(x.id), label: x.name || '' })).filter((x) => x.label).sort((a, b) => a.label.localeCompare(b.label, 'ru'))).catch(() => { partsP = null; return []; });
  }
  return partsP;
};

const partOf = (p) => ({ id: String(p.id || p._id || uid()), partId: p.partId ? String(p.partId) : '', name: p.name || '', qty: p.qty ?? 1, checked: !!p.checked, by: p.checkedByName || '', saved: !!(p.id || p._id) });
const stepOf = (s) => ({ id: String(s.id || s._id || uid()), workTypeId: String(s.workTypeId || ''), partRowId: s.partRowId ? String(s.partRowId) : '', hours: s.hours ?? '', checked: !!s.checked, by: s.checkedByName || '', saved: !!(s.id || s._id) });
const outPart = (p) => ({ id: p.id, ...(p.partId ? { partId: p.partId } : {}), name: p.name, qty: num(p.qty) ?? 1, checked: p.checked });
const outStep = (s) => ({ id: s.id, workTypeId: s.workTypeId, partRowId: s.partRowId || null, hours: num(s.hours), checked: s.checked });

/**
 * compositionEditor({ parts, steps, types, partsDict, canEdit, check?(kind,rowId,checked) → данные, suggested? })
 * → { el, get value() (JSON { parts, steps }), get dirty(), setData({ parts, steps }) }; при правке шлёт `change`.
 * check не задан — «Проверено» ставится на месте и уходит вместе с сохранением.
 */
export function compositionEditor({ parts: p0 = [], steps: s0 = [], types = [], partsDict = [], canEdit = true, check, suggested = [] } = {}) {
  let parts = p0.map(partOf), steps = s0.map(stepOf), curPart = '', dirty = false, adding = false;
  const root = stack();
  const typeName = (id) => types.find((t) => t.value === id)?.label || 'вид работ удалён';
  const partName = (id) => (id ? parts.find((p) => p.id === id)?.name || 'часть удалена' : 'Изделие целиком');
  const cur = () => curPart || (parts.length ? '' : ALL);
  const rowOf = (pid) => (pid === ALL ? '' : pid);

  const touch = () => { dirty = true; root.dispatchEvent(new Event('change', { bubbles: true })); };
  const edit = (fn) => { fn(); touch(); paint(); };

  async function toggle(kind, row) {
    if (!check) { row.checked = !row.checked; row.by = ''; touch(); paint(); return; }
    try { setData(await check(kind, row.id, !row.checked)); } catch (e) { toastError(e, 'отметить'); }
  }
  const checkBtn = (kind, row) => {
    const locked = !!check && (dirty || !row.saved);
    return button({ label: locked ? 'Сначала сохраните' : row.checked ? badge('✓ проверено — снять', 'ok') : 'Отметить проверенным', kind: row.checked ? 'ghost' : 'secondary', size: 'S', disabled: !canEdit || locked,
      title: locked ? 'Сначала сохраните правки — потом отметьте' : row.checked ? (row.by ? 'Проверил: ' + row.by + '. Нажмите — снять' : 'Нажмите — снять отметку') : 'Отметить как проверенное', onClick: () => toggle(kind, row) });
  };

  const hoursIn = (s) => !canEdit ? String(s.hours ?? '—') : qtyInput({ value: s.hours === null ? '' : String(s.hours), label: 'Часов на 1 шт.', plusLabel: '+1 час', onInput: (_n, text) => { s.hours = text; s.checked = false; touch(); totalEl.textContent = totalText(); } });
  const qtyIn = (p) => !canEdit ? String(p.qty ?? 1) : qtyInput({ value: String(p.qty ?? 1), label: 'Количество', plusLabel: '+1', onInput: (_n, text) => { p.qty = text; p.checked = false; touch(); totalEl.textContent = totalText(); } });

  const totalText = () => {
    const t = steps.reduce((a, s) => a + (num(s.hours) || 0) * (s.partRowId ? (num(parts.find((p) => p.id === s.partRowId)?.qty) ?? 1) : 1), 0);
    return t ? `Часов на одно изделие: ${Math.round(t * 100) / 100}` : 'Часы не заданы';
  };
  const totalEl = h('span', { class: 'muted' }, totalText());

  const move = (i, d) => { const j = i + d; if (j < 0 || j >= steps.length) return; edit(() => { [steps[i], steps[j]] = [steps[j], steps[i]]; }); };

  function partsTable() {
    return table({
      label: 'Части изделия', columns: [{ label: 'Часть', wrap: true }, { label: 'Кол-во', num: true }, { label: 'Проверено' }, { label: '' }],
      empty: { title: 'Частей нет', hint: canEdit ? 'Работы идут на изделие целиком. Добавьте части — стойки, навес, наполнение — и назначьте работы каждой.' : '' },
      rows: parts.map((p) => ({ cells: [p.name, qtyIn(p), checkBtn('part', p),
        canEdit ? iconButton({ icon: '✕', label: 'Убрать часть ' + p.name, size: 'S', onClick: () => edit(() => { parts = parts.filter((x) => x !== p); steps = steps.filter((s) => s.partRowId !== p.id); if (curPart === p.id) curPart = ''; }) }) : ''] })),
    });
  }

  function addPart() {
    const used = new Set(parts.map((p) => p.partId).filter(Boolean));
    const sel = select({ label: 'Добавить часть', options: [['', 'Добавить часть…'], ...partsDict.filter((t) => !used.has(t.value)).map((t) => [t.value, t.label]), ['_new', '＋ Новая часть (в справочник)']], value: '' });
    const add = async (text) => {
      const v = String(text || '').trim(); if (!v) return;
      const known = partsDict.find((x) => x.label.toLowerCase() === v.toLowerCase()); // такая часть уже есть в справочнике — не дублируем
      try {
        const made = known || { value: String((await api('/dicts/productParts', { method: 'POST', body: { name: v } })).id), label: v };
        if (!known) { partsDict.push(made); partsP = null; }
        adding = false;
        edit(() => { parts.push({ id: uid(), partId: made.value, name: made.label, qty: 1, checked: false, by: '', saved: false }); });
      } catch (e) { toastError(e, 'добавить часть'); }
    };
    const name = searchBox({ placeholder: 'Название новой части — Enter', label: 'Название новой части', minLength: 1, onSearch: () => {}, onEnter: add });
    name.el.hidden = !adding;
    const ok = button({ label: 'Добавить', size: 'S', kind: 'primary', onClick: () => add(name.input.value) });
    ok.hidden = !adding;
    sel.addEventListener('change', () => {
      if (sel.value === '_new') { adding = true; name.el.hidden = false; ok.hidden = false; name.focus(); return; }
      const t = partsDict.find((x) => x.value === sel.value); if (!t) return;
      edit(() => { parts.push({ id: uid(), partId: t.value, name: t.label, qty: 1, checked: false, by: '', saved: false }); });
    });
    enhanceSelect(sel, { force: true });
    return actions(sel, name.el, ok);
  }

  /** Воронка П-1: часть → виды работ (несколько). Выбор видов сразу меняет таблицу итога. */
  const fn = funnel({ steps: [], onChange: (key, v) => {
    if (key === 'part') { curPart = v; paintFunnel(); return; }
    const pid = rowOf(cur()); const want = String(v).split(',').filter(Boolean);
    edit(() => {
      steps = steps.filter((s) => s.partRowId !== pid || want.includes(s.workTypeId));
      for (const id of want) if (!steps.some((s) => s.partRowId === pid && s.workTypeId === id)) steps.push({ id: uid(), workTypeId: id, partRowId: pid, hours: '', checked: false, by: '', saved: false });
    });
  } });
  function funnelSteps() {
    const count = (pid) => steps.filter((s) => s.partRowId === pid).length;
    const pv = [...parts.map((p) => ({ id: p.id, label: p.name, count: count(p.id) })), { id: ALL, label: 'Изделие целиком', count: count('') }];
    const pid = rowOf(cur());
    return [
      { key: 'part', label: 'Часть', ask: 'выберите часть, чтобы назначить ей работы', value: cur(), values: pv, skip: !parts.length },
      { key: 'work', label: 'Виды работ', ask: 'отметьте виды работ по этой части', multi: true, value: steps.filter((s) => s.partRowId === pid).map((s) => s.workTypeId).join(','), values: types.map((t) => ({ id: t.value, label: t.label })) },
    ];
  }
  function paintFunnel() { fn.update({ steps: funnelSteps() }); }

  function stepsTable() {
    const sorted = steps; // порядок = порядок выполнения (цепочка Ганта)
    return table({
      label: 'Работы по частям', columns: [{ label: 'Часть', wrap: true }, { label: 'Работа' }, { label: 'Часов на 1 шт.', num: true }, { label: 'Проверено' }, { label: '' }],
      empty: { title: 'Работ нет', hint: canEdit ? 'Без работ позиция запускается одной работой «Изготовление». Выберите часть и виды работ выше.' : '' },
      rows: sorted.map((s, i) => ({ cells: [partName(s.partRowId), typeName(s.workTypeId), hoursIn(s), checkBtn('step', s),
        canEdit ? actions(
          iconButton({ icon: '↑', label: 'Работа выше', size: 'S', onClick: () => move(i, -1) }),
          iconButton({ icon: '↓', label: 'Работа ниже', size: 'S', onClick: () => move(i, 1) }),
          iconButton({ icon: '✕', label: 'Убрать работу', size: 'S', onClick: () => edit(() => { steps = steps.filter((x) => x !== s); }) })) : ''] })),
    });
  }

  function paint() {
    const all = parts.length + steps.length, ok = parts.filter((p) => p.checked).length + steps.filter((s) => s.checked).length;
    const pending = [...parts, ...steps].filter((r) => !r.checked && (!check || r.saved));
    const sum = actions(
      all ? (ok === all ? badge('всё проверено', 'ok') : badge(`проверено ${ok} из ${all}`, 'warn')) : null, totalEl,
      canEdit && pending.length && !(check && dirty) ? button({ label: 'Проверить всё', size: 'S', kind: 'primary', onClick: async (e) => {
        e.currentTarget.classList.add('is-busy');
        if (!check) { pending.forEach((r) => { r.checked = true; }); touch(); paint(); return; }
        try { let data = null; for (const r of pending) data = await check(parts.includes(r) ? 'part' : 'step', r.id, true); if (data) setData(data); } catch (er) { toastError(er, 'отметить'); paint(); }
      } }) : null);
    const sug = !steps.length && suggested.length && canEdit ? button({ label: 'Взять подсказку: ' + suggested.map((x) => x.name).join(' → '), size: 'S', title: 'Виды работ из модулей изделия',
      onClick: () => edit(() => { steps = suggested.filter((x) => types.some((t) => t.value === x.workTypeId)).map((x) => ({ id: uid(), workTypeId: x.workTypeId, partRowId: '', hours: '', checked: false, by: '', saved: false })); }) }) : null;
    root.replaceChildren(sum, section({ title: 'Части', count: parts.length, tone: 'main', open: true, body: [partsTable(), canEdit ? addPart() : null] }),
      section({ title: 'Работы по частям', count: steps.length, tone: 'main', open: true, body: [canEdit ? fn.el : null, sug, stepsTable()] }));
    if (canEdit) paintFunnel();
  }

  function setData(d) { parts = (d.parts || []).map(partOf); steps = (d.steps || []).map(stepOf); dirty = false; curPart = ''; adding = false; paint(); }
  paint();
  return { el: root, get value() { return JSON.stringify({ parts: parts.map(outPart), steps: steps.map(outStep) }); }, get dirty() { return dirty; }, setData };
}

/* ---------------------------------------------------------------- панель «Позиция заказа» */

const meta = new Map(); // incomeId → { title, orderNo, qty } — что открыто (из карточки заказа)

/** Открыть панель состава позиции. info — { title, orderNo, qty } для шапки. */
export function openPlan(incomeId, info) {
  meta.set(String(incomeId), info || {});
  patch({ of: 'workplan', open: String(incomeId), new: undefined });
}
export const planLink = (incomeId, info, label = 'Состав и работы') => link({ label, title: 'Части позиции, виды работ и «Проверено»', onClick: () => openPlan(incomeId, info) });

const PLAN = '/orderline-plans';

async function productStamp(plan) {
  if (plan.productUpdatedAt) return plan.productUpdatedAt;
  return (await api('/showcase/' + plan.productId)).updatedAt;
}

export const workPlan = sideForm({
  id: 'workplan', title: 'Позиция заказа', noun: 'состав позиции',
  canEdit: () => !!session.canEdit,
  saveLabel: 'Сохранить',
  get: async (incomeId) => {
    const [plan, types, partsDict] = await Promise.all([api(`${PLAN}/by-income/${incomeId}`), workTypes(), partTypes()]);
    return { incomeId, plan, types, partsDict, info: meta.get(String(incomeId)) || {} };
  },
  heading: (r) => r.info.title || r.plan.productName || 'Позиция заказа',
  subheading: (r) => [r.info.orderNo ? 'Заказ ' + r.info.orderNo : '', r.info.qty != null ? r.info.qty + ' шт.' : ''].filter(Boolean).join(' · '),
  fields: async (r) => {
    const p = r.plan;
    let ed = null;
    const check = async (kind, rowId, checked) => { const x = await api(`${PLAN}/${p.id}/check`, { method: 'POST', body: { kind, rowId, checked } }); Object.assign(p, x); return x; };
    const notes = [];
    if (session.canEdit) notes.push(sideNote('Правка часов или количества снимает отметку «Проверено» — после сохранения отметьте снова.'));
    if (!p.productId) notes.push(sideNote('У позиции нет изделия: составьте части и работы вручную — они сохранятся только в этом заказе. Чтобы подставить из продукции, сопоставьте позицию с изделием.'));
    else notes.push(sideNote('Изделие: ' + (p.productName || '—') + (p.origin === 'product' ? '. Части и работы подставлены из продукции — проверьте и отметьте.' : '. План составлен вручную.')));
    if (p.productChangedSinceCopy) {
      notes.push(sideNote('Изделие в продукции изменили после того, как план взяли в этот заказ. ',
        button({ label: 'Взять заново', size: 'S', onClick: async (e) => {
          e.currentTarget.classList.add('is-busy');
          try { const x = await api(`${PLAN}/${p.id}/reset-from-product`, { method: 'POST' }); Object.assign(p, x); ed?.setData(x); toast('План взят заново из изделия'); patch({ of: 'workplan', open: String(r.incomeId) }); }
          catch (er) { toastError(er, 'взять заново'); e.currentTarget.classList.remove('is-busy'); }
        } })));
    }
    if (p.launchedAt) notes.push(sideNote('Задание уже запущено: правки плана его не меняют.'));
    return [
      { section: 'Состав и работы', tone: 'main', fixed: true },
      { key: '_notes', type: 'widget', label: '', wide: true, widget: () => ({ el: stack(...notes), value: '' }) },
      { key: 'compo', type: 'widget', label: '', wide: true, summary: () => '', widget: () => {
        ed = compositionEditor({ parts: p.parts, steps: p.steps, types: r.types, partsDict: r.partsDict, canEdit: !!session.canEdit, check });
        return { el: ed.el, get value() { return ed.value; }, set value(_) { /* только своё состояние */ } };
      } },
    ];
  },
  toInitial: () => ({}),
  save: async (v, row) => {
    const p = row.plan, body = JSON.parse(v.compo || '{"parts":[],"steps":[]}');
    let plan;
    try { plan = await api(`${PLAN}/${p.id}`, { method: 'PUT', body: { rev: p.rev, parts: body.parts, steps: body.steps } }); }
    catch (e) { if (e.status === 409) toast('План изменил другой человек — обновите панель'); throw e; }
    let toProduct = false;
    if (plan.productId && plan.diff?.changed) {
      toProduct = !!(await modal({ title: 'Сохранить и в продукцию?', okText: 'И в продукцию', cancelText: 'Только в этом заказе',
        body: h('p', null, `План позиции отличается от изделия «${plan.productName || ''}». «Только в этом заказе» — изделие не меняется. «И в продукцию» — части и работы запишутся в изделие и подставятся в следующие заказы.`) }));
      if (toProduct) {
        try { await api(`${PLAN}/${p.id}/apply-to-product`, { method: 'POST', body: { productUpdatedAt: await productStamp(plan) } }); }
        catch (e) { toast(e.status === 409 ? 'Изделие изменили после копии — в продукцию не записано. План сохранён в заказе.' : 'Не удалось записать в продукцию. План сохранён в заказе.'); toProduct = false; }
      }
    }
    toast(toProduct ? 'Сохранено в заказе и в продукции' : 'Сохранено в заказе', { sub: plan.launchedAt ? 'Запущенное задание не изменилось' : undefined });
    return { id: row.incomeId };
  },
});

/* ---------------------------------------------------------------- карточка изделия (продукция) */

/** Блок «Части и работы» в карточке изделия: тот же редактор, сохранение сразу в изделие (PUT /work-routes/:id). */
export function productRoute(product) {
  const box = stack();
  const sec = section({ title: 'Части и работы', tone: 'main', count: '…', body: box });
  const setCount = (n) => { const b = sec.querySelector(':scope > summary .k-sec-n'); if (b) b.textContent = String(n); };
  const can = session.canEdit;
  async function load() {
    box.replaceChildren(busyBlock('части и работы'));
    let data, types, partsDict;
    try { [data, types, partsDict] = await Promise.all([api('/work-routes/' + product.id), workTypes(), partTypes()]); }
    catch (e) { box.replaceChildren(failBlock(e, load)); return; }
    const parts = (data.parts || []).filter((p) => p.partId || p.qty != null); // старый ответ: части состава без partId — не части работ
    const ed = compositionEditor({ parts, steps: data.steps || [], types, partsDict, canEdit: !!can, suggested: data.suggested || [] });
    const saveBtn = button({ label: 'Сохранить в изделие', kind: 'primary', size: 'S', disabled: true, onClick: async (e) => {
      const b = JSON.parse(ed.value);
      if (b.steps.some((s) => !s.workTypeId)) { toast('У работы не выбран вид — выберите или уберите'); return; }
      e.currentTarget.disabled = true; e.currentTarget.classList.add('is-busy');
      try { await api('/work-routes/' + product.id, { method: 'PUT', body: { parts: b.parts, steps: b.steps } }); toast('Части и работы сохранены в изделии'); await load(); }
      catch (er) { toastError(er, 'сохранить части и работы'); e.currentTarget.disabled = false; e.currentTarget.classList.remove('is-busy'); }
    } });
    ed.el.addEventListener('change', () => { saveBtn.disabled = false; });
    setCount((data.steps || []).length);
    box.replaceChildren(sideNote('Так позиции заказа получают части и работы по умолчанию. Менеджер правит их в заказе и ставит «Проверено».'), ed.el, can ? actions(saveBtn) : null);
  }
  load();
  return sec;
}
