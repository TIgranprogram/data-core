import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { actions, button, sideForm, sideNote, stack, toast, toastError } from '../ui/kit/index.js';
import { applyNorm } from './work-facts.js';
import { SCHEDULE, day, iso, partOf, round, startOfWeek, steps, titleOf, DAY } from './work-schedule-shared.js';

/* Правая панель шага Ганта (of=wsstep): исполнитель, даты, факт «Начал / Закончил», норма. Вызывается кликом по полосе work-schedule.js. */

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
      { key: '_norm', type: 'widget', label: 'Норма', wide: true, widget: () => ({
        el: stack(sideNote(`Часов на 1 шт.: ${round(b.hoursPerUnit)}. Правка нормы — только в изделии («Части и работы»).`),
          session.canEdit ? button({ label: 'Принять как норму', size: 'S', kind: 'primary', title: 'Записать фактические часы в норму изделия', onClick: async (ev) => {
            const t = ev.currentTarget; t.classList.add('is-busy');
            try {
              const plan = await api(`/orderline-plans/by-income/${b.incomeId}`);
              if (!plan.productId) { toast('У позиции нет изделия — норма живёт в изделии'); return; }
              const res = await applyNorm(plan.productId);
              toast(`Норма обновлена: ${res?.applied ?? 0} ${res?.applied === 1 ? 'работа' : 'работ'}`);
            } catch (e) { toastError(e, 'принять норму'); }
            t.classList.remove('is-busy');
          } }) : null), value: '' }) },
      { key: 'start', label: 'Начало', type: 'date', span: 1 },
      { key: 'end', label: 'Конец', type: 'date', span: 1 },
    ];
  },
  toInitial: (r) => ({ assigneeId: r.bar.assigneeId ? String(r.bar.assigneeId) : '', start: day(r.bar.start), end: day(r.bar.end) }),
  save: async (v, r) => {
    const b = r.bar;
    if (v.start && v.end && v.end < v.start) { toast('Конец раньше начала — поправьте даты'); throw new Error('Конец раньше начала'); }
    const body = { assigneeId: v.assigneeId || null, start: v.start || undefined, end: v.end || undefined };
    if (b.rev != null) body.rev = b.rev;
    try { await api(`/orderline-plans/${b.planId}/steps/${b.stepId}`, { method: 'PATCH', body }); }
    catch (e) { if (e.status === 409) toast('План изменил другой человек — откройте шаг заново'); throw e; }
    steps.delete(String(b.stepId));
    toast('Шаг обновлён');
    return { id: String(b.stepId) };
  },
});

