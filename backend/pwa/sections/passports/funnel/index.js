import { h } from '../../../core/dom.js';
import { actions, button, confirmDlg, hint, link, section, stack, toast, toastError } from '../../../ui/kit/index.js';
import { canWorkPassport } from '../common.js';
import { passportFill } from '../fill/index.js';
import { getProduct, orderPlan } from './api.js';
import { passportVariant, printDialog } from '../dialogs.js';
import { issueBlock, openPositions, orderStep } from './issue.js';
import { barText } from './bar.js';
import { newProduct } from './new-product.js';
import { peekProduct, peekReady, takePending } from './open.js';
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
  const S = { P: {}, q: '', prod: null, order: lockedOrder ? entry : null, focus: entry?.gap || null }; // focus — пробел из «Заполнения изделия» (C114 H-UI): встать на это поле после загрузки анкеты
  let stageSeq = 0;
  let activeFill = null; let creation = null;
  let parked = null; // C096 Э4: изделие создано, заполнение не закончено — та же форма и та же запись при следующем «+ Новое изделие»
  const recap = stack();
  const stages = stack();
  const newBox = h('div', null);
  // Ф1 (C112): закреплённая полоса панели (подвал карточки): «Осталось N: … →» и «Выпустить». Подвал kit.card, form.foot.
  const barStatus = link({ label: '', onClick: () => bar.go?.() });
  const barNote = h('span', { class: 'muted small' });
  const barGo = button({ label: 'Выпустить', kind: 'ghost', disabled: true, onClick: (e) => bar.issue?.run(e.currentTarget) });
  const bar = { required: [], issue: null, go: null, done: false };
  const foot = [barStatus, barNote, barGo];
  function paintBar() {
    const on = !!bar.issue && !bar.done;
    foot.forEach((n) => { n.hidden = !on; });
    if (!on) return;
    const st = bar.issue.status();
    const t = barText(bar.required, st);
    barStatus.hidden = !t.left; barStatus.textContent = t.left || '';
    barNote.hidden = !!t.left; barNote.textContent = t.left ? '' : t.ok;
    barGo.disabled = !t.ready; barGo.title = t.ready ? st.why : t.title;
    barGo.classList.toggle('btn-primary', t.ready); barGo.classList.toggle('btn-ghost', !t.ready);
  }
  paintBar();
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
    onChange: async (P, key) => {
      if (!(await leaveStage())) { ps.update(S.P); return; }
      const order = ps.order(); const i = order.indexOf(key);
      order.slice(i + 1).forEach((k) => delete P[k]);
      S.P = Object.fromEntries(Object.entries(P).filter(([, v]) => v));
      if (S.prod || !newBox.hidden) showPick({ checked: true }); else ps.update(S.P);
    },
  });
  const pl = productList({
    onPick: (it) => choose(it.id),
    onSearch: (q) => { S.q = q; ps.update(S.P); },
    onNew: () => openNew(),
  });

  /** Выбор воронки для нового изделия: группа — выбранная или единственная (шаг пропущен), категория и её группы. */
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

  /** C096 Э4: тип паспорта нового изделия — по его группе; шаги выше не должны показывать другую. */
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
      // C096 Э4: запись уже есть — не говорим «не сохранено»; форма откладывается и продолжит эту же запись
      if (!(await confirmDlg('Изделие уже создано', `«${made.name || 'Новое изделие'}» уже создано, но не заполнено. «+ Новое изделие» продолжит его.`, { okText: 'Вернуться к списку' }))) return false;
      parked = creation;
    } else if (creation?.dirty() && !(await confirmDlg('Вернуться к выбору?', 'Данные нового изделия ещё не сохранены.', { okText: 'Вернуться' }))) return false;
    try { await activeFill?.beforeClose?.(); return true; }
    catch (e) { toastError(e, 'сохранить изделие перед переходом'); return false; }
  }

  async function showPick({ checked = false } = {}) {
    if (!checked && !(await leaveStage())) return;
    stageSeq += 1;
    activeFill = null; creation = null; bar.issue = null; bar.done = false; bar.required = []; paintBar();
    S.prod = null; S.manual = false; if (!lockedOrder) S.order = null; stages.replaceChildren(); recap.replaceChildren(); title('Новый паспорт');
    newBox.hidden = true; pickBox.hidden = false; ps.setDone(false); say(null); ps.update(S.P);
  }

  function paintRecap(prod) {
    const sku = prod.sku ? prod.sku + ' ' : '';
    const bits = [link({ label: `Изделие: ${sku}${prod.name} ✎`, title: 'Выбрать другое изделие', onClick: showPick })];
    if (S.order && !S.order.quiet && !lockedOrder) {
      const text = S.order.noOrder ? 'Заказ: без заказа ✎' : `Заказ: ${S.order.orderText || 'выбран'} ✎`;
      bits.push(link({ label: text, title: 'Выбрать другой заказ', onClick: () => { S.order = null; S.manual = true; stagePanels(prod); } }));
    }
    recap.replaceChildren(...bits);
  }

  // ── шаги 5–7 ──
  async function choose(src, { fromCreation = false } = {}) {
    // из формы нового изделия: созданное или выбранное похожее уже подтверждено там (частичный успех не прячется)
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
    paintRecap(prod);
    // C077: с изделия, если заказ ещё не выбран — необязательный шаг «Для заказа»
    if (!S.order) {
      say('выберите заказ или «Без заказа»');
      stages.replaceChildren(hint('Ищу открытые позиции с этим изделием…'));
      let positions = [];
      try { positions = await openPositions(prod.id); } catch { positions = []; }
      if (my !== stageSeq) return;
      if (!positions.length) S.order = { noOrder: true, quiet: true };
      else if (positions.length === 1 && !S.manual) S.order = positions[0]; // одна открытая позиция — подставлена, меняется по «Заказ: … ✎»
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
    bar.done = false; bar.required = [];
    const issue = issueBlock({
      prod,
      order: S.order,
      goGaps: () => goFirstGap(),
      onState: () => { paintBar(); sayNext(); },
      onIssued: (passport) => afterIssue(prod, passport),
    });
    bar.issue = issue;
    // «Осталось N: … →» ведёт к первому пробелу анкеты, а если пробелов нет — к выбору фирмы / позиции в разделе «Выпуск»
    const goFirstGap = () => {
      const first = bar.required[0];
      if (first && activeFill?.focusGap) { activeFill.focusGap(first); return true; }
      const gap = stages.querySelector('[data-gap]');
      if (first && gap) { gap.scrollIntoView({ block: 'start' }); return true; }
      return false;
    };
    // фирма / позиция заказа — в разделе «Выпуск»: открыть и поставить фокус на первый список
    const goIssue = () => {
      issueSec.open = true; issueSec.scrollIntoView({ block: 'center' });
      setTimeout(() => issueSec.querySelector('select, input, button')?.focus({ preventScroll: true }), 0);
    };
    bar.go = () => { if (!goFirstGap()) goIssue(); };
    // «Дальше: …» — первое недостающее в анкете, затем фирма / позиция, затем выпуск
    const sayNext = () => {
      const first = bar.required[0];
      if (first) { say(`укажите «${first.label}»`); return; }
      const st = issue.status();
      if (st.ready) say('выпустите PDF (тексты уже подставлены)');
      else if (st.need?.[0]) say(`выберите ${st.need[0].label}`);
    };
    issueSec.querySelector('.k-sec-body').replaceChildren(issue.el);
    const fill = await passportFill({
      prod, mode: 'issue',
      onStatus: ({ required }) => {
        bar.required = required;
        issue.paint(required);
        sayNext();
        if (!required[0]) issueSec.open = true;
        paintBar();
      },
    });
    if (my !== stageSeq) return;
    activeFill = fill;
    stages.replaceChildren(fill.el, issueSec);
    paintBar();
    if (S.focus) { const m = S.focus; S.focus = null; requestAnimationFrame(() => fill.focusGap?.(m)); }
  }

  /** Ф4: после выпуска панель остаётся — «Печать…» и, если паспорт из заказа, «Следующая позиция». */
  async function afterIssue(prod, passport) {
    bar.done = true; paintBar(); activeFill = null;
    const num = passport?.passportNumber ? ' № ' + passport.passportNumber : '';
    say(null); ps.setDone(true);
    const next = button({ label: 'Следующая позиция', kind: 'primary', onClick: () => nextPosition(next.dataset.pid, next) });
    next.hidden = true;
    const note = hint('');
    stages.replaceChildren(stack(
      hint('Выпущен паспорт' + num + '. Окно печати открыто — его можно открыть ещё раз.', 'ok'),
      actions(button({ label: 'Печать…', kind: 'secondary', onClick: () => printDialog(passport) }), next),
      note));
    const orderId = S.order?.salesOrderId;
    if (!orderId) return;
    try {
      const plan = await orderPlan(orderId, passportVariant.value);
      const line = (plan?.lines || []).find((l) => l.state !== 'issued' && l.productId && String(l.incomeId) !== String(S.order?.incomeId || ''));
      if (line) { next.dataset.pid = JSON.stringify({ productId: line.productId, incomeId: line.incomeId }); next.hidden = false; }
      else note.textContent = 'Все позиции заказа выпущены.';
    } catch { /* без плана кнопки «Следующая позиция» нет — «Печать…» остаётся */ }
  }

  async function nextPosition(raw, btn) {
    let p; try { p = JSON.parse(raw); } catch { return; }
    btn.disabled = true;
    try {
      S.order = { ...S.order, incomeId: p.incomeId };
      bar.issue = null; bar.done = false; bar.required = []; paintBar();
      await choose(String(p.productId));
    } catch (e) { toastError(e, 'открыть следующую позицию'); btn.disabled = false; }
  }

  // старт: вход Б — сразу к изделию; вход А — с категории
  if (entry?.productId) { say('проверьте недостающее'); choose(entry.productId); } else ps.update({});

  const el = stack(ps.el, recap, pickBox, newBox, stages);
  return { el, foot, readonly: true, busy: () => !!creation?.busy() || !!activeFill?.busy?.(), dirty: () => !!creation?.dirty() || !!activeFill?.dirty?.(), beforeClose: () => { const m = creation?.partial?.() || parked?.partial?.(); if (m) toast(`«${m.name || 'Новое изделие'}» уже создано в «Продукции» с незавершённым заполнением — допишите в карточке изделия`, { ms: 8000 }); return activeFill?.beforeClose?.(); }, focus: () => {}, read: () => ({ values: {} }) };
}

export const passFunnel = {
  id: 'passfunnel', title: 'Паспорта', canEdit: canWorkPassport,
  get newTitle() { return (readyMode || peekReady()) ? 'Готовый паспорт' : peekProduct() ? 'Паспорт изделия' : 'Новый паспорт'; },
  card: { heading: () => (readyMode || peekReady()) ? 'Готовый паспорт' : peekProduct() ? 'Паспорт изделия' : 'Новый паспорт' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
