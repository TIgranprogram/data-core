/**
 * C138: паспорта позиций заказа для вкладки «Позиции» —
 * одна загрузка на вкладку, подпись под названием, общая карта для «Документы».
 */
import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { button, card, badge, empty, stack, actions, busyBlock, failBlock } from '../ui/kit/index.js';
import { numberOf, statusOf, canWorkPassport } from './passports/common.js';
import { printDialog } from './passports/dialogs.js';
import { openBookEditor } from './passports/book-editor.js';
import { toastError } from '../ui/kit/toast.js';
import { go } from '../core/router.js';

const rank = (p) => (statusOf(p) === 'issued' ? 0 : statusOf(p) === 'draft' ? 1 : 2);

/** Map incomeId → массив паспортов (выпущенные выше черновиков). Несколько на позицию — все. */
export function groupPassportsByIncome(items, into = new Map()) {
  for (const p of items || []) {
    if (!p?.incomeId) continue;
    const key = String(p.incomeId);
    const list = into.get(key) || [];
    list.push(p);
    into.set(key, list);
  }
  for (const list of into.values()) list.sort((a, b) => rank(a) - rank(b));
  return into;
}

/** GET /passports по каждому договору. Ошибка любого запроса — наружу (карточка «Документы» покажет fail + повтор). */
export async function loadPassportsByIncome(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!ids.length) return map;
  const results = await Promise.all(ids.map((id) => api('/passports', { query: { salesOrderId: id, limit: 200 } })));
  for (const r of results) groupPassportsByIncome(r.items, map);
  return map;
}

/** Клик по номеру — открыть этот паспорт (как в «Документы»). */
function openPassport(p) {
  go('docs', { tab: 'orders', of: 'passports', open: p.id }, { kind: 'card' });
}

/** Подпись под названием: все номера / черновики; нет паспорта — null. */
export function passportUnderTitle(list) {
  const items = Array.isArray(list) ? list : (list ? [list] : []);
  if (!items.length) return null;
  return h('div', { class: 'small' }, ...items.map((p) => {
    const n = numberOf(p);
    if (n) {
      return h('div', null, h('a', {
        href: '#', title: 'Открыть паспорт',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); openPassport(p); },
      }, `Паспорт № ${n}`));
    }
    return h('div', { class: 'muted' }, 'Паспорт — черновик');
  }));
}

/** Состояние загрузки вкладки: { map, error }. map — Map|null; error — при сбое общей загрузки. */
export function makePassportPack() {
  return { map: null, error: null };
}

/** Слоты под названием + общая загрузка (чтобы salesorders.js не рос по L8). */
export function attachLinePassports(orders) {
  const passports = makePassportPack();
  const markSlots = new Map();
  const markOf = (id) => { const el = h('div'); markSlots.set(String(id), el); return el; };
  const whenReady = () => loadPassportsByIncome(orders.map((o) => o.id)).then((map) => {
    passports.map = map; passports.error = null;
    for (const [id, el] of markSlots) { const node = passportUnderTitle(map.get(id)); el.replaceChildren(...(node ? [node] : [])); }
  }).catch((e) => { passports.map = null; passports.error = e; for (const el of markSlots.values()) el.replaceChildren(); });
  return { passports, markOf, whenReady };
}

/** Карточка «Документы»: из pack.map без повторного GET; при pack.error — fail + повтор; после правки — skipCache. */
export function documentsCard(l, d, pack) {
  const body = h('div');
  const showList = (list, reloadCard) => {
    if (!list?.length) { body.replaceChildren(empty({ title: 'Паспорта ещё нет', hint: 'Выпускается в «Документы → Паспорта заказа».' })); return; }
    const blocks = list.map((p) => {
      const issued = statusOf(p) === 'issued';
      return stack(actions(
        button({ label: numberOf(p) ? `Паспорт № ${numberOf(p)}` : 'Паспорт — черновик', size: 'S', kind: 'ghost', onClick: () => openPassport(p) }),
        badge(issued ? 'выпущен' : 'черновик', issued ? 'ok' : 'warn')),
      actions(
        !canWorkPassport() ? null : button({ label: 'Изменить паспорт', size: 'S', title: 'Большое окно: паспорт как в PDF, любое поле правится на месте', onClick: () => openBookEditor(p, { onClose: () => reloadCard() }) }),
        issued ? button({ label: 'Скачать PDF', size: 'S', kind: 'ghost', onClick: (e) => { const b = e.currentTarget; b.classList.add('is-busy'); printDialog(p).catch(toastError).finally(() => b.classList.remove('is-busy')); } }) : null));
    });
    body.replaceChildren(stack(...blocks));
  };
  const load = async ({ skipCache } = {}) => {
    const again = () => load({ skipCache: true });
    body.replaceChildren(busyBlock('документы', { retry: again }));
    try {
      if (pack && !skipCache) {
        if (pack.error && !pack.map) { body.replaceChildren(failBlock(pack.error, again, { text: 'Документы не загрузились' })); return; }
        if (pack.map) { showList(pack.map.get(String(l.id)), again); return; }
      }
      if (!(l.orderId || d.orderId)) { body.replaceChildren(empty({ title: 'Паспорта ещё нет', hint: 'Позиция не привязана к заказу.' })); return; }
      const r = await api('/passports', { query: { salesOrderId: l.orderId || d.orderId, limit: 200 } });
      showList(groupPassportsByIncome(r.items).get(String(l.id)), again);
    } catch (e) { body.replaceChildren(failBlock(e, again, { text: 'Документы не загрузились' })); }
  };
  load();
  return card({ size: 'M', title: 'Документы', variant: 'fields', body });
}
