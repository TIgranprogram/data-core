import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { catNames } from '../../core/passport-kinds.js';
import { actions, attachCombo, buildForm, button, hint, link, stack, tagPick, textInput } from '../../ui/kit/index.js';
import { busyBtn } from '../../ui/kit/busy.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { codeList, dictOpts, dictRows, passportCategoryOptions, V2_NUMS } from './common.js';
import { sidePanel } from './book-shared.js';
import { setSideWide } from './book-side-edit.js';
import { jointsPick } from './traits.js';
import { simpleTextHref } from './book-template.js';
import { simpleChoiceChanges, simpleChoiceField, simpleChoiceOptions } from './book-choices.js';

/** Общее состояние правки в правой колонке для шаблона, в том числе при смене варианта. */
export function sideForm(slot, { title, form, extra, changed, save, done, read, confirm = false, okLabel = 'Сохранить в шаблон' }) {
  let working = false;
  const body = stack(form?.el, extra);
  const error = h('div', { hidden: true, role: 'alert' });
  const ok = button({ label: okLabel, kind: 'primary', size: 'S', onClick: async () => {
    if (working) return;
    const values = read ? read() : form.read().values;
    if (!values) return;
    working = true;
    body.inert = true;
    error.hidden = true;
    const end = busyBtn(ok);
    try {
      if ((confirm || changed()) && await save(values) === false) return;
      slot._bkLeave = null;
      done({ saved: true });
    } catch (e) {
      error.replaceChildren(hint(e.message, 'warn'));
      error.hidden = false;
    } finally {
      working = false;
      body.inert = false;
      end();
    }
  } });
  slot._bkLeave = async () => !working && (!changed() || await confirmDlg(
    'Выйти без сохранения?', 'В шаблоне есть несохранённая правка.', { okText: 'Выйти' }));
  const cancel = button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: async () => {
    if (await slot._bkLeave?.()) { slot._bkLeave = null; done({ saved: false }); }
  } });
  setSideWide(slot, false, { editing: true });
  slot.replaceChildren(sidePanel(title, stack(body, error, actions(ok, cancel))));
}

function descriptionHelp(slot, template, { done, openParts }, message, dictionary = 'passportPhrases') {
  const href = dictionary === 'passportPhrases' ? simpleTextHref(template.simpleDescriptionSource) : `#dicts?d=${dictionary}`;
  const label = dictionary === 'passportKinds' ? 'Справочник видов ↗' : 'Справочник текстов ↗';
  const source = !!template.simpleDescriptionSource;
  const dictionaryLink = link({ label, href, target: '_blank' });
  const partsButton = button({ label: 'Части изделия', size: 'S', onClick: openParts });
  setSideWide(slot, false, { editing: true });
  slot.replaceChildren(sidePanel('Краткое описание', stack(hint(message),
    actions(dictionaryLink, partsButton, button({ label: 'Закрыть', kind: 'ghost', size: 'S', onClick: () => done() })))));
  (source ? partsButton : dictionaryLink).focus();
}

/** Дополнительный выбор готовой словарной фразы. */
export function openDescriptionSetup(slot, template, options) {
  if (template.simpleDescriptionSource) {
    const own = template.simpleDescriptionSource.kind === 'own';
    return descriptionHelp(slot, template, options, own ? 'Используется своя формулировка.' : 'Описание подставлено из справочника.');
  }
  if (!template.passportCategory) return openBookCategory(slot, template, options);
  if (!template.document.kindId) return openBookSetting(slot, template, { ...options, key: 'kindId', descriptionSetup: true });
  const candidates = simpleChoiceOptions(template);
  if (!candidates.length) return descriptionHelp(slot, template, options,
    'Для этого вида и известных признаков нет готового краткого описания. Проверьте или дополните подходящую ветку в справочнике.');
  const one = candidates.length === 1 ? candidates[0] : null;
  const form = one ? { el: h('p', null, one.text) }
    : buildForm([{ ...simpleChoiceField(candidates), required: true, choose: true }]);
  sideForm(slot, {
    title: one ? 'Подходит ли этот вариант?' : 'Краткое описание', form, done: options.done,
    extra: hint('Выбранный вариант и связанные с ним части подставятся в шаблон из справочника.'),
    changed: () => form.dirty?.() ?? false,
    read: one ? () => ({ simpleChoice: one.id }) : undefined,
    confirm: !!one, okLabel: one ? 'Подтвердить вариант' : 'Применить вариант',
    save: ({ simpleChoice }) => options.save({ textChoices: simpleChoiceChanges(candidates, simpleChoice, template.defaults.textChoices) }, template.defaults),
  });
  if (one) slot.querySelector('.btn-primary')?.focus();
  else form.focus();
}

