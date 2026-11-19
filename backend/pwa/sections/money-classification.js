import { incomePreparation } from './money-income-preparation.js';
import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, dateTime, money } from '../core/format.js';
import { buildForm, readonlyGroup, link, section, table, button, failBlock } from '../ui/kit/index.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { loadFinancialArticles, articleChoices, flattenArticles } from './financial-articles.js';
import { orderChoices } from './expenses.js';
import { classificationBody } from './money-operations-state.js';
const base = id => '/finance/operations/' + encodeURIComponent(id);
const get = async id => ({ ...(await api(base(id))), id });
const heading = row => `${row.type === 'income' ? 'Поступление' : 'Выплата'} · ${money(row.amount)}`;
function readonlyFact(row) {
  return readonlyGroup({ rows: [['Фактическая дата', date(row.date)], ['Наша компания', row.companyName], ['Сумма', money(row.amount)], ['Статья', (row.articlePath || []).map(x => typeof x === 'string' ? x : x.name).join(' → ') || 'Без статьи'], ['Объект', row.projectName || row.costObject || 'Не указан'], ['Документ', row.sourceLink ? link({ label: row.docNo || 'Исходный документ', href: row.sourceLink }) : row.docNo || row.source]] });
}
export const moneyClassification = {
  id: 'moneyclassification', title: 'Статья и объект оплаты', entityType: 'FinancialOperation', canEdit: () => session.canMoney,
  get,
  card: { ...screenCard({ title: heading, sub: row => row.companyName || '', noHistory: true, facts: () => [], body: (row, ctx) => [readonlyFact(row),
    row.classificationEditable !== true ? h('p', { class: 'hint' }, row.classificationReason || row.classificationEditableReason || row.reason || 'Для этого источника уточнение пока недоступно. Денежный факт сохранён.') : null,
    section({ title: 'История уточнений', body: table({ label: 'История аналитической классификации', columns: [{ label: 'Когда' }, { label: 'Автор' }, { label: 'Причина', wrap: true }], rows: (row.classificationHistory || row.history || []).map(item => ({ cells: [dateTime(item.at || item.createdAt), item.authorName || item.createdByName || 'Сохранён в истории', item.reason] })), empty: { title: 'Уточнений пока нет' } }) }),
    incomePreparation(row, ctx),
  ] }), startEdit: row => row.classificationEditable === true && session.canMoney, editable: row => row.classificationEditable === true && session.canMoney },
  form: {
    build: async (row, ctx) => {
      if (row.classificationEditable !== true) throw new Error(row.classificationReason || 'Доступен только просмотр');
      const [articles, orders] = await Promise.all([loadFinancialArticles({ type: row.type, refresh: true }), orderChoices('Без аналитического объекта')]);
      const effective = { ...row, ...(row.classificationEffective || row.effective || {}) };
      const original = row.classificationOriginal || row.original || {};
      const names = new Map(flattenArticles(articles.items || []).map(item => [item.id, item.path.join(' → ')]));
      const form = buildForm([
        { section: 'Уточнить для отчёта', fixed: true },
        { note: readonlyFact(row) },
        { note: 'Меняются только аналитические связи. Сумма, дата, плательщик и исходный заказ производства сохраняются. Это не сторно и не возврат денег.' },
        { key: 'action', label: 'Действие', type: 'select', options: [{ value: 'update', label: 'Уточнить классификацию' }, { value: 'reset', label: 'Вернуть исходную классификацию' }], mount: api => { const sync = () => { for (const key of ['articleId', 'salesOrderId', 'costCenter', 'costObject']) api.field(key).hidden = api.get('action') === 'reset'; }; api.on('action', sync); sync(); } },
        { key: 'articleId', label: 'Статья', type: 'select', wide: true, options: articleChoices(articles.items || [], 'Без статьи — снять связь', { type: row.type, savedId: effective.articleId }) },
        { key: 'salesOrderId', label: 'Аналитический объект', type: 'select', wide: true, options: [...orders, ...(effective.salesOrderId && !orders.some(x => x.value === String(effective.salesOrderId)) ? [{ value: String(effective.salesOrderId), label: row.projectName || 'Сохранённый объект' }] : [])] },
        { key: 'costCenter', label: 'Направление затрат', type: 'select', options: [{ value: '', label: 'Не указано — снять связь' }, { value: 'office', label: 'Офис' }, { value: 'workshop', label: 'Цех' }, { value: 'smr', label: 'СМР' }, { value: 'order', label: 'Под заказ' }] },
        { key: 'costObject', label: 'Уточнение объекта', max: 1000, wide: true },
        { note: `Исходная статья: ${names.get(String(original.articleId)) || (original.articleId ? 'Сохранена в исходном документе' : 'Без статьи')}. Возврат к исходному отличается от снятия связи.` },
        { key: 'reason', label: 'Причина уточнения', required: true, type: 'textarea', max: 1000, wide: true },
      ], { action: 'update', articleId: effective.articleId || '', salesOrderId: effective.salesOrderId || '', costCenter: effective.costCenter || '', costObject: effective.costObject || '', reason: '' });
      const uid = globalThis.crypto?.randomUUID?.() || `classify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let submitted, bindSave;
      const notice = h('div');
      const el = h('div', null, form.el, notice);
      return { ...form, el, bindSave: fn => { bindSave = fn; }, read: () => {
        const result = form.read(); if (result.errors) return result;
        try { submitted ||= Object.freeze(classificationBody(row, result.values, uid)); }
        catch (error) { if (!error.field) throw error; form.markErrors([{ key: error.field, message: error.message }]); return { errors: { [error.field]: error.message } }; }
        return { values: { body: submitted } };
      }, onError: error => {
        if (error.status === 400) submitted = undefined;
        else if (submitted) setTimeout(() => form.el.querySelectorAll('input,select,textarea,button').forEach(input => { input.disabled = true; }), 0);
        if (error.status === 409) { bindSave?.(false); notice.replaceChildren(failBlock(error, () => ctx.reload(), { text: 'Классификация изменилась. Ввод сохранён; перечитайте операцию перед новым действием.' }), button({ label: 'Обновить операцию', onClick: () => ctx.reload() })); }
      } };
    },
    toBody: values => values,
    update: async (id, values) => ({ ...(await api(base(id) + '/classification', { noWait: true, method: 'PATCH', body: values.body })), id }),
  },
};
