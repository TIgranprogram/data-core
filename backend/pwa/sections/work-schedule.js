import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { actions, busyBlock, button, empty, failBlock, funnel, hint, openSide, planner, segmented, stack, toast, toastError } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { buildModel } from './work-schedule-tree.js';
import { DAY, NONE, SCHEDULE, day, dmy, iso, partOf, pref, savePref, startOfWeek, steps, typeOf } from './work-schedule-shared.js';
export { wsStep } from './work-schedule-step.js';

/*
 * Гант (C041 Э2, C053 Э3) — единственный: раздел «Гант» и вид «Гант» в «В работе». GET /work-schedule?from&to → { people, bars, load, legend }.
 * Дерево: «По заказам» — заказ › позиция › часть › шаги; «По людям» — человек › позиция › шаги. По умолчанию всё свёрнуто.
 * Линза, масштаб и раскрытое запоминаются (localStorage dc-gantt-lens / -scale / -open). Воронка фильтров (заказ → позиция → часть → рабочий → вид работ)
 * считается по загруженным полосам; перетаскивание полосы = даты, на строку другого человека = другой исполнитель (PATCH /orderline-plans/:id/steps/:stepId);
 * клик по полосе — правая панель шага (of=wsstep, work-schedule-step.js). Параметры адреса: from, order, incomeId, part, person, work (mode/scale — старые ссылки).
 */
const LENSES = ['orders', 'people'];
const SCALES = ['day', 'week', 'month', 'fit'];
const SPAN = { day: 27, week: 55, fit: 55, month: 181 };
const SHIFT = { day: 7, week: 14, fit: 14, month: 30 };
const OPEN_MAX = 400;
const FILTERS = ['order', 'incomeId', 'part', 'person', 'work'];
const clearFilters = Object.fromEntries(FILTERS.map((key) => [key, undefined]));
const norm = (v) => String(v ?? '').toLowerCase().replaceAll('ё', 'е');

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
    legend.set(id, { id, name: x?.name || b.workTypeName, hue: b.hue || 1 });
  }
  return [...legend.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}

