import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay } from '../core/format.js';
import { patch } from '../core/router.js';
import { attachCombo } from '../ui/combo.js';
import { confirmDlg } from '../ui/dialog.js';
import { errText } from '../ui/errors.js';
import { photoField } from '../ui/photos.js';
import { toast, toastError } from '../ui/toast.js';

/**
 * Договоры поставщиков (ТЗ SUPPLIER-CONTRACTS). Сервер: /supply/contracts (GET список/:id, POST, PATCH :id, DELETE :id).
 * Здесь: поле «Договор» для панели счёта (`contractField`), блок «Договоры» в карточке поставщика (`contractsBlock`)
 * и правая панель договора (`contract`, #partners?of=contract&open=<id>|new=1&supplierId=<id>).
 * Создают и правят те, кто правит заявки (session.canEdit: админ, менеджер и выше).
 */
export const canContract = () => session.canEdit;
export const contractLabel = (c) => `№ ${c.no} от ${date(c.date)}` + (c.subject ? ` · ${c.subject}` : '');
const clean = (v) => String(v ?? '').trim();

/** Договоры поставщика (по умолчанию — действующие). */
export async function fetchContracts(supplierId, status = 'active') {
  if (!supplierId) return [];
  const r = await api('/supply/contracts', { query: { supplierId, ...(status ? { status } : {}), limit: 100 } });
  return r.items || [];
}

/** Ответ сервера с warnings[] — каждое предупреждение отдельным уведомлением. */
export const showWarnings = (res) => { for (const w of res?.warnings || []) toast(String(w?.message || w), { error: true }); };

/** Поле выбора файла-скана договора: уже загруженные id сохраняются, новые добавляются. */
function filesField(known = []) {
  const keep = [...known].map(String);
  const pf = photoField([], { pdf: true }); // скан договора — PDF или фото
  const el = h('div', null, keep.length ? h('div', { class: 'muted small' }, `Уже загружено файлов: ${keep.length}`) : null, pf.el);
  return { el, ids: () => [...keep, ...pf.ids()] };
}

/**
 * Поле «Договор» для счёта. { el, id(), setSupplier(id) }.
 * Выбор из действующих договоров поставщика, «Без договора» и «+ Договор поставщика» (мини-форма тут же; после «Сохранить» договор выбран).
 * onChange(id) вызывается при выборе; бросит ошибку — выбор откатится.
 */
