/** C163: сначала различия изделия, затем готовые тексты; ввод остаётся справа. */
import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { actions, buildForm, button, hint, stack, tagPick } from '../../ui/kit/index.js';
import { bookKindLabel, openBookCategory, openBookSetting, sideForm } from './book-template-edit.js';
import { V2_CATS } from './common.js';

const live = (row) => !row.deletedAt;
const ordered = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const ids = (value) => Array.isArray(value) ? value.map(String) : [];

/** Связь с конструкцией ограничивается всей веткой, а не только листом. */
function facetPhraseBindings(template, phrases) {
  const byId = new Map(phrases.map((phrase) => [String(phrase.id), phrase]));
  const parents = new Set(phrases.filter((phrase) => phrase.parentId).map((phrase) => String(phrase.parentId)));
  const bindings = new Map();
  for (const leaf of phrases) {
    if (parents.has(String(leaf.id)) || !String(leaf.text || '').trim() || !ids(leaf.facetValueIds).length) continue;
    const chain = [];
    const seen = new Set();
    let current = leaf;
    let valid = true;
    while (current) {
      const id = String(current.id);
      if (seen.has(id)) { valid = false; break; }
      seen.add(id); chain.push(current);
      if (!live(current)) valid = false;
      if (!current.parentId) break;
      current = byId.get(String(current.parentId));
      if (!current) valid = false;
    }
    const sections = chain.map((phrase) => phrase.section).filter(Boolean);
    if (!sections.includes('simple-description') && (valid || sections.length)) continue;
    const fits = valid && chain.every((phrase) => {
      const kinds = ids(phrase.kindIds);
      const categories = Array.isArray(phrase.categories) ? phrase.categories : String(phrase.categories || '').split(/[,;\s]+/).filter(Boolean);
      return (!kinds.length || kinds.includes(String(template.document?.kindId || '')))
        && (phrase.allCategories || !categories.length || categories.includes(template.passportCategory));
    });
    for (const valueId of ids(leaf.facetValueIds)) {
      const matches = bindings.get(valueId) || [];
      matches.push(fits); bindings.set(valueId, matches);
    }
  }
  return bindings;
}

/** Собственные значения других категорий и недоступных критериев не затрагиваются. */
export function bookFacetModel(template, facets, values, phrases = []) {
  const baseline = template.product?.facetValueIds ?? null;
  const selected = new Set(ids(baseline));
  const bindings = facetPhraseBindings(template, phrases);
  const applicable = facets.filter((facet) => live(facet) && facet.category === template.passportCategory)
    .sort((a, b) => Number(a.step === false) - Number(b.step === false) || ordered(a, b));
  const rows = applicable.map((facet) => {
    const owned = values.filter((value) => String(value.parentId) === String(facet.id));
    // Неполное покрытие фразами не ограничивает общие признаки, только явные уточнения конструкции.
    const construction = facet.step === false && String(facet.code || '').endsWith('.form');
    const choices = owned.filter((value) => live(value) && (!construction || !bindings.has(String(value.id)) || bindings.get(String(value.id)).some(Boolean))).sort(ordered);
    const allowed = new Set(choices.map((value) => String(value.id)));
    return { ...facet, choices, hiddenSelected: owned.filter((value) => selected.has(String(value.id)) && !allowed.has(String(value.id))),
      initial: choices.filter((value) => selected.has(String(value.id))).map((value) => String(value.id)) };
  }).filter((facet) => facet.choices.length);
  return {
    baseline, rows,
    changes(answer) {
      let next = ids(baseline);
      for (const facet of rows) {
        const raw = answer[facet.id];
        const picked = facet.multi ? ids(raw) : raw ? [String(raw)] : [];
        if (JSON.stringify(picked) === JSON.stringify(facet.initial)) continue;
        const allowed = new Set(facet.choices.map((value) => String(value.id)));
        if (picked.some((id) => !allowed.has(id)) || (!facet.multi && picked.length > 1)) throw new Error('Выберите доступное значение критерия.');
        const owned = new Set(values.filter((value) => String(value.parentId) === String(facet.id)).map((value) => String(value.id)));
        next = next.filter((id) => !owned.has(id)).concat(picked);
      }
      return { facetValueIds: [...new Set(next)] };
    },
  };
}

