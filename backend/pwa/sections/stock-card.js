import { api } from '../core/api.js';
import { stockPositionCode, stockPositionName } from '../core/stock-display.js';
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { busyBtn, busyBlock, failBlock } from '../ui/kit/busy.js';
import { STOCK_STATUS } from '../ui/kit/badges.js';
import { toastError } from '../ui/kit/toast.js';
import { targetNote } from '../ui/kit/target-picker.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { section, stack, button as kitButton, badge, row, hint } from '../ui/kit/index.js';
import { metalView, offcutDialog } from './metal.js';
import { orderedBlock, orderItem } from './item-orders.js';
import { passportSpecView } from './stock-passport.js';
import { qrPrintAction } from './qr.js';
import { openStockOp } from './stock-ops.js';

/** Карточка позиции склада (C118 W7): шаблон «Карточка объекта» + последние движения. */
const unit = (r) => r.unit || '';
const HIST = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', count: 'Пересчёт', transfer: 'Перемещение', reserve: 'Бронь', unreserve: 'Снятие брони' };
const NEG = ' neg';
const negCls = (m) => (m.type === 'out' ? NEG : '');
/** Последние 5 записей истории позиции (GET /stock/items/:id/history?limit=5) и «Вся история» — без ограничения. */
function recentMoves(r) {
  const list = stack(busyBlock('История движений')); const more = h('div', { class: 'actions' }); const box = h('div');
  const paint = (count) => box.replaceChildren(section({ tone: 'gold', title: 'Последние записи', count, open: box.querySelector('details.k-sec')?.open ?? true, body: [list, more] })); paint(null);
  const show = (res, full) => {
    paint(res.total ?? res.items.length); if (!res.items.length) { list.replaceChildren(hint('Движений нет. Приход и списание — кнопки в карточке позиции.')); more.replaceChildren(); return; }
    list.replaceChildren(...res.items.map((m) => { const target = targetNote(m); return row({ lead: date(m.date), title: HIST[m.type] || m.type,
      side: h('span', { class: 'num' + negCls(m) }, (m.type === 'in' ? '+' : m.type === 'out' ? '−' : '') + qty(m.qty)),
      below: target || m.note ? h('span', null, target, target && m.note ? ' · ' : null, m.note || null) : null }); }));
    more.replaceChildren(...[
      !full && res.total > res.items.length ? kitButton({ label: `Вся история (${res.total})`, kind: 'ghost', size: 'S', onClick: async (e) => {
        const free = busyBtn(e.currentTarget, null);
        try { show(await api(`/stock/items/${r.id}/history`), true); } catch (err) { free(); toastError(err, 'загрузить историю'); }
      } }) : null,
      h('a', { class: 'btn btn-ghost btn-sm', href: '#movements?materialId=' + r.id, title: 'Журнал движений позиции — там можно отменить ошибочное' }, 'Журнал движений →')].filter(Boolean));
  };
  const loadHist = () => api(`/stock/items/${r.id}/history`, { query: { limit: 5 } }).then((res) => show(res, false)).catch((e) => list.replaceChildren(failBlock(e, loadHist, { text: 'История не загрузилась' })));
  loadHist();
  return box;
}

