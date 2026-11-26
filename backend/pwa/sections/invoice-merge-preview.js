import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { mergeInvoiceWithPreview } from '../core/invoice-merge.js';
import { badge, enhanceSelect, failBlock, INVOICE_STATUS, modal, row, section, select } from '../ui/kit/index.js';

const heading = (r) => (r.num ? `№${r.num} · ` : '') + (r.title || r.materialName || '—');
const MERGE_LABELS = { append: 'Добавить все позиции', mergeSameRequest: 'Добавить без дублей', replaceLines: 'Заменить позиции целевого счёта' };
/** Только подтверждение: POST выполняется после закрытия окна, не в обработчике submit. */
function confirmInvoiceMerge(preview) {
  const strategy = enhanceSelect(select({ label: 'Способ объединения', value: 'append',
    options: preview.strategies.filter((k) => preview.plans[k]).map((k) => [k, MERGE_LABELS[k]]),
  }));
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
      h('p', { class: 'hint' }, 'Объединение перенесёт сохранённые позиции. Введённые в форме изменения реквизитов не попадут в целевой счёт.'),
      invoice('Источник — этот счёт', preview.source), invoice('Цель — существующий счёт', preview.target),
      h('label', { class: 'field' }, h('span', null, 'Способ объединения'), strategy), plan,
      preview.duplicates > 0 && !preview.strategies.includes('mergeSameRequest')
        ? h('p', { class: 'hint' }, 'Вариант «Добавить без дублей» переносит одинаковые заявки в корзину. Его может выбрать администратор.') : null,
      h('p', { class: 'hint' }, 'После подтверждения исходный счёт будет объединён с целевым и убран в корзину. Оплаченные счета и счета с приёмкой сервер объединить не разрешает. «Отмена» ничего не меняет.')),
    onOk: () => strategy.value,
  });
}

export async function previewInvoiceMerge(sourceId, targetId) {
  return mergeInvoiceWithPreview(api, sourceId, targetId, { confirm: confirmInvoiceMerge, canMoney: session.canMoney,
    retry: (e, sent) => modal({ title: sent ? 'Объединение не подтверждено' : 'Предпросмотр не загрузился', okText: 'Обновить предпросмотр',
      body: h('div', null, failBlock(e, null, { text: sent ? 'Не удалось подтвердить объединение' : 'Не удалось загрузить предпросмотр' }),
        h('p', { class: 'hint' }, sent ? 'При потере связи результат неизвестен. Повтор только перечитает счета; объединение потребует нового подтверждения.' : 'Повтор только загрузит данные. До вашего подтверждения позиции не изменятся.')),
    }),
  });
}
