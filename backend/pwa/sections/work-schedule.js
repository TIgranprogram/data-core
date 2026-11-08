import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { actions, busyBlock, button, empty, failBlock, funnel, openSide, planner, section, segmented, sideForm, sideNote, stack, toast, toastError } from '../ui/kit/index.js';

/*
 * Гант (C041 Э2): планировщик по шагам планов позиций. GET /work-schedule?from&to → { people, bars, load }.
 * Переключатель «По людям / По заказам»; воронка фильтров (заказ → позиция → часть → рабочий → вид работ) считается по загруженным полосам;
 * перетаскивание полосы = даты, на строку другого человека = другой исполнитель (PATCH /orderline-plans/:id/steps/:stepId);
 * клик по полосе — правая панель шага (of=wsstep). Параметры адреса: mode, scale, from, order, incomeId, part, person, work.
 */
const SCHEDULE = '/work-schedule';
const NONE = '_none';
const DAY = 864e5;
const iso = (n) => new Date(n).toISOString().slice(0, 10);
const startOfWeek = () => { const d = new Date(); const u = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); return u - ((new Date(u).getUTCDay() + 6) % 7) * DAY; };
const day = (v) => String(v || '').slice(0, 10);
const dmy = (v) => day(v).split('-').reverse().join('.');
const round = (v) => Math.round((Number(v) || 0) * 10) / 10;

const steps = new Map(); // stepId → { bar, people } — для панели шага

const partOf = (b) => b.partName || 'Изделие целиком';
const titleOf = (b) => `${partOf(b)} · ${b.workTypeName || 'работа'}`;
const rowKey = (b, mode) => (mode === 'orders' ? String(b.orderNo || '—') : String(b.assigneeId || NONE));

