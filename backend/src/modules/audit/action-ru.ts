/** Русские подписи журнала аудита: «Заявка: изменено». Неизвестное — исходный код. */
const ENTITY_RU: Record<string, string> = {
  Income: 'Позиция заказа', SalesOrder: 'Заказ', SupplyRequest: 'Заявка', Order: 'Заказ покупателя', Material: 'Позиция склада',
  StockMovement: 'Движение склада', Counterparty: 'Контрагент', Partner: 'Партнёр', DictItem: 'Справочник', Product: 'Изделие',
  ProductModule: 'Модуль изделия', ProductPassport: 'Паспорт', PassportTemplate: 'Шаблон паспорта', Photo: 'Фото', User: 'Пользователь',
  Role: 'Роль', Category: 'Категория', Contract: 'Договор', Shipment: 'Отгрузка', Reservation: 'Резерв', SupplyInvoice: 'Счёт поставщика', SupplierContract: 'Договор поставщика',
  SupplierItem: 'Цена поставщика', DesignTask: 'Задача проектирования', DesignOrder: 'Проектный заказ', WorkTask: 'Задание «В работе»', DesignNote: 'Заметка проектирования',
  ProductAlias: 'Соответствие названия изделию', DesignSticker: 'Стикер проектирования', PayrollPayment: 'Выплата', PayrollTimesheet: 'Табель', WorkType: 'Вид работ',
  Organization: 'Организация', Person: 'Сотрудник', Zone: 'Зона ответственности', Proposal: 'Предложение', Unit: 'Единица измерения', Currency: 'Валюта',
};
const VERB_RU: Record<string, string> = {
  created: 'Создано', updated: 'Изменено', deleted: 'Удалено', restored: 'Восстановлено',
  create: 'Создано', update: 'Изменено', delete: 'Удалено', restore: 'Восстановлено',
};

export function actionRu(action: string | undefined | null, entityType?: string | null): string {
  const code = String(action ?? '');
  const verb = VERB_RU[code.split('.').pop() ?? ''];
  if (!verb) return code;
  const ent = entityType ? ENTITY_RU[entityType] : undefined;
  return ent ? `${ent}: ${verb.toLowerCase()}` : verb;
}
