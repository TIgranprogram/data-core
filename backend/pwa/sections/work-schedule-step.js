import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { actions, button, sideForm, sideNote, stack, toast, toastError } from '../ui/kit/index.js';
import { applyNorm, markStep } from './work-facts.js';
import { SCHEDULE, day, dmy, iso, partOf, round, startOfWeek, steps, titleOf, DAY } from './work-schedule-shared.js';

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
  let pending = false;
  const paintFact = () => {
    info.replaceChildren(sideNote(`Начат: ${stamp(b.startedAt) || 'не отмечено'}. Закончен: ${stamp(b.finishedAt) || 'не отмечено'}.`));
    const dis = !session.canEdit || pending;
    btns.replaceChildren(
      button({ label: 'Начал', size: 'S', disabled: dis || !!b.startedAt, onClick: () => mark('start') }),
      button({ label: 'Закончил', size: 'S', disabled: dis || !!b.finishedAt, onClick: () => mark('finish') }));
  };
  async function mark(what) {
    pending = true; paintFact();
    try {
      const res = await markStep(b.planId, b.stepId, what);
      Object.assign(b, res.bar || {}); if (res.rev != null) b.rev = res.rev;
      toast(what === 'start' ? 'Начало отмечено' : 'Окончание отмечено');
      window.dispatchEvent(new Event('data-changed'));
    } catch (e) { toastError(e, 'отметить шаг'); }
    finally { pending = false; paintFact(); }
  }
  paintFact();
  return { el: stack(info, btns), value: '' };
}

function assigneeOptions(r) {
  const cur = r.bar.assigneeId ? String(r.bar.assigneeId) : '';
  const list = r.eligible.map((x) => ({ value: String(x.id), label: x.name }));
  if (cur && !list.some((p) => p.value === cur)) {
    list.unshift({ value: cur, label: r.people.find((p) => String(p.id) === cur)?.name || 'Текущий исполнитель' });
  }
  return list;
}
function assigneeMount(fapi) {
  const sel = fapi.input('assigneeId');
  if (sel?.options[0]) sel.options[0].textContent = 'Не назначен';
}

export const wsStep = sideForm({
  id: 'wsstep', title: 'Шаг плана', noun: 'шаг плана',
  canEdit: () => !!session.canEdit,
  saveLabel: 'Сохранить',
  get: async (stepId) => {
    const rec = await stepRec(stepId);
    let eligible = [], assigneeHint = 'Не указан вид работ шага.';
    if (rec.bar.workTypeId) {
      try {
        eligible = (await api('/work-tasks/people', { query: { workTypeId: rec.bar.workTypeId } })).items || [];
        assigneeHint = eligible.length ? 'Сотрудники с видом работ этого шага.' : 'Нет сотрудников с видом работ этого шага.';
      } catch { assigneeHint = 'Список исполнителей недоступен. Откройте шаг повторно.'; }
    }
    return { stepId, ...rec, eligible, assigneeHint };
  },
  heading: (r) => titleOf(r.bar),
  editTitle: (r) => titleOf(r.bar),
  subheading: (r) => [r.bar.orderNo ? 'Заказ № ' + r.bar.orderNo : '', r.bar.title].filter(Boolean).join(' · '),
  fields: (r) => {
    const b = r.bar;
    return [
      { section: 'Исполнитель и сроки', tone: 'main', fixed: true },
      { key: '_info', type: 'widget', label: '', wide: true, widget: () => ({ el: sideNote(`Часов по плану: ${round(b.hours)}. Работа: ${b.workTypeName || '—'}. Часть: ${partOf(b)}.`), value: '' }) },
      { key: '_fact', type: 'widget', label: 'Факт', wide: true, widget: () => factWidget(r) },
      { key: 'assigneeId', label: 'Исполнитель', type: 'select', wide: true, options: assigneeOptions(r), mount: assigneeMount, hint: r.assigneeHint },
      { key: 'start', label: 'Начало', type: 'date', span: 1, required: true },
      { key: 'end', label: 'Конец', type: 'date', span: 1, required: true },
      { key: '_norm', type: 'widget', label: 'Норма', wide: true, widget: () => ({
        el: stack(sideNote(`Часов на 1 шт.: ${round(b.hoursPerUnit)}. Правка нормы — только в изделии («Части и работы»).`),
          session.canEdit ? actions(button({ label: 'Принять как норму', size: 'S', title: 'Записать фактические часы в норму изделия', onClick: async () => {
            try {
              const plan = await api(`/orderline-plans/by-income/${b.incomeId}`);
              if (!plan.productId) { toast('У позиции нет изделия — норма живёт в изделии'); return; }
              const res = await applyNorm(plan.productId);
              const n = res?.applied ?? 0;
              toast(n ? `Норма обновлена: ${n} ${plural(n, 'работа', 'работы', 'работ')}` : 'Фактических часов для обновления нормы пока нет');
            } catch (e) { toastError(e, 'принять норму'); }
          } })) : null), value: '' }) },
    ];
  },
  toInitial: (r) => ({ assigneeId: r.bar.assigneeId ? String(r.bar.assigneeId) : '', start: day(r.bar.start), end: day(r.bar.end) }),
  save: async (v, r) => {
    const b = r.bar;
    if (v.start && v.end && v.end < v.start) { toast('Конец раньше начала — поправьте даты'); throw new Error('Конец раньше начала'); }
    const body = {};
    if ((v.assigneeId || null) !== (b.assigneeId || null)) body.assigneeId = v.assigneeId || null;
    if (v.start !== day(b.start) || v.end !== day(b.end)) { body.start = v.start; body.end = v.end; }
    if (!Object.keys(body).length) return r;
    if (b.rev != null) body.rev = b.rev;
    let res;
    try { res = await api(`/orderline-plans/${b.planId}/steps/${b.stepId}`, { method: 'PATCH', body }); }
    catch (e) { if (e.status === 409) toast('План изменил другой человек — откройте шаг заново'); throw e; }
    steps.delete(String(b.stepId));
    return { ...r, bar: { ...b, ...res.bar, rev: res.rev ?? b.rev } };
  },
});

wsStep.card.view = ({ bar, people }) => [
  ['Исполнитель', bar.assigneeId ? people.find((p) => String(p.id) === String(bar.assigneeId))?.name || 'Назначен' : 'Не назначен'],
  ['Начало по плану', dmy(bar.start)], ['Конец по плану', dmy(bar.end)], ['Часов по плану', round(bar.hours)],
  ['Начат', stamp(bar.startedAt) || 'Не отмечено'], ['Закончен', stamp(bar.finishedAt) || 'Не отмечено'],
];
wsStep.card.editSub = wsStep.card.subheading;
wsStep.card.startEdit = wsStep.card.editable = ({ bar }) => bar.status !== 'done' && !bar.locked;

