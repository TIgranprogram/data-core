import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/busy.js';
import { date, money, newUid, parseNum, qty } from '../core/format.js';
import { confirmDlg } from '../ui/dialog.js';
import { openSide, sideForm } from '../ui/side-form.js';
import { toast, toastError } from '../ui/toast.js';
import { incomeLookups, todayMsk } from './orders.js';

/**
 * «ФОТ» — фонд оплаты труда. Данные с сервера: GET /api/payroll/summary?month= (сотрудники, табель, начислено,
 * выплачено, остаток, срок выплаты, итог и по компаниям). Правка табеля — PUT /payroll/timesheet, выплаты —
 * POST/DELETE /payroll/payments, компания сотрудника — PATCH /payroll/people/:id. Ставки — «Справочники → Сотрудники».
 * Включается/выключается одной строкой: FEATURES.payroll в main.js.
 */
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const KINDS = [['advance', 'Аванс'], ['salary', 'Зарплата'], ['bonus', 'Премия'], ['other', 'Прочее']];
const curMonth = () => todayMsk().slice(0, 7);
const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const label = (m) => { const [y, mo] = m.split('-').map(Number); return `${MONTHS[mo - 1][0].toUpperCase()}${MONTHS[mo - 1].slice(1)} ${y}`; };
const kpi = (l, v, cls = '') => h('div', { class: 'sum-item static' }, h('span', { class: 'sum-v ' + cls }, v), h('span', { class: 'sum-l' }, l));

/** «Выплата» — правая панель (П3, было окно): вид, дата, сумма (по умолчанию — остаток); у сотрудника без компании — выбор нашей компании. */
let live = null; // { month(), reload() } — открытый экран «ФОТ»
export const payout = sideForm({
  id: 'payout', title: 'Выплата сотруднику', canEdit: () => session.canPayroll, entityType: 'PayrollPayment', noun: 'выплату',
  get: async (key) => {
    const month = live?.month() || curMonth();
    const [s, l] = await Promise.all([api('/payroll/summary', { query: { month } }), incomeLookups().catch(() => ({ companies: [] }))]);
    const people = s.items.filter((p) => p.rate || p.paid);
    return { month, people, companies: l.companies || [], person: key === 'new' ? null : people.find((p) => String(p.id) === String(key)) || null, _key: key };
  },
  heading: (r) => (r.person ? 'Выплата: ' + r.person.name : 'Выплата сотруднику'),
  subheading: (r) => label(r.month),
  saveLabel: 'Сохранить выплату',
  fields: (r) => {
    const byId = (id) => r.people.find((p) => String(p.id) === String(id));
    const sync = (fapi) => { const p = byId(r.person ? r.person.id : fapi.get('personId')); fapi.set('companyId', p?.companyId || ''); const lab = fapi.field('companyId'); if (lab) lab.hidden = !!p?.companyId; if (!r.person) fapi.set('amount', p && p.balance > 0 ? String(p.balance).replace('.', ',') : ''); };
    return [
      r.person ? null : { key: 'personId', label: 'Сотрудник', type: 'select', required: true, choose: true, wide: true, options: r.people.map((p) => ({ value: String(p.id), label: p.name })), mount: (fapi) => fapi.on('personId', () => sync(fapi)) },
      { key: 'companyId', label: 'Наша компания (платит)', type: 'select', options: r.companies.map((c) => ({ value: String(c.id), label: c.name })), mount: (fapi) => sync(fapi) },
      { key: 'kind', label: 'Вид', type: 'select', options: KINDS.map(([value, label]) => ({ value, label })), span: 1 },
      { key: 'date', label: 'Дата', type: 'date', required: true, span: 1 },
      { key: 'amount', label: 'Сумма, ₽ на руки', type: 'money', min: 0, required: true },
    ].filter(Boolean);
  },
  toInitial: (r) => ({ personId: '', companyId: r.person?.companyId || '', kind: 'salary', date: todayMsk(), amount: r.person && r.person.balance > 0 ? r.person.balance : null }),
  toBody: (v, r) => {
    const p = r.person || r.people.find((x) => String(x.id) === String(v.personId));
    const a = Number(v.amount) || 0;
    if (!p) throw new Error('Выберите сотрудника');
    if (!(a > 0)) throw new Error('Впишите сумму больше нуля');
    const companyId = p.companyId || v.companyId;
    if (!companyId) throw new Error('Выберите нашу компанию');
    return { personId: p.id, companyId, date: v.date, amount: a, kind: v.kind, month: r.month };
  },
  save: async (body) => { await api('/payroll/payments', { method: 'POST', body: { ...body, clientUid: newUid() } }); toast('Выплата записана'); live?.reload(); return {}; },
});

