import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money, date } from '../core/format.js';
import { photoField } from '../ui/photos.js';
import { patch } from '../core/router.js';
import { SUPPLY_STATUS, supplyKey } from '../ui/badges.js';
import { attachCombo } from '../ui/combo.js';
import { modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups, unitList } from './lookups.js';
import { canContract, contractField, contractView, showWarnings } from './contracts.js';


/**
 * Заявки: «ворота» этапов и шаг воронки (REQUESTS-FUNNEL, шаг 1 — только приложение).
 * Одна таблица GATES — копия backend/src/modules/supply/supply-invoice-rules.ts (менять синхронно).
 * «Заказал у поставщика» — по заявке (ORDERED_GATE); «Счёт оплачен» — по счёту (ISSUED_GATE: №, дата, сумма):
 * панель шага всегда показывает одни и те же поля (№, дата, сумма, поставщик), заполненные — заполненными.
 * Заказ идёт через счёт: POST /supply/invoices {requestIds}.
 */
const text = (v) => !!String(v ?? '').trim();
export const GATES = [
  { to: 'ordered', fields: [
    { key: 'supplierName', label: 'Поставщик', ok: (r) => !!r.supplierId || text(r.supplierName) },
    { key: 'qty', label: 'Количество', ok: (r) => Number(r.qty) > 0 },
    { key: 'unit', label: 'Ед. изм.', ok: (r) => text(r.unit) }] },
  { to: 'paid', fields: [
    { key: 'invoiceNo', label: '№ счёта', ok: (r) => text(r.invoiceNo) },
    { key: 'invoiceDate', label: 'Дата счёта', ok: (r) => text(r.invoiceDate) },
    { key: 'priceHint', label: 'Сумма счёта', ok: (r) => Number(r.priceHint) > 0 }] },
];
const STAGE = { ordered: 0, paid: 1 };

/** Чего не хватает заявке, чтобы встать на этап `to` (учитываются только этапы впереди текущего). */
export function missingFor(r, to) {
  if (!(to in STAGE)) return [];
  if (to === 'paid' && r.invoiceId) return []; // №/дата/сумма лежат в счёте — проверяет сервер, панель покажет все поля
  const k = supplyKey(r);
  const cur = k in STAGE ? STAGE[k] : -1;
  return GATES.filter((g) => STAGE[g.to] > cur && STAGE[g.to] <= STAGE[to]).flatMap((g) => g.fields.filter((f) => !f.ok(r)));
}

/** Следующий шаг заявки: одна кнопка-глагол. kind 'receive' — окно приёма. */
export function nextStep(r) {
  const k = supplyKey(r);
  if (k === 'in_progress') return { to: 'requested', verb: 'В заказ' };
  if (k === 'requested') return { to: 'ordered', verb: 'Заказал у поставщика' };
  if (k === 'ordered') return { to: 'paid', verb: 'Счёт оплачен' };
  if (k === 'paid') return { to: 'received', verb: 'Принять на склад', kind: 'receive' };
  return null;
}

let pending = null; // { id, to } — куда ведёт открытая панель (после обновления страницы — следующий этап)
export function openStep(r, to) {
  pending = { id: r.id, to };
  patch({ of: 'reqstep', open: r.id, new: undefined });
}

const today = () => isoDay();
let payers = null;
const payerList = () => (payers ??= api('/incomes/lookups').then((x) => (x.companies || []).map((c) => ({ value: String(c.id), label: c.name }))).catch(() => { payers = null; return []; }));
/** Сумма по умолчанию: сумма заявки, иначе цена из каталога поставщика × количество. */
const defaultAmount = (r, defPrice) => (Number(r.priceHint) > 0 ? Number(r.priceHint) : Number(defPrice) > 0 ? Math.round(Number(defPrice) * (Number(r.qty) || 1) * 100) / 100 : Number(r.catalogCurrentPrice) > 0 ? Math.round(Number(r.catalogCurrentPrice) * (Number(r.qty) || 1) * 100) / 100 : null);

