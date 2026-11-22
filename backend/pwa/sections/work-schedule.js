import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, patch } from '../core/router.js';
import { actions, busyBlock, button, empty, failBlock, funnel, hint, openSide, planner, segmented, stack, toast, toastError } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { buildModel } from './work-schedule-tree.js';
import { shiftWorkFocus, validDate, workFocus, workFocusTitle } from './work-schedule-period.js';
import { DAY, NONE, SCHEDULE, day, dmy, iso, partOf, pref, savePref, steps, typeOf, workLabel, isLegacyCommonWork } from './work-schedule-shared.js';
export { wsStep } from './work-schedule-step.js';

/*
 * Гант (C041 Э2, C053 Э3) — единственный: раздел «Гант» и вид «Гант» в «В работе». GET /work-schedule?from&to → { people, bars, load, legend }.
 * Дерево: «По заказам» — заказ › позиция › часть › шаги; «По людям» — человек › позиция › шаги. По умолчанию всё свёрнуто.
 * Линза, период и раскрытое запоминаются (localStorage dc-gantt-lens / -scale / -open). Воронка фильтров (заказ → позиция → часть → рабочий → вид работ)
 * считается по загруженным полосам; перетаскивание полосы = даты, на строку другого человека = другой исполнитель (PATCH /orderline-plans/:id/steps/:stepId);
 * Правый край меняет конец, клик открывает шаг (of=wsstep).
 */
const LENSES = ['orders', 'people'];
const SCALES = ['day', 'week', 'month', 'fit'];
// Период загрузки не зависит от масштаба и ширины экрана.
const PERIOD_DAYS = 182;
const today = () => iso(Date.now() - new Date().getTimezoneOffset() * 60000);
const dateOf = (p) => [p.date, p.from].find(validDate) || '';
const OPEN_MAX = 400;
const FILTERS = ['order', 'incomeId', 'part', 'person', 'work'];
const clearFilters = Object.fromEntries(FILTERS.map((key) => [key, undefined]));
const norm = (v) => String(v ?? '').toLowerCase().replaceAll('ё', 'е');
const orderKey = (b) => String(b.orderId || b.orderNo || '');

/** На выходных продолжаем сдвиг в выбранную сторону до рабочего дня. */
function movedStart(previous, next) {
  const date = new Date(next);
  const weekDay = date.getUTCDay();
  if (weekDay !== 0 && weekDay !== 6) return next;
  const offset = next < previous ? (weekDay === 0 ? -2 : -1) : (weekDay === 0 ? 1 : 2);
  return iso(date.getTime() + offset * DAY);
}

