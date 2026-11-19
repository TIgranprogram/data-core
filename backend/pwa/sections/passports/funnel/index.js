import { h } from '../../../core/dom.js';
import { button, confirmDlg, hint, link, stack, toast, toastError } from '../../../ui/kit/index.js';
import { current, patch } from '../../../core/router.js';
import { canWorkPassport } from '../common.js';
import { getProduct } from './api.js';
import { openPositions, orderStep } from './issue.js';
import { newProduct } from './new-product.js';
import { peekProduct, peekReady, takePending } from './open.js';
import { pickSteps } from './pick-steps.js';
import { productList } from './product-list.js';
import { readyPanel } from './ready.js';
import { openBookForProduct } from '../open-book.js';

/**
 * Воронка «Новый паспорт» (C141): шаги до изделия (категория → … → изделие / заказ),
 * дальше эталон — книжка (заполнение и выпуск). Старая анкета passportFill здесь больше не монтируется.
 */
const FACET_FREE = (P) => Object.entries(P).filter(([k, v]) => v && k !== 'category' && k !== 'group').flatMap(([, v]) => String(v).split(',')).filter((id) => id && id !== 'none');

/** «Добавить готовый паспорт» (C072) — та же правая панель, другие шаги. */
let readyMode = false; // какая панель открыта сейчас — для заголовка карточки
function buildReady(entry) {
  return readyPanel(entry);
}

