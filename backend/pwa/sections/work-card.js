import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { dateTime, qty } from '../core/format.js';
import { canFollow } from '../core/route-access.js';
import { actions, badge as toneBadge, buildForm, busyBlock, button, enhanceSelect, failBlock, field, hint, openCard, photoStrip, readonlyGroup, section, select, sku, stack, table, toast, toastError } from '../ui/kit/index.js';
import { badge } from '../ui/kit/badges.js';
import { busyBtn } from '../ui/kit/busy.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { markStep } from './work-facts.js';

const stepLabels = {
  done: { label: 'Сделано', tone: 'ok' },
  current: { label: 'Сейчас', tone: 'info' },
  next: { label: 'Впереди', tone: 'dim' },
};

function routeTable(task) {
  const route = task.route || [];
  const el = table({
    label: 'Маршрут задания',
    maxHeight: 'S',
    columns: [{ label: 'Операция', wrap: true }, { label: 'Состояние', nowrap: true }],
    rows: route.map((step) => {
      const state = task.status === 'done' ? 'done' : task.status === 'waiting' ? 'next' : step.state;
      const status = stepLabels[state];
      return { selected: state === 'current', cells: [
        step.note ? stack(step.name, hint(step.note)) : step.name,
        status ? toneBadge(status.label, status.tone) : '',
      ] };
    }),
    empty: { title: 'Маршрут не задан.' },
  });
  if (route.length) requestAnimationFrame(() => {
    if (el.scrollHeight <= el.clientHeight) return;
    el.tabIndex = 0;
    const current = el.querySelector('tbody tr.selected');
    if (current) {
      const frame = el.getBoundingClientRect();
      const next = current.nextElementSibling || current;
      el.scrollTop = Math.max(0, Math.min(next.getBoundingClientRect().bottom - frame.bottom, current.getBoundingClientRect().top - frame.top));
    }
  });
  return el;
}

/** Команда этапа меняет задание, отметки начала и конца относятся к операции плана. */
function factBlock(task) {
  const stepId = task.status === 'work' && task.route?.[task.stepIndex]?.stepId;
  if (!stepId || !task.incomeId || !session.canEdit) return null;
  const box = stack();
  const block = section({ title: 'Факт работы', tone: 'who', body: box });
  const stamp = (v) => v ? dateTime(v) : 'Не отмечено';
  let loaded = false;
  let marking = false;
  async function paint() {
    box.replaceChildren(busyBlock('факт работы'));
    try {
      const plan = await api(`/orderline-plans/by-income/${task.incomeId}`);
      const step = (plan.steps || []).find((s) => String(s.id) === String(stepId));
      if (!step) { box.replaceChildren(hint('Операция задания отсутствует в плане позиции.')); return; }
      const { startedAt, finishedAt } = step;
      box.replaceChildren(
        readonlyGroup({ rows: [['Начало', stamp(startedAt)], ['Окончание', stamp(finishedAt)]] }),
        actions(
          button({ label: 'Начал', size: 'S', disabled: !!startedAt, onClick: (e) => mark(plan.id, 'start', e.currentTarget) }),
          button({ label: 'Закончил', size: 'S', disabled: !!finishedAt, onClick: (e) => mark(plan.id, 'finish', e.currentTarget) })),
      );
    } catch (e) { box.replaceChildren(failBlock(e, paint)); }
  }
  async function mark(planId, what, trigger) {
    if (marking) return;
    marking = true;
    const done = busyBtn(trigger);
    try {
      await markStep(planId, stepId, what);
      toast(what === 'start' ? 'Начало отмечено' : 'Окончание отмечено');
      window.dispatchEvent(new CustomEvent('data-changed'));
      await paint();
    } catch (e) { toastError(e, 'отметить шаг'); }
    finally { marking = false; done(); }
  }
  block.addEventListener('toggle', () => {
    if (!block.open || loaded) return;
    loaded = true;
    void paint();
  });
  return block;
}

