import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { isoDay, money, date } from '../core/format.js';
import { current, patch } from '../core/router.js';
import { SUPPLY_STATUS, supplyKey } from '../ui/kit/badges.js';
import { attachCombo, modal, toast, toastError, button, actions, row, section, badge, INVOICE_STATUS, failBlock } from '../ui/kit/index.js';
import { mergeInvoiceWithPreview } from '../core/invoice-merge.js';
import { lookups, unitList } from './lookups.js';


/**
 * Заявки: «ворота» этапов и шаг воронки (REQUESTS-FUNNEL, шаг 1 — только приложение).
 * Одна таблица GATES — копия backend/src/modules/supply/supply-invoice-rules.ts (менять синхронно).
 * «Заказал у поставщика» — по заявке (ORDERED_GATE); «Счёт оплачен» — по счёту (ISSUED_GATE: №, дата, сумма):
 * панель шага всегда показывает одни и те же поля (№, дата, сумма, поставщик), заполненные — заполненными.
 * Заказ идёт через счёт: POST /supply/invoices {requestIds}.
 */
const text = (v) => !!String(v ?? '').trim();

const STAGES = ['requested', 'ordered', 'paid', 'received'];
/** Полоса этапов заявки в правой панели; «Ожидает» и «Отменено» вне цепочки — полосы нет. */
export function stageStrip(r) {
  const now = STAGES.indexOf(supplyKey(r));
  if (now < 0) return null;
  return h('ol', { class: 'stage-strip', 'aria-label': 'Этапы заявки' }, STAGES.map((k, i) => h('li', { class: i === now ? 'is-now' : i < now ? 'is-done' : '', 'aria-current': i === now ? 'step' : undefined }, SUPPLY_STATUS[k].label)));
}

export const GATES = [
  { to: 'ordered', fields: [
    { key: 'supplierName', label: 'Поставщик', ok: (r) => !!r.supplierId || text(r.supplierName) },
    { key: 'qty', label: 'Количество', ok: (r) => Number(r.qty) > 0 },
    { key: 'unit', label: 'Единица', ok: (r) => text(r.unit) }] },
  { to: 'paid', fields: [
    { key: 'invoiceNo', label: '№ счёта', ok: (r) => text(r.invoiceNo) },
    { key: 'invoiceDate', label: 'Дата счёта', ok: (r) => text(r.invoiceDate) },
    { key: 'priceHint', label: 'Вся сумма по заявке', ok: (r) => Number(r.priceHint) > 0 }] },
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
  if (r.invoiceId && to === 'paid') { patch({ of: 'invoicecard', open: r.invoiceId, new: undefined }); return; }
  pending = { id: r.id, to };
  patch({ of: 'reqstep', open: r.id, new: undefined });
}

const today = () => isoDay();
/** Сумма по умолчанию: сумма заявки, иначе цена из каталога поставщика × количество. */
const defaultAmount = (r, defPrice) => (Number(r.priceHint) > 0 ? Number(r.priceHint) : Number(defPrice) > 0 ? Math.round(Number(defPrice) * (Number(r.qty) || 1) * 100) / 100 : Number(r.catalogCurrentPrice) > 0 ? Math.round(Number(r.catalogCurrentPrice) * (Number(r.qty) || 1) * 100) / 100 : null);

