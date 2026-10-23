import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { facetValues, FACETS, index, pick } from '../core/facets.js';
import { date, parseNum, plural, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { stockList } from '../core/stock-list.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { bulkPaste } from '../ui/bulk.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups } from './lookups.js';
import { pic } from './stock.js';
import { orderOptions, splitRef } from './salesorders.js';
import { issueToFields } from './issue.js';
import { reservationsPanel } from './reservations.js';
import { enhanceSelect } from '../ui/select.js';
import { searchBox } from '../ui/searchbox.js';
import { weighButton } from './ops-weight.js';
import { errText } from '../ui/errors.js';

/* «Операции» склада (TASKS фаза С): как касса — слева подбор (поиск «м10 гайка» + кнопки-фильтры
 * тип → резьба → длина → стандарт), справа корзина; одна кнопка проводит всё разом (POST /stock/batch),
 * «Отменить» во всплывающем сообщении отменяет всю операцию. Режимы: списание, приход, пересчёт. */
const MODES = {
  out: { label: 'Списание', verb: 'Списать', done: 'Списано', note: 'Куда / на какой заказ', hint: 'Выдача в производство, расход. Найдите позиции (например «м10 гайка») и нажмите — они попадут в список на списание.' },
  in: { label: 'Приход', verb: 'Принять', done: 'Принято', note: 'От кого / основание', hint: 'Приехала машина по заявкам — блок «Ждём поставку»: выберите счёт и примите всё разом. Принесли без заявки — найдите позицию ниже (нет на складе — создайте её прямо здесь).' },
  reserve: { label: 'Бронь по списку', verb: 'Забронировать', done: 'Забронировано', note: 'Для чего бронь (конструкция, изделие) *', hint: 'Спецификация от конструктора: «⇩ Вставить список» — вставьте строки из Excel, или добавьте позиции поиском. Справа видно, хватает ли свободного остатка. «Забронировать» — бронь под названием; снять — в «Активных бронях» ниже.' },
  count: { label: 'Пересчёт', verb: 'Сохранить пересчёт', done: 'Пересчёт сохранён', note: 'Примечание', hint: 'Пройдите по полке: выберите категорию или фильтр и нажмите «Взять всё в пересчёт», впишите, сколько лежит. Пустое поле — не пересчитано.' },
};
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export function mountOps(params) {
  let P = { ...params };
  const mode = () => (MODES[P.mode] ? P.mode : 'out');
  let items = [];
  let loaded = false; let loading = false; // склад целиком грузится по действию (фокус поиска), а не при открытии экрана (ПР-1)
  let byId = new Map();
  let cats = [];
  const st = { q: '', cat: '', sel: {}, active: 0 };
  /** Корзина каждого режима: [{ id, qty }] — переживает перезагрузку страницы. */
  const cart = () => store.get('dc-ops-' + mode()) || [];
  const setCart = (c) => { store.set('dc-ops-' + mode(), c); renderCart(); renderResults(); };
  // ---------- Шапка ----------
  const seg = h('div', { class: 'seg', role: 'tablist' });
  const head = h('div', { class: 'page-head' }, h('h1', null, 'Операции'), h('span', { class: 'spacer' }), seg);
  const hint = h('p', { class: 'hint ops-hint' });
  // ---------- Подбор ----------
  // общий поиск (ПО.3): пусто — всё; клавиши ↑↓ Enter — ниже
  const sbo = searchBox({ delay: 120, label: 'Поиск позиции', onSearch: (v) => { st.q = v; st.active = 0; renderPicker(); }, placeholder: 'Например: м10 гайка · din 933 · подшипник', className: 'ops-sb' });
  const search = sbo.input; search.classList.add('ops-search');
  const catRow = h('div', { class: 'ops-cats' });
  const facetBox = h('div', { class: 'ops-facets' });
  const found = h('div', { class: 'ops-found' });
  const results = h('div', { class: 'ops-results', role: 'listbox' });
  const bulk = bulkPaste({
    title: 'Вставить список',
    items: () => items.map((x) => ({ label: x.name, cat: x.categoryName || '', values: { article: x.article, unit: x.unit }, ref: x })),
    onFound: (list) => {
      const cc = cart();
      for (const { item, line } of list) {
        const id = item.ref?.id || items.find((x) => x.name === item.label)?.id;
        if (!id) continue;
        const ex = cc.find((l) => l.id === id);
        if (ex) ex.qty = String((parseNum(ex.qty) || 0) + (line.qty || 1)); else cc.push({ id, qty: String(line.qty || 1) });
      }
      setCart(cc);
    },
  });
  const picker = h('section', { class: 'panel ops-picker' }, h('div', { class: 'ops-search-wrap' }, sbo.el, bulk.el), catRow, facetBox, found, results);
  // ---------- Корзина ----------
  const cartTitle = h('h3', null);
  const lines = h('div', { class: 'ops-lines' });
  const note = h('input', { maxlength: 300 });
  const doc = h('input', { maxlength: 200, placeholder: 'накладная, счёт' });
  const docWrap = h('label', { class: 'field' }, h('span', null, 'Документ'), doc);
  const soSel = h('select', null, h('option', { value: '' }, '— не под заказ —'));
  const soWrap = h('label', { class: 'field wide' }, h('span', null, 'Под заказ (позиция)'), soSel);
  const issueTo = issueToFields(); // кому выдано (TASKS Л.3) — только списание
  let soLoaded = false;
  const loadOrders = async () => { if (soLoaded) return; soLoaded = true; try { for (const o of await orderOptions()) soSel.append(h('option', { value: o.value }, o.label)); enhanceSelect(soSel); } catch { soLoaded = false; } };
  const noteLabel = h('span', null);
  const submit = h('button', { class: 'btn btn-primary ops-submit', type: 'button' });
  const clear = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setCart([]) }, 'Очистить');
  const shortBox = h('div', { class: 'ops-short', hidden: true });
  const basket = h('section', { class: 'panel ops-cart' },
    h('div', { class: 'panel-head' }, cartTitle, h('span', { class: 'spacer' }), clear),
    shortBox,
    lines,
    h('div', { class: 'ops-foot' }, h('div', { class: 'form-grid' }, soWrap, issueTo.el, h('label', { class: 'field' }, noteLabel, note), docWrap), submit));
  const mobileBar = h('button', { class: 'ops-mobile-bar btn btn-primary', type: 'button', onclick: () => basket.scrollIntoView({ behavior: 'smooth' }) });

  const arrivals = arrivalsBlock(() => reload().catch(() => {}));
  // активные брони: выдать / снять / путь брони (sections/reservations.js)
  const resPanel = reservationsPanel({ onChange: () => reload() });
  const resBox = resPanel.el;
  const loadReservations = () => resPanel.load();
  const el = h('div', { class: 'ops' }, head, hint, arrivals.el, resBox, h('div', { class: 'ops-grid' }, picker, basket), mobileBar);

  function renderChrome() {
    const m = MODES[mode()];
    seg.replaceChildren(...Object.entries(MODES).map(([k, v]) => h('button', { type: 'button', class: k === mode() ? 'active' : '', onclick: () => patch({ mode: k === 'out' ? undefined : k }) }, v.label)));
    hint.textContent = m.hint;
    noteLabel.textContent = m.note;
    note.placeholder = mode() === 'out' ? 'например: заказ 15, цех' : mode() === 'in' ? 'например: принёс поставщик' : 'пересчёт';
    docWrap.hidden = mode() !== 'in';
    soWrap.hidden = mode() !== 'out' && mode() !== 'reserve';
    issueTo.el.hidden = mode() !== 'out';
    shortBox.hidden = true;
    if (mode() === 'reserve') loadReservations(); else resBox.hidden = true;
    if (mode() === 'out') loadOrders();
    if (mode() === 'in') arrivals.load(); else arrivals.el.hidden = true;
  }

  // ---------- Подбор: категории, фильтры, результаты ----------
  function renderPicker() {
    const inCat = pick(items, { q: st.q, sel: {} });
    catRow.replaceChildren(...[{ id: '', name: 'Все' }, ...cats].map((c) => {
      const n = c.id ? inCat.filter((i) => i.categoryId === c.id).length : inCat.length;
      return h('button', { type: 'button', class: 'chip' + (st.cat === c.id ? ' active' : ''), disabled: !n && st.cat !== c.id, onclick: () => { st.cat = c.id; st.sel = {}; renderPicker(); } }, c.name, h('b', null, n));
    }));
    // Фильтры: каждый считается по найденному с учётом остальных выбранных — «М10» сужает «Тип» до гаек и болтов M10
    facetBox.replaceChildren(...FACETS.map(([key, label]) => {
      const others = { ...st.sel }; delete others[key];
      const vals = facetValues(pick(items, { q: st.q, cat: st.cat, sel: others }), key);
      if (vals.length < 2 && !st.sel[key]) return null;
      // Пока ничего не выбрано — только «Тип» и «Резьба»: длины и стандарты появляются, когда понятно, что ищем
      const narrowed = st.q.trim() || Object.values(st.sel).some(Boolean);
      if (!narrowed && (key === 'length' || key === 'std') && !st.sel[key]) return null;
      return h('div', { class: 'ops-facet' }, h('span', { class: 'ops-facet-l' }, label),
        h('div', { class: 'ops-facet-v' }, ...vals.slice(0, key === 'type' ? 14 : 24).map(([v]) =>
          h('button', { type: 'button', class: 'tag' + (st.sel[key] === v ? ' active' : ''), onclick: () => { st.sel = { ...st.sel, [key]: st.sel[key] === v ? undefined : v }; renderPicker(); } }, v))));
    }).filter(Boolean));
    renderResults();
  }

  // обрезки с остатком — первыми (СМ.2: «сначала брать обрезки»)
  function shown() { const l = pick(items, { q: st.q, cat: st.cat, sel: st.sel }); return mode() === 'out' ? [...l.filter((x) => x.offcutOf && x.quantity > 0), ...l.filter((x) => !(x.offcutOf && x.quantity > 0))] : l; }
  function renderResults() {
    if (!loaded) { found.replaceChildren(); results.replaceChildren(h('div', { class: 'ops-empty muted' }, loading ? 'Загружаю…' : 'Коснитесь строки поиска — склад загрузится')); return; }
    const list = shown();
    const inCart = new Map(cart().map((l) => [l.id, l]));
    const anyFilter = st.q || st.cat || Object.values(st.sel).some(Boolean);
    found.replaceChildren(...[
      h('span', null, anyFilter ? `Найдено ${list.length} ${plural(list.length, 'позиция', 'позиции', 'позиций')}` : `Всего ${list.length} ${plural(list.length, 'позиция', 'позиции', 'позиций')}`),
      Object.values(st.sel).some(Boolean) || st.q ? h('button', { type: 'button', class: 'link-btn', onclick: () => { st.q = ''; sbo.set('', true); st.sel = {}; renderPicker(); search.focus(); } }, 'сбросить') : null,
      h('span', { class: 'spacer' }),
      mode() === 'count' && anyFilter && list.length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => takeAll(list) }, `Взять всё в пересчёт (${list.length})`) : null].filter(Boolean));
    st.active = Math.min(st.active, Math.max(0, list.length - 1));
    const rows = list.slice(0, 200).map((it, i) => {
      const inc = inCart.get(it.id);
      return h('div', { class: 'ops-row' + (i === st.active ? ' active' : '') + (inc ? ' in-cart' : ''), role: 'option', onclick: () => add(it), title: 'Добавить в список' },
        pic(it.photos?.[0]),
        h('div', { class: 'ops-name' }, h('div', { class: 'clip' }, it.name), h('small', null, [it.offcutOf ? 'обрезок — берите первым' : '', it.categoryName, it.supplierArticle && 'арт. ' + it.supplierArticle, it.offcuts?.length ? `есть обрезки: ${it.offcuts.length}` : ''].filter(Boolean).join(' · '))),
        h('div', { class: 'ops-stock num' + (it.quantity <= 0 ? ' neg' : '') }, qty(it.quantity), h('small', null, ' ' + (it.unit || ''))),
        h('span', { class: 'ops-add', 'aria-hidden': 'true' }, inc ? (mode() === 'count' ? '✓' : '+1') : '+'));
    });
    if (!list.length) {
      rows.push(h('div', { class: 'ops-empty' },
        h('p', null, st.q ? `Ничего не нашлось по «${st.q}».` : 'Ничего не нашлось.'),
        mode() === 'in' && st.q.trim().length > 2 ? h('button', { class: 'btn', type: 'button', onclick: () => createNew(st.q.trim()) }, `+ Новая позиция «${st.q.trim()}»`) : h('p', { class: 'muted' }, 'Попробуйте короче: «м10», «гайк», «933».')));
    } else if (list.length > 200) rows.push(h('div', { class: 'ops-empty muted' }, `Показаны первые 200 — уточните поиск или фильтр.`));
    results.replaceChildren(...rows);
    results.querySelector('.ops-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Корзина ----------
  function add(it) {
    const c = cart();
    const ex = c.find((l) => l.id === it.id);
    if (ex) { if (mode() !== 'count') ex.qty = (parseNum(ex.qty) || 0) + 1; }
    else c.push({ id: it.id, qty: mode() === 'count' ? '' : 1 });
    setCart(c);
    // фокус в количество добавленной строки — сразу ввести число
    requestAnimationFrame(() => lines.querySelector(`[data-id="${it.id}"] input`)?.select());
  }
  function takeAll(list) {
    const c = cart(); const have = new Set(c.map((l) => l.id));
    for (const it of list) if (!have.has(it.id)) c.push({ id: it.id, qty: '' });
    setCart(c);
  }
  async function createNew(name) {
    try {
      const lk = await lookups().catch(() => ({}));
      const cat = cats.find((c) => c.id === st.cat);
      const r = await api('/stock/items', { method: 'POST', body: { name, unit: 'шт', ...(cat ? { categoryName: cat.name } : {}) } });
      lookups.reset?.(); void lk;
      await reload();
      add(byId.get(r.id) || r);
      toast(`Позиция «${r.name}» создана — укажите количество`);
    } catch (e) { toastError(e); }
  }

  function renderCart() {
    const m = MODES[mode()];
    const c = cart().filter((l) => byId.has(l.id));
    cartTitle.textContent = c.length ? `${m.label}: ${c.length} ${plural(c.length, 'позиция', 'позиции', 'позиций')}` : m.label;
    clear.hidden = !c.length;
    if (!c.length) {
      lines.replaceChildren(h('div', { class: 'ops-empty' }, h('p', null, 'Список пуст.'), h('p', { class: 'muted' }, 'Нажмите на позицию слева или Enter в поиске — она появится здесь.')));
    } else {
      lines.replaceChildren(...c.map((l) => {
        const it = byId.get(l.id);
        const inp = h('input', { inputmode: 'decimal', value: l.qty, placeholder: mode() === 'count' ? 'факт' : '0', 'aria-label': 'Количество' });
        const diff = h('span', { class: 'ops-diff num' });
        const showDiff = () => {
          const n = parseNum(inp.value);
          if (mode() === 'count') {
            const d = n === undefined || Number.isNaN(n) ? null : Math.round((n - it.quantity) * 1000) / 1000;
            diff.textContent = d === null ? 'не пересчитано' : d === 0 ? 'сходится' : (d > 0 ? '+' : '') + qty(d);
            diff.className = 'ops-diff num ' + (d === null ? 'muted' : d === 0 ? 'pos' : 'neg');
          } else if (mode() === 'reserve') {
            const free = it.free ?? it.quantity;
            const ok = !(n > free);
            diff.textContent = n ? (ok ? 'хватает' : `не хватает ${qty(n - free)} (свободно ${qty(free)})`) : '';
            diff.className = 'ops-diff num ' + (ok ? 'pos' : 'neg');
          } else if (mode() === 'out') {
            const over = n > it.quantity;
            diff.textContent = over ? `есть только ${qty(it.quantity)}` : '';
            diff.className = 'ops-diff num neg';
          } else diff.textContent = '';
        };
        inp.addEventListener('input', () => { const cc = cart(); const x = cc.find((y) => y.id === l.id); if (x) x.qty = inp.value; store.set('dc-ops-' + mode(), cc); showDiff(); updateSubmit(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search.focus(); search.select(); } });
        const step = (d) => { const n = Math.max(0, (parseNum(inp.value) || 0) + d); inp.value = String(n); inp.dispatchEvent(new Event('input')); };
        showDiff();
        return h('div', { class: 'ops-line', 'data-id': l.id },
          h('div', { class: 'ops-name' }, h('div', { class: 'clip', title: it.name }, it.name),
            h('small', null, mode() === 'reserve' ? `свободно ${qty(it.free ?? it.quantity)} из ${qty(it.quantity)} ${it.unit || ''}` : mode() === 'count' ? `по учёту ${qty(it.quantity)} ${it.unit || ''}` + (it.lastCountedAt ? ` · пересчитано ${date(it.lastCountedAt)}` : '') : `на складе ${qty(it.quantity)} ${it.unit || ''}`)),
          h('div', { class: 'ops-qty' },
            mode() !== 'count' ? h('button', { class: 'btn btn-icon btn-sm', type: 'button', tabindex: -1, onclick: () => step(-1), 'aria-label': 'Меньше' }, '−') : null,
            inp,
            mode() !== 'count' ? h('button', { class: 'btn btn-icon btn-sm', type: 'button', tabindex: -1, onclick: () => step(1), 'aria-label': 'Больше' }, '+') : null,
            h('span', { class: 'ops-unit' }, it.unit || ''), weighButton(it, mode(), (q, nt) => { const cc = cart(); const x = cc.find((y) => y.id === l.id); if (x) x.note = nt; store.set('dc-ops-' + mode(), cc); inp.value = String(q); inp.dispatchEvent(new Event('input')); })),
          diff,
          h('button', { class: 'btn btn-ghost btn-icon btn-sm ops-x', type: 'button', title: 'Убрать из списка', onclick: () => setCart(cart().filter((y) => y.id !== l.id)) }, '×'));
      }));
    }
    updateSubmit();
  }

  function ready() {
    return cart().filter((l) => byId.has(l.id)).map((l) => ({ materialId: l.id, qty: parseNum(l.qty), ...(l.note ? { note: l.note } : {}) })) // note — расчёт по весу (НО)
      .filter((l) => l.qty !== undefined && !Number.isNaN(l.qty) && (mode() === 'count' ? l.qty >= 0 : l.qty > 0));
  }
  function updateSubmit() {
    const n = ready().length;
    const m = MODES[mode()];
    submit.textContent = n ? (mode() === 'count' ? `${m.verb} (${n})` : `${m.verb} ${n} ${plural(n, 'позицию', 'позиции', 'позиций')}`) : m.verb;
    submit.disabled = !n;
    mobileBar.textContent = cart().length ? `${m.label}: ${cart().length} → к списку` : '';
    mobileBar.hidden = !cart().length;
  }

  submit.addEventListener('click', async () => {
    const body = { type: mode(), lines: ready(), note: note.value.trim() || undefined, documentRef: mode() === 'in' ? doc.value.trim() || undefined : undefined, clientUid: uid() };
    if (mode() === 'out' && soSel.value) { const so = splitRef(soSel.value); body.salesOrderId = so.salesOrderId; if (so.salesOrderLineId) body.salesOrderLineId = so.salesOrderLineId; }
    if (mode() === 'out') Object.assign(body, issueTo.value());
    if (!body.lines.length) return;
    const m = MODES[mode()];
    if (mode() === 'reserve') { await doReserve(body); return; }
    submit.disabled = true; const label = submit.textContent; submit.textContent = 'Проводим…';
    try {
      // ФИ.3/ФИ.4: пересчёт ниже брони — сервер спрашивает подтверждение (409), «Да» — повтор с force
      const r = await api('/stock/batch', { method: 'POST', body }).catch(async (e) => {
        if (!(mode() === 'count' && e.status === 409 && /брон/i.test(e.message) && (await confirmDlg('Меньше, чем в брони', errText(e), { okText: 'Да, сохранить', danger: true })))) throw e;
        return api('/stock/batch', { method: 'POST', body: { ...body, force: true } });
      });
      const left = cart().filter((l) => !body.lines.some((x) => x.materialId === l.id));
      store.set('dc-ops-' + mode(), left);
      note.value = ''; doc.value = ''; soSel.value = ''; issueTo.reset();
      await reload();
      window.dispatchEvent(new CustomEvent('data-changed'));
      const extra = mode() === 'count' ? ` · изменилось ${r.moved}` : '';
      toast(`${m.done}: ${r.lines} ${plural(r.lines, 'позиция', 'позиции', 'позиций')}${extra}`, {
        undo: async () => {
          try { await api(`/stock/batch/${r.batchId}/cancel`, { method: 'POST' }); await reload(); window.dispatchEvent(new CustomEvent('data-changed')); toast('Операция отменена'); }
          catch (e) { toastError(e); }
        },
      });
      search.focus();
    } catch (e) { toastError(e); submit.textContent = label; submit.disabled = false; }
  });

  async function doReserve(body) {
    const groupName = note.value.trim();
    if (!groupName) { toastError(new Error('Впишите, для чего бронь (конструкция, изделие)')); note.focus(); return; }
    const so = soSel.value ? splitRef(soSel.value) : null;
    submit.disabled = true;
    try {
      const r = await api('/stock/reserve-list', { method: 'POST', body: { groupName, lines: body.lines, clientUid: body.clientUid, ...(so?.salesOrderId ? { salesOrderId: so.salesOrderId } : {}) } });
      store.set('dc-ops-reserve', []);
      note.value = ''; soSel.value = '';
      await reload(); loadReservations();
      window.dispatchEvent(new CustomEvent('data-changed'));
      toast(`Забронировано под «${groupName}»: ${r.lines.length} ${plural(r.lines.length, 'позиция', 'позиции', 'позиций')}`, { undo: async () => { await api(`/stock/reservations/group/${r.batchId}/release`, { method: 'POST' }); await reload(); loadReservations(); toast('Бронь снята'); } });
      if (r.short?.length) {
        const sh = r.short.map((s) => ({ ...s, it: byId.get(s.materialId) }));
        shortBox.hidden = false;
        shortBox.replaceChildren(h('b', null, `Не хватило на складе: ${sh.length} ${plural(sh.length, 'позиция', 'позиции', 'позиций')}`),
          h('ul', null, ...sh.map((s) => h('li', null, `${s.it?.name || 'позиция'} — нужно ${qty(s.need)}, забронировано ${qty(s.reserved)}, не хватает ${qty(s.need - s.reserved)} ${s.it?.unit || ''}`))),
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async (e) => {
            e.currentTarget.disabled = true;
            for (const s of sh) await api('/supply/requests', { method: 'POST', body: { title: s.it?.name, qty: s.need - s.reserved, unit: s.it?.unit || 'шт', categoryName: s.it?.categoryName || '', statusLabel: 'Заказать', notes: `Не хватило для брони «${groupName}»`, clientUid: `short-${r.batchId}-${s.materialId}` } });
            toast(`Заявки на недостающее: ${sh.length}`); shortBox.hidden = true; window.dispatchEvent(new CustomEvent('data-changed'));
          } }, 'Заказать недостающее'));
      }
    } catch (e) { toastError(e); } finally { updateSubmit(); }
  }

  // ---------- Клавиатура: печатаешь → ↑↓ → Enter добавляет ----------
  search.addEventListener('keydown', (e) => {
    const list = shown();
    if (e.key === 'ArrowDown') { e.preventDefault(); st.active = Math.min(list.length - 1, st.active + 1); renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); st.active = Math.max(0, st.active - 1); renderResults(); }
    else if (e.key === 'Enter') {
      e.preventDefault(); st.q = search.value;
      const l = shown(); if (l[st.active]) add(l[st.active]); else if (mode() === 'in' && st.q.trim().length > 2) createNew(st.q.trim());
    }
  });

  async function reload() {
    const [list, cs] = await Promise.all([
      stockList(),
      api('/stock/categories').catch(() => ({ items: [] })),
    ]);
    items = index(list);
    byId = new Map(items.map((i) => [i.id, i]));
    cats = cs.items.filter((c) => c.id !== 'none').map((c) => ({ id: c.id, name: c.name }));
    loaded = true;
    renderPicker(); renderCart();
  }
  const desktop = window.matchMedia('(hover: hover) and (min-width: 720px)').matches; // на компьютере — автофокус и загрузка сразу; на телефоне — по касанию поиска
  function ensureLoaded(fromSearch = false) {
    if (loaded || loading) return;
    loading = true; renderResults();
    reload().then(() => { if (fromSearch === true || desktop) search.focus(); }).catch((e) => showFail(e)).finally(() => { loading = false; });
  }
  renderChrome();
  search.addEventListener('focus', () => ensureLoaded(true));
  bulk.el.addEventListener('click', () => ensureLoaded(false), true);
  if (desktop) ensureLoaded(true); else if (cart().length) ensureLoaded(); else { renderPicker(); renderCart(); } // начатый список надо показать сразу; пустой экран склад не грузит
  const showFail = ((e) => { results.replaceChildren(h('div', { class: 'ops-empty' }, h('p', null, 'Не удалось загрузить склад: ' + errText(e)), h('button', { class: 'btn', type: 'button', onclick: () => reload().catch(toastError) }, 'Повторить'))); });
  return {
    el,
    reload: () => reload().catch(() => {}),
    update(next) {
      const prevMode = mode(); P = { ...next };
      if (mode() !== prevMode) { renderChrome(); renderCart(); renderResults(); search.focus(); }
    },
  };
}