function build() {
  const entry = takePending();
  readyMode = !!entry?.ready;
  if (entry?.ready) return buildReady(entry);
  const orderId = entry?.salesOrderId;
  const initialOrder = entry?.incomeId ? entry : orderId ? null : { noOrder: true };
  const S = { P: {}, q: '', prod: null, order: initialOrder };
  let stageSeq = 0;
  let closed = false;
  let creation = null;
  let parked = null; // C096 Э4: изделие создано, заполнение не закончено — та же форма и та же запись при следующем «+ Новое изделие»
  const recap = stack();
  const stages = stack();
  const newBox = h('div', null);
  // C141: выпуск — в книжке; полоса воронки скрыта
  const foot = [];
  const say = (t) => ps.setNext(t);
  const title = (t, again = true) => { const hd = ps.el.closest('.drawer, .k-panel')?.querySelector('h2'); if (hd) hd.textContent = t; else if (again) setTimeout(() => title(t, false), 0); };

  const ps = pickSteps({
    getQ: () => S.q,
    onData: (resp) => {
      pl.paint(resp.products); pl.gate(ps.ready() || !!S.q);
      const s = (resp.steps || []).find((x) => !S.P[x.key] && !x.skip && (x.values || []).length > 1);
      say(s ? null : 'выберите изделие в списке');
    },
    onChange: async (P, key) => {
      if (!(await leaveStage())) { ps.update(S.P); return; }
      const order = ps.order(); const i = order.indexOf(key);
      order.slice(i + 1).forEach((k) => delete P[k]);
      S.P = Object.fromEntries(Object.entries(P).filter(([, v]) => v));
      if (S.prod || !newBox.hidden) showPick({ checked: true }); else ps.update(S.P);
    },
  });
  const pl = productList({
    onPick: (it) => choose(it),
    onSearch: (q) => { S.q = q; ps.update(S.P); },
    onNew: () => openNew(),
  });

  function creationContext() {
    const cat = ps.effective('category');
    return { group: ps.effective('group')?.label || '', facetIds: FACET_FREE(S.P), category: cat ? { code: cat.id, label: cat.label } : null, knownGroups: ps.valuesOf('group') };
  }

  function openNew({ fresh = false } = {}) {
    const c = creationContext();
    if (fresh && parked?.partial()) toast(`«${parked.partial().name || 'Новое изделие'}» осталось в «Продукции» с незавершённым заполнением`);
    if (!fresh && parked?.partial()) { creation = parked; creation.setContext(c); }
    else {
      if (fresh && creation?.partial()) toast(`«${creation.partial().name || 'Новое изделие'}» осталось в «Продукции» с незавершённым заполнением`);
      creation = newProduct({ ...c, onCreated: (p) => { parked = null; followCategory(p); choose(p, { fromCreation: true }); }, onPickExisting: (it) => choose(it.id, { fromCreation: true }), onCancel: showPick, onFresh: () => openNew({ fresh: true }) });
    }
    parked = null;
    newBox.replaceChildren(creation.el);
    pickBox.hidden = true; newBox.hidden = false; ps.setDone(true); say('введите название нового изделия');
  }

  function followCategory(prod) {
    const pc = prod?.passportCategory;
    const code = String(pc?.own?.code || pc?.inherited?.code || pc?.code || prod?.passportDefaults?.passportCategory || '');
    const was = ps.effective('category');
    if (!was || was.id === code) return;
    S.P = code ? { category: code } : {};
    ps.update(S.P);
    toast(code ? `Тип паспорта — по группе изделия: ${ps.labelOf('category', code) || code}` : 'У группы изделия нет типа паспорта — задайте его в группе изделия');
  }
  const pickBox = stack(pl.el);
  newBox.hidden = true;

  async function leaveStage() {
    if (creation?.busy()) return false;
    const made = creation?.partial?.();
    if (made) {
      if (!(await confirmDlg('Изделие уже создано', `«${made.name || 'Новое изделие'}» уже создано, но не заполнено. «+ Новое изделие» продолжит его.`, { okText: 'Вернуться к списку' }))) return false;
      parked = creation;
    } else if (creation?.dirty() && !(await confirmDlg('Вернуться к выбору?', 'Данные нового изделия ещё не сохранены.', { okText: 'Вернуться' }))) return false;
    return true;
  }

  async function showPick({ checked = false } = {}) {
    if (!checked && !(await leaveStage())) return;
    stageSeq += 1;
    creation = null;
    S.prod = null; S.order = initialOrder; stages.replaceChildren(); recap.replaceChildren(); title('Новый паспорт');
    newBox.hidden = true; pickBox.hidden = false; ps.setDone(false); say(null); ps.update(S.P);
  }

  function paintRecap(prod) {
    const sku = prod.sku ? prod.sku + ' ' : '';
    const bits = [link({ label: `Изделие: ${sku}${prod.name} ✎`, title: 'Выбрать другое изделие', onClick: showPick })];
    recap.replaceChildren(...bits);
  }

  async function choose(src, { fromCreation = false } = {}) {
    if (!(fromCreation && creation?.partial?.()) && creation?.dirty() && !(await leaveStage())) return;
    if (fromCreation) parked = null;
    const selecting = ++stageSeq;
    try {
      const prod = typeof src === 'string' ? await getProduct(src) : src;
      if (selecting !== stageSeq) return;
      creation = null;
      S.prod = prod; pickBox.hidden = true; newBox.hidden = true; ps.setDone(true); title('Паспорт: ' + (prod.name || 'изделие'));
      await stagePanels(prod);
    } catch (e) { toastError(e, 'открыть изделие'); }
  }

  async function stagePanels(prod) {
    const my = ++stageSeq;
    const routeSection = current().section;
    const ownsRoute = () => {
      const route = current();
      return route.section === routeSection && (route.params.of || route.section) === 'passfunnel' && route.params.new === '1';
    };
    paintRecap(prod);
    if (!S.order) {
      say('выберите заказ или «Без заказа»');
      stages.replaceChildren(hint('Ищу открытые позиции с этим изделием…'));
      let positions = [];
      try { positions = (await openPositions(prod.id)).filter((p) => p.salesOrderId === orderId); } catch { positions = []; }
      if (my !== stageSeq) return;
      if (!positions.length) {
        stages.replaceChildren(hint('У этого изделия нет действующей позиции в выбранном заказе.', 'warn'));
        return;
      }
      else {
        stages.replaceChildren(orderStep({
          positions,
          onPick: (p) => { S.order = p; stagePanels(prod); },
        }));
        return;
      }
      paintRecap(prod);
    }
    const position = S.order?.noOrder ? undefined : {
      salesOrderId: S.order?.salesOrderId,
      incomeId: S.order?.incomeId,
      orderNo: S.order?.orderNo,
      lineNo: S.order?.lineNo,
    };
    let opening = false;
    let retry = null;
    const sameStage = () => !closed && my === stageSeq && ownsRoute();
    const isCurrent = () => sameStage() && el.isConnected;
    const clearOwnedRoute = () => { if (isCurrent()) patch({ of: undefined, new: undefined }); };
    const enter = async () => {
      if (opening || !sameStage()) return;
      opening = true;
      if (retry) retry.disabled = true;
      say('открываю книжку паспорта');
      stages.replaceChildren(hint('Открываю эталонное окно паспорта…'));
      try {
        const row = await openBookForProduct(prod.id, {
          position, isCurrent,
          onClose: () => { clearOwnedRoute(); window.dispatchEvent(new CustomEvent('data-changed')); },
        });
        if (!isCurrent()) return;
        if (row) return;
        say('повторите открытие книжки');
        retry = button({ label: 'Повторить открытие паспорта', kind: 'secondary', onClick: enter });
        stages.replaceChildren(hint('Открытие отменено или не завершилось. Можно повторить здесь.', 'warn'), retry);
      } finally {
        opening = false;
        if (retry) retry.disabled = false;
      }
    };
    await enter();
  }

  if (entry?.productId) { say('открываю книжку'); choose(entry.productId); } else ps.update({});

  const el = stack(ps.el, recap, pickBox, newBox, stages);
  return {
    el, foot, readonly: true,
    busy: () => !!creation?.busy(),
    dirty: () => !!creation?.dirty(),
    beforeClose: () => {
      closed = true;
      stageSeq += 1;
      const m = creation?.partial?.() || parked?.partial?.();
      if (m) toast(`«${m.name || 'Новое изделие'}» уже создано в «Продукции» с незавершённым заполнением — допишите в карточке изделия`, { ms: 8000 });
    },
    focus: () => {},
    read: () => ({ values: {} }),
  };
}

export const passFunnel = {
  id: 'passfunnel', title: 'Паспорта', canEdit: canWorkPassport,
  get newTitle() { return (readyMode || peekReady()) ? 'Готовый паспорт' : peekProduct() ? 'Паспорт изделия' : 'Новый паспорт'; },
  card: { heading: () => (readyMode || peekReady()) ? 'Готовый паспорт' : peekProduct() ? 'Паспорт изделия' : 'Новый паспорт' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
