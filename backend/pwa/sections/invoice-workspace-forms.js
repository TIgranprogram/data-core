import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { money, date } from '../core/format.js';
import { buildForm, section, table, button, actions, link, failBlock, photoField, badge, SUPPLY_STATUS } from '../ui/kit/index.js';
import { permissions, assertOperation, lineDraft, changeLine, lineBody, addBody, metaBody } from './invoice-workspace-state.js';

const field = (key, label, input) => ({ key, label, type: 'widget', wide: true, widget: () => ({ el: input, get value() { return JSON.stringify(input.value); }, set value(_) { /* начальное значение уже установлено */ } }) });
const number = (name, value, step = 'any') => h('input', { name, type: 'number', min: '0', step, inputmode: 'decimal', value });

/** Сумма строки каноническая; изменение qty само по себе не умножает округлённую цену. */
export function buildLineForm(invoice, line) {
  let draft = lineDraft(line), unitEdited = false;
  const inputs = { qty: number('qty', draft.qty), unitPrice: number('unitPrice', draft.unitPrice, '0.01'), lineAmount: number('lineAmount', draft.lineAmount, '0.01') };
  if (invoice.status === 'paid') inputs.reason = h('input', { name: 'reason', maxlength: 500, value: '', placeholder: 'Почему изменился оплаченный счёт' });
  for (const key of ['qty', 'unitPrice', 'lineAmount']) inputs[key].addEventListener('input', () => {
    if (key === 'unitPrice') unitEdited = true;
    if (key === 'lineAmount') unitEdited = false;
    draft = changeLine(draft, key, inputs[key].value, unitEdited);
    for (const other of ['unitPrice', 'lineAmount']) if (other !== key) inputs[other].value = draft[other];
  });
  const form = buildForm([
    { section: 'Изменить одну позицию', fixed: true },
    { note: `${line.title || line.materialName || 'Позиция'} · ${line.unit || ''}. Сохранение изменит только эту строку.` },
    field('qty', 'Количество', inputs.qty), field('unitPrice', 'Цена за единицу, ₽', inputs.unitPrice), field('lineAmount', 'Точная сумма строки, ₽', inputs.lineAmount),
    inputs.reason ? field('reason', 'Причина корректировки *', inputs.reason) : null,
    { note: 'Сумма строки — источник истины. Новая цена за единицу пересчитает сумму; количество без новой цены сохранит точную сумму.' },
  ].filter(Boolean));
  return { ...form, inputs, payload: () => lineBody(invoice, Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value]))) };
}