/* ---------- Приёмка машины: заявки «Заказано/Оплачено», сгруппированные по счёту и поставщику ---------- */
function arrivalsBlock(onDone) {
  const box = h('section', { class: 'panel ops-arrivals' });
  async function load() {
    let res;
    try { res = await api('/supply/requests', { query: { status: 'ordered,paid', limit: 500 } }); }
    catch { box.hidden = true; return; }
    const groups = new Map();
    for (const r of res.items) {
      const inv = String(r.invoiceNo || '').replace(/^\s*сч[её]т\s*№?\s*/i, '').trim();
      const key = (inv ? 'Счёт № ' + inv : 'Без номера счёта') + ' · ' + (r.supplierName || 'поставщик не указан');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    box.hidden = !groups.size;
    box.replaceChildren(
      h('div', { class: 'panel-head' }, h('h3', null, `Ждём поставку: ${groups.size} ${plural(groups.size, 'счёт', 'счёта', 'счетов')}`),
        h('span', { class: 'muted small' }, 'Приехала машина — найдите счёт и примите всё разом')),
      h('div', { class: 'ops-arr-list' }, ...[...groups].map(([key, rs]) => h('div', { class: 'ops-arr' },
        h('div', { class: 'ops-name' }, h('div', { class: 'clip' }, key),
          h('small', null, rs.slice(0, 3).map((r) => r.title).join(' · ') + (rs.length > 3 ? ` · ещё ${rs.length - 3}` : ''))),
        h('span', { class: 'muted small nowrap' }, `${rs.length} ${plural(rs.length, 'позиция', 'позиции', 'позиций')}`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => acceptGroup(key, rs) }, 'Принять…')))));
  }
  async function acceptGroup(key, rs) {
    const rows = rs.map((r) => ({ r, on: h('input', { type: 'checkbox', checked: true }), q: h('input', { inputmode: 'decimal', value: String(r.qty ?? ''), class: 'ops-arr-q' }) }));
    const done = await modal({
      title: 'Приёмка: ' + key,
      okText: 'Принять отмеченное',
      body: h('div', null,
        h('p', { class: 'hint' }, 'Снимите галочку с того, что не приехало; поправьте количество, если пришло меньше. Отмеченное поступит на склад, заявки станут «Получено».'),
        h('div', { class: 'ops-arr-dlg' }, ...rows.map(({ r, on, q }) => h('label', { class: 'ops-arr-row' }, on,
          h('span', { class: 'ops-name' }, h('span', { class: 'clip' }, r.title), h('small', null, [r.paid ? 'оплачено' : 'не оплачено', r.orderLabel].filter(Boolean).join(' · '))),
          q, h('span', { class: 'ops-unit' }, r.unit || ''))))),
      onOk: async () => {
        const pickd = rows.filter((x) => x.on.checked).map((x) => ({ r: x.r, n: parseNum(x.q.value) }));
        if (!pickd.length) throw new Error('Ничего не отмечено');
        const bad = pickd.find((x) => !(x.n > 0));
        if (bad) throw new Error(`Укажите количество для «${bad.r.title}»`);
        let ok = 0;
        for (const x of pickd) {
          await api(`/supply/requests/${x.r.id}/receive`, { method: 'POST', body: { qty: x.n, clientUid: 'arr-' + x.r.id + '-' + x.n } });
          ok++;
        }
        return ok;
      },
    });
    if (done) { toast(`Принято на склад: ${done} ${plural(done, 'позиция', 'позиции', 'позиций')}`); await load(); onDone(); }
  }
  box.hidden = true;
  return { el: box, load };
}

/** Кнопки «Списать / Принять / Пересчёт» для других экранов. */
export const opsLinks = () => h('div', { class: 'ops-links' },
  h('button', { class: 'btn', type: 'button', onclick: () => go('ops', {}) }, '− Списать'),
  h('button', { class: 'btn', type: 'button', onclick: () => go('ops', { mode: 'in' }) }, '+ Принять'),
  h('button', { class: 'btn', type: 'button', onclick: () => go('ops', { mode: 'count' }) }, 'Пересчёт'));