const partText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Локальный предпросмотр по тем же правилам, что и серверная сборка при сохранении. */
export function simplePartsPreview(ids, byId) {
  const parts = [...new Set(ids)].map((id) => byId.get(id));
  if (!parts.length || parts.some((part) => !partText(part?.name))) return '';
  const hasGenitive = parts.every((part) => partText(part.genSingular));
  const names = new Map();
  for (const part of parts) {
    const text = partText(hasGenitive ? part.genSingular : part.name);
    const key = text.toLocaleLowerCase('ru');
    if (!names.has(key)) names.set(key, text);
  }
  const words = [...names.values()];
  const list = words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' и ' + words.at(-1);
  return (hasGenitive ? 'Изделие состоит из ' : 'Основные части изделия: ') + list + '.';
}

function descriptionPartPicker(byId, template, initial, onChange) {
  const linked = new Set((template.simpleDescriptionSource?.partIds
    ?? (template.simpleDescriptionSuggestions || []).flatMap((item) => item.partIds || [])).map(String));
  const ids = new Set(initial);
  let allParts = false;
  const selected = actions();
  const search = textInput({ label: 'Добавить часть', placeholder: 'Найдите по названию' });
  const widen = button({ label: 'Искать среди всех частей', kind: 'ghost', size: 'S', onClick: () => {
    allParts = !allParts;
    widen.textContent = allParts ? 'Только подходящие части' : 'Искать среди всех частей';
    search.value = ''; combo.close(); search.focus();
  } });
  const render = () => {
    selected.replaceChildren(...[...ids].map((id) => {
      const label = byId.get(id)?.label || `Часть недоступна (${id})`;
      return button({ label: `${label} ×`, title: `Убрать «${label}»`, kind: 'ghost', size: 'S', onClick: () => {
        ids.delete(id); render(); onChange(); search.focus();
      } });
    }));
  };
  const combo = attachCombo(search.input, {
    options: () => [...byId.values()].filter((part) => part.label && !ids.has(part.value) && (allParts || linked.has(part.value))),
    empty: () => !allParts && !linked.size ? 'Уточните вид и признаки; готовый набор частей пока не задан'
      : search.value.trim() ? 'Части с таким названием не найдены' : 'Нет доступных частей для добавления',
    max: 12,
    onPick: (part) => { ids.add(part.value); search.value = ''; search.input.title = ''; render(); onChange(); },
  });
  render();
  return { el: stack(selected, !linked.size ? hint('Уточните вид и признаки; готовый набор частей пока не задан') : null,
    search.el, actions(widen)), value: () => [...ids], focus: search.focus, close: combo.close };
}