function toneOf(b, mode) {
  if (/done|finish|готов|сделан/i.test(b.status || '')) return 'ok';
  if (/cancel|отмен/i.test(b.status || '')) return 'dim';
  if (mode === 'people' && !b.assigneeId) return 'warn';
  return 'info';
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

export const workSchedule = {
  title: 'Гант',
  mount(el, { params: p0 = {} } = {}) {
    let P = p0, data = null, seq = 0;
    const box = stack();
    const top = actions();
    const filterBox = stack();
    const chartBox = stack();
    box.append(top, filterBox, chartBox);
    el.append(box);

    const F = () => ({ order: P.order || '', line: P.incomeId || '', part: P.part || '', person: P.person || '', work: P.work || '' });
    const mode = () => (P.mode === 'orders' ? 'orders' : 'people');
    const scale = () => (P.scale === 'day' || P.scale === 'week' ? P.scale : (typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches ? 'day' : 'week'));
    const from = () => (P.from && /^\d{4}-\d{2}-\d{2}$/.test(P.from) ? P.from : iso(startOfWeek() - 7 * DAY));
    const to = () => iso(Date.parse(from() + 'T00:00:00Z') + (scale() === 'day' ? 27 : 55) * DAY);
    const set = (c) => patch(c, { replace: true });
    const shift = (days) => set({ from: iso(Date.parse(from() + 'T00:00:00Z') + days * DAY) });

    async function load() {
      const my = ++seq;
      chartBox.replaceChildren(busyBlock('Гант'));
      try {
        const r = await api(SCHEDULE, { query: { from: from(), to: to() } });
        if (my !== seq) return;
        data = { people: r.people || [], bars: r.bars || [], load: r.load || [] };
        steps.clear();
        for (const b of data.bars) steps.set(String(b.stepId), { bar: b, people: data.people });
        paint();
      } catch (e) { if (my === seq) chartBox.replaceChildren(failBlock(e, load)); }
    }

    function paintTop() {
      const modeSeg = segmented({ items: [{ key: 'people', label: 'По людям' }, { key: 'orders', label: 'По заказам' }], value: mode(), label: 'Что в строках', onChange: (k) => set({ mode: k === 'people' ? undefined : k }) });
      const scaleSeg = segmented({ items: [{ key: 'week', label: 'Недели' }, { key: 'day', label: 'Дни' }], value: scale(), label: 'Масштаб', onChange: (k) => set({ scale: k }) });
      top.replaceChildren(modeSeg.el, scaleSeg.el, button({ label: '←', size: 'S', title: 'Раньше', onClick: () => shift(scale() === 'day' ? -7 : -14) }),
        button({ label: 'Сегодня', size: 'S', onClick: () => set({ from: undefined }) }), button({ label: '→', size: 'S', title: 'Позже', onClick: () => shift(scale() === 'day' ? 7 : 14) }),
        Object.values(F()).some(Boolean) ? button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: () => set({ order: undefined, incomeId: undefined, part: undefined, person: undefined, work: undefined }) }) : null);
    }

    function paintFilters() {
      const f = F(), bars = data.bars;
      const steps2 = [
        { key: 'order', label: 'Заказ', ask: 'выберите заказ', optional: true, value: f.order, values: countBy(bars.filter((b) => pass(b, f, 'order')), (b) => b.orderNo, (b) => 'Заказ № ' + b.orderNo) },
        { key: 'line', label: 'Позиция', ask: 'выберите позицию', optional: true, value: f.line, values: countBy(bars.filter((b) => pass(b, f, 'line')), (b) => b.incomeId, (b) => b.title || 'Позиция') },
        { key: 'part', label: 'Часть', ask: 'выберите часть', optional: true, value: f.part, values: countBy(bars.filter((b) => pass(b, f, 'part')), partOf, partOf) },
        { key: 'person', label: 'Рабочий', ask: 'выберите рабочего', optional: true, value: f.person, values: countBy(bars.filter((b) => pass(b, f, 'person')), (b) => b.assigneeId || NONE, (b) => (b.assigneeId ? data.people.find((x) => String(x.id) === String(b.assigneeId))?.name || 'Рабочий' : 'Не назначен')) },
        { key: 'work', label: 'Вид работ', ask: 'выберите вид работ', optional: true, value: f.work, values: countBy(bars.filter((b) => pass(b, f, 'work')), (b) => b.workTypeName, (b) => b.workTypeName) },
      ].filter((s) => s.values.length || s.value);
      const fn = funnel({ steps: steps2, onChange: (key, v) => set({ [key === 'line' ? 'incomeId' : key]: v || undefined }) });
      filterBox.replaceChildren(section({ title: 'Фильтры', count: Object.values(f).filter(Boolean).length || undefined, tone: 'main', open: !!Object.values(f).some(Boolean), body: [fn.el] }));
    }

    function paintChart() {
      const f = F(), m = mode(), bars = data.bars.filter((b) => pass(b, f));
      const loadBy = {};
      for (const l of data.load) { (loadBy[l.personId] ||= {})[day(l.date)] = l.hours; }
      let rows;
      if (m === 'people') {
        const unassigned = bars.some((b) => !b.assigneeId);
        rows = [...(unassigned || !f.person ? [{ id: NONE, label: 'Не назначен', sub: `${bars.filter((b) => !b.assigneeId).length} шагов` }] : []),
          ...data.people.filter((x) => !f.person || String(x.id) === f.person).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')).map((x) => ({ id: String(x.id), label: x.name, sub: x.capacityHours ? `${round(x.capacityHours)} ч в день` : '', cap: Number(x.capacityHours) || 0 }))];
        if (f.person === NONE) rows = rows.filter((r) => r.id === NONE);
      } else rows = [...new Set(bars.map((b) => String(b.orderNo || '—')))].sort().map((o) => ({ id: o, label: 'Заказ № ' + o, sub: `${bars.filter((b) => String(b.orderNo || '—') === o).length} шагов` }));
      const view = bars.map((b) => ({ id: String(b.stepId), rowId: rowKey(b, m), start: day(b.start), end: day(b.end), title: titleOf(b), sub: [`${round(b.hours)} ч`, m === 'people' ? '№ ' + b.orderNo : b.assigneeId ? '' : 'не назначен'].filter(Boolean).join(' · '), tone: toneOf(b, m), hint: `Заказ № ${b.orderNo}${b.title ? ' · ' + b.title : ''}` }));
      const chart = planner({
        rows, bars: view, load: loadBy, from: from(), to: to(), scale: scale(), canEdit: !!session.canEdit, rowsMovable: m === 'people',
        empty: empty({ title: 'В этом периоде работ нет', hint: 'Откройте заказ, в позиции нажмите «Состав» и добавьте работы, затем «Запланировать». Или сдвиньте период.' }),
        onOpen: (b) => openSide('wsstep', b.id), onMove: (b, dest) => move(b.id, dest),
      });
      chartBox.replaceChildren(chart.el);
      chart.scrollToToday();
    }

    async function move(stepId, dest) {
      const rec = steps.get(String(stepId)); if (!rec) return;
      const body = { start: dest.start, end: dest.end };
      if (mode() === 'people' && String(dest.rowId) !== rowKey(rec.bar, 'people')) body.assigneeId = dest.rowId === NONE ? null : dest.rowId;
      if (rec.bar.rev != null) body.rev = rec.bar.rev;
      try {
        await api(`/orderline-plans/${rec.bar.planId}/steps/${stepId}`, { method: 'PATCH', body });
        toast(body.assigneeId !== undefined ? 'Шаг передан другому рабочему' : `Шаг начнётся ${dmy(dest.start)}`);
        window.dispatchEvent(new Event('data-changed'));
        await load();
      } catch (e) {
        if (e.status === 409) toast('План изменил другой человек — Гант обновлён');
        else toastError(e, 'переставить шаг'); // 400 «нет вида работ» — текст сервера, полоса возвращается (load ниже)
        await load();
        throw e;
      }
    }

    function paint() { paintTop(); paintFilters(); paintChart(); }
    paintTop();
    load();
    return {
      update(np) {
        const refetch = np.from !== P.from || np.scale !== P.scale;
        P = np;
        if (!data || refetch) { paintTop(); load(); } else paint();
      },
      reload: load,
      destroy() { seq++; },
    };
  },
};