export async function openBookFacets(slot, template, { save, done, isCurrent }) {
  const [facets, values, phrases] = await Promise.all([api('/dicts/productFacets'), api('/dicts/productFacetValues'), api('/dicts/passportPhrases')]);
  if (!isCurrent()) return;
  const model = bookFacetModel(template, facets.items || [], values.items || [], phrases.items || []);
  const fields = [];
  const initial = {};
  let extra = false;
  for (const facet of model.rows) {
    if (facet.step === false && !extra) { fields.push({ section: 'Дополнительные критерии', collapsed: true }); extra = true; }
    const options = facet.choices.map((value) => ({ value: String(value.id), label: value.name }));
    fields.push(facet.multi
      ? { key: facet.id, label: facet.name, type: 'widget', wide: true, widget: (value) => tagPick({ options, value, label: facet.name }) }
      : { key: facet.id, label: facet.name, type: 'select', wide: true, options });
    if (facet.hiddenSelected.length) fields.push({ note: 'Сохранённое значение относится к другому виду или больше недоступно: '
      + facet.hiddenSelected.map((value) => value.name || 'без названия').join(', ') + '. Оно сохранится, пока вы не измените этот критерий.' });
    initial[facet.id] = facet.multi ? JSON.stringify(facet.initial) : facet.initial[0] || '';
  }
  const form = buildForm(fields, initial);
  const summary = h('div', { role: 'status', 'aria-label': 'Выбранные критерии полностью' });
  const paintSummary = () => {
    const chosen = [];
    for (const facet of model.rows) {
      const raw = form.get(facet.id);
      let selected = raw ? [String(raw)] : [];
      if (facet.multi) {
        try { selected = ids(Array.isArray(raw) ? raw : JSON.parse(raw || '[]')); }
        catch { selected = []; }
      }
      const labels = facet.choices.filter((value) => selected.includes(String(value.id))).map((value) => hint(value.name));
      if (labels.length) chosen.push(stack(h('b', null, facet.name), ...labels));
    }
    summary.hidden = !chosen.length;
    summary.replaceChildren(...chosen);
  };
  form.el.addEventListener('change', paintSummary);
  paintSummary();
  sideForm(slot, {
    title: 'Критерии изделия', form, done, changed: form.dirty,
    extra: stack(hint(model.rows.length ? 'Выберите известные различия. Неизвестное можно оставить пустым.' : 'Для этого типа паспорта критериев пока нет.'), summary),
    save: (answer) => save(model.changes(answer), { ...template.defaults, facetValueIds: model.baseline }),
  });
  form.focus();
}

/** Дерево уже отфильтровано сервером по изделию и режиму short. */
export function purposeOptions(sections) {
  const result = [];
  const walk = (nodes, rootId, path = []) => {
    for (const node of nodes || []) {
      const names = [...path, node.name].filter(Boolean);
      if (node.children?.length) walk(node.children, rootId, names);
      else if (node.text) result.push({ id: node.id, rootId, label: names.join(' › '), text: node.text });
    }
  };
  for (const section of sections || []) if (section.section === 'purpose') walk(section.children, section.id);
  return result;
}