export function mountPayroll() {
  if (!session.canPayroll) return { el: h('div', { class: 'panel state' }, 'Раздел доступен только бухгалтеру и руководству.'), reload: () => {}, update: () => {} };
  let month = curMonth();
  const monthLabel = h('span', { class: 'm-label' });
  const next = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Следующий месяц', onclick: () => { month = shift(month, 1); load(); } }, '›');
  const body = h('div', { class: 'm-body' }, busyBlock('сотрудников', { cls: 'panel state' }));
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => payDialog(null) }, '+ Выплата');
  const el = h('div', { class: 'payroll' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'ФОТ'), h('div', { class: 'sub' }, 'Фонд оплаты труда: начислено, выплачено, остаток по сотрудникам и компаниям')), h('span', { class: 'spacer' }), addBtn),
    h('div', { class: 'm-controls' }, h('div', { class: 'm-month' },
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Предыдущий месяц', onclick: () => { month = shift(month, -1); load(); } }, '‹'), monthLabel, next)),
    body);

  let data = null;
  let seq = 0;

  const payDialog = (person) => openSide('payout', person ? person.id : 'new');
  live = { month: () => month, reload: () => load() };

  /** Правка табеля в строке: часы (почасовая) или дни/норма (оклад). */
  function sheetInputs(p) {
    const send = async (field, inp) => {
      const raw = inp.value.trim();
      const v = raw === '' ? null : parseNum(raw);
      try { await api('/payroll/timesheet', { method: 'PUT', body: { personId: p.id, month, [field]: v } }); load(); } catch (e) { toastError(e); }
    };
    const mk = (field, val, ph, title) => { const i = h('input', { class: 'pr-inp', inputmode: 'decimal', placeholder: ph, title, value: val ?? '' }); i.addEventListener('change', () => send(field, i)); return i; };
    if (p.kind === 'hour') return mk('hours', p.hours, 'часов', 'Отработано часов за месяц');
    return h('span', { class: 'nowrap' }, mk('days', p.days, 'дней', 'Отработано дней (пусто — полный оклад)'), ' из ', mk('normDays', p.normDays, 'норма', 'Рабочих дней в месяце'));
  }

  async function companyPick(p, cell) {
    const l = await incomeLookups().catch(() => ({ companies: [] }));
    const sel = h('select', null, h('option', { value: '' }, 'выбрать компанию…'), ...l.companies.map((c) => h('option', { value: c.id }, c.name)));
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      try { await api(`/payroll/people/${p.id}`, { method: 'PATCH', body: { companyId: sel.value } }); toast('Наша компания сотрудника сохранена'); load(); } catch (e) { toastError(e); }
    });
    cell.replaceChildren(sel);
  }

  function view(s, pays) {
    monthLabel.textContent = label(s.month);
    next.disabled = s.month >= curMonth();
    const items = s.items.filter((p) => p.rate || p.paid || p.hasTimesheet);
    if (!items.length) {
      return [h('div', { class: 'panel state' }, h('div', null, 'Ставок нет. «Справочники → Сотрудники» → сотрудник → «Оплата» и «Ставка».'),
        h('a', { class: 'btn', href: '#dicts?d=persons' }, 'Открыть «Сотрудники»'))];
    }
    const cos = s.byCompany || [];
    const row = (p) => {
      const coCell = h('td', { class: 'md-hide' }, p.companyName || h('a', { href: '#', class: 'muted', title: 'Нужна для календаря: чья это зарплата', onclick: (e) => { e.preventDefault(); companyPick(p, coCell); } }, 'компания не указана — выбрать'));
      return h('tr', null,
        h('td', null, h('a', { href: '#dicts?d=persons&of=dict&open=' + p.id }, h('b', null, p.name)), p.position ? h('div', { class: 'muted small' }, p.position) : null),
        coCell,
        h('td', { class: 'num right' }, p.rate ? money(p.rate) + (p.kind === 'hour' ? ' / час' : ' / мес') : h('span', { class: 'muted' }, 'нет ставки')),
        h('td', { class: 'right' }, p.rate ? sheetInputs(p) : ''),
        h('td', { class: 'num right' }, money(p.accrued)), h('td', { class: 'num right' }, money(p.paid)),
        h('td', { class: 'num right ' + (p.balance > 0 ? 'neg' : '') }, money(p.balance)),
        h('td', { class: 'num md-hide' }, date(p.dueDate)),
        h('td', { class: 'act' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => payDialog(p) }, '+ Выплата')));
    };
    const t = s.totals;
    const noRate = s.noRate ? h('p', { class: 'hint' }, `Без ставки: ${s.noRate} — «Справочники → Сотрудники» → сотрудник → «Оплата» и «Ставка».`) : null;
    const maxCo = Math.max(1, ...cos.map((c) => c.accrued));
    return [
      h('div', { class: 'summary' }, kpi('сотрудников', qty(items.length)), kpi('начислено', money(t.accrued)), kpi('выплачено', money(t.paid)), kpi('остаток к выплате', money(t.balance), t.balance > 0 ? 'neg' : '')),
      noRate,
      h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ...[['Сотрудник'], ['Наша компания', 'md-hide'], ['Ставка', 'right'], ['Часы / дни', 'right'], ['Начислено', 'right'], ['Выплачено', 'right'], ['Остаток', 'right'], ['Срок выплаты', 'md-hide'], ['']].map(([x, c]) => h('th', { class: c || '' }, x)))),
        h('tbody', null, ...items.map(row)),
        h('tfoot', null, h('tr', { class: 'total' }, h('td', { colspan: 4 }, 'Итого'), h('td', { class: 'num right' }, money(t.accrued)), h('td', { class: 'num right' }, money(t.paid)), h('td', { class: 'num right' }, money(t.balance)), h('td', { colspan: 2 }))))),
      h('p', { class: 'hint' }, 'Часы и дни правятся прямо в строке (почасовая — часы; оклад — отработано дней из нормы, пусто — полный оклад). Остаток — начислено минус выплачено; срок — по графику выплат сотрудника.')),
      cos.length ? h('div', { class: 'panel dash-card compact-card', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, 'ФОТ по компаниям')),
        h('div', { class: 'shares' }, ...cos.map((c) => h('div', { class: 'share' },
          h('div', { class: 'share-l' }, h('span', null, c.company), h('b', { class: 'num' }, money(c.accrued)), h('span', { class: 'muted num share-p' }, `выплачено ${money(c.paid)} · остаток ${money(c.balance)}`)),
          h('div', { class: 'share-bar' }, h('i', { style: { width: Math.max(2, (c.accrued / maxCo) * 100) + '%' } })))))) : null,
      h('div', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'q-head' }, h('h3', null, `Выплаты — ${label(s.month)}`)),
        pays.items.length ? h('ul', { class: 'q-list' }, pays.items.map((p) => h('li', { class: 'q-row' },
          h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, p.person), h('div', { class: 'q-sub' }, [date(p.date), p.kindLabel, p.company, p.note].filter(Boolean).join(' · '))),
          h('div', { class: 'q-side' }, h('span', { class: 'num neg' }, '−' + money(p.amount)),
            h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Удалить выплату', onclick: async () => {
              if (!(await confirmDlg('Удалить выплату?', `${p.person}: ${money(p.amount)} от ${date(p.date)}`, { okText: 'Удалить', danger: true }))) return;
              try { await api(`/payroll/payments/${p.id}`, { method: 'DELETE' }); toast('Выплата удалена'); load(); } catch (e) { toastError(e); }
            } }, '✕'))))) : h('p', { class: 'muted', style: { padding: '0 16px 12px' } }, 'За месяц выплат нет. «+ Выплата» — записать аванс, зарплату или премию.')),
    ];
  }

  async function load() {
    const my = ++seq;
    monthLabel.textContent = label(month);
    el.classList.add('loading');
    try {
      const [s, pays] = await Promise.all([api('/payroll/summary', { query: { month } }), api('/payroll/payments', { query: { month } })]);
      if (my !== seq) return;
      data = s;
      body.replaceChildren(...view(s, pays).filter(Boolean));
    } catch (e) {
      if (my === seq) body.replaceChildren(failBlock(e, load, { cls: 'panel state' }));
    } finally { if (my === seq) el.classList.remove('loading'); }
  }
  load();
  return { el, reload: load, update: () => {} };
}