const fieldDefs = (lk) => ({
  supplierName: { key: 'supplierName', label: 'Поставщик', type: 'combo', options: lk.suppliers, max: 200, required: true },
  qty: { key: 'qty', label: 'Количество', type: 'number', min: 0, required: true, span: 1 },
  unit: { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(lk), max: 30, required: true, span: 1 },
  invoiceNo: { key: 'invoiceNo', label: '№ счёта', max: 100, required: true, span: 1 },
  invoiceDate: { key: 'invoiceDate', label: 'Дата счёта', type: 'date', required: true, span: 1 },
  priceHint: { key: 'priceHint', money: true, label: 'Сумма счёта, ₽', type: 'money', min: 0, required: true },
});
/** Чипы прошлых поставщиков позиции под полем «Поставщик»: клик подставляет имя. */
function supplierChips(fapi, r) {
  if (!r.materialId) return;
  const chips = h('div', { class: 'rq-chips', hidden: true });
  fapi.field('supplierName')?.append(chips);
  api(`/materials/${r.materialId}/prices`, { query: { limit: 20 } }).catch(() => null).then((hist) => {
    const seen = new Map();
    for (const x of (hist?.items || hist || []).filter((x) => x && x.supplierName)) if (!seen.has(x.supplierName)) seen.set(x.supplierName, x);
    if (!seen.size) return;
    chips.replaceChildren(...[...seen.values()].slice(0, 4).map((x) => h('button', { type: 'button', class: 'tag rq-chip', title: 'Подставить поставщика', onclick: () => fapi.set('supplierName', x.supplierName) }, x.supplierName + (session.canMoney && x.price > 0 ? ` · ${money(x.price)} ₽` : ''))));
    chips.hidden = false;
  });
}
/** id организации-поставщика по названию; нет такой — создаём (как в «Контрагентах»). */
async function ensureSupplierId(name) {
  const n = String(name || '').trim(); if (!n) return '';
  const find = async () => ((await api('/partners', { query: { limit: 500, type: 'supplier' } })).items || []).find((p) => [p.shortName, p.name].some((x) => String(x || '').trim().toLowerCase() === n.toLowerCase()))?.id || '';
  const have = await find(); if (have) return have;
  try { const c = await api('/partners', { method: 'POST', body: { kind: 'supplier', name: n } }); if (c?.id) return c.id; } catch (e) { if (e.status !== 409) throw e; }
  return find();
}
const heading = (r) => (r.num ? `№${r.num} · ` : '') + (r.title || r.materialName || '—');
const verbOf = (to) => ({ ordered: 'Заказал у поставщика', paid: 'Счёт оплачен' }[to] || SUPPLY_STATUS[to]?.label || '');

