/**
 * Вход к записи заявок для модулей, которым нельзя импортировать `modules/supply`
 * (цикл: supply → dicts и supply → partners; incomes → supply → dicts → incomes).
 * Тела операций — `modules/supply/supply-writes.ts`. Сессию и свою базу передаёт вызывающий.
 */
export {
  moveSupplyRequestsToOrder,
  reassignSupplyCategory,
  reassignSupplySupplier,
  reassignSupplyUnit,
  renameSupplyColor,
  renameSupplyLabel,
  renameSupplyOrderLabel,
  renameSupplyRequestedBy,
} from '../modules/supply/supply-writes';
