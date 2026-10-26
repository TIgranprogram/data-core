import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn } from '../ui/busy.js';
import { parseNum, plural, qty } from '../core/format.js';
import { current, patch } from '../core/router.js';
import { stockList } from '../core/stock-list.js';
import { attachCombo } from '../ui/combo.js';
import { confirmDlg } from '../ui/dialog.js';
import { errText } from '../ui/errors.js';
import { enhanceSelect } from '../ui/select.js';
import { toast, toastError } from '../ui/toast.js';
import { ftParams, ftQuery } from '../ui/facet-filter.js';
import { offerAfterIssue } from '../ui/composition-suggest.js';
import { lineCode, targetPicker } from '../ui/target-picker.js';
import { withOrders } from './issue.js';
import { receiveField } from './item-orders.js';
import { pipeInHelper } from './metal.js';
import { lookups } from './lookups.js';
import { arrivalsBlock } from './ops.js';
import { weighButton } from './ops-weight.js';
import { buildFromReserve, buildUnreserve } from './stock-ops-res.js';
import { reservationsPanel } from './reservations.js';

/*
 * Действия склада в правой панели (SK-4b, SK-9): «Принять», «Выдать», «Забронировать», «Списать», «Пересчитать»; по одной позиции из её карточки — ещё
 * «Выдать из брони» и «Снять бронь» (stock-ops-res.js).
 * Одна панель на все пять: выбрать одну позицию или несколько — одной пачкой (POST /stock/batch), «Отменить» во всплывашке
 * отменяет пачку целиком. Склад целиком не грузится при открытии: варианты позиций — по первому нажатию в поле «Позиция»,
 * заказы и сотрудники — при открытии панели «Выдать» / «Забронировать». Панель открывается адресом ?of=stockop&new=1&op=<вид>&materialId=<id>.
 */
const OPS = {
  in: { title: 'Принять на склад', verb: 'Принять', done: 'Принято', note: 'От кого / основание', hint: 'Приехала машина — выберите счёт в «Ждём поставку». Без заявки — найдите позицию ниже.' },
  out: { title: 'Выдать со склада', verb: 'Выдать', done: 'Выдано', note: 'Примечание', hint: 'Впишите количество и выберите, кому или под какую позицию выдано' },
  reserve: { title: 'Забронировать', verb: 'Забронировать', done: 'Забронировано', note: 'Для чего бронь (конструкция, изделие)', hint: 'Остаток не меняется, «свободно» уменьшается. Выберите заказ и позицию — или впишите, для чего бронь. Поставленные брони — ниже.' },
  writeoff: { title: 'Списать', verb: 'Списать', done: 'Списано', note: 'Комментарий (необязательно)', hint: 'Брак, потеря, порча: выберите причину. Заказ и сотрудник не указываются.' },
  fromres: { title: 'Выдать из брони', verb: 'Выдать', done: 'Выдано' },
  unreserve: { title: 'Снять бронь', verb: 'Снять бронь', done: 'Снято' },
  count: { title: 'Пересчитать', verb: 'Сохранить пересчёт', done: 'Пересчёт сохранён', note: 'Примечание', hint: 'Впишите, сколько лежит всего (с забронированным). Пустое поле — не пересчитано.' },
};
export const STOCK_OPS = Object.keys(OPS);
export const opTitle = (op) => OPS[op]?.title || 'Действие со складом';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

/** Открыть панель действия: op — in | out | reserve | writeoff | count, materialId — сразу с этой позицией. */
export function openStockOp(op, materialId) {
  // из карточки / строки позиции — шагом: закрыли панель, вернулись к позиции
  patch({ of: 'stockop', new: '1', op: OPS[op] ? op : 'in', materialId: materialId || undefined, open: undefined }, { replace: !materialId });
}

