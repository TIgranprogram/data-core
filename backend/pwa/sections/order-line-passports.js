/**
 * C138: паспорта позиций заказа для вкладки «Позиции» —
 * одна загрузка на вкладку, номер справа перед «Кол-во», общая карта для «Документы».
 */
import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { button, card, badge, empty, stack, actions, busyBlock, failBlock } from '../ui/kit/index.js';
import { numberOf, statusOf, canWorkPassport } from './passports/common.js';
import { variantName } from './passports/book-template.js';
import { busyBtn } from '../ui/kit/busy.js';
import { toastError } from '../ui/kit/toast.js';
import { go } from '../core/router.js';
import { attachmentSource, readPassportSource, selectedPassportActions, openPassportSourcePicker, downloadSelectedPassport } from './passport-source-picker.js';

const rank = (p) => (statusOf(p) === 'issued' ? 0 : statusOf(p) === 'draft' ? 1 : 2);
const isReuseGhost = (p) => String(numberOf(p) || '').includes('~');

/** Map incomeId → массив паспортов (выпущенные выше черновиков). */
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

/**
 * Один актуальный паспорт позиции: выпущенный без суффикса «~», иначе черновик.
 * Аннулированные (601~1) в строке и в «Документах» не показываем.
 */
export function primaryPassport(list) {
  const items = Array.isArray(list) ? list : (list ? [list] : []);
  const live = items.filter((p) => statusOf(p) !== 'annulled' && !isReuseGhost(p));
  const issued = live.filter((p) => statusOf(p) === 'issued' && numberOf(p));
  if (issued.length) {
    return issued.slice().sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0)
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
  }
  return live.find((p) => statusOf(p) === 'draft') || null;
}

/** GET /passports по каждому договору. Ошибка любого запроса — наружу (карточка «Документы» покажет fail + повтор). */
export async function loadPassportsByIncome(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  const map = new Map();
  if (!ids.length) return map;
  const results = await Promise.all(ids.map(async (id) => {
    const [passports, plan] = await Promise.all([api('/passports', { query: { salesOrderId: id, limit: 200 } }), api(`/passports/order/${id}/plan`, { query: { presentationVersion: 1 } })]);
    return { passports, plan, orderId: id };
  }));
  for (const { passports, plan, orderId } of results) {
    groupPassportsByIncome(passports.items, map);
    for (const line of plan.lines || []) {
      const list = map.get(String(line.incomeId)) || [];
      list.sourceView = { ...line, orderId };
      map.set(String(line.incomeId), list);
    }
  }
  return map;
}

/** Клик по номеру — эталонная книжка (C141), не старая карточка. */
async function openPassport(p, options) {
  const { openBookEditor } = await import('./passports/book-editor.js');
  return openBookEditor(p.id, options);
}

/** Метка в строке позиций: только актуальный номер / черновик; нет паспорта — null. */
export function passportMark(list) {
  const source = list?.sourceView;
  if (attachmentSource(source)) return button({ label: source.state === 'attached' ? 'Вложенный паспорт' : 'Паспорт — нужен файл', size: 'S', kind: 'ghost',
    onClick: async (e) => {
      e.stopPropagation();
      if (source.state !== 'attached') return;
      const end = busyBtn(e.currentTarget, null);
      try { await downloadSelectedPassport(source.orderId, source.incomeId, source); }
      catch (err) { toastError(err); window.dispatchEvent(new Event('data-changed')); } finally { end(); }
    } });
  const p = primaryPassport(list);
  if (!p) return null;
  const n = numberOf(p);
  if (n) {
    return h('a', {
      href: '#', class: 'small nowrap', title: 'Открыть паспорт',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); openPassport(p); },
    }, `Паспорт № ${n}`);
  }
  return h('a', {
    href: '#', class: 'small nowrap', title: 'Открыть черновик паспорта позиции',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); openPassport(p); },
  }, 'Паспорт — черновик');
}

/** Состояние загрузки вкладки: { map, error }. map — Map|null; error — при сбое общей загрузки. */
export function makePassportPack() {
  return { map: null, error: null };
}

/** Слоты в колонке перед «Кол-во» + общая загрузка (чтобы salesorders.js не рос по L8). */
export function attachLinePassports(orders) {
  const passports = makePassportPack();
  const markSlots = new Map();
  const markOf = (id) => { const el = h('div'); markSlots.set(String(id), el); return el; };
  const whenReady = () => loadPassportsByIncome(orders.map((o) => o.id)).then((map) => {
    passports.map = map; passports.error = null;
    for (const [id, el] of markSlots) { const node = passportMark(map.get(id)); el.replaceChildren(...(node ? [node] : [])); }
  }).catch((e) => { passports.map = null; passports.error = e; for (const el of markSlots.values()) el.replaceChildren(); });
  return { passports, markOf, whenReady };
}

