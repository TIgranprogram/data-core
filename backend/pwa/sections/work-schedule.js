import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { actions, busyBlock, button, empty, failBlock, funnel, hint, openSide, planner, section, segmented, stack, toast, toastError } from '../ui/kit/index.js';
import { buildModel } from './work-schedule-tree.js';
import { DAY, NONE, SCHEDULE, day, dmy, iso, partOf, pref, savePref, startOfWeek, steps } from './work-schedule-shared.js';
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
function createSchedule(el, p0, set, extra0 = {}) {
  let P = p0, data = null, seq = 0, extra = extra0, touched = false, chart = null;
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
  box.append(top, bannerBox, filterBox, chartBox);
  el.append(box);

  const F = () => ({ order: P.order || '', line: P.incomeId || '', part: P.part || '', person: P.person || '', work: P.work || '' });
  const from = () => (P.from && /^\d{4}-\d{2}-\d{2}$/.test(P.from) ? P.from : iso(startOfWeek() - (scaleK === 'month' ? 28 : 7) * DAY));
  const to = () => iso(Date.parse(from() + 'T00:00:00Z') + SPAN[scaleK] * DAY);
  const winOf = (k) => (k === 'day' ? 'd' : k === 'month' ? 'm' : 'w');

  async function load() {
    const my = ++seq;
    chartBox.replaceChildren(busyBlock('Гант'));
    try {
      const r = await api(SCHEDULE, { query: { from: from(), to: to(), ...extra } });
      if (my !== seq) return;
      data = { people: r.people || [], bars: r.bars || [], load: r.load || [], legend: r.legend || [] };
      steps.clear();
      for (const b of data.bars) steps.set(String(b.stepId), { bar: b, people: data.people });
      paint();
    } catch (e) { if (my === seq) chartBox.replaceChildren(failBlock(e, load)); }
  }

  function paintTop() {
    // переключатель «По заказам / По людям» — в одной строке с масштабом (planner lead), здесь — только «Сбросить фильтры»
    top.replaceChildren(...(Object.values(F()).some(Boolean) ? [button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: () => set({ order: undefined, incomeId: undefined, part: undefined, person: undefined, work: undefined }) })] : [])); // без фильтров — пусто (null дал бы текст «null»)
  }

  function showUnassigned() {
    lens = 'people'; savePref('lens', lens); open.add(NONE); touched = true; saveOpen();
    paint();
    chartBox.querySelector(`[data-row="${NONE}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function paintBanner() {
    const n = data.bars.filter((b) => !b.assigneeId && pass(b, F())).length;
    bannerBox.replaceChildren(...(n ? [actions(hint(`Без исполнителя: ${n} ${n === 1 ? 'шаг' : 'шагов'} — их не видно в загрузке людей`, 'warn'), button({ label: 'Показать', size: 'S', onClick: showUnassigned }))] : []));
  }

  function paintFilters() {
    const f = F(), bars = data.bars;
    const label = (b) => b.productName || b.title || 'Позиция';
    const steps2 = [
      { key: 'order', label: 'Заказ', ask: 'выберите заказ', optional: true, value: f.order, values: countBy(bars.filter((b) => pass(b, f, 'order')), (b) => b.orderNo, (b) => 'Заказ № ' + b.orderNo) },
      { key: 'line', label: 'Позиция', ask: 'выберите позицию', optional: true, value: f.line, values: countBy(bars.filter((b) => pass(b, f, 'line')), (b) => b.incomeId, label) },
      { key: 'part', label: 'Часть', ask: 'выберите часть', optional: true, value: f.part, values: countBy(bars.filter((b) => pass(b, f, 'part')), partOf, partOf) },
      { key: 'person', label: 'Исполнитель', ask: 'выберите исполнителя', optional: true, value: f.person, values: countBy(bars.filter((b) => pass(b, f, 'person')), (b) => b.assigneeId || NONE, (b) => (b.assigneeId ? data.people.find((x) => String(x.id) === String(b.assigneeId))?.name || 'Исполнитель' : 'Без исполнителя')) },
      { key: 'work', label: 'Вид работ', ask: 'выберите вид работ', optional: true, value: f.work, values: countBy(bars.filter((b) => pass(b, f, 'work')), (b) => b.workTypeName, (b) => b.workTypeName) },
    ].filter((s) => s.values.length || s.value);
    const fn = funnel({ steps: steps2, onChange: (key, v) => set({ [key === 'line' ? 'incomeId' : key]: v || undefined }) });
    if (!steps2.length) { filterBox.replaceChildren(); return; } // нечего фильтровать — блока «Фильтры» нет
    filterBox.replaceChildren(section({ title: 'Фильтры', count: Object.values(f).filter(Boolean).length || undefined, tone: 'main', open: !!Object.values(f).some(Boolean), body: [fn.el] }));
  }

  function saveOpen() { savePref('open', [...open].slice(-OPEN_MAX)); }

  function paintChart() {
    const f = F(), bars = data.bars.filter((b) => pass(b, f));
    const loadBy = {};
    for (const l of data.load) { (loadBy[l.personId] ||= {})[day(l.date)] = l.hours; }
    const people = lens === 'people' ? data.people.filter((x) => !f.person || String(x.id) === f.person) : data.people;
    const model = buildModel({ bars, people, lens });
    const filtersOn = Object.values(f).some(Boolean);
    const lensSeg = segmented({ items: [{ key: 'orders', label: 'По заказам' }, { key: 'people', label: 'По людям' }], value: lens, label: 'Что в строках', onChange: (k) => { lens = k; savePref('lens', k); if (data) paint(); } });
    chart = planner({
      lead: lensSeg.el,
      rowsTitle: lens === 'people' ? 'Исполнитель · позиция' : 'Заказ · позиция · часть',
      rows: bars.length ? model.rows : [], bars: model.bars, load: loadBy, from: from(), to: to(), scale: scaleK, canEdit: !!session.canEdit, rowsMovable: lens === 'people', // нет работ — подсказка, а не пустые строки людей
      fitWidth: Math.max(320, (chartBox.clientWidth || 800) - (narrow() ? 148 : 232)),
      expanded: filtersOn && !touched ? new Set(model.nodeIds) : open,
      onToggle: (_id, _isOpen, set2) => { touched = true; open = new Set(set2); saveOpen(); },
      legend: data.legend.map((x) => ({ id: x.workTypeId, name: x.name, hue: x.hue })),
      onScale: (k) => { const was = scaleK; scaleK = k; savePref('scale', k); if (winOf(was) !== winOf(k)) load(); else paint(); },
      onShift: (dir) => set({ from: iso(Date.parse(from() + 'T00:00:00Z') + dir * SHIFT[scaleK] * DAY) }),
      onToday: () => set({ from: undefined }),
      empty: empty({ title: 'В этом периоде работ нет', hint: 'Откройте заказ, в позиции нажмите «Состав» и добавьте работы, затем «Запланировать». Или сдвиньте период.' }),
      onOpen: (b) => (b.locked && b.taskId ? patch({ of: 'work', open: b.taskId }, { replace: false }) : openSide('wsstep', b.id)), onMove: (b, dest) => move(b.id, dest), // задание без плана — его карточка
    });
    chartBox.replaceChildren(chart.el);
    chart.scrollToToday();
  }

  async function move(stepId, dest) {
    const rec = steps.get(String(stepId)); if (!rec) return;
    const body = { start: dest.start, end: dest.end };
    const owner = rec.bar.assigneeId ? String(rec.bar.assigneeId) : NONE;
    if (lens === 'people' && String(dest.rowId) !== owner) body.assigneeId = dest.rowId === NONE ? null : dest.rowId;
    if (rec.bar.rev != null) body.rev = rec.bar.rev;
    try {
      await api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body });
      toast(body.assigneeId !== undefined ? 'Шаг передан другому исполнителю' : `Шаг начнётся ${dmy(dest.start)}`);
      window.dispatchEvent(new Event('data-changed'));
      await load();
    } catch (e) {
      if (e.status === 409) toast('План изменил другой человек — Гант обновлён');
      else toastError(e, 'переставить шаг'); // 400 «нет вида работ» — текст сервера, полоса возвращается (load ниже)
      await load();
      throw e;
    }
  }

  function paint() { paintTop(); paintBanner(); paintFilters(); paintChart(); }
  paintTop();
  load();
  return {
    update(np) {
      const refetch = np.from !== P.from;
      P = np;
      if (!data || refetch) { paintTop(); load(); } else paint();
    },
    setExtra(q) { if (JSON.stringify(q) === JSON.stringify(extra)) return; extra = q; if (data) load(); },
    reload: load,
    destroy() { seq++; },
  };
}

export const workSchedule = {
  title: 'Гант',
  mount(el, { params = {} } = {}) {
    return createSchedule(el, params, (c) => patch(c, { replace: true }));
  },
};

/** Вид «Гант» списка «В работе» (list.gantt.mount): тот же экран; фильтры адреса держит у себя, исполнитель и заказ списка передаёт серверу. */
export function mountScheduleView(_cfg, _path, query = {}) {
  const el = h('div');
  const pick = (q) => ({ ...(q?.assigneeId ? { personId: q.assigneeId } : {}), ...(q?.orderId ? { orderId: q.orderId } : {}) });
  let P = {};
  const core = createSchedule(el, P, (c) => { P = { ...P, ...c }; for (const k of Object.keys(P)) if (P[k] === undefined) delete P[k]; core.update(P); }, pick(query));
  return { el, setQuery: (q) => core.setExtra(pick(q)), reload: () => core.reload() };
}