export async function openSimpleDescription(slot, template, { save, done, isCurrent, openDictionary }) {
  const current = template.defaults.simpleDescription;
  const savedText = current?.text ?? template.simpleDescriptionSource?.text ?? template.textSnapshot?.description ?? '';
  const partIds = [...new Set((current?.partIds ?? template.simpleDescriptionSource?.partIds ?? []).map(String))];
  const initialMode = current && current.mode !== 'parts' ? 'manual' : 'parts';
  const { items } = await api('/dicts/passportParts');
  if (!isCurrent()) return;
  const parts = (items || []).map((part) => ({
    ...part, value: String(part.id), label: partText(part.name), sub: catNames(part.categories), cats: codeList(part.categories),
  }));
  const byId = new Map(parts.map((part) => [part.value, part]));
  let mode = initialMode;
  let manualForm;
  const preview = h('div', { role: 'status', 'aria-label': 'Предпросмотр краткого описания' });
  const manual = h('div');
  const picker = descriptionPartPicker(byId, template, partIds, render);
  const autoText = () => simplePartsPreview(picker.value(), byId);
  const manualDirty = () => manualForm?.dirty() ?? false;
  const editText = button({ label: 'Изменить текст', size: 'S', onClick: () => {
    if (!manualForm || (mode === 'parts' && !manualDirty())) {
      const text = mode === 'parts' ? autoText() || savedText : savedText;
      manualForm = buildForm([{ key: 'text', label: 'Своя формулировка', type: 'textarea', rows: 4, wide: true, max: 4000, required: true }], { text });
      manual.replaceChildren(manualForm.el);
    }
    mode = 'manual';
    render();
    manualForm.focus();
  } });
  const useParts = button({ label: 'Собрать из частей', size: 'S', onClick: () => {
    mode = 'parts'; render(); picker.focus();
  } });
  const reset = current ? button({ label: 'Вернуться к справочнику', kind: 'ghost', size: 'S', onClick: () => {
    mode = 'dictionary'; render(); useParts.focus();
  } }) : null;
  const choose = !current && openDictionary ? button({ label: 'Подобрать готовый вариант', kind: 'ghost', size: 'S', onClick: openDictionary }) : null;

  function render() {
    const ids = picker.value();
    const broken = mode !== 'dictionary' && ids.some((id) => !byId.get(id)?.label);
    const editingManual = mode === 'manual' && !!manualForm;
    const text = mode === 'parts' ? autoText() : mode === 'manual' && !editingManual ? savedText : '';
    preview.replaceChildren(
      text ? h('p', null, text) : null,
      broken ? hint('Уберите недоступные части и при необходимости выберите их заново.', 'warn')
        : mode === 'parts' && !ids.length ? hint('Выберите части изделия.') : null,
      mode === 'dictionary' ? hint('После сохранения сайт подберёт применимый текст из справочника.') : null,
    );
    preview.hidden = editingManual && !broken;
    picker.el.hidden = mode === 'dictionary';
    manual.hidden = !editingManual;
    editText.hidden = editingManual;
    useParts.hidden = mode === 'parts';
    if (reset) reset.hidden = mode === 'dictionary';
  }

  sideForm(slot, {
    title: 'Краткое описание', done, confirm: !current,
    extra: stack(picker.el, preview, manual, actions(editText, useParts), actions(
      choose, reset, link({ label: 'Справочник частей ↗', href: '#dicts?d=passportParts', target: '_blank' }))),
    changed: () => mode !== initialMode || manualDirty() || picker.value().join() !== partIds.join(),
    read() {
      picker.close();
      if (mode === 'dictionary') return { simpleDescription: null };
      const ids = picker.value();
      if (ids.some((id) => !byId.get(id)?.label) || (mode === 'parts' && !autoText())) {
        picker.focus();
        return null;
      }
      if (mode === 'parts') return { simpleDescription: { mode: 'parts', partIds: ids } };
      const text = manualForm ? manualForm.read().values?.text : savedText;
      return text ? { simpleDescription: { text, partIds: ids } } : null;
    },
    async save(change) {
      if (mode !== 'manual' && manualDirty() && !await confirmDlg(
        'Сохранить без ручной правки?', 'Набранная формулировка будет снята.', { okText: 'Сохранить' },
      )) return false;
      await save(change, template.defaults);
    },
  });
  render();
  (mode === 'parts' ? picker : editText).focus();
}

export async function openBookCategory(slot, template, { save, done, isCurrent }) {
  const options = await passportCategoryOptions();
  if (!isCurrent()) return;
  const initial = template.defaults.passportCategory || '';
  const form = buildForm([{ key: 'category', label: 'Свой тип паспорта', type: 'select', options }], { category: initial });
  sideForm(slot, {
    title: 'Тип паспорта', form, done,
    extra: hint(initial ? 'Пустое значение возвращает тип из вида или группы изделия.' : 'Если свой тип не выбран, применяется тип вида или группы изделия.'),
    changed: () => form.get('category') !== initial,
    save: ({ category }) => save({ passportCategory: category || null }, template.defaults),
  });
}

export function editBookTemplateText(slot, spec, { done }) {
  const form = buildForm([{ key: 'text', label: spec.label, type: 'textarea', rows: spec.rows || 3, wide: true, max: 4000 }], { text: spec.text });
  sideForm(slot, {
    title: spec.label, form, done,
    changed: () => form.get('text') !== spec.text,
    save: ({ text }) => spec.save(text.trim()),
  });
  form.focus();
}

