import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { SUPPLY_STATUS, supplyKey } from '../ui/badges.js';
import { attachCombo } from '../ui/combo.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { lookups, unitList } from './lookups.js';

/**
 * Заявки: «ворота» этапов и шаг воронки (REQUESTS-FUNNEL, шаг 1 — только приложение).
 * Одна таблица GATES: что должно быть заполнено, чтобы заявка перешла на этап. Сервер пока не проверяет
 * (шаг 2) — приложение не меняет статус, а открывает правую панель только с недостающими полями.
 */
const text = (v) => !!String(v ?? '').trim();
export const GATES = [
  { to: 'ordered', fields: [
    { key: 'supplierName', label: 'Поставщик', ok: (r) => text(r.supplierName) },
    { key: 'qty', label: 'Количество', ok: (r) => Number(r.qty) > 0 },
    { key: 'unit', label: 'Единица измерения', ok: (r) => text(r.unit) }] },
  { to: 'paid', fields: [
    { key: 'invoiceNo', label: '№ счёта', ok: (r) => text(r.invoiceNo) },
    { key: 'invoiceDate', label: 'Дата счёта', ok: (r) => text(r.invoiceDate) },
    { key: 'priceHint', label: 'Сумма счёта', ok: (r) => Number(r.priceHint) > 0 }] },
];
const STAGE = { ordered: 0, paid: 1 };

/** Чего не хватает заявке, чтобы встать на этап `to` (учитываются только этапы впереди текущего). */
export function missingFor(r, to) {
  if (!(to in STAGE)) return [];
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
  if (k === 'paid') return { to: 'received', verb: 'Принять', kind: 'receive' };
  return null;
}

let pending = null; // { id, to } — куда ведёт открытая панель (после обновления страницы — следующий этап)
export function openStep(r, to) {
  pending = { id: r.id, to };
  patch({ of: 'reqstep', open: r.id, new: undefined });
}

const fieldDefs = (lk) => ({
  supplierName: { key: 'supplierName', label: 'Поставщик', type: 'combo', options: lk.suppliers, max: 200, required: true },
  qty: { key: 'qty', label: 'Количество', type: 'number', min: 0, required: true, span: 1 },
  unit: { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(lk), max: 30, required: true, span: 1 },
  invoiceNo: { key: 'invoiceNo', label: '№ счёта', max: 100, required: true, span: 1 },
  invoiceDate: { key: 'invoiceDate', label: 'Дата счёта', type: 'date', required: true, span: 1 },
  priceHint: { key: 'priceHint', money: true, label: 'Сумма счёта, ₽', type: 'money', min: 0, required: true },
});
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
    return { ...r, _to: to, _miss: missingFor(r, to) };
  },
  card: {
    heading,
    subheading: (r) => (r._to ? `Следующий шаг: «${verbOf(r._to)}»` : ''),
    noHistory: true,
    startEdit: (r) => r._miss.length > 0,
    view: () => [],
    extra: (r, ctx) => h('div', null,
      h('p', { class: 'hint' }, r._miss.length ? 'Заполните поля и нажмите «Сохранить и перевести».' : 'Всё заполнено — можно переводить.'),
      r._miss.length || !r._to ? null : h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[r._to].label } });
        toast(`${heading(r)} → ${SUPPLY_STATUS[r._to].label}`); ctx.changed(); ctx.close();
      } }, verbOf(r._to))),
  },
  form: {
    saveLabel: 'Сохранить и перевести',
    fields: async (r) => {
      const defs = fieldDefs(await lookups());
      const miss = r._miss;
      const note = h('div', { class: 'fill-note' }, h('b', null, `Следующий шаг: «${verbOf(r._to)}»`),
        h('div', null, `Чтобы перевести заявку в «${SUPPLY_STATUS[r._to].label}», нужно: ${miss.map((f) => f.label.toLowerCase()).join(', ')}.`));
      return [
        { key: '_next', type: 'widget', label: '', wide: true, widget: () => ({ el: note, get value() { return ''; }, set value(_) { /* только показ */ } }) },
        ...miss.map((f) => defs[f.key]),
      ];
    },
    toInitial: (r) => ({ ...r, priceHint: r.priceHint ?? null, invoiceDate: r.invoiceDate ? String(r.invoiceDate).slice(0, 10) : '' }),
    toBody: (v, r) => {
      const body = { statusLabel: SUPPLY_STATUS[r._to].label };
      for (const f of r._miss) body[f.key] = f.key === 'qty' || f.key === 'priceHint' ? v[f.key] : String(v[f.key] ?? '');
      return body;
    },
    update: async (id, body) => {
      const saved = await api(`/supply/requests/${id}`, { method: 'PATCH', body });
      lookups.reset();
      toast(`Заявка → ${SUPPLY_STATUS[supplyKey(saved)]?.label || ''}`);
      setTimeout(() => patch({ of: undefined, open: undefined }), 0); // форма уже сброшена — панель закрывается без вопроса
      return saved;
    },
  },
};

/** Перевести заявку на этап: хватает данных — меняем статус (true), нет — открываем панель (false). */
export async function advance(r, to, patchStatus) {
  if (missingFor(r, to).length) { openStep(r, to); return false; }
  await patchStatus(r, to);
  return true;
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
  let done = 0; const skipped = [];
  for (const r of rows) {
    const x = { ...r, supplierName: supplier };
    if (missingFor(x, 'ordered').length) { skipped.push(heading(r)); continue; }
    await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { supplierName: supplier, statusLabel: SUPPLY_STATUS.ordered.label } });
    done++;
  }
  lookups.reset();
  toast(`Заказано у «${supplier}»: ${done}` + (skipped.length ? `. Не переведены (нет количества или единицы): ${skipped.length}` : ''), skipped.length ? { error: true } : undefined);
  return done;
}
