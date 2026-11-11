import { h } from '../../../core/dom.js';
import { patch } from '../../../core/router.js';
import { button, hint, link, section, stack, toastError } from '../../../ui/kit/index.js';
import { canEdit } from '../common.js';
import { passportFill } from '../fill/index.js';
import { getProduct } from './api.js';
import { issueBlock, openPositions, orderStep } from './issue.js';
import { newProduct } from './new-product.js';
import { peekReady, takePending } from './open.js';
import { pickSteps } from './pick-steps.js';
import { productList } from './product-list.js';
import { readyPanel } from './ready.js';

/**
 * Воронка «Новый паспорт» (C028, docs/crew/C028-passport-funnel/ANALYSIS.md §4): одна правая панель, сверху вниз
 * Категория → Группа → признаки → Изделие → Заполнение (fill, режим issue) → Выпуск. Ответы пишутся в изделие и не спрашиваются дважды.
 * Шаги и «Дальше: …» — эталон kit.funnel (П-1); пройденное — строка «Категория: … ✎».
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
  const lockedOrder = !!(entry && (entry.salesOrderId || entry.incomeId));
  const S = { P: {}, q: '', prod: null, order: lockedOrder ? entry : null };
  let stageSeq = 0;
  const recap = stack();
  const stages = stack();
  const newBox = h('div', null);
  const say = (t) => ps.setNext(t); // «Дальше: …» — строка kit.funnel над шагами
  // заголовок панели называет изделие (приёмка дизайнера D1); до выбора — «Новый паспорт»
  const title = (t, again = true) => { const hd = ps.el.closest('.drawer, .k-panel')?.querySelector('h2'); if (hd) hd.textContent = t; else if (again) setTimeout(() => title(t, false), 0); }; // вход из карточки: панель ещё не вставлена

  // ── шаги 1–4 ──
  const ps = pickSteps({
    getQ: () => S.q,
    onData: (resp) => {
      pl.paint(resp.products); pl.gate(ps.ready() || !!S.q);
      const s = (resp.steps || []).find((x) => !S.P[x.key] && !x.skip && (x.values || []).length > 1);
      say(s ? null : 'выберите изделие в списке');
    },
    onChange: (P, key) => {
      const order = ps.order(); const i = order.indexOf(key);
      order.slice(i + 1).forEach((k) => delete P[k]);
      S.P = Object.fromEntries(Object.entries(P).filter(([, v]) => v));
      if (S.prod || !newBox.hidden) showPick(); else ps.update(S.P);
    },
  });
  const pl = productList({
    onPick: (it) => choose(it.id),
    onSearch: (q) => { S.q = q; ps.update(S.P); },
    onNew: () => {
      newBox.replaceChildren(newProduct({ group: ps.labelOf('group', S.P.group), facetIds: FACET_FREE(S.P), onCreated: (p) => choose(p), onPickExisting: (it) => choose(it.id), onCancel: showPick }).el);
      pickBox.hidden = true; newBox.hidden = false; ps.setDone(true); say('введите название нового изделия');
    },
  });
  const pickBox = stack(pl.el);
  newBox.hidden = true;

  function showPick() {
    stageSeq += 1;
    S.prod = null; if (!lockedOrder) S.order = null; stages.replaceChildren(); recap.replaceChildren(); title('Новый паспорт');
    newBox.hidden = true; pickBox.hidden = false; ps.setDone(false); say(null); ps.update(S.P);
  }

  function paintRecap(prod) {
    const sku = prod.sku ? prod.sku + ' ' : '';
    const bits = [link({ label: `Изделие: ${sku}${prod.name} ✎`, title: 'Выбрать другое изделие', onClick: showPick })];
    if (S.order && !S.order.quiet && !lockedOrder) {
      const text = S.order.noOrder ? 'Заказ: без заказа ✎' : `Заказ: ${S.order.orderText || 'выбран'} ✎`;
      bits.push(link({ label: text, title: 'Выбрать другой заказ', onClick: () => { S.order = null; stagePanels(prod); } }));
    }
    recap.replaceChildren(...bits);
  }

  // ── шаги 5–7 ──
  async function choose(src) {
    try {
      const prod = typeof src === 'string' ? await getProduct(src) : src;
      S.prod = prod; pickBox.hidden = true; newBox.hidden = true; ps.setDone(true); title('Паспорт: ' + (prod.name || 'изделие'));
      await stagePanels(prod);
    } catch (e) { toastError(e, 'открыть изделие'); }
  }

  async function stagePanels(prod) {
    const my = ++stageSeq;
    paintRecap(prod);
    // C077: с изделия, если заказ ещё не выбран — необязательный шаг «Для заказа»
    if (!S.order) {
      say('выберите заказ или «Без заказа»');
      stages.replaceChildren(hint('Ищу открытые позиции с этим изделием…'));
      let positions = [];
      try { positions = await openPositions(prod.id); } catch { positions = []; }
      if (my !== stageSeq) return;
      if (!positions.length) S.order = { noOrder: true, quiet: true };
      else {
        stages.replaceChildren(orderStep({
          positions,
          onPick: (p) => { S.order = p; stagePanels(prod); },
          onNone: () => { S.order = { noOrder: true }; stagePanels(prod); },
        }));
        return;
      }
      paintRecap(prod);
    }
    const issueSec = section({ title: 'Выпуск', tone: 'gold', open: false, body: [] });
    const issue = issueBlock({
      prod,
      order: S.order,
      goGaps: () => stages.querySelector('[data-gap]')?.scrollIntoView({ block: 'start' }),
      onIssued: () => patch({ of: undefined, new: undefined }),
    });
    issueSec.querySelector('.k-sec-body').replaceChildren(issue.el);
    // одна главная на этап: пробелы — «Дальше»; выпуск открыт — «Выпустить PDF» (вторая ghost)
    const onePrimary = (btn, primary) => { btn.classList.toggle('btn-primary', primary); btn.classList.toggle('btn-ghost', !primary); };
    let fill;
    const next = button({
      label: 'Дальше — к выпуску', kind: 'primary',
      onClick: async () => {
        try {
          const must = await fill.missingRequired();
          if (must.length) { stages.querySelector('[data-gap]')?.scrollIntoView({ block: 'start' }); return; }
          issueSec.open = true;
          onePrimary(next, false);
        } catch (e) { toastError(e, 'сохранить'); }
      },
    });
    fill = await passportFill({
      prod, mode: 'issue',
      onStatus: ({ required }) => {
        issue.paint(required);
        const first = required[0];
        say(first ? `укажите «${first.label}»` : 'выпустите PDF (тексты уже подставлены)');
        if (!first) issueSec.open = true;
        onePrimary(next, !!first);
        next.hidden = !first; // C070-П3: всё заполнено — на экране одна главная кнопка «Выпустить PDF»
      },
    });
    if (my !== stageSeq) return;
    stages.replaceChildren(fill.el, next, issueSec);
  }

  // старт: вход Б — сразу к изделию; вход А — с категории
  if (entry?.productId) { say('проверьте недостающее'); choose(entry.productId); } else ps.update({});

  const el = stack(ps.el, recap, pickBox, newBox, stages);
  return { el, readonly: true, dirty: () => false, focus: () => {}, read: () => ({ values: {} }) };
}

export const passFunnel = {
  id: 'passfunnel', title: 'Паспорта', canEdit,
  get newTitle() { return (readyMode || peekReady()) ? 'Готовый паспорт' : 'Новый паспорт'; },
  card: { heading: () => (readyMode || peekReady()) ? 'Готовый паспорт' : 'Новый паспорт' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