function openWorkForm(ctx, { title, form, save }) {
  const parent = [...document.querySelectorAll('aside[data-k="drawer"]:not([hidden])')].at(-1);
  if (!parent) return;
  let saved;
  return openCard({
    title, newTitle: title, card: {},
    form: { saveLabel: 'Сохранить', closeAfterCreate: true, toBody: (values) => values, ...form, create: async (body) => {
      saved = await save(body);
      return saved;
    } },
  }, { mode: 'create', parent }, { changed() {}, close() { if (saved) ctx.setRow(saved); } });
}

/** Сначала исполнители текущей операции, при необходимости — весь список. */
function assign(task, ctx, loadPeople) {
  return openWorkForm(ctx, {
    title: 'Исполнитель и примечание',
    form: { build: () => {
      const step = task.status === 'work' ? task.route?.[task.stepIndex] : null;
      const assigneeId = task.assigneeId || '';
      const previous = task.note || '';
      const existing = task.assignee?.name || 'Текущий исполнитель';
      const unassigned = ['', 'Не назначен'];
      const picker = select({ label: 'Исполнитель', options: assigneeId ? [unassigned, [assigneeId, existing]] : [unassigned], value: assigneeId, disabled: true });
      const note = buildForm([{ key: 'note', label: 'Примечание', type: 'textarea', max: 500, wide: true }], { note: previous });
      const message = hint('');
      const all = button({ label: 'Показать всех сотрудников', kind: 'ghost', size: 'S', onClick: () => fill(true) });
      all.hidden = !step?.workTypeId;
      let setSave = () => {};
      let loading = true;
      const changes = () => ({
        ...(picker.value !== assigneeId ? { assigneeId: picker.value || null } : {}),
        ...(note.get('note').trim() !== previous ? { note: note.get('note').trim() } : {}),
      });
      const dirty = () => Object.keys(changes()).length > 0;
      const sync = () => setSave(!loading && dirty());
      picker.addEventListener('change', sync);
      note.el.addEventListener('input', sync);
      async function fill(everyone) {
        loading = true;
        all.disabled = true;
        sync();
        const limited = !everyone && !!step?.workTypeId;
        try {
          const staff = limited
            ? (await api('/work-tasks/people', { query: { workTypeId: step.workTypeId } })).items.map((p) => ({ value: p.id, label: p.name }))
            : await loadPeople();
          const listed = staff.some((p) => p.value === assigneeId);
          const options = [h('option', { value: '' }, 'Не назначен')];
          if (assigneeId && !listed) options.push(h('option', { value: assigneeId }, existing));
          const keep = picker.value;
          picker.replaceChildren(...options, ...staff.map((p) => h('option', { value: p.value }, p.label)));
          picker.value = keep;
          message.textContent = limited ? (staff.length ? `Сотрудники с видом работ «${step.name}».` : `Нет сотрудников с видом работ «${step.name}».`) : '';
          all.hidden = !limited;
        } catch {
          message.textContent = 'Список сотрудников не загрузился.';
        } finally {
          all.disabled = false;
          picker.disabled = false;
          loading = false;
          sync();
        }
      }
      const el = stack(field('Исполнитель', picker), message, all, note.el);
      void fill(false).then(() => enhanceSelect(picker, { force: true }));
      return { el, dirty, bindSave: (cb) => { setSave = cb; sync(); }, focus: () => note.focus(), read: () => ({ values: changes() }) };
    } },
    save: async (body) => {
      const saved = await api(`/work-tasks/${task.id}`, { method: 'PATCH', body });
      toast('Сохранено');
      return saved;
    },
  });
}

function cancel(task, ctx) {
  return openWorkForm(ctx, {
    title: 'Отменить задание',
    form: {
      saveLabel: 'Отменить задание',
      fields: () => [
        { note: 'Позиция освободится, её можно будет запустить заново.' },
        { key: 'reason', label: 'Причина отмены', type: 'textarea', max: 300, required: true, wide: true },
      ],
    },
    save: async ({ reason }) => {
      const text = reason?.trim();
      if (!text) throw new Error('Укажите причину отмены');
      const saved = await api(`/work-tasks/${task.id}/cancel`, { method: 'POST', body: { reason: text } });
      toast(`${task.code} отменена`);
      return saved;
    },
  });
}

