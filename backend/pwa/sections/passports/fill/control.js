import { openCard } from '../../../ui/kit/card.js';
import { api } from '../../../core/api.js';
import { buildForm, button, enhanceSelect, field, fieldRow, hint, link, row, segmented, select, sideNote, stack, textInput, toast } from '../../../ui/kit/index.js';
import { V2_NUMS, canEdit as canEditTexts } from '../common.js';
import { patchProduct, putDefaults, setFacets } from '../funnel/api.js';
import { jointsPick } from '../traits.js';
import { num } from './model.js';

const CAT_NUMS = new Set([...V2_NUMS.map(([k]) => k), 'warrantyMonths']);
const optsOf = (m) => (m.options || []).map((o) => [o.id, o.label]);
const fitsElement = (d, code) => (!d.kind || d.kind === 'product') && String(d.categories || '').split(/[,;\s]+/).filter(Boolean).includes(code);

/** «Похоже: … — верно?» — одна кнопка, без молчаливой записи (П-1 правило 6). Несколько id — состав изделия. */
export function suggestRow(m, write, save) {
  const ids = (m?.suggest?.ids || []).map(String).filter(Boolean);
  const one = m?.suggest?.id || ids[0];
  if (!one) return null;
  const payload = ids.length > 1 ? ids : one;
  return row({
    tone: 'info',
    title: `Похоже: ${m.suggest.label} — верно?`,
    meta: m.suggest.word ? `по слову «${m.suggest.word}» в названии` : null,
    action: button({ label: 'Да, верно', size: 'S', onClick: () => save(() => write(payload)) }),
  });
}

/** Не тронутые умолчания — одним запросом, когда идём дальше (как раньше commit в воронке). */
export async function commitPending(prod, pending) {
  if (!pending.size) return;
  const change = Object.assign({}, ...[...pending.values()].map((p) => p.patch));
  await putDefaults(prod, change);
  pending.clear();
}

function numEditor(ctx, key, label, dflt) {
  const cur = ctx.prod.passportDefaults?.[key];
  const empty = cur == null || cur === '';
  const shown = empty ? (dflt != null ? dflt : '') : cur;
  if (empty && dflt != null && dflt !== '') ctx.pending.set(key, { patch: { [key]: num(dflt) ?? dflt } });
  const f = textInput({
    label: label || 'Значение', value: shown, type: 'number', disabled: !ctx.can, short: true,
    hint: empty && dflt != null ? 'По умолчанию — можно не менять' : undefined,
  });
  f.input.addEventListener('change', () => {
    const v = num(f.value);
    if (v === null) return;
    ctx.pending.delete(key);
    ctx.save(() => putDefaults(ctx.prod, { [key]: v }));
  });
  return f.el;
}

export function dimsEditor(ctx) {
  const d = ctx.prod.dimensions && (ctx.prod.dimensions.unit || 'мм') === 'мм' ? ctx.prod.dimensions : {};
  const fs = ['length', 'width', 'height'].map((key, i) => textInput({
    label: ['Длина, мм', 'Ширина, мм', 'Высота, мм'][i], value: d[key] ?? '', type: 'number', disabled: !ctx.can, short: true,
  }));
  const saveDims = () => {
    const [length, width, height] = fs.map((f) => num(f.value));
    if (!(length && width && height)) return;
    ctx.save(() => patchProduct(ctx.prod.id, { dimensions: { length, width, height, unit: 'мм' } })
      .then(() => { ctx.prod.dimensions = { length, width, height, unit: 'мм' }; }));
  };
  fs.forEach((f) => f.input.addEventListener('change', saveDims));
  return fieldRow(...fs.map((f) => f.el));
}

export function weightEditor(ctx) {
  const f = textInput({ label: 'Вес изделия, кг', value: ctx.prod.weightKg ?? '', type: 'number', disabled: !ctx.can, short: true });
  f.input.addEventListener('change', () => {
    const v = num(f.value);
    if (v) ctx.save(() => patchProduct(ctx.prod.id, { weightKg: v }).then(() => { ctx.prod.weightKg = v; }));
  });
  return f.el;
}