export async function openBookPurpose(slot, template, { save, done, isCurrent, openManual }) {
  const data = await api('/passports/funnel', { query: {
    category: template.passportCategory, productId: template.productId, presentationVersion: 1, variant: 'short',
  } });
  if (!isCurrent()) return;
  const options = purposeOptions(data.sections);
  const own = template.defaults.textChoices || {};
  const chosen = options.find((option) => own[option.rootId] === option.id);
  const one = options.length === 1 ? options[0] : null;
  const form = buildForm(options.length ? [{ key: 'purpose', label: 'Готовое назначение', type: 'select',
    required: true, choose: true, wide: true, options: options.map((option) => ({ value: option.id, label: option.label })) }] : [],
  { purpose: chosen?.id || one?.id || '' });
  const preview = h('div', { role: 'status', 'aria-label': 'Предпросмотр назначения' });
  const paint = () => {
    const selected = options.find((option) => option.id === form.get('purpose'));
    preview.replaceChildren(selected ? h('p', null, selected.text) : hint(template.document.purpose || 'Выберите готовое назначение.'));
  };
  form.el.addEventListener('change', paint);
  sideForm(slot, {
    title: 'Назначение', form, done, changed: form.dirty, confirm: !!options.length,
    okLabel: options.length ? 'Применить назначение' : 'Закрыть',
    extra: stack(preview, !options.length ? hint('Готовых вариантов для подтверждённых признаков пока нет.') : null,
      template.defaults.manualPurpose != null || template.defaults.manualText?.includes('purpose')
        ? hint('Своя формулировка сохранится, пока вы не примените готовое назначение.') : null,
      actions(button({ label: 'Своя формулировка', kind: 'ghost', size: 'S', onClick: () =>
        openManual(options.find((option) => option.id === form.get('purpose'))?.text || template.document.purpose || '') }))),
    save: async ({ purpose }) => {
      const option = options.find((item) => item.id === purpose);
      if (!option) return false;
      const manualText = template.defaults.manualText;
      await save({ textChoices: { [option.rootId]: option.id },
        ...(template.defaults.manualPurpose != null ? { manualPurpose: null } : {}),
        ...(manualText?.includes('purpose') ? { manualText: manualText.filter((key) => key !== 'purpose') } : {}),
      }, template.defaults);
    },
  });
  paint();
  form.focus();
}

export function bookSettingOpener(S, editTemplateSide, openDescription) {
  return (key) => {
    if (S.template?.variant === 'short') {
      if (key === 'simpleDescription') { openDescription(); return; }
      if (['purpose', 'facets', 'kindId'].includes(key) && !S.template.passportCategory) { editTemplateSide(openBookCategory); return; }
      if (key === 'purpose' && !S.r.kindId) {
        editTemplateSide((slot, template, options) => openBookSetting(slot, template, { ...options, key: 'kindId', descriptionSetup: true }), { followPurpose: true });
        return;
      }
      if (key === 'purpose') { editTemplateSide(openBookPurpose); return; }
      if (key === 'facets') { editTemplateSide(openBookFacets); return; }
    }
    editTemplateSide(key === 'category' ? openBookCategory
      : (slot, template, options) => openBookSetting(slot, template, { ...options, key }));
  };
}

/** Монтаж экземпляра правится в нём; прочие пункты сохраняют существующий переход к шаблону. */
export function bookFocusSettingOpener({ S, runHeadAction, editDraftTemplate, openDescription, editSetting, openInstanceInstallation }) {
  return async (key, button) => {
    if (key === 'installationTypeId' && !S.template) return openInstanceInstallation();
    if (!S.template) await runHeadAction(button, null, editDraftTemplate);
    if (S.template) key === 'simpleDescription' ? openDescription() : editSetting(key);
  };
}

/** Компактные шаги перед очередью обязательных сведений; значения правятся справа. */
export function paintBookSetup(host, template, { can, open }) {
  const visible = can && template?.variant === 'short';
  host.hidden = !visible;
  if (!visible) { host.replaceChildren(); return; }
  const r = template.document;
  host.replaceChildren(stack(
    h('h3', null, 'Подготовка паспорта'),
    button({ label: `Тип паспорта: ${V2_CATS.find((cat) => cat.value === template.passportCategory)?.label || 'выбрать'}`, kind: 'ghost', size: 'S', onClick: () => open('category') }),
    button({ label: `Вид изделия: ${r.kindName || bookKindLabel(r.kindId) || (r.kindId ? 'выбран' : 'выбрать')}`, kind: 'ghost', size: 'S', onClick: () => open('kindId') }),
    r.kindId ? button({ label: 'Критерии изделия', kind: 'ghost', size: 'S', onClick: () => open('facets') }) : null,
    r.kindId ? button({ label: r.purpose ? 'Назначение: готово · Изменить' : 'Подобрать назначение', kind: 'ghost', size: 'S', onClick: () => open('purpose') }) : null,
    r.kindId && r.purpose ? hint(r.purpose) : null,
    r.kindId ? button({ label: 'Краткое описание', kind: 'ghost', size: 'S', onClick: () => open('simpleDescription') }) : null,
    template.simpleDescriptionSource?.text ? hint(template.simpleDescriptionSource.text) : null,
  ));
}
