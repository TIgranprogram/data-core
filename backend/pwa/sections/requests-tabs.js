import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { mountInvoicesTab } from './invoices-tab.js';

/**
 * «Заявки» с вкладками (CHAIN-AUDIT В2): «Заявки» (доска/таблица, как раньше) и «Счета» (#requests?tab=invoices).
 * `mkList(params)` создаёт обычный список заявок (mountList из main.js).
 */
const tabOf = (p) => (p.tab === 'invoices' ? 'invoices' : 'list');
const TABS = [['list', 'Заявки'], ['invoices', 'Счета']];
const clean = (p) => { const { tab, ...rest } = p; return rest; };

export function mountRequests(params, mkList) {
  let tab = tabOf(params);
  let inner = null;
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Заявки' });
  const body = h('div', { class: 'docs-body' });
  const el = h('div', { class: 'docs' }, h('div', { class: 'page-head' }, seg), body);
  const drawTabs = () => seg.replaceChildren(...TABS.map(([k, label]) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'active' : '', onclick: () => { if (tab !== k) go('requests', k === 'invoices' ? { tab: 'invoices' } : {}, { replace: true }); } }, label)));
  function mountTab(p) {
    inner?.destroy?.();
    inner = tab === 'invoices' ? mountInvoicesTab() : mkList(clean(p));
    body.replaceChildren(inner.el);
    drawTabs();
  }
  mountTab(params);
  return {
    el,
    reload: () => inner?.reload?.(),
    focusSearch: () => inner?.focusSearch?.(),
    destroy: () => inner?.destroy?.(),
    update: (p) => {
      if (tabOf(p) !== tab) { tab = tabOf(p); mountTab(p); return; }
      inner.update?.(tab === 'list' ? clean(p) : p);
    },
  };
}
