/**
 * Вход к записи доходов для модулей, которым нельзя импортировать `modules/incomes`
 * (цикл: partners ← customer-names, showcase ← order-product-name, product-requests ← IncomesModule).
 * Тела операций — `modules/incomes/income-writes.ts`. Сессию и свою базу передаёт вызывающий.
 */
export {
  attachIncomeNewProductRequest,
  bindDraftProduct,
  confirmRequestLines,
  matchIncomeLine,
  renameCustomerLines,
  setIncomePassportSelection,
} from '../modules/incomes/income-writes';