/** Правая панель «Следующий шаг»: только недостающие поля, «Сохранить и перевести» двигает этап. */
export const reqStep = {
  id: 'reqstep',
  title: 'Следующий шаг',
  noun: 'заявку',
  entityType: 'SupplyRequest',
  get: async (id) => {
    const r = await api(`/supply/requests/${id}`);
    const to = pending?.id === id ? pending.to : nextStep(r)?.to;
    const inv = to === 'paid' && r.invoiceId ? await api(`/supply/invoices/${r.invoiceId}`).catch(() => null) : null;
    const def = to === 'paid' && r.materialId ? await api(`/materials/${r.materialId}/price-default`).catch(() => null) : null;
    const companies = to === 'paid' ? await payerList() : [];
    return { ...r, _to: to, _miss: missingFor(r, to), _inv: inv, _defPrice: def?.price, _companies: companies };
  },
  card: {
    heading,
    editTitle: (r) => `${verbOf(r._to) || 'Следующий шаг'} — ${r.title || r.materialName || '—'}`,
    subheading: (r) => (r._to ? `Следующий шаг: «${verbOf(r._to)}»` : ''),
    noHistory: true,
    startEdit: (r) => r._to === 'paid' || (r._miss || []).length > 0,
    view: () => [],
    extra: (r, ctx) => h('div', null,
      h('p', { class: 'hint' }, (r._miss || []).length ? 'Заполните поля и нажмите «Сохранить и перевести».' : 'Всё заполнено — можно переводить.'),
      (r._miss || []).length || !r._to ? null : h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (r._to === 'ordered') await api('/supply/invoices', { method: 'POST', body: { requestIds: [r.id] } });
        else await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[r._to].label } });
        toast(`${heading(r)} → ${SUPPLY_STATUS[r._to].label}`); ctx.changed(); ctx.close();
      } }, verbOf(r._to))),
  },
  form: {
    saveLabel: 'Сохранить и перевести',
    fields: async (r) => {
      const defs = fieldDefs(await lookups());
      const paid = r._to === 'paid';
      const tail = r.invoiceId ? (session.canMoney ? ' и оплачен.' : '; оплату отметит бухгалтер.') : ' и заявка станет оплаченной.';
      const note = h('div', { class: 'fill-note' }, h('b', null, `Следующий шаг: «${verbOf(r._to)}»`),
        h('div', null, paid ? 'Проверьте данные счёта, при необходимости поправьте. После «Сохранить и перевести» счёт будет выставлен' + tail
          : `Чтобы перевести заявку в «${SUPPLY_STATUS[r._to].label}», нужно: ${r._miss.map((f) => f.label.toLowerCase()).join(', ')}.`));
      const head = { key: '_next', type: 'widget', label: '', wide: true, widget: () => ({ el: note, get value() { return ''; }, set value(_) { /* только показ */ } }) };
      if (!paid) return [head, ...r._miss.map((f) => defs[f.key])];
      // «Счёт оплачен»: всегда одни и те же поля; уже заполненные показываем заполненными
      const supplier = { ...defs.supplierName, required: true, wide: true, hint: 'Другой поставщик сохранится в истории позиции вместе с ценой', mount: (fapi) => supplierChips(fapi, r) };
      return [head, { ...defs.invoiceNo, required: true }, { ...defs.invoiceDate, required: true }, defs.priceHint, supplier,
        r.invoiceId ? { key: 'payerCompanyId', label: 'Наша компания', type: 'select', required: true, options: await payerList() } : null].filter(Boolean);
    },
    toInitial: (r) => ({ ...r,
      invoiceNo: r._inv?.no || r.invoiceNo || '',
      invoiceDate: String(r._inv?.date || r.invoiceDate || '').slice(0, 10) || today(),
      priceHint: (r._inv?.amount > 0 ? r._inv.amount : null) ?? defaultAmount(r, r._defPrice),
      supplierName: r.supplierName || r._inv?.supplierName || '',
      payerCompanyId: r._inv?.payerCompanyId ? String(r._inv.payerCompanyId) : r.companyId ? String(r.companyId) : r.payerCompanyId ? String(r.payerCompanyId) : r._companies?.length === 1 ? r._companies[0].value : '' }),
    toBody: (v, r) => {
      if (r._to === 'paid' && r.invoiceId) return { _inv: r.invoiceId, no: String(v.invoiceNo ?? ''), date: String(v.invoiceDate ?? ''), amount: Number(v.priceHint) || 0, payerCompanyId: String(v.payerCompanyId ?? ''), _sup: String(v.supplierName ?? '').trim() !== String(r.supplierName || r._inv?.supplierName || '').trim() ? String(v.supplierName ?? '').trim() : '' };
      if (r._to === 'paid') return { statusLabel: SUPPLY_STATUS.paid.label, invoiceNo: String(v.invoiceNo ?? ''), invoiceDate: String(v.invoiceDate ?? ''), priceHint: v.priceHint, supplierName: String(v.supplierName ?? '') };
      const body = r._to === 'ordered' ? { _order: true } : { statusLabel: SUPPLY_STATUS[r._to].label };
      for (const f of r._miss) body[f.key] = f.key === 'qty' ? v[f.key] : String(v[f.key] ?? '');
      return body;
    },
    update: async (id, body) => {
      let saved;
      if (body._inv) {
        const { _inv, _sup, ...inv } = body;
        if (_sup) inv.supplierId = await ensureSupplierId(_sup); // сервер ставит имя счёта и переносит поставщика во все заявки счёта
        // счёт с таким № у поставщика уже есть — сервер добавит позицию в него (ответ — тот счёт, id другой)
        const res = await api(`/supply/invoices/${_inv}`, { method: 'PATCH', body: { ...inv, issue: true } });
        showWarnings(res);
        const invId = res?.id || _inv;
        if (session.canMoney) { await api(`/supply/invoices/${invId}/pay`, { method: 'POST' }); toast('Счёт оплачен'); } else toast('Счёт выставлен — оплату отметит бухгалтер');
        saved = await api(`/supply/requests/${id}`);
      } else if (body._order) {
        const { _order, ...rest } = body;
        if (Object.keys(rest).length) await api(`/supply/requests/${id}`, { method: 'PATCH', body: rest });
        await api('/supply/invoices', { method: 'POST', body: { requestIds: [id] } });
        saved = await api(`/supply/requests/${id}`); toast('Заявка заказана, создан счёт');
      } else {
        saved = await api(`/supply/requests/${id}`, { method: 'PATCH', body });
        toast(`Заявка → ${SUPPLY_STATUS[supplyKey(saved)]?.label || ''}`);
      }
      lookups.reset();
      setTimeout(() => patch({ of: undefined, open: undefined }), 0); // форма уже сброшена — панель закрывается без вопроса
      return saved;
    },
  },
};