/** Список элементов до трёх. Варианты пункта A3, иначе справочник ctx.elRows. */
function elementsCombo(ctx, rows) {
  const cur = (ctx.prod.passportDefaults?.elements || []).map(String);
  const labels = cur.map((id) => rows.find((o) => o.id === id)?.label).filter(Boolean);
  const f = buildForm([{
    key: 'els', label: 'Что это за изделие (не больше трёх)', type: 'combo', multi: true,
    hint: 'Начните печатать — список подскажет',
    options: rows.map((o) => ({ value: o.id, label: o.label })),
  }], { els: labels.join(', ') });
  f.el.addEventListener('change', () => {
    const names = String(f.read().values?.els || '').split(',').map((s) => s.trim()).filter(Boolean);
    let list = [...new Set(names.map((n) => rows.find((o) => o.label === n)?.id).filter(Boolean))];
    if (list.length > 3) { list = list.slice(0, 3); toast('Не больше трёх элементов'); }
    ctx.els.setIds(list);
    ctx.save(() => putDefaults(ctx.prod, { elements: list }));
  });
  return f.el;
}

/** Справочник открывается отдельной панелью; шаблон и незавершённый ввод остаются на месте. */
function addElement(ctx, refresh) {
  if (!canEditTexts() || !ctx.code) return null;
  const trigger = link({
    label: 'Нет в списке? Добавить элемент',
    title: 'Открыть справочник «Функциональные элементы» и вернуться в шаблон',
    onClick: () => {
      const resume = ctx.pause();
      let created = null;
      const editor = {
        id: 'dict', title: 'Функциональные элементы', newTitle: 'Новый функциональный элемент',
        canEdit: canEditTexts, card: {},
        form: {
          fields: async () => {
            const { dict } = await import('../../dicts.js');
            editor.form.toBody = dict.form.toBody;
            return dict.form.fields(null, 'passportElements');
          },
          toBody: (v) => v,
          saveLabel: 'Сохранить и вернуться', closeAfterCreate: true,
          create: async (body) => {
            // После успешного POST повтор привязки не создаёт второй элемент.
            created = created
              ? await api(`/dicts/passportElements/${created.id || created._id}`, { method: 'PATCH', body })
              : await api('/dicts/passportElements', { method: 'POST', body });
            const id = String(created.id || created._id);
            const at = ctx.elRows.findIndex((r) => String(r.id || r._id) === id);
            if (at < 0) ctx.elRows.push(created); else ctx.elRows[at] = created;
            ctx.elNames?.set(id, created.name);
            ctx.els.setRows(ctx.elRows);
            await ctx.waitForSaves();
            const cur = (ctx.prod.passportDefaults?.elements || []).map(String);
            const fits = fitsElement(created, ctx.code);
            if (fits && !cur.includes(id) && cur.length < 3) await putDefaults(ctx.prod, { elements: [...cur, id] });
            ctx.els.setIds(ctx.prod.passportDefaults?.elements || []);
            await ctx.refreshStatus();
            if (!fits) toast('Элемент сохранён в справочнике. Для выбора в этом паспорте нужны вид «Изделие» и категория паспорта.');
            else if (!cur.includes(id) && cur.length >= 3) toast('Элемент сохранён в справочнике. Уже выбрано три — замените один из них.');
            return created;
          },
        },
      };
      openCard(editor, { mode: 'create', initial: { kind: 'product', categories: ctx.code }, parent: trigger }, {
        changed() {},
        close: () => { resume(); if (created) refresh(); },
      });
    },
  });
  return trigger;
}