export function contractField({ supplierId = '', current = null, onChange } = {}) {
  let sup = String(supplierId || '');
  let sel = current?.id ? String(current.id) : '';
  let selLabel = current?.id ? contractLabel(current) : '';
  let list = [];
  const input = h('input', { autocomplete: 'off', maxlength: 200 });
  const note = h('div', { class: 'hint' });
  const setNote = () => { note.textContent = sup ? (list.length || sel ? '' : 'У поставщика пока нет договоров. Создайте первый — «+ Договор поставщика».') : 'Сначала выберите поставщика.'; };
  const paint = () => { input.value = sel ? selLabel : ''; input.placeholder = sup ? 'Без договора' : 'Сначала выберите поставщика'; input.disabled = !sup && !sel; setNote(); };
  const load = async () => { try { list = await fetchContracts(sup); } catch { list = []; } paint(); };

  async function choose(c) {
    const prev = { sel, selLabel };
    sel = c ? String(c.id) : ''; selLabel = c ? contractLabel(c) : '';
    paint();
    try { await onChange?.(sel); } catch (e) { toastError(e); sel = prev.sel; selLabel = prev.selLabel; paint(); }
  }

  // ---- мини-форма «+ Договор поставщика»: в той же панели ----
  const nNo = h('input', { maxlength: 100, placeholder: 'например: 12/24' });
  const nDate = h('input', { type: 'date', value: isoDay() });
  const nSubject = h('input', { maxlength: 300, placeholder: 'о чём договор' });
  const nTo = h('input', { type: 'date' });
  const nFiles = filesField();
  const nErr = h('div', { class: 'err', hidden: true });
  const nSave = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, 'Сохранить договор');
  const fld = (label, el, cls = '') => h('label', { class: 'field ' + cls }, h('span', null, label), el);
  const form = h('div', { class: 'form-block inv-new', 'data-tone': 'info', hidden: true },
    h('div', { class: 'inv-new-head' }, h('b', null, 'Новый договор'), h('span', { class: 'muted small' }, ' — сразу выберется в этом счёте')),
    h('div', { class: 'form-grid' }, fld('№ договора *', nNo), fld('Дата договора *', nDate), fld('Предмет', nSubject, 'wide'), fld('Действует до', nTo), h('div', { class: 'field wide' }, h('span', null, 'Скан договора'), nFiles.el)),
    nErr, h('div', { class: 'inv-new-foot' }, nSave, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { form.hidden = true; } }, 'Отмена')));
  nSave.addEventListener('click', async () => {
    if (!clean(nNo.value)) { nErr.textContent = 'Впишите № договора'; nErr.hidden = false; nNo.focus(); return; }
    if (!nDate.value) { nErr.textContent = 'Укажите дату договора'; nErr.hidden = false; nDate.focus(); return; }
    nSave.disabled = true; nSave.classList.add('is-busy'); nErr.hidden = true;
    try {
      const c = await api('/supply/contracts', { method: 'POST', body: { supplierId: sup, no: clean(nNo.value), date: nDate.value, ...(clean(nSubject.value) ? { subject: clean(nSubject.value) } : {}), ...(nTo.value ? { validTo: nTo.value } : {}), fileIds: nFiles.ids() } });
      list.unshift(c);
      form.hidden = true; nNo.value = ''; nSubject.value = ''; nTo.value = '';
      toast(`Договор № ${c.no} создан`);
      await choose(c);
    } catch (e) { nErr.textContent = errText(e); nErr.hidden = false; } finally { nSave.disabled = false; nSave.classList.remove('is-busy'); }
  });

  attachCombo(input, {
    options: () => [{ label: 'Без договора', x: null }, ...list.map((c) => ({ label: contractLabel(c), x: c }))],
    onPick: (o) => choose(o.x),
    extra: () => (sup && canContract() ? [{ label: '+ Договор поставщика', run: () => { form.hidden = false; nNo.focus(); } }] : []),
  });
  input.addEventListener('change', () => { if (!input.value.trim()) { if (sel) choose(null); } else { input.value = sel ? selLabel : ''; } });
  input.addEventListener('focus', () => input.select());

  const el = h('div', { class: 'field contract-field' }, h('span', null, 'Договор поставщика'), h('div', { class: 'has-combo' }, input), note, form);
  paint();
  if (sup) load();
  return {
    el,
    id: () => sel,
    // другой поставщик — договор прежнего не подходит (сервер тоже его сбросит)
    setSupplier(id) { id = String(id || ''); if (id === sup) return; sup = id; sel = ''; selLabel = ''; list = []; form.hidden = true; paint(); if (sup) load(); },
  };
}

/** Только показ: «Договор: № … от …» или серое «без договора». */
export function contractView(inv) {
  return inv?.contractId || inv?.contractNo
    ? h('span', { class: 'badge ok' }, `договор № ${inv.contractNo || '—'}${inv.contractDate ? ' от ' + date(inv.contractDate) : ''}`)
    : h('span', { class: 'badge dim' }, 'без договора');
}

/** Привязать/снять договор у счёта; ответ может нести warnings[]. */
export async function setInvoiceContract(invoiceId, contractId) {
  const res = await api(`/supply/invoices/${invoiceId}`, { method: 'PATCH', body: { contractId: contractId || '' } });
  toast(contractId ? 'Договор привязан к счёту' : 'Договор снят со счёта');
  showWarnings(res);
  return res;
}