/* ---------------------------------------------------------------- панель шага */

async function stepRec(id) {
  let rec = steps.get(String(id));
  if (!rec) {
    const t = Date.now();
    const r = await api(SCHEDULE, { query: { from: iso(startOfWeek() - 28 * DAY), to: iso(t + 120 * DAY) } });
    for (const b of r.bars || []) steps.set(String(b.stepId), { bar: b, people: r.people || [] });
    rec = steps.get(String(id));
  }
  if (!rec) throw new Error('Шаг не найден — возможно, его убрали из плана');
  return rec;
}

const stamp = (v) => (v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** Факт шага: когда начали и закончили + кнопки «Начал» / «Закончил» (POST …/mark → { bar, rev }). */
function factWidget(r) {
  const b = r.bar;
  const info = h('div');
  const btns = actions();
  const paintFact = () => {
    info.replaceChildren(sideNote(`Начат: ${stamp(b.startedAt) || 'не отмечено'}. Закончен: ${stamp(b.finishedAt) || 'не отмечено'}.`));
    const dis = !session.canEdit;
    btns.replaceChildren(
      button({ label: 'Начал', size: 'S', disabled: dis || !!b.startedAt, onClick: (ev) => mark('start', ev) }),
      button({ label: 'Закончил', size: 'S', disabled: dis || !!b.finishedAt, onClick: (ev) => mark('finish', ev) }));
  };
  async function mark(what, ev) {
    const t = ev?.currentTarget; t?.classList.add('is-busy');
    try {
      const res = await api(`/orderline-plans/${b.planId}/steps/${b.stepId}/mark`, { method: 'POST', body: { what } });
      Object.assign(b, res.bar || {}); if (res.rev != null) b.rev = res.rev;
      toast(what === 'start' ? 'Начало отмечено' : 'Окончание отмечено');
      window.dispatchEvent(new Event('data-changed'));
    } catch (e) { toastError(e, 'отметить шаг'); }
    paintFact();
  }
  paintFact();
  return { el: stack(info, btns), value: '' };
}

const ALL = '__all';
/** Список исполнителей шага: с видом работ шага (+ уже назначенный) и пункт «Показать всех». */
function assigneeOptions(r, all) {
  const cur = r.bar.assigneeId ? String(r.bar.assigneeId) : '';
  const list = r.people.filter((x) => all || !r.able || r.able.has(String(x.id)) || String(x.id) === cur).map((x) => ({ value: String(x.id), label: x.name }));
  return [{ value: '', label: 'Не назначен' }, ...list, ...(r.able && !all ? [{ value: ALL, label: 'Показать всех…' }] : [])];
}
function assigneeMount(r, fapi) {
  const sel = fapi.input('assigneeId');
  if (!r.able || !sel) return;
  sel.addEventListener('change', () => {
    if (sel.value !== ALL) return;
    sel.replaceChildren(...assigneeOptions(r, true).map((o) => h('option', { value: o.value }, o.label)));
    sel.value = r.bar.assigneeId ? String(r.bar.assigneeId) : '';
  });
}

export const wsStep = sideForm({
  id: 'wsstep', title: 'Шаг плана', noun: 'шаг плана',
  canEdit: () => !!session.canEdit,
  saveLabel: 'Сохранить',
  get: async (stepId) => {
    const rec = await stepRec(stepId);
    // кто умеет эту работу: сотрудники с видом работ шага (нет вида работ у шага или сбой — показываем всех)
    let able = null;
    if (rec.bar.workTypeId) {
      try { able = new Set(((await api('/work-tasks/people', { query: { workTypeId: rec.bar.workTypeId } })).items || []).map((p) => String(p.id))); } catch { able = null; }
    }
    return { stepId, ...rec, able };
  },
  heading: (r) => titleOf(r.bar),
  subheading: (r) => [r.bar.orderNo ? 'Заказ № ' + r.bar.orderNo : '', r.bar.title].filter(Boolean).join(' · '),
  fields: (r) => {
    const b = r.bar;
    return [
      { section: 'Исполнитель и сроки', tone: 'main', fixed: true },
      { key: '_info', type: 'widget', label: '', wide: true, widget: () => ({ el: sideNote(`Часов по плану: ${round(b.hours)}. Работа: ${b.workTypeName || '—'}. Часть: ${partOf(b)}.`), value: '' }) },
      { key: '_fact', type: 'widget', label: 'Факт', wide: true, widget: () => factWidget(r) },
      { key: 'assigneeId', label: 'Исполнитель', type: 'select', wide: true, options: assigneeOptions(r, false), mount: (fapi) => assigneeMount(r, fapi),
        hint: r.able ? 'Только сотрудники с видом работ этого шага. «Показать всех» — весь список.' : undefined },
      { key: 'hours', label: 'Часов на 1 шт.', type: 'number', min: 0, wide: true },
      { key: 'start', label: 'Начало', type: 'date', span: 1 },
      { key: 'end', label: 'Конец', type: 'date', span: 1 },
    ];
  },
  toInitial: (r) => ({ assigneeId: r.bar.assigneeId ? String(r.bar.assigneeId) : '', start: day(r.bar.start), end: day(r.bar.end), hours: r.bar.hoursPerUnit ?? '' }),
  save: async (v, r) => {
    const b = r.bar;
    if (v.start && v.end && v.end < v.start) { toast('Конец раньше начала — поправьте даты'); throw new Error('Конец раньше начала'); }
    const body = { assigneeId: v.assigneeId || null, start: v.start || undefined, end: v.end || undefined };
    if (v.hours !== '' && v.hours != null && Number(v.hours) >= 0 && Number(v.hours) !== b.hoursPerUnit) body.hours = Number(v.hours);
    if (b.rev != null) body.rev = b.rev;
    try { await api(`/orderline-plans/${b.planId}/steps/${b.stepId}`, { method: 'PATCH', body }); }
    catch (e) { if (e.status === 409) toast('План изменил другой человек — откройте шаг заново'); throw e; }
    steps.delete(String(b.stepId));
    toast('Шаг обновлён');
    return { id: String(b.stepId) };
  },
});