// шапка → «Что дальше» (одна главная кнопка по смыслу) → сведения → вкладки; остальные действия — в «⋯»
export const stockCard = {
    ...screenCard({
      title: stockPositionName,
      sub: (r) => [r.categoryName, stockPositionCode(r)].filter(Boolean).join(' · '),
      stage: (r) => badge(STOCK_STATUS, r.status),
      warns: (r) => [r.hangingQty > 0 && { tone: 'warn', title: `Висит в брони: ${qty(r.hangingQty)} ${unit(r)}`, sub: 'Заказ уже отгружен, закрыт или аннулирован, а материал всё ещё в брони.', label: 'Снять бронь', run: () => { openStockOp('unreserve', r.id); } }],
      next: (r) => {
        const open = (kind) => ({ run: async () => { openStockOp(kind, r.id); } });
        if (r.reservedQty > 0) return { text: `В брони ${qty(r.reservedQty)} ${unit(r)} — можно выдать под заказ.`, primary: { label: 'Выдать из брони', title: 'Количество и объект — из брони', ...open('fromres') } };
        if (r.status === 'none' || r.status === 'low') return { tone: 'warn', text: r.status === 'none' ? 'Закончилось — примите поставку или закажите.' : 'Ниже минимума — пора принять поставку или заказать.', primary: { label: '+ Принять', title: 'Поступление на склад', ...open('in') } };
        return { text: 'Хватает. Нужно выдать — «− Выдать»; поступило — «+ Принять» в «⋯».', primary: { label: '− Выдать', title: 'Кому и под что выдано — в правой панели', ...open('out') } };
      },
      facts: (r) => [
        ['Остаток', `${qty(r.quantity)} ${unit(r)}`],
        ['Свободно', `${qty(r.free)} ${unit(r)}`],
        ['В брони', r.reservedQty ? `${qty(r.reservedQty)} ${unit(r)}` : ''],
        ['Мин. остаток', r.minQuantity ? `${qty(r.minQuantity)} ${unit(r)}` : ''],
        ['Пересчитано', r.lastCountedAt ? date(r.lastCountedAt) : 'ещё не пересчитывали'],
      ],
      more: (r) => [
        ['Короткое название', r.name],
        ['Длинное (документы)', r.fullName && r.fullName !== r.name ? r.fullName : null], // совпадает с коротким — не повторяем
        ['В счёте', r.invoiceName && r.invoiceName !== r.name ? r.invoiceName : null],
        ['Категория', r.categoryName],
        ...metalView(r).filter(Boolean),
        ['Ед. изм.', r.unit],
        // АР.1: артикул поставщика и внутренний код — раздельно; СКЛ-… — не артикул
        ['Артикул (поставщика)', r.supplierArticle && r.supplierArticle !== r.pdmCode ? h('span', null, r.supplierArticle, r.articleSource ? h('span', { class: 'muted' }, ` · из: ${r.articleSource}`) : null) : h('span', { class: 'muted' }, 'нет — впишите из счёта или заявки')],
        ['Код PDM', r.pdmCode],
        ['Внутр. код', r.internalCode ? h('span', { class: 'muted' }, r.internalCode) : ''],
        ['Вес 1 шт.', r.weightG ? `${qty(r.weightG)} г` : ''],
        ['Примечание', r.notes],
      ],
      // все действия — в правой панели «Склад» (SK-9): закрыли панель — вернулись к этой позиции
      menu: (r) => { const lowNone = r.status === 'none' || r.status === 'low'; const inMain = !(r.reservedQty > 0) && lowNone; const outMain = !(r.reservedQty > 0) && !lowNone; return [
        { label: 'Изменить', title: 'Правка полей позиции', run: (row, ctx) => ctx.edit() },
        !inMain && { label: '+ Принять', title: 'Поступление на склад', run: (row) => { openStockOp('in', row.id); return false; } },
        !outMain && { label: '− Выдать', title: 'Кому и под что выдано — в правой панели', run: (row) => { openStockOp('out', row.id); return false; } },
        { label: 'Списать (брак, потеря)', title: 'Причина из списка', run: (row) => { openStockOp('writeoff', row.id); return false; } },
        { label: 'Забронировать под заказ', run: (row) => { openStockOp('reserve', row.id); return false; } },
        r.reservedQty > 0 && { label: 'Снять бронь', run: (row) => { openStockOp('unreserve', row.id); return false; } },
        { label: 'Пересчитать (сколько лежит)', run: (row) => { openStockOp('count', row.id); return false; } },
        r.metal && !r.offcutOf && { label: 'Отложить обрезок…', run: (row, ctx) => offcutDialog(row, ctx) },
        { label: 'Заказать (новая заявка)', run: (row) => orderItem(row) },
        qrPrintAction('S'),
      ]; },
      // C119 шаг 3: без вкладок — последние движения сразу под шапкой, «Заказано» и «Для паспорта» — блоками ниже
      body: (r) => stack(recentMoves(r), orderedBlock(r), passportSpecView(r)),
    }),
    editable: () => false, // «Изменить» — в «⋯»: внизу панели главная — в «Что дальше»
    gallery: (r) => r.photos || [],
    photoMain: (r, photoId) => api(`/stock/items/${r.id}/photos/${photoId}/main`, { method: 'PUT' }),
    // СКФ.5: фото в карточке — только просмотр; добавить / убрать — в «Изменить» (раньше было в двух местах)
};