const quantities = new Map([
  ...V2_NUMS, ['foundationDepth', 'Глубина Г, мм'], ['seatsCount', 'Количество мест'], ['warrantyMonths', 'Гарантия, мес.'],
]);
const textFields = {
  description: ['Описание изделия', 'manualDescription', 'description'],
  purpose: ['Назначение', 'manualPurpose', 'purpose'],
  install: ['Текст монтажа', 'manualInstall', 'installationMethod'],
  installationMethod: ['Текст монтажа', 'manualInstall', 'installationMethod'],
};
const chooseFields = {
  kind: ['Вид изделия', 'kindId', 'passportKinds'],
  kindId: ['Вид изделия', 'kindId', 'passportKinds'],
  installationTypeId: ['Способ установки', 'installationTypeId', 'passportInstall'],
  installation: ['Способ установки', 'installationTypeId', 'passportInstall'],
};
const bookKindNames = new Map();
export const bookKindLabel = (id) => bookKindNames.get(String(id || '')) || '';
export const isBookSetting = (key) => Object.hasOwn(textFields, key) || Object.hasOwn(chooseFields, key)
  || quantities.has(key) || key === 'joints' || key === 'elements';

export async function openBookSetting(slot, template, options) {
  const { key, save, done, isCurrent, descriptionSetup = false } = options;
  const { defaults, document: r } = template;
  let spec;
  let initial;
  let parse = (value) => value ?? null;
  if (Object.hasOwn(textFields, key)) {
    const [label, own, value] = textFields[key];
    spec = { key: own, label, type: 'textarea', rows: 4, wide: true, max: 4000 };
    initial = options.initialText ?? defaults[own] ?? r[value] ?? '';
    parse = (input) => input.trim() || null;
  } else if (Object.hasOwn(chooseFields, key)) {
    const [label, own, dict] = chooseFields[key];
    const rows = await dictRows(dict);
    if (dict === 'passportKinds') for (const row of rows) if (!row.deletedAt) bookKindNames.set(String(row.id), row.name);
    if (!isCurrent()) return;
    const values = rows.filter((item) => dict !== 'passportKinds' || !item.passportCategory || item.passportCategory === template.passportCategory)
      .map((item) => ({ value: item.id, label: item.name }));
    if (descriptionSetup && !values.length) return descriptionHelp(slot, template, options,
      'В справочнике нет доступных видов для этого типа паспорта.', dict);
    spec = { key: own, label, options: values, type: 'select', required: descriptionSetup, choose: descriptionSetup, wide: true };
    initial = String(defaults[own] ?? r[own] ?? '');
    parse = (input) => input || null;
  } else if (key === 'joints' || key === 'elements') {
    const label = key === 'joints' ? 'Как соединено' : 'Элементы изделия';
    const rows = key === 'elements' ? await dictOpts('passportElements') : [];
    const widget = key === 'joints' ? jointsPick : (value) => {
      const pick = tagPick({ options: rows, value, label, productOnly: true });
      pick.setScope(template.passportCategory);
      return pick;
    };
    spec = { key, label, widget, type: 'widget', wide: true };
    initial = JSON.stringify(defaults[key] ?? r[key] ?? []);
    // buildForm декодирует JSON-виджет в массив; старые адаптеры могут вернуть ещё строку.
    parse = (value) => Array.isArray(value) ? value : JSON.parse(value);
  } else if (quantities.has(key)) {
    spec = { key, label: quantities.get(key), type: 'number', min: key === 'seatsCount' ? 1 : 0 };
    initial = defaults[key] ?? r[key] ?? '';
  } else return;
  if (!isCurrent()) return;
  const form = buildForm([spec], { [spec.key]: initial });
  sideForm(slot, {
    title: spec.label, form, done,
    confirm: options.initialText !== undefined && Object.hasOwn(textFields, key),
    extra: descriptionSetup ? hint('Вид изделия помогает подобрать краткое описание из справочника.') : null,
    changed: form.dirty,
    save: (values) => save({ [spec.key]: parse(values[spec.key]) }, defaults),
  });
  form.focus();
}
