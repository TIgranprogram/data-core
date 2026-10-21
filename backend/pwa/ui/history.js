import { h } from '../core/dom.js';
import { date } from '../core/format.js';

/*
 * История изменений (TASKS И.1, И.2): подписи действий и список «Поле: было → стало».
 * Сервер считает изменения сравнением соседних снимков записи (`/audit-logs/record` → changes).
 */
/** Подписи полей, которых нет в форме раздела (служебные / из других экранов). */
const FIELD = {
  title: 'Наименование', name: 'Название', qty: 'Количество', unit: 'Ед.', status: 'Статус', stage: 'Этап', notes: 'Примечание', note: 'Примечание',
  priceHint: 'Сумма', amount: 'Сумма', unitPrice: 'Цена', paid: 'Оплачено', paidDate: 'Дата оплаты', shipDate: 'Отгрузка', invoiceNo: 'Счёт', invoiceDate: 'Дата счёта',
  supplierName: 'Поставщик', supplier: 'Поставщик', categoryName: 'Категория', requestedBy: 'Кто подал', customer: 'Заказчик', orderNo: '№ заказа',
  statusLabel: 'Статус', priority: 'Приоритет', article: 'Артикул', internalArticle: 'Внутр. код', articleSource: 'Артикул — откуда', quantity: 'Остаток', reservedQty: 'В брони', minQuantity: 'Мин. остаток', article: 'Артикул', inn: 'ИНН', kpp: 'КПП', phone: 'Телефон', email: 'Почта',
  website: 'Сайт', legalAddress: 'Адрес', contactName: 'Контакт', costCenter: 'Направление', deletedAt: 'Удалено', companyName: 'Компания',
};
const ACT = { created: 'Создано', updated: 'Изменено', deleted: 'Удалено', restored: 'Восстановлено', merged: 'Объединено', cancelled: 'Отменено', received: 'Оприходовано',
  cleaned: 'Чистка артикулов', added: 'Добавлено фото', removed: 'Убрано', batch: 'Операция склада', imported: 'Загружено', issued: 'Выдано по брони', list: 'Бронь по списку', moved: 'Движение', released: 'Бронь снята' };
/** «supply.request.updated» → «Изменено». */
export const actionLabel = (a) => ACT[String(a || '').split('.').pop()] || String(a || '');

const show = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'да';
  if (v === false) return 'нет';
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return date(v);
  return String(v);
};

/** Список изменений одной записи журнала; first — первое известное состояние (без «было»). */
export function changeList(changes, names = {}, first = false) {
  if (!changes?.length) return null;
  const label = (k) => names[k] || FIELD[k] || k;
  const max = 8;
  return h('ul', { class: 'changes' }, ...changes.slice(0, max).map((c) => h('li', null, h('span', { class: 'muted' }, label(c.field) + ': '),
    first ? h('b', null, show(c.to)) : [h('s', { class: 'muted' }, show(c.from)), ' → ', h('b', null, show(c.to))])),
    changes.length > max ? h('li', { class: 'muted' }, `…и ещё ${changes.length - max}`) : null);
}