/** Перевести заявку на этап: хватает данных — меняем статус (true), нет — открываем панель (false). */
export async function advance(r, to, patchStatus) {
  if (to === 'paid' || missingFor(r, to).length) { openStep(r, to); return false; } // «Счёт оплачен» — всегда панель с № / датой / суммой / поставщиком
  if (to === 'ordered') { await api('/supply/invoices', { method: 'POST', body: { requestIds: [r.id] } }); return true; } // заказ — через счёт
  return (await patchStatus(r, to)) || true; // ответ — обновлённая запись (вызывающий кладёт её в карточку без лишнего GET)
}

/** «Заказал у поставщика» для нескольких заявок: поставщика спрашиваем один раз. Возвращает число переведённых. */
export async function bulkOrder(rows) {
  const lk = await lookups();
  const names = [...new Set(rows.map((r) => String(r.supplierName || '').trim()).filter(Boolean))];
  const input = h('input', { name: 'supplier', maxlength: 200, value: names.length === 1 ? names[0] : '', placeholder: 'Выберите или впишите' });
  attachCombo(input, { options: () => (lk.suppliers || []).map((s) => (typeof s === 'string' ? { value: s, label: s } : s)) });
  const supplier = await modal({
    title: 'Заказал у поставщика',
    okText: 'Заказал',
    body: h('div', null,
      h('p', null, `Позиций: ${rows.length}. Поставщик проставится всем.`),
      h('label', { class: 'field' }, h('span', null, 'Поставщик'), input)),
    onOk: async () => { const v = input.value.trim(); if (!v) throw new Error('Укажите поставщика'); return v; },
  });
  if (!supplier) return 0;
  let done = 0; const skipped = []; const ids = [];
  for (const r of rows) {
    const x = { ...r, supplierName: supplier };
    if (missingFor(x, 'ordered').length) { skipped.push(heading(r)); continue; }
    if (String(r.supplierName || '').trim() !== supplier) await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { supplierName: supplier } });
    ids.push(r.id);
  }
  if (ids.length) { await api('/supply/invoices', { method: 'POST', body: { requestIds: ids } }); done = ids.length; } // счета делятся по поставщику
  lookups.reset();
  toast(`Заказано у «${supplier}»: ${done}` + (skipped.length ? `. Не переведены (нет количества или единицы): ${skipped.length}` : ''), skipped.length ? { error: true } : undefined);
  return done;
}