function legendFor(bars, known) {
  const types = new Map(known.map((x) => [String(x.workTypeId), x]));
  const legend = new Map();
  for (const b of bars) {
    const id = typeOf(b);
    if (!id || legend.has(id)) continue;
    const x = types.get(id);
    legend.set(id, { id, name: isLegacyCommonWork(b) ? workLabel(b) : x?.name || workLabel(b), hue: b.hue || 1 });
  }
  return [...legend.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}

/** Фильтр по значениям воронки; skip — какой шаг не применять (для вариантов этого шага). */
function pass(b, F, skip) {
  return (skip === 'order' || !F.order || orderKey(b) === F.order || String(b.orderNo) === F.order) && (skip === 'line' || !F.line || String(b.incomeId) === F.line)
    && (skip === 'part' || !F.part || partOf(b) === F.part) && (skip === 'person' || !F.person || String(b.assigneeId || NONE) === F.person)
    && (skip === 'work' || !F.work || (b.workTypeName || '') === F.work);
}

function countBy(list, keyOf, labelOf) {
  const m = new Map();
  for (const b of list) { const k = keyOf(b); if (k === '' || k == null) continue; const e = m.get(k) || { id: String(k), label: labelOf(b), count: 0 }; e.count++; m.set(k, e); }
  return [...m.values()];
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;

/** Ядро экрана: рисует в el. set(изменения) — сменить параметры адреса (воронка, окно дат); extra — условия списка «В работе». */
function createSchedule(el, p0, set, extra0 = {}, host = {}) {
  let P = p0, data = null, seq = 0, extra = extra0, touched = false, chart = null;
  let windowDates = null, scrollTop = 0, loading = false, destroyed = false;
  let lens = LENSES.includes(P.mode) ? P.mode : pref('lens', 'orders');
  let scaleK = SCALES.includes(P.scale) ? P.scale : pref('scale', 'fit');
  if (!LENSES.includes(lens)) lens = 'orders';
  if (!SCALES.includes(scaleK)) scaleK = 'fit';
  const savedOpen = pref('open', null);
  let open = new Set(savedOpen || []);
  let chartWidth = 0, shownBars = [];
  const box = stack();
  const top = actions();
  const bannerBox = stack();
  const filterBox = stack();
  const chartBox = stack();
  const fields = stack(filterBox, top);
  const drawer = host.filterFields ? null : filterPanel({ key: 'work-schedule', fields, content: [bannerBox, chartBox] });
  if (drawer) box.append(drawer.el);
  else { host.filterFields.replaceChildren(fields); box.append(bannerBox, chartBox); }
  el.append(box);

  const F = () => ({ order: P.order || '', line: P.incomeId || '', part: P.part || '', person: P.person || '', work: P.work || '' });
  const setDate = (date) => set({ date: date || undefined, ...(date ? {} : { from: undefined }) });
  const fitW = () => Math.max(320, (chart?.scroller.isConnected ? chart.scroller.clientWidth
    : (chartBox.clientWidth || document.querySelector('main')?.clientWidth || innerWidth) - 2) - (narrow() ? 148 : 232));

  const barsForSearch = () => {
    const words = norm(P.q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return data.bars;
    const names = new Map(data.people.map((x) => [String(x.id), x.name]));
    return data.bars.filter((b) => {
      const line = norm([b.orderNo, b.productionNo, b.productName, b.title, partOf(b), b.workTypeName, workLabel(b), b.assigneeId ? names.get(String(b.assigneeId)) : 'Без исполнителя'].join(' '));
      return words.every((word) => line.includes(word));
    });
  };
  const rememberScroll = () => {
    if (chart?.scroller.isConnected) scrollTop = chart.scroller.scrollTop;
  };

  async function load() {
    if (destroyed) return;
    rememberScroll();
    const my = ++seq;
    const first = iso(Date.parse(today()) - 84 * DAY);
    const dates = windowDates || { from: first, to: iso(Date.parse(first) + (PERIOD_DAYS - 1) * DAY) };
    loading = true;
    chartBox.replaceChildren(busyBlock('Гант'));
    try {
      const r = await api(SCHEDULE, { query: { ...dates, ...extra } });
      if (my !== seq) return;
      loading = false;
      windowDates = dates;
      data = { people: r.people || [], bars: r.bars || [], load: r.load || [], legend: r.legend || [] };
      steps.clear();
      for (const b of data.bars) steps.set(String(b.stepId), { bar: b, people: data.people });
      paint();
    } catch (e) {
      if (my !== seq) return;
      loading = false;
      data = null;
      bannerBox.replaceChildren();
      chartBox.replaceChildren(failBlock(e, load));
    }
  }

  function paintTop() {
    if (host.filterFields) return;
    top.replaceChildren(...(Object.values(F()).some(Boolean) ? [button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: () => set(clearFilters) })] : []));
  }

  function reveal(toLens, hit, personIds = []) {
    lens = toLens; savePref('lens', lens); touched = true;
    const model = modelFor(barsForSearch().filter((b) => pass(b, F())));
    const rows = new Map(model.rows.map((r) => [r.id, r]));
    const barIds = new Set(hit.map((b) => String(b.stepId)));
    const found = model.bars.filter((b) => barIds.has(b.id));
    for (const id of personIds) open.add(id);
    for (const bar of found) {
      for (let row = rows.get(bar.rowId); row?.parentId; row = rows.get(row.parentId)) open.add(row.parentId);
    }
    saveOpen(); paint();
    requestAnimationFrame(() => {
      const bar = found[0] && chartBox.querySelector(`[data-bar="${CSS.escape(found[0].id)}"]`);
      const row = personIds[0] && chartBox.querySelector(`[data-row="${CSS.escape(personIds[0])}"]`);
      const target = bar || row;
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (bar) {
        const scroller = chart.scroller;
        const fixedWidth = scroller.querySelector('.gt-label').offsetWidth;
        const visibleDaysWidth = scroller.clientWidth - fixedWidth;
        if (bar.offsetLeft < scroller.scrollLeft || bar.offsetLeft + bar.offsetWidth > scroller.scrollLeft + visibleDaysWidth) {
          scroller.scrollLeft = Math.max(0, bar.offsetLeft - visibleDaysWidth / 2);
        }
      }
    });
  }

  function paintBanner(bars, range) {
    const live = bars.filter((b) => b.status !== 'done');
    const over = live.filter((b) => b.overdue), none = live.filter((b) => !b.assigneeId), design = live.filter((b) => b.inDesign);
    const cap = new Map(data.people.map((x) => [String(x.id), Number(x.capacityHours) || 0]));
    const owners = new Set(bars.map((b) => String(b.assigneeId ?? NONE)));
    const heavy = [...new Set(data.load.filter((l) => {
      const id = String(l.personId);
      return day(l.date) >= range.from && day(l.date) <= range.to && owners.has(id) && cap.get(id) && l.hours > cap.get(id);
    }).map((l) => String(l.personId)))];
    const items = [
      over.length && button({ label: `Просрочено: ${over.length}`, kind: 'danger', size: 'S', title: 'Показать просроченные шаги', onClick: () => reveal('orders', over) }),
      none.length && button({ label: `Без исполнителя: ${none.length}`, size: 'S', title: 'Показать шаги без исполнителя', onClick: () => reveal('people', none) }),
      heavy.length && button({ label: `Перегружены: ${heavy.length} чел.`, size: 'S', title: 'Показать людей, у кого часов больше, чем в рабочем дне', onClick: () => reveal('people', live.filter((b) => heavy.includes(String(b.assigneeId))), heavy) }),
      design.length && button({ label: `В проектировании: ${design.length}`, kind: 'ghost', size: 'S', title: 'Показать шаги, которые ждут проектирования', onClick: () => reveal('orders', design) }),
    ].filter(Boolean);
    bannerBox.replaceChildren(...(items.length ? [actions(hint('Что горит:'), ...items)] : []));
  }

  function paintFilters(bars) {
    const f = F();
    const label = (b) => b.productName || b.title || 'Позиция';
    const steps2 = [
      { key: 'order', label: 'Заказ', ask: 'выберите заказ', optional: true, value: f.order, values: countBy(bars.filter((b) => pass(b, f, 'order')), orderKey, (b) => 'Заказ № ' + (b.orderNo || '—') + (b.productionNo ? ' · пр. № ' + b.productionNo : '')) },
      { key: 'line', label: 'Позиция', ask: 'выберите позицию', optional: true, value: f.line, values: countBy(bars.filter((b) => pass(b, f, 'line')), (b) => b.incomeId, label) },
      { key: 'part', label: 'Часть', ask: 'выберите часть', optional: true, value: f.part, values: countBy(bars.filter((b) => pass(b, f, 'part')), partOf, partOf) },
      { key: 'person', label: 'Исполнитель', ask: 'выберите исполнителя', optional: true, value: f.person, values: countBy(bars.filter((b) => pass(b, f, 'person')), (b) => b.assigneeId || NONE, (b) => (b.assigneeId ? data.people.find((x) => String(x.id) === String(b.assigneeId))?.name || 'Исполнитель' : 'Без исполнителя')) },
      { key: 'work', label: 'Вид работ', ask: 'выберите вид работ', optional: true, value: f.work, values: countBy(bars.filter((b) => pass(b, f, 'work')), (b) => b.workTypeName, workLabel) },
    ].filter((s) => (s.values.length || s.value) && (!host.filterFields || !['order', 'person'].includes(s.key)));
    const fn = funnel({ steps: steps2, onChange: (key, v) => set({ [key === 'line' ? 'incomeId' : key]: v || undefined }) });
    const n = Object.values(f).filter(Boolean).length;
    if (drawer) drawer.setCount(n); else host.onFilterCount?.(n);
    filterBox.replaceChildren(...(steps2.length ? [fn.el] : []));
  }

  function saveOpen() { savePref('open', [...open].slice(-OPEN_MAX)); }
  const modelFor = (bars) => buildModel({ bars, people: data.people, lens, allBars: data.bars });

  function paintChart(bars) {
    rememberScroll();
    const date = dateOf(P), overview = scaleK === 'fit';
    const { periods, ...range } = workFocus(scaleK, bars, windowDates, today());
    const loadBy = {};
    for (const l of data.load) { (loadBy[l.personId] ||= {})[day(l.date)] = l.hours; }
    paintBanner(bars, range);
    const model = modelFor(bars);
    const filtersOn = !!(P.q || extra.orderId || extra.personId) || Object.values(F()).some(Boolean);
    const lensSeg = segmented({ items: [{ key: 'orders', label: 'По заказам' }, { key: 'people', label: 'По людям' }], value: lens, label: 'Что в строках', onChange: (k) => set({ mode: k }) });
    chartWidth = fitW();
    shownBars = bars;
    const defaultOpen = !savedOpen && !touched && bars.length <= 12
      ? new Set(model.nodeIds) : open;
    if (chart) resize.unobserve(chart.scroller);
    chart = planner({
      lead: lensSeg.el,
      rowsTitle: lens === 'people' ? 'Исполнитель и операции' : 'Заказы и операции',
      rows: model.rows, bars: model.bars, load: loadBy, ...range, scale: scaleK, canEdit: !!session.canEdit, rowsMovable: lens === 'people',
      fitWidth: chartWidth, autoScroll: false, calendar: true,
      period: { label: workFocusTitle(range), date, onChange: (pick) => { if (!pick || validDate(pick)) setDate(pick); } },
      onPickDate: setDate,
      expanded: filtersOn && !touched ? new Set(model.nodeIds) : defaultOpen,
      onToggle: (_id, _isOpen, set2) => { touched = true; open = new Set(set2); saveOpen(); },
      legend: legendFor(bars, data.legend),
      onScale: (k) => { if (k !== scaleK) set({ scale: k }); },
      onShift: overview || !periods.length ? undefined : (dir) => {
        const pick = shiftWorkFocus(scaleK, date, periods, range.segments, dir);
        if (pick) setDate(pick);
      },
      onToday: () => setDate(today()),
      empty: empty({
        title: filtersOn ? 'По этим фильтрам работ нет' : 'Работ нет',
        hint: filtersOn ? 'Измените фильтры или поиск.' : 'Запланируйте работы в позиции заказа.',
      }),
      onOpen: (b) => (b.taskId ? patch({ of: 'work', open: b.taskId }, { replace: false }) : openSide('wsstep', b.id)),
      onMove: (b, dest) => move(b.id, dest), onResize: (b, dest) => move(b.id, dest, true),
    });
    chartBox.replaceChildren(chart.el);
    resize.observe(chart.scroller);
    chart.scroller.scrollTop = scrollTop;
    if (date) chart.scrollToDate(date);
  }

  async function move(stepId, dest, resizeEnd = false) {
    const rec = steps.get(String(stepId)); if (!rec) return;
    if (resizeEnd) {
      const previous = day(rec.bar.end);
      const end = movedStart(previous, dest.end);
      if (end === previous || end < dest.start) return;
      dest = { ...dest, end, rowId: String(rec.bar.assigneeId || NONE), resizeEnd };
    }
    if (rec.bar.taskId) return moveTask(rec.bar, dest);
    const previousStart = day(rec.bar.start);
    const owner = rec.bar.assigneeId ? String(rec.bar.assigneeId) : NONE;
    const reassigned = lens === 'people' && String(dest.rowId) !== owner;
    const shifted = !reassigned && dest.start !== previousStart;
    if (!shifted && !reassigned && !resizeEnd) return;
    const body = resizeEnd ? { start: previousStart, end: dest.end }
      : shifted ? { start: movedStart(previousStart, dest.start) } : { assigneeId: dest.rowId === NONE ? null : dest.rowId };
    if (rec.bar.rev != null) body.rev = rec.bar.rev;
    try {
      const res = await api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body });
      const back = shifted || resizeEnd ? { start: previousStart, end: day(rec.bar.end) } : {};
      if (body.assigneeId !== undefined) back.assigneeId = rec.bar.assigneeId ? String(rec.bar.assigneeId) : null;
      if (res.rev != null) back.rev = res.rev;
      const message = resizeEnd ? `Шаг закончится ${dmy(res.bar?.end || body.end)}`
        : body.assigneeId !== undefined ? 'Шаг передан другому исполнителю' : `Шаг начнётся ${dmy(res.bar?.start || body.start)}`;
      toast(message, { undo: () => undoMove(() => api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body: back })) });
      window.dispatchEvent(new Event('data-changed'));
      await load();
    } catch (e) {
      if (e.status === 409) toast('План изменил другой человек — Гант обновлён');
      else toastError(e, resizeEnd ? 'изменить срок' : 'переставить шаг');
      await load();
      throw e;
    }
  }

  async function moveTask(bar, dest) {
    const owner = bar.assigneeId ? String(bar.assigneeId) : NONE;
    const who = lens === 'people' && String(dest.rowId) !== owner ? (dest.rowId === NONE ? null : dest.rowId) : undefined;
    if (who && bar.workTypeId && !data.people.find((p) => String(p.id) === who)?.workTypeIds?.map(String).includes(String(bar.workTypeId))) {
      const message = `У сотрудника нет вида работ «${workLabel(bar)}»`;
      toast(message);
      throw new Error(message);
    }
    const days = Math.round((Date.parse(dest.end) - Date.parse(dest.start)) / DAY) + 1;
    try {
      const shifted = who === undefined && (dest.resizeEnd || dest.start !== day(bar.start));
      if (shifted) await api(`/work-tasks/${bar.taskId}/plan`, { method: 'PATCH', body: { stepIndex: bar.stepIndex, start: dest.start, days } });
      if (who !== undefined) await api(`/work-tasks/${bar.taskId}`, { method: 'PATCH', body: { assigneeId: who } });
      const oldDays = Math.round((Date.parse(day(bar.end)) - Date.parse(day(bar.start))) / DAY) + 1;
      const message = dest.resizeEnd ? `Шаг закончится ${dmy(dest.end)}` : who !== undefined ? 'Задание передано другому исполнителю' : `Шаг начнётся ${dmy(dest.start)}`;
      toast(message, { undo: () => undoMove(async () => {
        if (shifted) await api(`/work-tasks/${bar.taskId}/plan`, { method: 'PATCH', body: { stepIndex: bar.stepIndex, start: day(bar.start), days: oldDays } });
        if (who !== undefined) await api(`/work-tasks/${bar.taskId}`, { method: 'PATCH', body: { assigneeId: bar.assigneeId ? String(bar.assigneeId) : null } });
      }) });
      window.dispatchEvent(new Event('data-changed'));
      await load();
    } catch (e) { toastError(e, dest.resizeEnd ? 'изменить срок' : 'переставить шаг'); await load(); throw e; }
  }
  async function undoMove(revert) {
    try { await revert(); toast('Перенос отменён'); window.dispatchEvent(new Event('data-changed')); } catch (e) { toastError(e, 'отменить перенос'); }
    await load();
  }

  function paint() {
    const matches = barsForSearch();
    const bars = matches.filter((b) => pass(b, F()));
    paintTop(); paintFilters(matches); paintChart(bars);
  }
  const resize = new ResizeObserver(() => {
    if (chart?.scroller.isConnected && fitW() !== chartWidth) paintChart(shownBars);
  });
  resize.observe(chartBox);
  paintTop();
  requestAnimationFrame(load);
  return {
    update(np, query = extra) {
      const changedScope = query.personId !== extra.personId || query.orderId !== extra.orderId;
      const changedFilter = [...FILTERS, 'q'].some((key) => np[key] !== P[key]);
      const changedPeriod = dateOf(np) !== dateOf(P) || np.scale !== P.scale;
      const changedLens = LENSES.includes(np.mode) && np.mode !== lens;
      P = np;
      extra = query;
      if (SCALES.includes(np.scale)) { scaleK = np.scale; if (changedPeriod) savePref('scale', scaleK); }
      if (changedLens) { lens = np.mode; savePref('lens', lens); }
      if (changedFilter || changedScope) touched = false;
      if (changedScope) load();
      else if (!loading && data && (changedPeriod || changedFilter || changedLens)) paint();
    },
    resetFilters: () => set(clearFilters),
    reload: load,
    destroy() { destroyed = true; seq++; resize.disconnect(); },
  };
}

export const workSchedule = {
  title: 'Гант',
  mount(el, { params = {} } = {}) {
    return createSchedule(el, params, (c) => patch(c, { replace: true }));
  },
};

export function mountScheduleView(_cfg, _path, query = {}, host = {}) {
  const el = h('div');
  const pick = (q) => ({ ...(q?.assigneeId ? { personId: q.assigneeId } : {}), ...(q?.orderId ? { orderId: q.orderId } : {}) });
  const address = () => {
    const { date, from, scale, mode } = current().params;
    return { date, from, scale, mode };
  };
  let P = { ...address(), q: query.search };
  const core = createSchedule(el, P, (changes) => {
    if ('date' in changes || 'scale' in changes || 'mode' in changes) { patch(changes); return; }
    P = { ...P, ...changes };
    core.update(P);
  }, pick(query), host);
  return { el, setQuery: (q) => { P = { ...P, ...address(), q: q.search }; core.update(P, pick(q)); }, reload: core.reload, resetFilters: core.resetFilters, destroy: core.destroy };
}
