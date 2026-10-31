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
  supplierName: 'Поставщик', supplier: 'Поставщик', categoryName: 'Категория', requestedBy: 'Кто подал', customer: 'Заказчик', orderNo: '№ договора', productionNo: '№ заказа',
  statusLabel: 'Статус', priority: 'Приоритет', article: 'Артикул', internalArticle: 'Внутр. код', articleSource: 'Артикул — откуда', quantity: 'Остаток', reservedQty: 'В брони', minQuantity: 'Мин. остаток', article: 'Артикул', inn: 'ИНН', kpp: 'КПП', phone: 'Телефон', email: 'Почта',
  website: 'Сайт', legalAddress: 'Адрес', contactName: 'Контакт', costCenter: 'Направление', deletedAt: 'Удалено', companyName: 'Компания',
};
const ACT = { created: 'Создано', updated: 'Изменено', deleted: 'Удалено', restored: 'Восстановлено', merged: 'Объединено', cancelled: 'Отменено', received: 'Оприходовано',
  cleaned: 'Чистка артикулов', added: 'Добавлено фото', removed: 'Убрано', batch: 'Операция склада', imported: 'Загружено', issued: 'Выдано по брони', list: 'Бронь по списку', moved: 'Движение', released: 'Бронь снята' };
/** «supply.request.updated» → «Изменено». */
export const actionLabel = (a) => ACT[String(a || '').split('.').pop()] || String(a || '');

/** Значения служебных полей: на экране только русские слова. */
const CODE_FIELD = /^(status|stage|state|kind|priority|statusLabel)$/;
const CODE = {
  draft: 'Черновик', active: 'Действует', archived: 'Архив', new: 'Новый', production: 'Производство', ready: 'Готов к отгрузке',
  partly: 'Частично отгружен', shipped: 'Отгружен', closed: 'Закрыт', cancelled: 'Отменён', queue: 'Очередь', work: 'В работе',
  paused: 'Приостановлено', done: 'Завершено', awaiting: 'Ждёт оплаты', partial: 'Частично', paid: 'Оплачено', issued: 'Выставлен',
  pending: 'Ожидает', ordered: 'Заказано', received: 'Получено', rejected: 'Отклонено', approved: 'Согласовано',
  normal: 'Обычный', high: 'Высокий', urgent: 'Срочный', low: 'Низкий',
};

const show = (v, field) => {
  if (v === null || v === undefined || v === '') return '—';
  if (CODE_FIELD.test(field || '') && typeof v === 'string' && /^[a-z_]+$/.test(v)) return CODE[v] || 'другое значение';
  if (v === true) return 'да';
  if (v === false) return 'нет';
  if (typeof v === 'number') return v.toLocaleString('ru-RU');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return date(v);
  return String(v);
};

/** Список изменений одной записи журнала; first — первое известное состояние (без «было»). */
export function changeList(changes, names = {}, first = false) {
  if (!changes?.length) return null;
  const label = (k) => names[k] || FIELD[k] || (/^[a-z]/i.test(k) ? 'Другое поле' : k);
  const max = 8;
  return h('ul', { class: 'changes' }, ...changes.slice(0, max).map((c) => h('li', null, h('span', { class: 'muted' }, label(c.field) + ': '),
    first ? h('b', null, show(c.to, c.field)) : [h('s', { class: 'muted' }, show(c.from, c.field)), ' → ', h('b', null, show(c.to, c.field))])),
    changes.length > max ? h('li', { class: 'muted' }, `…и ещё ${changes.length - max}`) : null);
}
