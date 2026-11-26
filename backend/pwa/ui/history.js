import { h } from '../core/dom.js';
import { date, dateTime } from '../core/format.js';
import { canEditSection } from '../core/api.js';
import { confirmDlg } from './kit/dialog.js';
import { toast, toastError } from './kit/toast.js';

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
export const actionLabel = (a) => {
  const action = String(a || '');
  if (action.endsWith('.photo.main')) return 'Выбрано главное фото';
  if (action.endsWith('.photo.removed')) return 'Убрано фото';
  return ACT[action.split('.').pop()] || action;
};

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

const isId = (v) => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
const isServiceValue = (v) => isId(v) || (v !== null && typeof v === 'object');

/** Только то, что понятно человеку: поле с русской подписью и значение без служебных кодов. */
export function usefulChanges(changes, names = {}) {
  return (changes || []).filter((c) => (names[c.field] || FIELD[c.field]) && !isServiceValue(c.to) && !isServiceValue(c.from));
}

/** Запись истории нужна: изменение с понятными полями или действие без полей (создано, удалено, восстановлено). */
export function usefulEntry(x, names = {}) {
  return !String(x.action || '').endsWith('updated') || (!x.first && usefulChanges(x.changes, names).length > 0);
}

/** Список изменений одной записи журнала. Первое состояние не показывается: оно и так видно в карточке. */
export function changeList(changes, names = {}, first = false) {
  const list = first ? [] : usefulChanges(changes, names);
  if (!list.length) return null;
  const max = 8;
  return h('ul', { class: 'changes' }, ...list.slice(0, max).map((c) => h('li', null, h('span', { class: 'muted' }, (names[c.field] || FIELD[c.field]) + ': '),
    h('s', { class: 'muted' }, show(c.from, c.field)), ' → ', h('b', null, show(c.to, c.field)))),
    list.length > max ? h('li', { class: 'muted' }, `…и ещё ${list.length - max}`) : null);
}

export function cardHistoryActions(section, record, fields, names, { openForm, canRestore, setSaving, onRestored }) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const restore = section.card.historyRestore;
  const restoreField = async (change, name) => {
    if (!canRestore() || !canEditSection(section)) return;
    const expected = record[change.field] || null;
    setSaving(true);
    try {
      if (!await confirmDlg('Вернуть прежнее значение?', `${name}\nСейчас: ${expected || 'пусто'}\nБудет: ${change.from || 'пусто'}`, { okText: 'Вернуть' })) return;
      const saved = await restore.update(record.id, { field: change.field, expected, value: change.from });
      await onRestored(saved);
      toast('Значение восстановлено');
    } catch (error) { toastError(error, 'вернуть значение'); }
    finally { setSaving(false); }
  };
  return (entry) => {
    if (entry.first || !canEditSection(section)) return null;
    const changes = entry.changes || [];
    if (restore) {
      return changes.filter((change) => restore.fields.includes(change.field) && names[change.field]
        && (change.from === null || typeof change.from === 'string') && (record[change.field] ?? '') !== (change.from ?? ''))
        .map((change) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => restoreField(change, names[change.field]) },
          `Вернуть поле «${names[change.field]}»`));
    }
    if (section.form?.build) return null;
    const back = changes.filter((change) => byKey.has(change.field) && !['widget', 'photos'].includes(byKey.get(change.field).type));
    if (!back.length) return null;
    return h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Открыть правку с прежними значениями этих полей — проверьте и сохраните', onclick: () => {
      const values = Object.fromEntries(back.map((change) => [change.field, byKey.get(change.field).type === 'date' && change.from ? String(change.from).slice(0, 10) : change.from ?? '']));
      const labels = back.map((change) => names[change.field] || change.field).join(', ');
      openForm({ values, note: `Как было до изменения от ${dateTime(entry.createdAt)}: ${labels}. Проверьте и нажмите «Сохранить».` });
    } }, 'Вернуть как было');
  };
}