/** Элементы. Есть подсказка — одно «Да, верно», список открывается по «Другой вариант». */
export function elementsEditor(ctx, gap) {
  const given = (gap?.options || []).map((o) => ({ id: String(o.id), label: o.label || o.name || 'без названия' }));
  // без пункта A3 (правка заполненного) — тот же отбор, что на сервере (`elementFits`): только своя категория и только изделия/снаряды
  const dict = (ctx.elRows || []).filter((d) => fitsElement(d, ctx.code)).map((d) => ({ id: String(d.id || d._id), label: d.name || 'без названия' }));
  const rows = given.length ? given : dict;
  const note = sideNote('Укажите, что это за изделие (не больше трёх вариантов). Ниже — фраза для описания и правила пользования.');
  const write = (v) => {
    const list = (Array.isArray(v) ? v : [v]).map(String).filter(Boolean).slice(0, 3);
    ctx.els.setIds(list);
    return putDefaults(ctx.prod, { elements: list });
  };
  const suggest = suggestRow(gap, write, ctx.save);
  const editor = stack();
  const refresh = () => {
    const body = editor.closest('.drawer-body'); const scroll = body?.scrollTop;
    const focused = editor.contains(document.activeElement);
    editor.replaceChildren(elementsEditor(ctx));
    if (body) body.scrollTop = scroll;
    if (focused) editor.querySelector('button')?.focus({ preventScroll: true });
  };
  const add = () => addElement(ctx, refresh);
  if (!rows.length) { editor.append(stack(hint('Для этой категории в справочнике «Функциональные элементы» вариантов нет. Поле можно оставить пустым.'), add())); return editor; }
  if (!suggest) { editor.append(stack(note, elementsCombo(ctx, rows), add())); return editor; }
  let box;
  const other = link({ label: 'Другой вариант', title: 'Выбрать элементы из списка', onClick: () => { box.replaceChildren(...[note, elementsCombo(ctx, rows), add()].filter(Boolean)); } });
  box = stack(note, suggest, other);
  editor.append(box);
  return editor;
}

/** Назначение. Есть подсказка — «Да, верно»; «Другой вариант» открывает шаг воронки текстов. */
function purposeEditor(ctx, m) {
  const rootId = String(m.key || '').replace(/^choice:/, '');
  const write = (v) => {
    const prev = ctx.prod.passportDefaults?.textChoices || {};
    return putDefaults(ctx.prod, { textChoices: { ...prev, [rootId]: v } });
  };
  const suggest = suggestRow(m, write, ctx.save);
  // C086: подсказки нет, а от назначения зависят вопросы — одно уточнение; сам список — шаг «Назначение» ниже
  if (!suggest) return hint('Уточните назначение изделия ниже. От него зависит, какие вопросы относятся к изделию: лишние не появятся.', 'warn');
  let box;
  const other = link({
    label: 'Другой вариант', title: 'Выбрать другое назначение',
    onClick: () => {
      const node = ctx.fb?.stepEl(rootId);
      if (node) { node.hidden = false; ctx.textHost?.purpose?.append(node); box.replaceChildren(); return; }
      const sel = select({
        label: 'Назначение', options: [['', 'Выберите…'], ...optsOf(m)], value: '',
        onChange: (v) => { if (v) ctx.save(() => write(v)); },
      });
      box.replaceChildren(field('Назначение', sel));
    },
  });
  box = stack(suggest, other);
  return box;
}

export function jointsEditor(ctx) {
  const pick = jointsPick(ctx.prod.passportDefaults?.joints || []);
  pick.el.addEventListener('change', () => {
    let list = [];
    try { list = JSON.parse(pick.value); } catch { list = []; }
    ctx.save(() => putDefaults(ctx.prod, { joints: list }));
  });
  return field('Как соединены части', pick, { hint: 'Болты и сварку можно вместе. «Цельное» — без болтов и сварки. От выбора зависят пункты осмотра.' });
}

export function kitEditor(ctx) {
  const v = ctx.prod.passportDefaults?.isKit;
  const seg = segmented({
    label: 'Как поставляется', fit: true,
    value: v === true ? 'yes' : v === false ? 'no' : '',
    items: [{ key: 'no', label: 'Цельное' }, { key: 'yes', label: 'Разобранное' }],
    onChange: (k) => ctx.save(() => putDefaults(ctx.prod, { isKit: k === 'yes' })),
  });
  return field('Как поставляется', seg, { hint: 'Разобранному изделию нужен рисунок сборки.' });
}

