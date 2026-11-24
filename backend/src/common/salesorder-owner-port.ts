/**
 * Вход к записи договоров для модулей, которым нельзя импортировать `modules/salesorders`
 * (цикл: shipments ↔ salesorders через архив файлов; partners → salesorders → incomes → partners).
 * Тела операций — `modules/salesorders/salesorder-writes.ts`. Сессию и свою базу передаёт вызывающий.
 */
export {
  applyShipmentStage,
  renameOrderCustomers,
  renameOrderPaymentForm,
} from '../modules/salesorders/salesorder-writes';