export function workCard({ status, clean, dueNode, prioBadge, people, call, nextStep }) {
  const taskOpen = (task) => task.status === 'waiting' || task.status === 'work';
  const after = (task, ctx, run) => async () => {
    const saved = await run(task);
    if (saved) ctx.setRow(saved);
  };
  const nextOf = (task) => task.route?.[task.stepIndex + 1];
  return screenCard({
    title: (task) => {
      const name = clean(task.productName) || clean(task.title);
      const href = task.productId && '#products?open=' + encodeURIComponent(task.productId);
      return [task.code, name && ' · ', name && href && canFollow(session, href) ? h('a', { href, title: 'Открыть изделие' }, name) : name];
    },
    sub: (task) => {
      const key = clean(task.productionNo) || clean(task.orderId);
      const order = clean(task.productionNo) || clean(task.orderNo);
      const pos = task.seqNo ?? task.lineNo;
      const href = key && '#salesorders?open=' + encodeURIComponent(key);
      const label = [order ? `Заказ № ${order}` : 'Заказ', pos == null ? '' : `поз. ${pos}`].filter(Boolean).join(' · ');
      const refs = [key && (canFollow(session, href) ? h('a', { href }, label) : label),
        clean(task.customer), clean(task.sku) && sku(clean(task.sku))].filter(Boolean);
      return refs.flatMap((ref, i) => i ? [' · ', ref] : [ref]);
    },
    side: (task) => [dueNode(task), actions(badge(status, task.status), prioBadge(task))],
    bodyFirst: true,
    facts: () => [],
    warns: (task) => task.status === 'cancelled' && task.cancelReason ? [{ title: 'Причина отмены', sub: task.cancelReason }] : [],
    next: (task, ctx) => {
      if (!session.canEdit || !taskOpen(task)) return null;
      if (task.status === 'waiting') {
        const first = task.route?.[0]?.name;
        return { text: first ? `Первая операция — ${first}` : '', primary: { label: 'Взять в работу', run: after(task, ctx, nextStep) } };
      }
      const next = nextOf(task);
      return next
        ? { text: next.name, primary: { label: 'Перейти к операции', run: after(task, ctx, nextStep) } }
        : { text: 'Последняя операция маршрута.', primary: { label: 'Завершить задание', run: after(task, ctx, (row) => call(row, 'done')) } };
    },
    body: (task, _ctx, notes) => stack(
      routeTable(task),
      readonlyGroup({ rows: [
        ['Исполнитель', clean(task.assignee?.name) || (task.assigneeId ? 'Имя недоступно' : 'Без исполнителя')],
        ['Количество', task.qty == null ? '' : `${qty(task.qty)} ${clean(task.unit) || 'шт'}`],
      ] }),
      ...notes,
      factBlock(task),
      task.note ? section({ title: 'Примечание', tone: 'neutral', body: hint(task.note) }) : null,
      task.photo ? section({ title: 'Фото изделия', tone: 'neutral', body: photoStrip([{ thumb: task.photo }]) }) : null,
    ),
    menu: (task, ctx) => {
      if (!session.canEdit || task.status === 'cancelled') return [];
      const edit = { label: 'Исполнитель и примечание', run: () => assign(task, ctx, people) };
      if (task.status === 'done') {
        const last = (task.route || []).at(-1);
        return [edit, { label: 'Вернуть в работу', run: after(task, ctx, (row) => call(row, last ? last.workTypeId || 'generic' : 'waiting')) }];
      }
      if (!taskOpen(task)) return [edit];
      return [
        edit,
        (task.status === 'waiting' || nextOf(task)) && { label: 'Завершить всё задание', run: after(task, ctx, (row) => call(row, 'done')) },
        task.status === 'work' && { label: 'Вернуть в ожидание', run: after(task, ctx, (row) => call(row, 'waiting')) },
        { label: 'Отменить задание…', danger: true, run: () => cancel(task, ctx) },
      ];
    },
  });
}