/** Блок «Договоры» в карточке поставщика: список, «+ Договор», клик — правка справа, удаление с подтверждением. */
export function contractsBlock(r) {
  const box = h('div', { class: 'ctr-block' });
  const list = h('div', { class: 'ctr-list' }, h('div', { class: 'muted' }, 'Загружаю договоры…'));
  const add = canContract() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => patch({ of: 'contract', new: '1', open: undefined, supplierId: r.id }) }, '+ Договор') : null;
  box.append(h('div', { class: 'ctr-head' }, h('div', { class: 'section-title' }, 'Договоры'), add), list);
  let seq = 0;
  async function load() {
    const my = ++seq;
    try {
      const items = await fetchContracts(r.id, '');
      if (my !== seq) return;
      if (!items.length) { list.replaceChildren(h('p', { class: 'muted' }, 'У поставщика пока нет договоров.' + (canContract() ? ' Создайте первый — «+ Договор».' : ''))); return; }
      list.replaceChildren(h('ul', { class: 'timeline ctr-ul' }, ...items.map(rowEl)));
    } catch (e) { if (my === seq) list.replaceChildren(h('div', { class: 'err' }, errText(e)), h('button', { type: 'button', class: 'btn btn-sm', onclick: load }, 'Повторить')); }
  }
  function rowEl(c) {
    const open = () => patch({ of: 'contract', open: c.id, new: undefined });
    const del = canContract() ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm ctr-del', title: 'Удалить договор', onclick: async (e) => {
      e.stopPropagation();
      if (!(await confirmDlg('Удалить договор поставщика?', `Договор № ${c.no} от ${date(c.date)} будет удалён. Если к нему привязаны счета, удалить не получится.`, { okText: 'Удалить', danger: true }))) return;
      try { await api(`/supply/contracts/${c.id}`, { method: 'DELETE' }); toast('Договор поставщика удалён'); load(); } catch (err) { toastError(err); }
    } }, 'Удалить') : null;
    return h('li', { class: 'ctr-row', tabindex: '0', onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
      h('b', null, `№ ${c.no}`), h('span', { class: 'when' }, date(c.date)),
      h('span', { class: 'muted clip' }, [c.subject, c.validTo ? 'до ' + date(c.validTo) : 'бессрочный'].filter(Boolean).join(' · ')),
      h('span', { class: 'muted' }, `счетов: ${c.invoicesCount ?? 0}`),
      c.status === 'closed' ? h('span', { class: 'badge dim' }, 'закрыт') : null, del);
  }
  const refresh = () => { if (box.isConnected) load(); };
  window.addEventListener('dc:changed', refresh);
  load();
  return box;
}

/** Выбор поставщика при создании договора: combo по организациям-поставщикам; значение — id (JSON-строкой, как у widget). */
function supplierWidget(v) {
  let id = v ? String(v).replace(/^"|"$/g, '') : '';
  let list = [];
  const input = h('input', { autocomplete: 'off', maxlength: 200, placeholder: 'Начните вводить название' });
  const paint = () => { input.value = list.find((x) => String(x.id) === id)?.name || ''; };
  api('/partners', { query: { type: 'supplier', limit: 500 } }).then((r) => { list = r.items || []; paint(); }).catch(() => { list = []; });
  attachCombo(input, { options: () => list.map((x) => ({ label: x.name, x })), onPick: (o) => { id = String(o.x.id); input.value = o.x.name; } });
  input.addEventListener('change', () => { if (!input.value.trim()) id = ''; else paint(); });
  return { el: h('div', { class: 'has-combo' }, input), get value() { return JSON.stringify(id); }, set value(_) { /* только показ */ } };
}

/** Правая панель договора. Открывается из карточки поставщика (#partners?of=contract&open=<id> | &new=1&supplierId=<id>). */
export const contract = {
  id: 'contract',
  title: 'Договор поставщика',
  newTitle: 'Новый договор',
  noun: 'договор',
  entityType: 'SupplierContract',
  canEdit: canContract,
  get: (id) => api(`/supply/contracts/${id}`),
  card: {
    heading: (c) => `Договор № ${c.no}`,
    subheading: (c) => [c.supplierName, c.status === 'closed' ? 'закрыт' : 'действует'].filter(Boolean).join(' · '),
    noHistory: true,
    view: (c) => [['Поставщик', c.supplierName], ['Дата', date(c.date)], ['Предмет', c.subject], ['Действует до', c.validTo ? date(c.validTo) : 'бессрочный'],
      ['Файлов', (c.fileIds || []).length ? String((c.fileIds || []).length) : ''],
      ['Счета по договору', (c.invoices || []).length ? h('span', null, ...c.invoices.map((i, k) => h('span', null, k ? ', ' : '', h('a', { href: '#requests?tab=invoices&open=' + i.id }, `№ ${i.no || 'без номера'}`)))) : 'пока нет']],
  },
  form: {
    fields: async (c) => [
      c ? { key: 'supplierId', type: 'hidden' } : { key: 'supplierId', label: 'Поставщик', type: 'widget', wide: true, hint: 'Организация-поставщик, с которой заключён договор', widget: supplierWidget },
      { key: 'no', label: '№ договора', required: true, max: 100 },
      { key: 'date', label: 'Дата договора', type: 'date', required: true },
      { key: 'subject', label: 'Предмет', wide: true, max: 300, hint: 'О чём договор — для списка выбора в счёте' },
      { key: 'validTo', label: 'Действует до', type: 'date', hint: 'Пусто — бессрочный' },
      { key: 'status', label: 'Статус', type: 'segment', options: [{ value: 'active', label: 'Действует' }, { value: 'closed', label: 'Закрыт' }], hint: 'Закрытый договор нельзя выбрать в новом счёте' },
      { key: 'fileIds', label: 'Скан договора', type: 'widget', wide: true, widget: (v) => { const ff = filesField(Array.isArray(v) ? v : []); return { el: ff.el, get value() { return JSON.stringify(ff.ids()); }, set value(_) { /* только показ */ } }; } },
    ],
    initial: () => ({ date: isoDay(), status: 'active' }),
    toInitial: (c) => ({ ...c, supplierId: c.supplierId ? String(c.supplierId) : '', date: String(c.date || '').slice(0, 10), validTo: String(c.validTo || '').slice(0, 10), status: c.status || 'active' }),
    toBody: (v, c) => {
      const body = { no: clean(v.no), date: String(v.date || ''), subject: clean(v.subject), validTo: String(v.validTo || ''), status: v.status || 'active', fileIds: Array.isArray(v.fileIds) ? v.fileIds : [] };
      if (!c) body.supplierId = String(v.supplierId || '');
      return body;
    },
    create: (body) => { if (!body.supplierId) throw new Error('Выберите поставщика из списка'); if (!body.no) throw new Error('Впишите № договора'); if (!body.date) throw new Error('Укажите дату договора'); const { validTo, ...rest } = body; return api('/supply/contracts', { method: 'POST', body: { ...rest, ...(validTo ? { validTo } : {}) } }); },
    update: (id, body) => api(`/supply/contracts/${id}`, { method: 'PATCH', body }),
  },
};