async function buildMetaForm(invoice, services) {
  const p = permissions(invoice, session);
  const [payers, contracts] = await Promise.all([p.finance ? services.payers() : [], services.contracts(invoice.supplierId)]);
  if (p.finance && invoice.payerCompanyId && !payers.some((payer) => String(payer.value) === String(invoice.payerCompanyId))) payers.push({ value: String(invoice.payerCompanyId), label: invoice.payerName || 'Текущая компания' });
  const files = photoField(invoice.files || [], { pdf: true });
  const knownIds = (invoice.fileIds || (invoice.files || []).map((f) => f.id)).map(String);
  const unseenIds = knownIds.filter((id) => !(invoice.files || []).some((f) => String(f.id) === id));
  const fileIds = () => [...unseenIds, ...files.ids()];
  const widget = { key: 'fileIds', label: 'Файлы счёта', type: 'widget', wide: true, widget: () => ({ el: files.el, get value() { return JSON.stringify(fileIds()); }, set value(_) { /* файлы уже показаны */ } }) };
  const contractOptions = [{ value: '', label: 'Без договора' }, ...contracts.map((c) => ({ value: c.id, label: `№ ${c.no} от ${date(c.date)}` }))];
  if (invoice.contractId && !contracts.some((c) => String(c.id) === String(invoice.contractId))) contractOptions.push({ value: invoice.contractId, label: `№ ${invoice.contractNo || '—'} (текущий)` });
  const form = buildForm([
    { section: 'Реквизиты счёта', fixed: true },
    !p.boundary ? { key: 'duplicateReason', label: 'Причина отдельного счёта с тем же номером', max: 200, wide: true, hint: 'Только если отдельный счёт с тем же номером действительно нужен.' } : null,
    { key: 'no', label: '№ счёта', max: 100 }, { key: 'date', label: 'Дата счёта', type: 'date' },
    p.finance ? { key: 'payerCompanyId', label: 'Наша компания', type: 'select', options: [{ value: '', label: 'Выберите компанию' }, ...payers] } : null,
    { section: 'Договор поставщика', tone: 'info' },
    { key: 'contractId', label: 'Договор', type: 'select', options: contractOptions, wide: true },
    { note: link({ label: 'Создать договор отдельно →', href: services.href({ of: 'contract', new: '1', open: undefined, supplierId: invoice.supplierId }) }) },
    { section: 'Файлы', tone: 'info' }, widget,
    { note: '«Выбрать файл» — отдельная загрузка файла на сервер. К счёту он привяжется только после «Сохранить». Отмена не меняет реквизиты счёта.' },
  ].filter(Boolean), { no: invoice.no || '', date: String(invoice.date || '').slice(0, 10), payerCompanyId: String(invoice.payerCompanyId || ''), contractId: String(invoice.contractId || ''), fileIds: fileIds() });
  return { ...form, busy: () => !!files.el.querySelector('.photo-drop.busy'), payload: () => {
    const read = form.read(); if (read.errors) return null;
    return metaBody(invoice, { ...read.values, fileIds: fileIds() }, session);
  } };
}

/** Выбор сохраняется в Map между поисками и серверными страницами. */
function buildAddForm(invoice, services) {
  const selected = new Map(); let page = 1, q = '', seq = 0, loading = false;
  const results = h('div'), pager = h('div', { class: 'actions' }), count = h('p', { class: 'hint' });
  const search = h('input', { type: 'search', name: 'candidate-search', placeholder: 'Найти существующую заявку', 'aria-label': 'Поиск заявок' });
  const reason = invoice.status === 'paid' ? h('input', { name: 'reason', maxlength: 500, placeholder: 'Причина добавления к оплаченному счёту' }) : null;
  const updateCount = () => { count.textContent = `Выбрано заявок: ${selected.size}. Выбор сохраняется между страницами.`; };
  const load = async () => {
    const my = ++seq; loading = true; results.classList.add('is-busy');
    try {
      const r = await services.candidates(invoice, { page, q, limit: 50 });
      if (my !== seq) return;
      const pages = Math.max(1, Math.ceil(Number(r.total || 0) / 50));
      results.replaceChildren(table({ label: 'Заявки для добавления', maxHeight: 'M',
        columns: [{ label: 'Выбрать' }, { label: 'Заявка', cls: 'clip' }, { label: 'Количество' }, { label: 'Статус' }],
        rows: (r.items || []).map((x) => ({ data: x.id, cells: [h('input', { type: 'checkbox', checked: selected.has(x.id), 'aria-label': 'Добавить ' + (x.title || x.num), onchange: (e) => { if (e.target.checked) selected.set(x.id, x); else selected.delete(x.id); updateCount(); } }), x.title || x.materialName || '—', `${x.qty ?? ''} ${x.unit || ''}`, badge(SUPPLY_STATUS, x.status)] })),
        empty: { title: 'На этой странице нет свободных заявок', hint: pages > 1 ? 'Заявки здесь уже привязаны к счетам. Перелистайте исходную выборку или уточните поиск.' : 'Измените поиск или создайте заявку отдельно. В счёт добавляются только непривязанные заявки.' } }));
      pager.replaceChildren(button({ label: '‹ Назад', disabled: page <= 1, onClick: () => { page--; return load(); } }), h('span', { class: 'muted' }, `Страница ${page} из ${pages} · в выборке: ${r.total || 0}`), button({ label: 'Далее ›', disabled: page >= pages, onClick: () => { page++; return load(); } }));
    } catch (e) { if (my === seq) results.replaceChildren(failBlock(e, load, { text: 'Заявки не загрузились' })); }
    finally { if (my === seq) { loading = false; results.classList.remove('is-busy'); } }
  };
  const find = () => { page = 1; q = search.value.trim(); return load(); };
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  const el = section({ title: 'Добавить существующие заявки', open: true, body: [
    actions(search, button({ label: 'Найти', onClick: find })), count,
    reason ? h('label', { class: 'field' }, h('span', null, 'Причина корректировки *'), reason) : null,
    results, pager, link({ label: 'Нет нужной позиции — создать заявку отдельно →', href: services.href({ of: 'requests', new: '1', open: undefined }) }),
    h('p', { class: 'hint' }, 'Новая заявка — отдельная операция. После создания вернитесь в счёт и добавьте её здесь; скрытого сохранения нет.'),
  ] });
  updateCount(); load();
  return { el, dirty: () => selected.size > 0 || !!reason?.value.trim(), read: () => ({ values: {} }), busy: () => false,
    payload: () => { if (loading) throw new Error('Дождитесь загрузки заявок'); return addBody(invoice, [...selected.keys()], reason?.value || ''); } };
}

