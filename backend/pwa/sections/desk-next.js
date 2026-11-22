import { nextStep as orderNext } from './salesorders-next.js';
import { missingFor, nextStep as requestNext } from './request-step.js';
import { statusOf as passportStatus } from './passports/common.js';

const text = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 160) : '';

/** Детальный ответ заказа хранит позиции в договорах, а не в счётчике доски. */
function orderLines(row) {
  if (Array.isArray(row.lines)) return row.lines.filter((line) => !line.cancelledAt && line.status !== 'cancelled');
  if (!Array.isArray(row.orders) || !row.orders.every((order) => Array.isArray(order.lines))) return null;
  return row.orders.filter((order) => order.stage !== 'cancelled').flatMap(orderLines);
}

function orderHint(row) {
  if (!row.stage || row.archived || row.activeArchiveVersion != null) return '';
  const lines = orderLines(row);
  const lineCount = lines?.length ?? row.lineCount;
  const unassignedCount = lines?.every((line) => typeof line.unassigned === 'boolean')
    ? lines.filter((line) => line.unassigned).length : row.unassignedCount;
  if (row.stage === 'new' && !(lineCount === 0 || unassignedCount > 0 || row.counts?.design > 0)) {
    return 'Проверить позиции и проектирование';
  }
  if (row.stage === 'production' && !(unassignedCount > 0) && !row.counts?.requests && !(row.counts?.inWork ?? row.counts?.work)
    && typeof row.readiness?.ready !== 'boolean') return 'Проверить готовность к отгрузке';
  if (row.stage === 'new' && lineCount == null && !(unassignedCount > 0)) return 'Проверить задачи проектирования';
  return orderNext({ ...row, lineCount: lineCount ?? unassignedCount, unassignedCount }).text;
}

function requestHint(row) {
  const step = requestNext(row);
  if (!step) return '';
  if (row.invoiceRequiresPaymentDate) return 'Указать дату оплаты в счёте';
  if (step.to === 'paid') return row.invoiceId ? 'Проверить оплату в счёте' : 'Проверить счёт и оплату';
  const missing = missingFor(row, step.to).map(({ label }) => label.toLowerCase());
  return missing.length ? 'Уточнить: ' + missing.join(', ') : step.to === 'ordered' ? 'Оформить заказ у поставщика' : step.verb;
}

function designHint(row) {
  if (row.production?.state === 'contract-closed' || row.status === 'cancelled') return '';
  if (row.status === 'paused') return row.assigneeId ? 'Возобновить проектирование' : 'Вернуть на распределение';
  if (row.status === 'queue') return row.assigneeId ? 'Начать проектирование' : 'Назначить проектировщика';
  if (row.status === 'work') return 'Завершить проектирование';
  if (row.status !== 'done') return '';
  if (row.production?.state === 'no-product') return 'Сопоставить позицию с изделием';
  if (row.production?.state === 'ready-for-review') return 'Проверить состав и маршрут в заказе';
  return row.production?.state === 'in-work' ? 'Изготовление запущено' : '';
}

function workHint(row) {
  if (!['waiting', 'work'].includes(row.status)) return '';
  if (row.hold) return text(row.hold.reason) || (row.hold.kind === 'materials' ? 'Не хватает материалов' : 'Работа на паузе');
  if (row.status === 'waiting') return 'Взять в работу';
  if (!Array.isArray(row.route) || !Number.isInteger(row.stepIndex)) return '';
  const next = text(row.route[row.stepIndex + 1]?.name);
  if (next) return 'Далее — ' + next;
  return row.route.length && row.stepIndex >= 0 ? 'Завершить задание' : '';
}

function offerHint(row) {
  if (row.orderId) return 'Открыть связанный договор';
  if (row.status === 'draft') return 'Проверить и отправить КП';
  if (row.status === 'sent') return 'Уточнить решение заказчика';
  if (['accepted', 'paid'].includes(row.status)) return 'Оформить договор и заказ';
  return '';
}

function passportHint(row) {
  const state = passportStatus(row);
  if (state === 'annulled') return '';
  if (row.readiness === 'rework') return 'Доработать паспорт';
  if (state === 'draft') return row.missing?.length ? 'Заполнить данные для выпуска' : 'Проверить данные перед выпуском';
  if (row.readiness === 'notReady') return 'Проверить паспорт';
  return row.passportCategory || row.printFile?.hasFile || row.printSource === 'file' ? 'Можно распечатать паспорт' : '';
}

/** Только пояснение к живой записи. Команды и права остаются в исходной карточке. */
export function deskNext(of, row) {
  if (!row || row.deletedAt) return '';
  switch (of) {
    case 'salesorders':
    case 'salesorder': return orderHint(row);
    case 'requests': return requestHint(row);
    case 'design': return designHint(row);
    case 'work': return workHint(row);
    case 'offers': return offerHint(row);
    case 'passarchive':
    case 'passports': return passportHint(row);
    default: return '';
  }
}
