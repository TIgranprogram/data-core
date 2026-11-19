import { h } from '../../core/dom.js';
import { actions, attachCombo, buildForm, button, hint, link, stack, tagPick, textInput } from '../../ui/kit/index.js';
import { busyBtn } from '../../ui/kit/busy.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { dictOpts, dictRows, passportCategoryOptions, V2_NUMS } from './common.js';
import { sidePanel } from './book-shared.js';
import { setSideWide } from './book-side-edit.js';
import { jointsPick } from './traits.js';
import { simpleTextHref } from './book-template.js';
import { simpleChoiceChanges, simpleChoiceField, simpleChoiceOptions } from './book-choices.js';

/** Общее состояние правки в правой колонке для шаблона, в том числе при смене варианта. */
function sideForm(slot, { title, form, extra, changed, save, done, read, confirm = false, okLabel = 'Сохранить в шаблон' }) {
  let working = false;
  const error = h('div', { hidden: true, role: 'alert' });
  const ok = button({ label: okLabel, kind: 'primary', size: 'S', onClick: async () => {
    if (working) return;
    const values = read ? read() : form.read().values;
    if (!values) return;
    working = true;
    error.hidden = true;
    const end = busyBtn(ok);
    try {
      if (confirm || changed()) await save(values);
      slot._bkLeave = null;
      done({ saved: true });
    } catch (e) {
      error.replaceChildren(hint(e.message, 'warn'));
      error.hidden = false;
    } finally {
      working = false;
      end();
    }
  } });
  slot._bkLeave = async () => !working && (!changed() || await confirmDlg(
    'Выйти без сохранения?', 'В шаблоне есть несохранённая правка.', { okText: 'Выйти' }));
  const cancel = button({ label: 'Отмена', kind: 'ghost', size: 'S', onClick: async () => {
    if (await slot._bkLeave?.()) { slot._bkLeave = null; done({ saved: false }); }
  } });
  setSideWide(slot, false, { editing: true });
  slot.replaceChildren(sidePanel(title, stack(form.el, extra, error, actions(ok, cancel))));
}

function descriptionHelp(slot, template, { done, openOwn }, message, dictionary = 'passportPhrases') {
  const href = dictionary === 'passportPhrases' ? simpleTextHref(template.simpleDescriptionSource) : `#dicts?d=${dictionary}`;
  const label = dictionary === 'passportKinds' ? 'Справочник видов ↗' : 'Справочник текстов ↗';
  const source = !!template.simpleDescriptionSource;
  const dictionaryLink = link({ label, href, target: '_blank' });
  const ownButton = button({ label: 'Своя формулировка', size: 'S', onClick: openOwn });
  setSideWide(slot, false, { editing: true });
  slot.replaceChildren(sidePanel('Краткое описание', stack(hint(message),
    actions(dictionaryLink, ownButton, button({ label: 'Закрыть', kind: 'ghost', size: 'S', onClick: () => done() })))));
  (source ? ownButton : dictionaryLink).focus();
}

/** Служебный список причин определяет следующий шаг, а текст и его применимость возвращает сервер. */
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

function descriptionPartPicker(parts, template, initial) {
  const linked = new Set((template.simpleDescriptionSource
    ? template.simpleDescriptionSource.partIds || []
    : (template.simpleDescriptionSuggestions || []).flatMap((item) => item.partIds || [])));
  const ids = new Set(initial);
  const byId = new Map(parts.map((part) => [part.value, part]));
  const selected = actions();
  const search = textInput({ label: 'Добавить часть', placeholder: 'Найдите по названию', hint: 'По желанию. Выбранные части сохраняются со своей формулировкой.' });
  const isShortlist = (part) => part.cats.includes(template.passportCategory);
  const render = () => selected.replaceChildren(...[...ids].map((id) => {
    const label = byId.get(id)?.label || 'Часть без названия';
    return button({ label: `${label} ×`, title: `Убрать «${label}»`, kind: 'ghost', size: 'S', onClick: () => {
      ids.delete(id); render(); search.focus();
    } });
  }));
  attachCombo(search.input, {
    options: () => parts.filter((part) => !ids.has(part.value) && (linked.has(part.value)
      || (search.value.trim() ? !part.cats.length || isShortlist(part) : !linked.size && isShortlist(part)))),
    empty: 'Введите название части для поиска', max: 12,
    onPick: (part) => { ids.add(part.value); search.value = ''; render(); },
  });
  render();
  return { el: stack(selected, search.el), value: () => [...ids] };
}

export async function openSimpleDescription(slot, template, { save, done, isCurrent }) {
  const current = template.defaults.simpleDescription;
  const text = current?.text ?? template.textSnapshot?.description ?? '';
  const partIds = current?.partIds || template.simpleDescriptionSource?.partIds || [];
  const form = buildForm([{ key: 'text', label: 'Своя формулировка', type: 'textarea', rows: 4, wide: true, max: 4000, required: true }], { text });
  const parts = await dictOpts('passportParts');
  if (!isCurrent()) return;
  const picker = descriptionPartPicker(parts, template, partIds);
  const reset = current ? button({ label: 'Вернуться к справочнику', kind: 'ghost', size: 'S', onClick: async () => {
    if (!await confirmDlg('Вернуться к тексту из справочника?', 'Собственная формулировка будет снята.', { okText: 'Вернуться к справочнику' })) return;
    const end = busyBtn(reset);
    try { await save({ simpleDescription: null }, template.defaults); done({ saved: true }); }
    catch (e) { slot.append(hint(e.message, 'warn')); }
    finally { end(); }
  } }) : null;
  const extra = stack(
    picker.el,
    actions(reset, link({ label: 'Справочник частей ↗', href: '#dicts?d=passportParts', target: '_blank' }),
      link({ label: 'Справочник текстов ↗', href: simpleTextHref(template.simpleDescriptionSource), target: '_blank' })),
  );
  sideForm(slot, {
    title: 'Краткое описание', form, extra, done,
    changed: () => String(form.get('text')).trim() !== text || JSON.stringify(picker.value()) !== JSON.stringify(partIds),
    save: ({ text }) => save({ simpleDescription: { text: text.trim(), partIds: picker.value() } }, template.defaults),
  });
  form.focus();
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
    initial = defaults[own] ?? r[value] ?? '';
    parse = (input) => input.trim() || null;
  } else if (Object.hasOwn(chooseFields, key)) {
    const [label, own, dict] = chooseFields[key];
    const rows = await dictRows(dict);
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
    parse = (value) => JSON.parse(value);
  } else if (quantities.has(key)) {
    spec = { key, label: quantities.get(key), type: 'number', min: key === 'seatsCount' ? 1 : 0 };
    initial = defaults[key] ?? r[key] ?? '';
  } else return;
  if (!isCurrent()) return;
  const form = buildForm([spec], { [spec.key]: initial });
  sideForm(slot, {
    title: spec.label, form, done,
    extra: descriptionSetup ? hint('Вид изделия помогает подобрать краткое описание из справочника.') : null,
    changed: form.dirty,
    save: (values) => save({ [spec.key]: parse(values[spec.key]) }, defaults),
  });
  form.focus();
}