const fieldDefs = (lk) => ({
  supplierName: { key: 'supplierName', label: 'Поставщик', type: 'combo', options: lk.suppliers, max: 200, required: true },
  qty: { key: 'qty', label: 'Количество', type: 'number', min: 0, required: true, span: 1 },
  unit: { key: 'unit', label: 'Единица', type: 'combo', options: unitList(lk), max: 30, required: true, span: 1 },
  invoiceNo: { key: 'invoiceNo', label: '№ счёта', max: 100, required: true, span: 1 },
  invoiceDate: { key: 'invoiceDate', label: 'Дата счёта', type: 'date', required: true, span: 1 },
  priceHint: { key: 'priceHint', money: true, label: 'Вся сумма по заявке, ₽', type: 'money', min: 0, required: true, hint: 'Сколько платить за эту позицию целиком (не цена за одну штуку)' },
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
const heading = (r) => (r.num ? `№${r.num} · ` : '') + (r.title || r.materialName || '—');
const verbOf = (to) => ({ ordered: 'Заказал у поставщика', paid: 'Счёт оплачен' }[to] || SUPPLY_STATUS[to]?.label || '');

const MERGE_LABELS = { append: 'Добавить все позиции', mergeSameRequest: 'Добавить без дублей', replaceLines: 'Заменить позиции целевого счёта' };
/** Только подтверждение: POST выполняется после закрытия окна, не в обработчике submit. */
function confirmInvoiceMerge(preview) {
  const strategy = h('select', { value: 'append' }, ...preview.strategies.filter((k) => preview.plans[k]).map((k) => h('option', { value: k }, MERGE_LABELS[k])));
  const plan = h('div', null);
  const lines = (title, items, note) => section({ title, count: items.length, open: true, body: [
    note ? h('p', { class: 'hint' }, note) : null,
    ...items.map((x) => row({ title: heading(x), meta: `${x.qty ?? ''} ${x.unit || ''}`.trim(), side: session.canMoney ? money(x.priceHint) : null })),
    !items.length ? h('p', { class: 'muted' }, 'Нет позиций') : null,
  ] });
  const paint = () => {
    const p = preview.plans[strategy.value];
    plan.replaceChildren(
      lines('Будут добавлены', p.moved),
      p.skipped.length ? lines('Дубли будут пропущены', p.skipped, 'Дубли исходного счёта не добавятся и будут убраны в корзину.') : null,
      p.replaced.length ? lines('Будут убраны из целевого счёта', p.replaced, 'Эти заявки останутся, но больше не будут входить в целевой счёт.') : null,
      session.canMoney ? h('p', null, 'Итог целевого счёта: ', h('b', null, money(preview.resultAmount[strategy.value]))) : null);
    const submit = strategy.closest('form')?.querySelector('button[type="submit"]');
    if (submit) submit.textContent = strategy.value === 'replaceLines' ? 'Заменить позиции' : 'Добавить';
  };
  strategy.addEventListener('change', paint); paint();
  const invoice = (title, inv) => section({ title, open: true, body: row({ title: `Счёт № ${inv.no || '—'}`, meta: `${inv.supplierName || 'Поставщик не указан'}${inv.date ? ' · ' + date(inv.date) : ''}`, side: badge(INVOICE_STATUS, inv.status) }) });
  return modal({ title: 'Объединение счетов — предпросмотр', okText: 'Добавить', wide: true,
    body: h('div', null,
      invoice('Источник — этот счёт', preview.source), invoice('Цель — существующий счёт', preview.target),
      h('label', { class: 'field' }, h('span', null, 'Способ объединения'), strategy), plan,
      h('p', { class: 'hint' }, 'После подтверждения исходный счёт будет объединён с целевым и убран в корзину. Оплаченные счета и счета с приёмкой сервер объединить не разрешает. «Отмена» ничего не меняет.')),
    onOk: () => strategy.value,
  });
}

export async function previewInvoiceMerge(sourceId, targetId) {
  return mergeInvoiceWithPreview(api, sourceId, targetId, { confirm: confirmInvoiceMerge,
    retry: (e, sent) => modal({ title: sent ? 'Объединение не подтверждено' : 'Предпросмотр не загрузился', okText: 'Обновить предпросмотр',
      body: h('div', null, failBlock(e, null, { text: sent ? 'Не удалось подтвердить объединение' : 'Не удалось загрузить предпросмотр' }),
        h('p', { class: 'hint' }, sent ? 'При потере связи результат неизвестен. Повтор только перечитает счета; объединение потребует нового подтверждения.' : 'Повтор только загрузит данные. До вашего подтверждения позиции не изменятся.')),
    }),
  });
}

/** 409 — явный выбор; duplicateReason и открытие счёта остаются доступны без merge. */
export async function patchInvoiceWithDuplicate(inv, payload) {
  try { return await api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: payload }); }
  catch (e) {
    const ex = e?.data;
    if (e?.status !== 409 || !ex?.existingInvoiceId) throw e;
    const target = await api(`/supply/invoices/${ex.existingInvoiceId}`).catch(() => null);
    const pick = (value) => (ev) => { const form = ev.target.closest('form'); form.dataset.choice = value; form.requestSubmit(); };
    const choice = await modal({ title: 'Такой счёт уже есть', okText: 'Открыть существующий',
      body: h('div', null,
        row({ title: `Счёт № ${target?.no || ex.existingNo || '—'}`, meta: target?.supplierName || inv.supplierName || 'Этот поставщик', side: badge(INVOICE_STATUS, target?.status || ex.existingStatus) }),
        h('p', { class: 'muted' }, 'Выберите существующий счёт. Сначала покажем позиции и итог; объединение — только после подтверждения. Или сохраните отдельный счёт с причиной.'),
        actions(button({ label: 'Посмотреть, что добавится', onClick: pick('merge') }), button({ label: 'Сохранить отдельный с причиной', onClick: pick('new') }))),
      onOk: (form) => form.dataset.choice || 'open',
    });
    if (!choice) return null;
    if (choice === 'open') { patch({ of: 'invoicecard', open: ex.existingInvoiceId }); return null; }
    if (choice === 'merge') {
      const result = await previewInvoiceMerge(inv.id, ex.existingInvoiceId);
      if (result) {
        toast('Позиции объединены с существующим счётом');
        patch({ of: 'invoicecard', open: result.targetInvoiceId || ex.existingInvoiceId });
      }
      return null;
    }
    const why = h('input', { maxlength: 200, placeholder: 'Например: отдельная поставка, кредит-нота' });
    const reason = await modal({ title: 'Отдельный счёт с тем же номером', okText: 'Сохранить',
      body: h('label', { class: 'field' }, h('span', null, 'Причина'), why),
      onOk: () => { const value = why.value.trim(); if (!value) throw new Error('Укажите причину'); return value; },
    });
    if (!reason) return null;
    return api(`/supply/invoices/${inv.id}`, { method: 'PATCH', body: { ...payload, duplicateReason: reason } });
  }
}