/** Карточка «Документы»: из pack.map без повторного GET; при pack.error — fail + повтор; после правки — skipCache. */
export function documentsCard(l, d, pack) {
  const body = h('div');
  const salesOrderId = l.orderId || d.orderId;
  const showList = (list, reloadCard, source) => {
    if (attachmentSource(source)) {
      const historical = (list || []).filter((p) => statusOf(p) === 'issued' && !isReuseGhost(p));
      body.replaceChildren(stack(selectedPassportActions(salesOrderId, l.id, source, { reload: reloadCard, editable: canWorkPassport() && !l.cancelledAt }),
        historical.length ? card({ size: 'S', title: 'Ранее выпущено на сайте', body: stack(...historical.map((p) => button({
          label: `Паспорт № ${numberOf(p)}`, size: 'S', kind: 'ghost', onClick: () => openPassport(p),
        }))) }) : null));
      return;
    }
    const choose = canWorkPassport() && salesOrderId && l.productId && !l.cancelledAt ? button({
      label: 'Выбрать вложенный паспорт', size: 'S', kind: 'ghost', onClick: (e) => openPassportSourcePicker(salesOrderId, l.id, { parent: e.currentTarget.closest('.drawer'), onSaved: reloadCard }),
    }) : null;
    const p = primaryPassport(list);
    if (!p) {
      const create = canWorkPassport() && salesOrderId && l.productId && !l.cancelledAt
        ? button({ label: 'Создать черновик паспорта', size: 'S', onClick: async (e) => {
          const b = e.currentTarget;
          const end = busyBtn(b, 'Открываю…');
          try {
            const { openBookForLine } = await import('./passports/open-book.js');
            await openBookForLine({ productId: l.productId, salesOrderId, incomeId: l.id },
              { onClose: () => reloadCard(), isCurrent: () => b.isConnected });
          } finally { end(); }
        } }) : null;
      body.replaceChildren(stack(empty({ title: 'Паспорта ещё нет', hint: 'Выпуск доступен также в плане паспортов заказа.' }), actions(create, choose)));
      return;
    }
    const issued = statusOf(p) === 'issued';
    body.replaceChildren(stack(actions(
      button({ label: numberOf(p) ? `Паспорт № ${numberOf(p)}` : 'Паспорт — черновик', size: 'S', kind: 'ghost', onClick: () => openPassport(p) }),
      badge(issued ? 'выпущен' : 'черновик', issued ? 'ok' : 'warn'),
      badge(variantName(p.variant) || 'Прежний формат', 'dim')),
    actions(
      canWorkPassport() && p.presentationVersion === 1 && !issued
        ? button({ label: 'Изменить паспорт', size: 'S', onClick: () => openPassport(p, { onClose: () => reloadCard() }) }) : null,
      issued ? button({ label: 'Скачать PDF', size: 'S', kind: 'ghost', onClick: async (e) => {
        const end = busyBtn(e.currentTarget, 'Открываю…');
        try { const { printDialog } = await import('./passports/dialogs.js'); await printDialog(p); }
        catch (err) { toastError(err); }
        finally { end(); }
      } }) : null, choose)));
  };
  const load = async ({ skipCache } = {}) => {
    const again = () => load({ skipCache: true });
    body.replaceChildren(busyBlock('документы', { retry: again }));
    try {
      if (pack && !skipCache) {
        if (pack.error && !pack.map) { body.replaceChildren(failBlock(pack.error, again, { text: 'Документы не загрузились' })); return; }
        if (pack.map) { const list = pack.map.get(String(l.id)); showList(list, again, list?.sourceView); return; }
      }
      if (!salesOrderId) { body.replaceChildren(empty({ title: 'Паспорта ещё нет', hint: 'Позиция не привязана к заказу.' })); return; }
      const [r, source] = await Promise.all([api('/passports', { query: { salesOrderId, limit: 200 } }), readPassportSource(salesOrderId, l.id)]);
      showList(groupPassportsByIncome(r.items).get(String(l.id)), again, source);
    } catch (e) { body.replaceChildren(failBlock(e, again, { text: 'Документы не загрузились' })); }
  };
  load();
  return card({ size: 'M', title: 'Документы', variant: 'fields', body });
}
