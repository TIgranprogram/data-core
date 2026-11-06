import { h } from '../../../core/dom.js';
import { busyBlock, empty, enhanceSelect, section, select, sideNote, toastError } from '../../../ui/kit/index.js';
import { loadTexts, putDefaults } from './api.js';

/**
 * Шаг 6 «Тексты»: разделы шаблона категории (section), в каждом выбор только из текстов категории и признаков изделия
 * (первыми — подходящие по признакам, byFacet). Текст подставлен сам (единственный или «по умолчанию»); менять не обязательно.
 * Выбор пишется в изделие (passportDefaults.textChoices).
 *   textsBlock({ prod }) → { el, load(category) }
 */
const plain = (t) => String(t || '').replace(/\{[^}]+\}/g, '…').replace(/\s+/g, ' ').trim();

/** Листья дерева с путём «Раздел › Вариант»; byFacet наследуется от родителя. */
function leaves(nodes, path = [], by = false) {
  return (nodes || []).flatMap((n) => {
    const f = by || !!n.byFacet;
    return n.children?.length ? leaves(n.children, [...path, n.name], f) : [{ id: String(n.id), label: [...path, n.name].join(' › '), text: n.text, isDefault: !!n.isDefault, byFacet: f }];
  });
}

export function textsBlock({ prod }) {
  const box = h('div', null);

  function paint(tree) {
    if (!tree.length) { box.replaceChildren(empty({ title: 'Для этой категории разделов нет', hint: 'Паспорт возьмёт общий текст категории.' })); return; }
    box.replaceChildren(sideNote('Тексты уже подставлены. Откройте раздел, только если нужен другой вариант.'), ...tree.map((root) => {
      const list = leaves(root.children).sort((a, b) => Number(b.byFacet) - Number(a.byFacet));
      const saved = prod.passportDefaults?.textChoices?.[root.id];
      const auto = list.length === 1 ? list[0] : list.find((l) => l.isDefault);
      const cur = list.find((l) => l.id === String(saved)) || auto || null;
      const preview = h('p', null, plain(cur?.text));
      const sel = select({ label: root.name, value: cur?.id || '',
        options: [['', 'Выберите вариант…'], ...list.map((l) => [l.id, l.label + (l.byFacet ? ' — по признаку изделия' : '')])],
        onChange: async (v) => {
          preview.textContent = plain(list.find((l) => l.id === v)?.text);
          if (!v) return;
          try { await putDefaults(prod, { textChoices: { ...(prod.passportDefaults?.textChoices || {}), [root.id]: v } }); } catch (e) { toastError(e, 'сохранить выбор текста'); }
        } });
      if (list.length > 12) enhanceSelect(sel);
      return section({ title: root.name, tone: 'info', body: list.length ? [sel, preview] : sideNote('Вариантов нет — подставится общий текст.') });
    }));
  }

  async function load(category) {
    box.replaceChildren(busyBlock('тексты'));
    try { paint(await loadTexts(category, prod.id)); } catch (e) { box.replaceChildren(empty({ title: 'Тексты не загрузились', hint: 'Откройте шаг ещё раз.' })); toastError(e, 'загрузить тексты'); }
  }
  return { el: box, load };
}