/** Блок «Счёт» в панели заявки с invoiceId: №, дата, сумма, плательщик, файл, заявки счёта; «Сохранить» (выставлен) и «Счёт оплачен». */
export function invoiceBlock(r, ctx) {
  const box = h('div', { class: 'inv-block' }, h('div', { class: 'muted' }, 'Загружаю счёт…'));
  (async () => {
    const [inv, companies] = await Promise.all([api(`/supply/invoices/${r.invoiceId}`), payerList()]);
    const paid = inv.status === 'paid';
    const lock = paid || !session.canEdit;
    const no = h('input', { value: inv.no || '', maxlength: 100, disabled: lock });
    const dt = h('input', { type: 'date', value: String(inv.date || '').slice(0, 10) || today(), disabled: lock });
    const amount = h('input', { inputmode: 'decimal', value: inv.amount > 0 ? String(inv.amount) : String(defaultAmount(r) ?? ''), disabled: lock });
    const payer = h('select', { disabled: lock }, h('option', { value: '' }, '— выберите —'), ...companies.map((c) => h('option', { value: c.value }, c.label)));
    payer.value = inv.payerCompanyId ? String(inv.payerCompanyId) : '';
    // файлы счёта видны всегда (уже загруженные — сразу в поле, можно открыть и убрать); прикрепить можно и к оплаченному
    const files = photoField((inv.files || []).map((f) => ({ id: f.id, url: f.url, name: f.name, mime: f.mime })), { pdf: true });
    const body = () => ({ no: no.value.trim(), date: dt.value, amount: Number(String(amount.value).replace(',', '.').replace(/\s/g, '')) || 0, payerCompanyId: payer.value, fileIds: files.ids() });
    const run = async (btn, fn) => { btn.disabled = true; btn.classList.add('is-busy'); try { await fn(); ctx.changed?.(); } catch (e) { toastError(e); } finally { btn.disabled = false; btn.classList.remove('is-busy'); } };
    const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(save, async () => { showWarnings(await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { ...body(), issue: true } })); toast('Счёт сохранён'); }) }, 'Сохранить');
    const pay = h('button', { class: 'btn', type: 'button', onclick: () => run(pay, async () => {
      const res = await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { ...body(), issue: true } });
      showWarnings(res);
      await api(`/supply/invoices/${res?.id || inv.id}/pay`, { method: 'POST' }); toast('Счёт оплачен');
    }) }, 'Счёт оплачен');
    const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
    // договор поставщика: выбор/создание сразу пишет в счёт (можно и у оплаченного); без прав — только показ
    const cf = canContract() && inv.supplierId
      ? contractField({ supplierId: inv.supplierId, current: inv.contractId ? { id: inv.contractId, no: inv.contractNo || '—', date: inv.contractDate } : null,
        onChange: async (id) => { showWarnings(await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { contractId: id } })); toast(id ? 'Договор привязан к счёту' : 'Договор снят со счёта'); ctx.changed?.(); } })
      : null;
    const saveFiles = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => run(saveFiles, async () => { await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { fileIds: files.ids() } }); toast('Файлы счёта сохранены'); }) }, 'Сохранить файлы');
    // оплаченный/выставленный: значения текстом, не «серыми» полями — их всё равно не изменить
    const ro = (label, val) => h('div', { class: 'field' }, h('span', null, label), h('div', { class: 'inv-ro' }, val || h('span', { class: 'muted' }, '—')));
    const contractRow = cf ? cf.el : h('div', { class: 'field' }, h('span', null, 'Договор поставщика'), contractView(inv), inv.supplierId ? null : h('div', { class: 'hint' }, 'Сначала укажите поставщика счёта.'));
    box.replaceChildren(
      h('div', { class: 'section-title' }, `Счёт${inv.no ? ' № ' + inv.no : ''}${inv.date ? ' от ' + date(inv.date) : ''}` + (paid ? ' · оплачен' : inv.status === 'issued' ? ' · выставлен' : ' · черновик')),
      ...(lock
        ? [ro('№ счёта', inv.no), ro('Дата счёта', inv.date ? date(inv.date) : ''), ro('Сумма', inv.amount > 0 ? money(inv.amount) : ''), ro('Наша компания', inv.payerName)]
        : [field('№ счёта', no), field('Дата счёта', dt), field('Сумма, ₽', amount), field('Наша компания', payer)]),
      contractRow,
      h('div', { class: 'field' }, h('span', null, 'Файл счёта'), session.canEdit ? files.el : null,
        !session.canEdit && !(inv.files || []).length ? h('span', { class: 'muted' }, 'Файла нет') : null,
        !session.canEdit ? h('div', null, ...(inv.files || []).map((f) => h('a', { href: PREFIX + f.url, target: '_blank', rel: 'noopener' }, f.name || 'Файл счёта'))) : null,
        lock && session.canEdit ? h('div', { class: 'inv-actions' }, saveFiles) : null),
      h('div', { class: 'muted' }, 'Заявки счёта' + (inv.supplierName ? ` · ${inv.supplierName}` : '')),
      h('ul', { class: 'inv-reqs' }, ...(inv.requests || []).map((x) => h('li', null, h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? '—'} ${x.title || x.materialName || ''}`), ` · ${x.qty ?? ''} ${x.unit || ''}`, x.priceHint ? ' · ' + money(x.priceHint) : ''))),
      lock ? h('div', { class: 'muted' }, paid ? 'Счёт оплачен — меняются только файлы и договор' : inv.status === 'issued' ? 'Счёт выставлен — меняются только файлы и договор' : null) : null,
      lock ? null : h('div', { class: 'inv-actions' }, save, session.canMoney ? pay : null));
  })().catch((e) => box.replaceChildren(h('div', { class: 'err' }, e?.message || 'Не удалось загрузить счёт')));
  return box;
}