async function build() {
  const P = current().params;
  const op = OPS[P.op] ? P.op : 'in';
  const cfg = OPS[op];
  if (op === 'fromres') return buildFromReserve(P.materialId);
  if (op === 'unreserve') return buildUnreserve(P.materialId);
  const clientUid = uid(); // одна на панель: повторное «Принять» после сбоя связи не задвоит движение
  let lines = []; // [{ it, qty, note }]
  let touched = false;
  // черновик набранных строк переживает перезагрузку страницы (как было в «Операциях»)
  const KEY = 'dc-ops-' + op;
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || []; } catch { return []; } };
  const saveDraft = () => { try { localStorage.setItem(KEY, JSON.stringify(lines.map((l) => ({ id: l.it.id, qty: l.qty, ...(l.note ? { note: l.note } : {}) })))); } catch { /* приватный режим */ } };
  const clearDraft = () => { try { localStorage.removeItem(KEY); } catch { /* приватный режим */ } };
  // строка; для прихода позиции, которая уже заказана, — выбор заявки, которую закрыть (ЗП.4)
  const newLine = (it, q, nt) => {
    const recv = op === 'in' ? receiveField(it) : null;
    if (recv) recv.el.style.gridColumn = '1 / -1';
    return { it, qty: q ?? (op === 'count' ? '' : '1'), note: nt || '', recv };
  };
  let resCache = null; // брони — один запрос, только когда понадобились (пересчёт ниже брони)
  const ordersOf = async (materialId) => { resCache ??= api('/stock/reservations').then((r) => r.items || []).catch(() => []); return (await resCache).filter((g) => g.lines.some((l) => l.materialId === materialId)).map((g) => (g.salesOrder && !String(g.name).includes(g.salesOrder) ? `${g.name} (заказ ${g.salesOrder})` : g.name)); };
  let all = null; let loading = false; // склад целиком — по первому нажатию в поле «Позиция»

  // ---------- Выбор позиции ----------
  const pickIn = h('input', { placeholder: 'Например: м10 гайка · din 933 · подшипник', 'aria-label': 'Найти позицию' });
  const pickBox = h('label', { class: 'field wide' }, h('span', null, 'Добавить позицию'), pickIn);
  const opts = () => (all || []).map((i) => ({ value: i.id, label: i.name, sub: [`${qty(i.quantity)} ${i.unit || ''}`.trim(), i.reservedQty ? `в брони ${qty(i.reservedQty)}` : '', i.categoryName].filter(Boolean).join(' · ') }));
  const combo = attachCombo(pickIn, {
    options: opts,
    empty: () => (loading ? 'Загружаю склад…' : ''),
    onPick: (o) => { pickIn.value = ''; const it = all.find((x) => x.id === o.value); if (it) add(it); },
    extra: (text) => (op === 'in' && all && text.length > 2 && !all.some((x) => x.name.toLowerCase() === text.toLowerCase()) ? [{ label: `+ Новая позиция «${text}»`, run: () => createNew(text) }] : []),
  });
  pickIn.addEventListener('focus', async () => {
    if (all || loading) return;
    loading = true;
    try { all = await stockList(); } catch (e) { toast(errText(e), { error: true }); } finally { loading = false; }
    if (document.activeElement === pickIn) combo.refresh();
  });

  async function createNew(name) {
    try {
      const r = await api('/stock/items', { method: 'POST', body: { name, unit: 'шт' } });
      lookups.reset?.();
      pickIn.value = '';
      add(r);
      toast(`Позиция «${r.name}» создана — укажите количество`);
    } catch (e) { toast(errText(e), { error: true }); }
  }

  // ---------- Строки ----------
  const linesBox = h('div', { class: 'ops-lines sop-lines' });
  const count = h('span', { class: 'muted small' });
  function add(it) {
    touched = true;
    const ex = lines.find((l) => l.it.id === it.id);
    if (ex) { if (op !== 'count') ex.qty = String((parseNum(ex.qty) || 0) + 1); } else lines.push(newLine(it));
    saveDraft();
    render();
    requestAnimationFrame(() => linesBox.querySelector(`[data-id="${it.id}"] input`)?.select());
  }
  function render() {
    count.textContent = lines.length ? `Позиций: ${lines.length}` : '';
    if (!lines.length) { linesBox.replaceChildren(h('div', { class: 'ops-empty muted sop-empty' }, 'Позиций пока нет — найдите их в поле выше.')); return; }
    linesBox.replaceChildren(...lines.map((l) => {
      const it = l.it;
      const inp = h('input', { inputmode: 'decimal', value: l.qty, placeholder: op === 'count' ? 'факт' : '0', 'aria-label': 'Количество' });
      const diff = h('span', { class: 'ops-diff num' });
      const warn = h('div', { class: 'ops-warn neg', role: 'note', hidden: true });
      const showDiff = () => {
        const n = parseNum(inp.value);
        if (op === 'count') {
          const d = n === undefined || Number.isNaN(n) ? null : Math.round((n - it.quantity) * 1000) / 1000;
          const below = d !== null && n < (it.reservedQty || 0);
          diff.textContent = d === null ? 'не пересчитано' : d === 0 ? `сходится: ${qty(it.quantity)}` : `было ${qty(it.quantity)} → станет ${qty(n)} (${d > 0 ? '+' : '−'}${qty(Math.abs(d))}), свободно станет ${qty(n - (it.reservedQty || 0))}`;
          diff.className = 'ops-diff num wide ' + (d === null ? 'muted' : below ? 'neg' : d === 0 ? 'pos' : '');
          warn.hidden = !below;
          if (below) ordersOf(it.id).then((names) => { warn.textContent = `Меньше, чем в брони (${qty(it.reservedQty)}): ${names.length ? names.join('; ') : 'бронь есть'}. Сначала снимите или выдайте бронь — иначе при сохранении будет вопрос.`; });
        } else if (op === 'reserve') {
          const free = it.free ?? it.quantity; const ok = !(n > free);
          diff.textContent = n ? (ok ? 'хватает' : `не хватает ${qty(n - free)} (свободно ${qty(free)})`) : '';
          diff.className = 'ops-diff num ' + (ok ? 'pos' : 'neg');
        } else if (op === 'writeoff') {
          const free = it.free ?? it.quantity;
          diff.textContent = n > it.quantity ? `на складе только ${qty(it.quantity)}` : n > free ? `в брони ${qty(it.reservedQty)} — спишется и забронированное` : '';
          diff.className = 'ops-diff num neg';
        } else if (op === 'out') {
          const free = it.free ?? it.quantity;
          diff.textContent = n > free ? `свободно только ${qty(free)}` : '';
          diff.className = 'ops-diff num neg';
        } else diff.textContent = '';
      };
      inp.addEventListener('input', () => { l.qty = inp.value; touched = true; saveDraft(); showDiff(); });
      inp.addEventListener('focus', () => inp.select());
      const step = (d) => { inp.value = String(Math.max(0, (parseNum(inp.value) || 0) + d)); inp.dispatchEvent(new Event('input')); };
      const ph = op === 'in' ? pipeInHelper(it, inp) : null; // труба: «10 хлыстов по 6 м» = 60 м
      if (ph) { ph.style.gridColumn = '1 / -1'; ph.addEventListener('input', () => inp.dispatchEvent(new Event('input'))); }
      showDiff();
      const info = op === 'count' ? `по учёту ${qty(it.quantity)} ${it.unit || ''}` : `на складе ${qty(it.quantity)} ${it.unit || ''}${it.reservedQty ? `, в брони ${qty(it.reservedQty)}` : ''}`;
      return h('div', { class: 'ops-line', 'data-id': it.id },
        h('div', { class: 'ops-name' }, h('div', { class: 'clip', title: it.name }, it.name), h('small', null, info)),
        h('div', { class: 'ops-qty' },
          op !== 'count' ? h('button', { class: 'btn btn-icon btn-sm', type: 'button', tabindex: -1, onclick: () => step(-1), 'aria-label': 'Меньше' }, '−') : null,
          inp,
          op !== 'count' ? h('button', { class: 'btn btn-icon btn-sm', type: 'button', tabindex: -1, onclick: () => step(1), 'aria-label': 'Больше' }, '+') : null,
          h('span', { class: 'ops-unit' }, it.unit || ''),
          weighButton(it, op, (q, nt) => { l.note = nt; inp.value = String(q); inp.dispatchEvent(new Event('input')); })),
        diff,
        warn,
        h('button', { class: 'btn btn-ghost btn-icon btn-sm ops-x', type: 'button', title: 'Убрать из списка', 'aria-label': 'Убрать из списка', onclick: () => { lines = lines.filter((x) => x !== l); touched = true; saveDraft(); render(); } }, '×'),
        l.recv?.el, ph);
    }));
  }

  // ---------- Общие поля ----------
  const note = h('input', { maxlength: 300, placeholder: op === 'in' ? 'например: принёс поставщик' : op === 'count' ? 'пересчёт' : '' });
  note.addEventListener('input', () => { touched = true; });
  const noteBox = h('label', { class: 'field wide' }, h('span', null, cfg.note), note);
  if (op === 'reserve') withOrders(note);
  const reasonSel = op === 'writeoff' ? h('select', { 'aria-label': 'Причина списания' }, h('option', { value: '' }, '— выберите причину —')) : null;
  if (reasonSel) {
    api('/dicts/writeOffReasons').then((r) => { for (const x of r.items || []) reasonSel.append(h('option', { value: x.name }, x.name)); enhanceSelect(reasonSel); })
      .catch(() => { reasonSel.firstChild.textContent = '— список не загрузился, закройте и откройте панель —'; });
  }
  const doc = h('input', { maxlength: 200, placeholder: 'накладная, счёт' });
  const issueTo = op === 'out' ? targetPicker({ mode: 'out' }) : null; // заказы и позиции — при выборе, не при открытии панели
  // возврат со сборки (только «Принять»): переключатель → выбор позиции заказа, с которой вернули
  const retTp = op === 'in' ? targetPicker({ mode: 'return' }) : null;
  const retOn = op === 'in' ? h('input', { type: 'checkbox', id: 'sop-ret' }) : null;
  const retBox = retTp ? h('div', { class: 'tp-ret', hidden: true }, retTp.el) : null;
  if (retOn) retOn.addEventListener('change', () => { retBox.hidden = !retOn.checked; touched = true; });
  const resTp = op === 'reserve' ? targetPicker({ mode: 'reserve' }) : null; // заказ → позиция; заказы грузятся по первому нажатию

  const arrivals = op === 'in' ? arrivalsBlock(() => { window.dispatchEvent(new CustomEvent('data-changed')); }) : null;
  arrivals?.load();
  const resPanel = op === 'reserve' ? reservationsPanel({ onChange: () => {} }) : null;
  resPanel?.load();

  // пересчёт: все позиции текущего фильтра списка (поиск, состояние, категория, признаки) — в строки разом
  const takeAllBtn = op === 'count' ? h('button', { class: 'btn btn-sm', type: 'button', style: { marginBottom: 'var(--s2)' }, title: 'Берёт все позиции, которые сейчас видны в списке с учётом поиска и фильтров', onclick: async (e) => {
    const free = busyBtn(e.currentTarget, 'Загружаю…');
    try {
      const q = { limit: 10000, sort: 'name' };
      const search = [P.q, P.ft ? ftQuery(P.ft) : ''].filter(Boolean).join(' ');
      if (search) q.search = search;
      if (P.ft) Object.assign(q, ftParams(P.ft));
      if (P.status) q.status = P.status;
      if (P.categoryId) q.categoryId = P.categoryId;
      const r = await api('/stock/items', { query: q });
      const have = new Set(lines.map((l) => l.it.id));
      for (const it of r.items || []) if (!have.has(it.id)) lines.push(newLine(it));
      touched = true; saveDraft(); render();
      toast(`В пересчёте позиций: ${lines.length}`);
    } catch (err) { toastError(err, 'взять позиции в пересчёт'); } finally { free(); }
  } }, 'Взять всё из списка в пересчёт') : null;

  // «Принять без счёта» — ручной ввод; скрыт когда есть список счетов
  const manualSection = h('div', { class: 'sop-manual', hidden: !!arrivals },
    h('div', { class: 'form-grid' }, pickBox),
    h('div', { class: 'sop-head' }, h('div', { class: 'section-title' }, 'Что ' + (op === 'in' ? 'принимаем' : op === 'out' ? 'выдаём' : op === 'reserve' ? 'бронируем' : op === 'count' ? 'пересчитываем' : 'списываем')), count),
    takeAllBtn,
    linesBox,
    h('div', { class: 'form-grid sop-foot' },
      issueTo?.el,
      retOn ? h('div', { class: 'field wide' }, h('label', { class: 'check' }, retOn, h('span', null, 'Возврат под позицию (вернули со сборки)')), retBox) : null,
      resTp?.el,
      reasonSel ? h('label', { class: 'field wide' }, h('span', null, 'Причина списания *'), reasonSel) : null,
      noteBox,
      op === 'in' ? h('label', { class: 'field wide' }, h('span', null, 'Документ'), doc) : null));
  // кнопка разворота — только для «Принять» с блоком счетов
  const toggleManual = arrivals ? h('button', { type: 'button', class: 'link-btn sop-toggle-manual', style: { margin: 'var(--s2) 0 var(--s1)', fontSize: '0.85em' }, onclick() { manualSection.hidden = !manualSection.hidden; this.textContent = manualSection.hidden ? '+ Принять без счёта' : '− Скрыть'; } }, '+ Принять без счёта') : null;
  const el = h('div', { class: 'sop' },
    h('p', { class: 'hint' }, cfg.hint),
    arrivals?.el,
    toggleManual,
    manualSection,
    resPanel?.el);

  // позиция из карточки / строки списка: сразу в списке
  if (P.materialId) api('/stock/items/' + P.materialId).then((it) => { if (it?.id && !lines.length) { lines.push(newLine(it)); render(); } }).catch(() => {});
  render();
  const draft = readDraft();
  if (draft.length) stockList().then((all2) => { for (const d of draft) { const it = all2.find((x) => x.id === d.id); if (it && !lines.some((l) => l.it.id === it.id)) lines.push(newLine(it, d.qty, d.note)); } render(); }).catch(() => {});

  // пересчёт: expected — остаток, который видел человек (изменился на сервере — 409, не перетираем чужое)
  const ready = () => lines.map((l) => ({ materialId: l.it.id, qty: parseNum(l.qty), ...(l.note ? { note: l.note } : {}), ...(op === 'count' && Number.isFinite(l.it.quantity) ? { expected: l.it.quantity } : {}) }))
    .filter((l) => l.qty !== undefined && !Number.isNaN(l.qty) && (op === 'count' ? l.qty >= 0 : l.qty > 0));

  // выдача больше, чем свободно, забирает материал из чужой брони: спросить, назвав заказ-владельца (SK-5b)
  async function confirmForeign(ls) {
    const over = ls.filter((x) => { const it = lines.find((l) => l.it.id === x.materialId)?.it; return it && x.qty > (it.free ?? it.quantity); });
    if (!over.length) return true;
    let groups = [];
    try { groups = (await api('/stock/reservations')).items || []; } catch { return true; } // список броней не открылся — сервер сам не даст выдать лишнее
    const mine = issueTo.orderId();
    const rows = [];
    for (const x of over) {
      const it = lines.find((l) => l.it.id === x.materialId).it;
      for (const g of groups) {
        const l = g.lines.find((y) => y.materialId === x.materialId);
        if (!l || (mine && g.salesOrderId === mine)) continue;
        rows.push(`${it.name}: бронь «${g.name}»${g.salesOrder ? ' (заказ ' + g.salesOrder + ')' : ''} — ${qty(l.qty - (l.issued || 0))} ${it.unit || ''}`);
      }
    }
    if (!rows.length) return true;
    return confirmDlg('Это материал из чужой брони', 'Выдаётся больше, чем свободно, — забирается из брони другого заказа:\n' + rows.join('\n') + '\n\nВыдать всё равно?', { okText: 'Да, выдать', danger: true });
  }

  async function save() {
    const ls = ready();
    if (!ls.length) throw new Error(op === 'count' ? 'Впишите, сколько лежит, хотя бы у одной позиции' : 'Добавьте позицию и впишите количество больше нуля');
    const text = note.value.trim();
    if (op === 'reserve') { const why = resTp.check(); if (why) throw new Error(why); if (!text && !resTp.orderId()) throw new Error('Выберите заказ или впишите, для чего бронь (конструкция, изделие)'); }
    if (op === 'writeoff' && !reasonSel.value) throw new Error('Выберите причину списания');
    if (op === 'writeoff') {
      const over = ls.map((x) => ({ x, it: lines.find((l) => l.it.id === x.materialId)?.it })).find(({ x, it }) => it && x.qty > it.quantity);
      if (over) throw new Error(`«${over.it.name}»: нельзя списать больше, чем на складе (${qty(over.it.quantity)} ${over.it.unit || ''})`);
    }
    if (op === 'count') { // сильное изменение остатка — спросить один раз (ФИ.3)
      const big = ls.map((x) => ({ x, it: lines.find((l) => l.it.id === x.materialId)?.it })).filter(({ x, it }) => it && it.quantity > 0 && (x.qty === 0 || Math.abs(x.qty - it.quantity) / it.quantity > 0.5));
      if (big.length && !(await confirmDlg('Остаток изменится сильно', big.map(({ x, it }) => `${it.name}: ${qty(it.quantity)} → ${qty(x.qty)} ${it.unit || ''}`).join('\n') + '\n\nЧисла верны? Сохранить пересчёт?', { okText: 'Да, сохранить', danger: true }))) throw new Error('Пересчёт не сохранён: проверьте числа');
    }
    if (op === 'out') { const why = issueTo.check(); if (why) throw new Error(why); }
    const isReturn = op === 'in' && retOn.checked;
    if (isReturn) { const why = retTp.check(); if (why) throw new Error(why); }
    if (op === 'out' && !(await confirmForeign(ls))) throw new Error('Выдача не проведена: без подтверждения материал из чужой брони не выдаётся');
    const names = new Map(lines.map((l) => [l.it.id, l.it]));
    const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
    if (op === 'reserve') {
      const to = resTp.value(); const ln = resTp.line();
      const groupName = text || (ln ? `${lineCode(ln)} ${ln.title}` : resTp.orderLabel());
      const r = await api('/stock/reserve-list', { method: 'POST', body: { groupName, lines: ls, clientUid, ...to } });
      toast(`Забронировано под «${groupName}»: ${r.lines.length} ${plural(r.lines.length, 'позиция', 'позиции', 'позиций')}`, { undo: async () => { await api(`/stock/reservations/group/${r.batchId}/release`, { method: 'POST' }); changed(); toast('Бронь снята'); } });
      clearDraft(); changed();
      if (r.short?.length) {
        const sh = r.short.map((s) => ({ ...s, it: names.get(s.materialId) }));
        const list = sh.map((s) => `${s.it?.name || 'позиция'}: не хватает ${qty(s.need - s.reserved)} ${s.it?.unit || ''}`).join('\n');
        if (await confirmDlg('Не хватило на складе', `${list}\n\nЗаказать недостающее — создать заявки?`, { okText: 'Заказать недостающее' })) {
          for (const s of sh) await api('/supply/requests', { method: 'POST', body: { title: s.it?.name, qty: s.need - s.reserved, unit: s.it?.unit || 'шт', categoryName: s.it?.categoryName || '', statusLabel: 'Заказать', notes: `Не хватило для брони «${groupName}»`, clientUid: `short-${r.batchId}-${s.materialId}` } });
          toast(`Заявки на недостающее: ${sh.length}`); changed();
        }
      }
      return r;
    }
    // приход по заявке: позиции с выбранной заявкой принимаются через заявку (она закрывается), остальное — пачкой
    let rest = ls;
    if (op === 'in' && !isReturn) { // возврат со сборки не закрывает заявки на поставку
      const withReq = lines.filter((l) => l.recv?.value() && ls.some((x) => x.materialId === l.it.id));
      for (const l of withReq) {
        const req = l.recv.value(); const n = ls.find((x) => x.materialId === l.it.id).qty;
        await api(`/supply/requests/${req.id}/receive`, { method: 'POST', body: { qty: n, partial: n < req.qty } });
        lines = lines.filter((x) => x !== l); // уже принято — повтор после сбоя не задвоит
      }
      if (withReq.length) { saveDraft(); render(); changed(); toast(`Принято по заявкам: ${withReq.length}`); }
      rest = ls.filter((x) => !withReq.some((l) => l.it.id === x.materialId));
      if (!rest.length) { clearDraft(); return { lines: withReq.length }; }
    }
    const body = { type: op === 'writeoff' ? 'out' : op, lines: rest, note: text || undefined, clientUid };
    if (op === 'writeoff') { body.writeOff = true; body.reason = reasonSel.value; }
    if (op === 'in') body.documentRef = doc.value.trim() || undefined;
    if (isReturn) Object.assign(body, retTp.value(), { isReturn: true });
    if (op === 'out') Object.assign(body, issueTo.value());
    // пересчёт ниже брони — сервер просит подтверждения (409), «Да» — повтор с force
    const r = await api('/stock/batch', { method: 'POST', body }).catch(async (e) => {
      if (!(op === 'count' && e.status === 409 && /брон/i.test(e.message) && (await confirmDlg('Меньше, чем в брони', errText(e), { okText: 'Да, сохранить', danger: true })))) throw e;
      return api('/stock/batch', { method: 'POST', body: { ...body, force: true } });
    });
    clearDraft();
    if (op === 'out' && body.salesOrderLineId) offerAfterIssue(body.salesOrderLineId); // изделие у позиции — предложить пополнить состав (SK-7b)
    const extra = op === 'count' ? ` · изменилось ${r.moved}` : '';
    toast(`${cfg.done}: ${r.lines} ${plural(r.lines, 'позиция', 'позиции', 'позиций')}${extra}`, {
      undo: async () => { await api(`/stock/batch/${r.batchId}/cancel`, { method: 'POST' }); changed(); toast('Операция отменена'); },
    });
    return r;
  }

  return {
    el,
    dirty: () => touched || !!issueTo?.dirty() || !!retTp?.dirty() || !!resTp?.dirty(),
    focus: () => pickIn.focus(),
    read: () => ({ values: { save } }),
  };
}

export const stockOp = {
  id: 'stockop', title: 'Склад',
  get newTitle() { return opTitle(current().params.op); },
  card: { heading: () => 'Склад' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), get saveLabel() { return OPS[current().params.op]?.verb || 'Провести'; }, closeAfterCreate: true },
};