/** Правая панель «Следующий шаг»: только недостающие поля, «Сохранить и перевести» двигает этап. */
export const reqStep = {
  id: 'reqstep',
  title: 'Следующий шаг',
  noun: 'заявку',
  entityType: 'SupplyRequest',
  get: async (id) => {
    const r = await api(`/supply/requests/${id}`);
    const to = pending?.id === id ? pending.to : nextStep(r)?.to;
    const def = to === 'paid' && r.materialId ? await api(`/materials/${r.materialId}/price-default`).catch(() => null) : null;
    return { ...r, _to: to, _miss: missingFor(r, to), _defPrice: def?.price };
  },
  card: {
    heading,
    editTitle: (r) => `${verbOf(r._to) || 'Следующий шаг'} — ${r.title || r.materialName || '—'}`,
    subheading: (r) => (r._to ? `Следующий шаг: «${verbOf(r._to)}»` : ''),
    noHistory: true,
    startEdit: (r) => !r.invoiceId && (r._to === 'paid' || (r._miss || []).length > 0),
    editable: (r) => !r.invoiceId,
    view: () => [],
    extra: (r, ctx) => r.invoiceId ? invoiceBlock(r) : h('div', null,
      stageStrip(r),
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
      if (r.invoiceId) throw new Error('Реквизиты и оплату изменяйте в панели счёта');
      const defs = fieldDefs(await lookups());
      const paid = r._to === 'paid';
      const tail = ' и заявка станет оплаченной.';
      const note = h('div', { class: 'fill-note' }, h('b', null, `Следующий шаг: «${verbOf(r._to)}»`),
        h('div', null, paid ? 'Проверьте данные счёта, при необходимости поправьте. После «Сохранить и перевести» счёт будет выставлен' + tail
          : `Чтобы перевести заявку в «${SUPPLY_STATUS[r._to].label}», нужно: ${r._miss.map((f) => f.label.toLowerCase()).join(', ')}.`));
      const head = { key: '_next', type: 'widget', label: '', wide: true, widget: () => ({ el: note, get value() { return ''; }, set value(_) { /* только показ */ } }) };
      if (!paid) return [head, ...r._miss.map((f) => defs[f.key])];
      // «Счёт оплачен»: всегда одни и те же поля; уже заполненные показываем заполненными
      const supplier = { ...defs.supplierName, required: true, wide: true, hint: 'Другой поставщик сохранится в истории позиции вместе с ценой', mount: (fapi) => supplierChips(fapi, r) };
      return [head, { ...defs.invoiceNo, required: true }, { ...defs.invoiceDate, required: true }, defs.priceHint, supplier];
    },
    toInitial: (r) => ({ ...r,
      invoiceNo: r.invoiceNo || '', invoiceDate: String(r.invoiceDate || '').slice(0, 10) || today(),
      priceHint: defaultAmount(r, r._defPrice), supplierName: r.supplierName || '' }),
    toBody: (v, r) => {
      if (r.invoiceId) throw new Error('Откройте счёт для изменения');
      if (r._to === 'paid') return { statusLabel: SUPPLY_STATUS.paid.label, invoiceNo: String(v.invoiceNo ?? ''), invoiceDate: String(v.invoiceDate ?? ''), priceHint: v.priceHint, supplierName: String(v.supplierName ?? '') };
      const body = r._to === 'ordered' ? { _order: true } : { statusLabel: SUPPLY_STATUS[r._to].label };
      for (const f of r._miss) body[f.key] = f.key === 'qty' ? v[f.key] : String(v[f.key] ?? '');
      return body;
    },
    update: async (id, body) => {
      let saved;
      if (body._inv) throw new Error('Оплата и правка доступны только в панели счёта');
      if (body._order) {
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

/** Краткий router-only блок. Никаких финансовых полей, оплаты или немедленного PATCH. */
export function invoiceBlock(r) {
  const route = current();
  const href = '#' + (route.section || 'requests') + '?' + new URLSearchParams(Object.entries({ ...route.params, of: 'invoicecard', open: r.invoiceId, new: undefined, fill: undefined }).filter(([, value]) => value !== undefined && value !== '')).toString();
  return section({ title: 'Счёт поставщика', open: true, body: [
    h('a', { class: 'link-btn', href }, r.invoiceNo ? 'Счёт № ' + r.invoiceNo : 'Счёт без номера'),
    h('p', { class: 'hint' }, [r.invoiceDate ? date(r.invoiceDate) : '', r.supplierName].filter(Boolean).join(' · ')),
    h('p', { class: 'hint' }, 'Все позиции, реквизиты и разрешённые действия — в единой панели счёта.'),
  ] });
}