export function materialsEditor(ctx) {
  const text = ctx.matLine || 'Не указано, из чего сделано изделие';
  return field('Из чего сделано', button({ label: 'Открыть техописание', size: 'S', onClick: () => ctx.openTech() }), { hint: text });
}

export function installEditor(ctx, gap) {
  const dflt = gap?.kind === 'install' && gap.default ? String(gap.default.id ?? gap.default) : '';
  const cur = String(ctx.prod.passportDefaults?.installationTypeId || dflt || '');
  if (dflt && !ctx.prod.passportDefaults?.installationTypeId) ctx.pending.set('installationTypeId', { patch: { installationTypeId: dflt } });
  const sel = select({
    label: 'Способ установки',
    options: [['', 'Выберите…'], ...ctx.instOpts],
    value: cur,
    disabled: !ctx.can,
    onChange: (v) => { ctx.pending.delete('installationTypeId'); if (v) ctx.save(() => putDefaults(ctx.prod, { installationTypeId: v })); },
  });
  if (ctx.instOpts.length > 12) enhanceSelect(sel);
  const write = (v) => putDefaults(ctx.prod, { installationTypeId: v });
  return stack(field('Способ установки', sel, { hint: 'Вариант текста не подсказывает способ установки — выберите его здесь.' }), suggestRow(gap, write, ctx.save));
}

/** Поле из A3, которого нет среди постоянных полей разделов (признак, категория, прочее). Рисунок сюда не входит. */
export function controlGap(m, ctx) {
  if (!m || m.kind === 'image') return null;
  if (m.kind === 'elements') return elementsEditor(ctx, m);
  if (m.kind === 'purpose') return purposeEditor(ctx, m);
  if (m.kind === 'field' && m.key === 'height') return dimsEditor(ctx);
  if (m.kind === 'field' && (m.key === 'weight' || m.key === 'weightKg')) return weightEditor(ctx);
  // назначение выбирается здесь же, шагом «Назначение» ниже, а не в карточке изделия (C086)
  if (m.kind === 'field' && m.key === 'purpose') return hint('Выберите назначение изделия ниже: из него собирается текст паспорта.', 'warn');
  if (m.kind === 'field' && !CAT_NUMS.has(m.key)) {
    return stack(sideNote(`«${m.label || 'Поле'}» заполняется в карточке изделия.`),
      link({ label: 'Открыть карточку изделия →', href: '#products?open=' + ctx.prod.id, target: '_blank', title: 'Откроется в новой вкладке — паспорт здесь останется' }));
  }
  if (m.kind === 'field') return numEditor(ctx, m.key, m.label, m.default);
  const write = (v) => (m.kind === 'facet'
    ? setFacets(ctx.prod.id, [...(ctx.prod.facetValueIds || []), v]).then(() => { ctx.prod.facetValueIds = [...(ctx.prod.facetValueIds || []), v]; })
    : putDefaults(ctx.prod, m.kind === 'category' ? { passportCategory: v } : { installationTypeId: v }));
  const dflt = m.kind === 'install' && m.default ? String(m.default.id ?? m.default) : '';
  if (dflt) ctx.pending.set(m.key, { patch: { installationTypeId: dflt } });
  const sel = select({
    label: m.label,
    options: [['', m.kind === 'category' ? 'Выберите категорию…' : 'Выберите…'], ...optsOf(m)],
    value: dflt,
    onChange: (v) => { ctx.pending.delete(m.key); if (v) ctx.save(() => write(v)); },
  });
  if ((m.options || []).length > 12) enhanceSelect(sel);
  const labeled = field(m.label || 'Признак', sel, { required: !!m.required });
  const suggest = suggestRow(m, write, ctx.save);
  if (!suggest) return labeled;
  // есть подсказка — один вопрос «Да, верно»; список открывается по «Другой вариант» (как у элементов и назначения)
  let box;
  const other = link({ label: 'Другой вариант', title: `Выбрать «${m.label || 'признак'}» из списка`, onClick: () => box.replaceChildren(labeled) });
  box = stack(suggest, other);
  return box;
}

export { numEditor };
