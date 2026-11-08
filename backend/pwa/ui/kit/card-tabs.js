import { h } from '../../core/dom.js';
import { busyBlock, failBlock } from './busy.js';
import { tabs } from './tabs.js';

/**
 * Вкладки панели карточки (card.tabs, C052 T9): эталон tabs({ fill }) + ленивая панель .k-pane.
 * Вынесено из ui/kit/card.js, чтобы тот не рос сверх 400 строк. Зависимости замыкания openCard — аргументами.
 *  tabDefs: [{ key, label, count?, tone?, blocks: (row, ctx) => узлы }]; onOpenTab(fn) — отдать ctx.openTab наружу.
 */
export function buildCardTabs({ tabDefs, section, row, actx, setPref, getPref, onOpenTab }) {
  const secKey = section.id || section.title || 'card';
  const pane = h('div', { class: 'k-pane' });
  const items = tabDefs.map((t) => ({ key: t.key, label: t.label, count: t.count, tone: t.tone }));
  const valid = (k) => tabDefs.some((t) => t.key === k);
  let cur = null;
  const bar = tabs({ items, value: undefined, label: 'Разделы', fill: true, onChange: (k) => select(k) });
  function select(k) {
    if (!valid(k)) k = tabDefs[0].key;
    cur = k;
    setPref('cardTab:' + secKey, k);
    bar.set(k);
    pane.replaceChildren(busyBlock('раздел'));
    Promise.resolve(tabDefs.find((t) => t.key === k).blocks(row, actx())).then((nodes) => {
      if (cur !== k) return;
      pane.replaceChildren(...[].concat(nodes ?? []).filter(Boolean));
    }).catch((e) => { if (cur === k) pane.replaceChildren(failBlock(e, () => select(k), { text: 'Раздел не открылся' })); });
  }
  onOpenTab(select);
  const saved = getPref('cardTab:' + secKey);
  select(valid(saved) ? saved : tabDefs[0].key);
  return h('div', null, bar.el, pane);
}