/** Регистрация формы в openCard охватывает и обзор, и внутренние смены строки/режима. */
export async function buildWorkspaceForm(invoice, options, services) {
  const operation = options.operation || 'meta', lineId = options.lineId;
  assertOperation(invoice, session, operation, lineId);
  const form = operation === 'line' ? buildLineForm(invoice, invoice.requests.find((x) => x.id === lineId))
    : operation === 'add' ? buildAddForm(invoice, services) : await buildMetaForm(invoice, services);
  const conflict = h('div', { class: 'form-error', hidden: true });
  let bindSave, conflicted = false, duplicate = false;
  const duplicateInput = form.el.querySelector('[name="duplicateReason"]');
  duplicateInput?.addEventListener('input', () => {
    if (!duplicate) return;
    conflicted = !duplicateInput.value.trim(); bindSave?.(!conflicted);
  });
  const p = permissions(invoice, session);
  const el = h('div', { 'data-invoice-operation': operation }, actions(
    p.meta ? button({ label: 'Реквизиты счёта', disabled: operation === 'meta', onClick: () => services.edit?.({ _operation: 'meta' }) }) : null,
    p.add ? button({ label: 'Добавить заявки', disabled: operation === 'add', onClick: () => services.edit?.({ _operation: 'add' }) }) : null), form.el, conflict,
    section({ title: 'Позиции этого счёта', count: (invoice.requests || []).length, open: true, body: services.overview(invoice) }));
  return { el, busy: form.busy, dirty: form.dirty,
    bindSave: (fn) => { bindSave = fn; },
    read: () => { const read = form.read(); return read.errors ? read : { values: { invoice, operation, lineId, body: form.payload() } }; },
    onError: (e) => {
      if (e?.status !== 409) return;
      duplicate = operation === 'meta' && !!e?.data?.existingInvoiceId;
      conflicted = true; bindSave?.(false);
      conflict.hidden = false;
      conflict.replaceChildren(h('p', null, duplicate ? 'Такой номер уже существует. Откройте существующий счёт или укажите причину отдельного счёта и сохраните явно. Ввод сохранён.' : 'Счёт изменился. Ввод сохранён; повторной записи не будет. Сначала обновите счёт.'),
        button({ label: 'Обновить счёт', onClick: services.refresh }),
        e?.data?.existingInvoiceId ? link({ label: 'Открыть существующий счёт →', href: services.href({ of: 'invoicecard', open: e.data.existingInvoiceId, new: undefined }) }) : null);
    },
    get conflicted() { return conflicted; },
  };
}