const cell = (v) => v || h('span', { class: 'muted' }, '—');
const isOverdue = (c) => c.status !== 'closed' && c.validTo && String(c.validTo).slice(0, 10) < isoDay();

/** Раздел меню «Договоры» (Снабжение): список всех договоров поставщиков; карточка и форма — те же, что у панели `contract`. */
export const contracts = {
  ...contract,
  id: 'contracts',
  title: 'Договоры',
  list: {
    path: '/supply/contracts',
    sortDefault: '-date', // без него список падал при отрисовке шапки (ошибка с сайта 2026-10-29)
    export: false,
    createLabel: 'Договор поставщика',
    searchPlaceholder: '№ договора, поставщик, предмет…',
    emptyText: 'Договоров пока нет.',
    emptyHint: 'Нажмите «+ Договор» — или привяжите договор прямо в счёте заявки.',
    filters: [
      { key: 'supplierId', label: 'Поставщик', allLabel: 'Все поставщики', options: async () => ((await api('/partners', { query: { type: 'supplier', limit: 500 } })).items || []).map((x) => ({ value: x.id, label: x.name })) },
      { key: 'status', label: 'Статус', allLabel: 'Любой статус', options: () => [{ value: 'active', label: 'Действует' }, { value: 'closed', label: 'Закрыт' }] },
    ],
    columns: [
      { key: 'no', label: '№ договора', cls: 'nowrap', render: (r) => h('b', null, r.no) },
      { key: 'date', label: 'Дата', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'supplierName', label: 'Поставщик', cls: 'clip', render: (r) => cell(r.supplierName) },
      { key: 'subject', label: 'Предмет', cls: 'clip md-hide', render: (r) => cell(r.subject) },
      { key: 'validTo', label: 'Действует до', cls: 'nowrap', render: (r) => (r.validTo ? h('span', null, date(r.validTo), isOverdue(r) ? h('span', { class: 'badge warn', style: 'margin-left:6px' }, 'просрочен') : null) : h('span', { class: 'muted' }, 'бессрочный')) },
      { key: 'invoicesCount', label: 'Счетов', cls: 'num right', render: (r) => String(r.invoicesCount ?? 0) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => (r.status === 'closed' ? h('span', { class: 'badge dim' }, 'закрыт') : h('span', { class: 'badge ok' }, 'действует')) },
    ],
    card: {
      title: (r) => `Договор № ${r.no}`,
      sub: (r) => [r.supplierName, date(r.date)].filter(Boolean).join(' · '),
      side: (r) => [r.status === 'closed' ? h('span', { class: 'badge dim' }, 'закрыт') : h('span', { class: 'badge ok' }, 'действует')],
    },
  },
};