/** Фильтр по значениям воронки; skip — какой шаг не применять (для вариантов этого шага). */
function pass(b, F, skip) {
  return (skip === 'order' || !F.order || String(b.orderNo) === F.order) && (skip === 'line' || !F.line || String(b.incomeId) === F.line)
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
  let windowDates = null, viewport = null, loading = false, destroyed = false;
  let lens = LENSES.includes(P.mode) ? P.mode : pref('lens', 'orders');
  let scaleK = SCALES.includes(P.scale) ? P.scale : pref('scale', 'day'); // «День» по умолчанию: на «Неделе» работа на 1–2 дня — точка
  if (!LENSES.includes(lens)) lens = 'orders';
  if (!SCALES.includes(scaleK)) scaleK = 'week';
  let open = new Set(pref('open', []));
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
  const from = () => {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(P.from) ? Date.parse(P.from) : NaN;
    return Number.isFinite(parsed) && iso(parsed) === P.from ? P.from : iso(startOfWeek() - (scaleK === 'month' ? 28 : 7) * DAY);
  };
  const fitW = () => Math.max(320, (chartBox.clientWidth || document.querySelector('main')?.clientWidth || innerWidth) - (narrow() ? 148 : 232)); // до первой отрисовки chartBox ещё вне страницы
  const to = () => iso(Date.parse(from() + 'T00:00:00Z') + Math.max(SPAN[scaleK], scaleK === 'fit' ? 0 : Math.ceil(fitW() / ({ day: 36, week: 18, month: 6 }[scaleK] || 18)) - 1) * DAY); // период — не короче окна (ширина дня как в planner PX)
  const barsForSearch = () => {
    const words = norm(P.q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return data.bars;
    const names = new Map(data.people.map((x) => [String(x.id), x.name]));
    return data.bars.filter((b) => {
      const line = norm([b.orderNo, b.productionNo, b.productName, b.title, partOf(b), b.workTypeName, b.assigneeId ? names.get(String(b.assigneeId)) : 'Без исполнителя'].join(' '));
      return words.every((word) => line.includes(word));
    });
  };
  const rememberViewport = () => {
    const scroller = chart?.scroller;
    if (scroller?.isConnected) viewport = { left: scroller.scrollLeft, top: scroller.scrollTop };
  };

  async function load() {
    if (destroyed) return;
    rememberViewport();
    const my = ++seq;
    const dates = { from: from(), to: to() };
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
    // переключатель «По заказам / По людям» — в одной строке с масштабом (planner lead), здесь — только «Сбросить фильтры»
    if (host.filterFields) return;
    top.replaceChildren(...(Object.values(F()).some(Boolean) ? [button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: () => set(clearFilters) })] : []));
  }

  /** «Что горит»: раскрыть путь к полосе и показать её на шкале. */
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

  function paintBanner(bars) {
    const live = bars.filter((b) => b.status !== 'done');
    const over = live.filter((b) => b.overdue), none = live.filter((b) => !b.assigneeId), design = live.filter((b) => b.inDesign);
    const cap = new Map(data.people.map((x) => [String(x.id), Number(x.capacityHours) || 0]));
    const owners = new Set(bars.map((b) => String(b.assigneeId ?? NONE)));
    const heavy = [...new Set(data.load.filter((l) => {
      const id = String(l.personId);
      return owners.has(id) && cap.get(id) && l.hours > cap.get(id);
    }).map((l) => String(l.personId)))];
    const items = [
      over.length && button({ label: `Просрочено: ${over.length}`, kind: 'danger', size: 'S', title: 'Показать просроченные шаги', onClick: () => reveal('orders', over) }),
      none.length && button({ label: `Без исполнителя: ${none.length}`, size: 'S', title: 'Показать шаги без исполнителя', onClick: () => reveal('people', none) }),
      heavy.length && button({ label: `Перегружены: ${heavy.length} чел.`, size: 'S', title: 'Показать людей, у кого часов больше, чем в рабочем дне', onClick: () => reveal('people', [], heavy) }),
      design.length && button({ label: `В проектировании: ${design.length}`, kind: 'ghost', size: 'S', title: 'Показать шаги, которые ждут проектирования', onClick: () => reveal('orders', design) }),
    ].filter(Boolean);
    bannerBox.replaceChildren(...(items.length ? [actions(hint('Что горит:'), ...items)] : []));
  }

  function paintFilters(bars) {
    const f = F();
    const label = (b) => b.productName || b.title || 'Позиция';
    const steps2 = [
      { key: 'order', label: 'Заказ', ask: 'выберите заказ', optional: true, value: f.order, values: countBy(bars.filter((b) => pass(b, f, 'order')), (b) => b.orderNo, (b) => 'Заказ № ' + b.orderNo) },
      { key: 'line', label: 'Позиция', ask: 'выберите позицию', optional: true, value: f.line, values: countBy(bars.filter((b) => pass(b, f, 'line')), (b) => b.incomeId, label) },
      { key: 'part', label: 'Часть', ask: 'выберите часть', optional: true, value: f.part, values: countBy(bars.filter((b) => pass(b, f, 'part')), partOf, partOf) },
      { key: 'person', label: 'Исполнитель', ask: 'выберите исполнителя', optional: true, value: f.person, values: countBy(bars.filter((b) => pass(b, f, 'person')), (b) => b.assigneeId || NONE, (b) => (b.assigneeId ? data.people.find((x) => String(x.id) === String(b.assigneeId))?.name || 'Исполнитель' : 'Без исполнителя')) },
      { key: 'work', label: 'Вид работ', ask: 'выберите вид работ', optional: true, value: f.work, values: countBy(bars.filter((b) => pass(b, f, 'work')), (b) => b.workTypeName, (b) => b.workTypeName) },
    ].filter((s) => s.values.length || s.value);
    const fn = funnel({ steps: steps2, onChange: (key, v) => set({ [key === 'line' ? 'incomeId' : key]: v || undefined }) });
    const n = Object.values(f).filter(Boolean).length;
    if (drawer) drawer.setCount(n); else host.onFilterCount?.(n);
    filterBox.replaceChildren(...(steps2.length ? [fn.el] : []));
  }

  function saveOpen() { savePref('open', [...open].slice(-OPEN_MAX)); }

  function modelFor(bars) {
    const { person } = F();
    const people = lens === 'people' && person ? data.people.filter((x) => String(x.id) === person) : data.people;
    return buildModel({ bars, people, lens });
  }

  function paintChart(bars) {
    rememberViewport();
    const loadBy = {};
    for (const l of data.load) { (loadBy[l.personId] ||= {})[day(l.date)] = l.hours; }
    const model = modelFor(bars);
    const filtersOn = !!P.q || Object.values(F()).some(Boolean);
    const lensSeg = segmented({ items: [{ key: 'orders', label: 'По заказам' }, { key: 'people', label: 'По людям' }], value: lens, label: 'Что в строках', onChange: (k) => { lens = k; savePref('lens', k); paint(); } });
    chart = planner({
      lead: lensSeg.el,
      rowsTitle: lens === 'people' ? 'Исполнитель · позиция' : 'Заказ · позиция · часть',
      rows: bars.length ? model.rows : [], bars: model.bars, load: loadBy, ...windowDates, scale: scaleK, canEdit: !!session.canEdit, rowsMovable: lens === 'people',
      fitWidth: fitW(), autoScroll: false,
      expanded: filtersOn && !touched ? new Set(model.nodeIds) : open,
      onToggle: (_id, _isOpen, set2) => { touched = true; open = new Set(set2); saveOpen(); },
      legend: legendFor(bars, data.legend),
      onScale: (k) => {
        if (scaleK === k) return;
        scaleK = k; savePref('scale', k);
        if (from() !== windowDates.from || to() !== windowDates.to) load(); else paint();
      },
      onShift: (dir) => set({ from: iso(Date.parse(windowDates.from) + dir * SHIFT[scaleK] * DAY) }),
      onToday: () => set({ from: undefined }),
      empty: empty({ title: filtersOn ? 'По этим фильтрам работ нет' : 'В этом периоде работ нет', hint: `${dmy(windowDates.from)} — ${dmy(windowDates.to)}. ${filtersOn ? 'Измените фильтры или сдвиньте период.' : 'Сдвиньте период или запланируйте работы в составе позиции заказа.'}` }),
      onOpen: (b) => (b.taskId ? patch({ of: 'work', open: b.taskId }, { replace: false }) : openSide('wsstep', b.id)), onMove: (b, dest) => move(b.id, dest), // задание без плана — его карточка
    });
    chartBox.replaceChildren(chart.el);
    if (chart.scroller.isConnected) {
      if (viewport) {
        chart.scroller.scrollLeft = viewport.left;
        chart.scroller.scrollTop = viewport.top;
      } else chart.scrollToToday();
    }
  }

  async function move(stepId, dest) {
    const rec = steps.get(String(stepId)); if (!rec) return;
    if (rec.bar.taskId) return moveTask(rec.bar, dest);
    const previousStart = day(rec.bar.start);
    const owner = rec.bar.assigneeId ? String(rec.bar.assigneeId) : NONE;
    const reassigned = lens === 'people' && String(dest.rowId) !== owner;
    const shifted = !reassigned && dest.start !== previousStart;
    if (!shifted && !reassigned) return;
    // Длительность при сдвиге пересчитывает сервер, а назначение оставляет прежние даты.
    const body = shifted ? { start: movedStart(previousStart, dest.start) } : { assigneeId: dest.rowId === NONE ? null : dest.rowId };
    if (rec.bar.rev != null) body.rev = rec.bar.rev;
    try {
      const res = await api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body });
      const back = shifted ? { start: day(rec.bar.start), end: day(rec.bar.end) } : {};
      if (body.assigneeId !== undefined) back.assigneeId = rec.bar.assigneeId ? String(rec.bar.assigneeId) : null;
      if (res.rev != null) back.rev = res.rev;
      toast(body.assigneeId !== undefined ? 'Шаг передан другому исполнителю' : `Шаг начнётся ${dmy(res.bar?.start || body.start)}`, { undo: () => undoMove(() => api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body: back })) }); // случайный перенос — вернуть одной кнопкой
      window.dispatchEvent(new Event('data-changed'));
      await load();
    } catch (e) {
      if (e.status === 409) toast('План изменил другой человек — Гант обновлён');
      else toastError(e, 'переставить шаг'); // 400 «нет вида работ» — текст сервера, полоса возвращается (load ниже)
      await load();
      throw e;
    }
  }

  /** Задание без плана позиции (запущено по маршруту изделия): срок шага — PATCH /work-tasks/:id/plan, исполнитель — PATCH /work-tasks/:id. */
  async function moveTask(bar, dest) {
    const owner = bar.assigneeId ? String(bar.assigneeId) : NONE;
    const who = lens === 'people' && String(dest.rowId) !== owner ? (dest.rowId === NONE ? null : dest.rowId) : undefined;
    const days = Math.round((Date.parse(dest.end) - Date.parse(dest.start)) / DAY) + 1;
    try {
      // У старого задания отдельные запросы для сроков и исполнителя. Перенос на другую строку меняет только исполнителя.
      const shifted = who === undefined && dest.start !== day(bar.start);
      if (shifted) await api(`/work-tasks/${bar.taskId}/plan`, { method: 'PATCH', body: { stepIndex: bar.stepIndex, start: dest.start, days } });
      if (who !== undefined) await api(`/work-tasks/${bar.taskId}`, { method: 'PATCH', body: { assigneeId: who } });
      const oldDays = Math.round((Date.parse(day(bar.end)) - Date.parse(day(bar.start))) / DAY) + 1;
      toast(who !== undefined ? 'Задание передано другому исполнителю' : `Шаг начнётся ${dmy(dest.start)}`, { undo: () => undoMove(async () => {
        if (shifted) await api(`/work-tasks/${bar.taskId}/plan`, { method: 'PATCH', body: { stepIndex: bar.stepIndex, start: day(bar.start), days: oldDays } });
        if (who !== undefined) await api(`/work-tasks/${bar.taskId}`, { method: 'PATCH', body: { assigneeId: bar.assigneeId ? String(bar.assigneeId) : null } });
      }) });
      window.dispatchEvent(new Event('data-changed'));
      await load();
    } catch (e) { toastError(e, 'переставить шаг'); await load(); throw e; }
  }

  /** «Отменить» в сообщении о переносе: вернуть как было и перерисовать. */
  async function undoMove(revert) {
    try { await revert(); toast('Перенос отменён'); window.dispatchEvent(new Event('data-changed')); } catch (e) { toastError(e, 'отменить перенос'); }
    await load();
  }

  function paint() {
    const matches = barsForSearch();
    const bars = matches.filter((b) => pass(b, F()));
    paintTop(); paintBanner(bars); paintFilters(matches); paintChart(bars);
  }
  paintTop();
  requestAnimationFrame(load);
  return {
    update(np, query = extra) {
      const refetch = np.from !== P.from || query.personId !== extra.personId || query.orderId !== extra.orderId;
      const changedFilter = [...FILTERS, 'q'].some((key) => np[key] !== P[key]);
      const resetToday = !!P.from && !np.from;
      P = np;
      extra = query;
      if (changedFilter || refetch) touched = false;
      if (refetch) {
        paintTop();
        load();
        if (resetToday) viewport = null;
      } else if (changedFilter && !loading && data) paint();
    },
    resetFilters: () => set(clearFilters),
    reload: load,
    destroy() { destroyed = true; seq++; },
  };
}

export const workSchedule = {
  title: 'Гант',
  mount(el, { params = {} } = {}) {
    return createSchedule(el, params, (c) => patch(c, { replace: true }));
  },
};

/** Вид «Гант» списка «В работе» (list.gantt.mount): тот же экран; фильтры адреса держит у себя, исполнитель и заказ списка передаёт серверу. */
export function mountScheduleView(_cfg, _path, query = {}, host = {}) {
  const el = h('div');
  const pick = (q) => ({ ...(q?.assigneeId ? { personId: q.assigneeId } : {}), ...(q?.orderId ? { orderId: q.orderId } : {}) });
  let P = { q: query.search };
  const core = createSchedule(el, P, (c) => { P = { ...P, ...c }; for (const k of Object.keys(P)) if (P[k] === undefined) delete P[k]; core.update(P); }, pick(query), host);
  return { el, setQuery: (q) => { P = { ...P, q: q.search }; core.update(P, pick(q)); }, reload: core.reload, resetFilters: core.resetFilters, destroy: core.destroy };
}
