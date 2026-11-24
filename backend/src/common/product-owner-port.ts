/**
 * Вход к записи изделий для витрины: импорт `modules/product` замыкает цикл
 * (product → category → showcase через коды паспорта в DTO группы).
 * Тела операций — `modules/product/product-writes.ts`. Сессию и свою базу передаёт вызывающий.
 */
export {
  archiveShowcaseProduct,
  assignShowcaseSku,
  commitBulkProductRow,
  commitPassportTemplate,
  insertProductCopy,
  insertShowcaseProduct,
  patchShowcaseProduct,
  replacePassportDefaults,
  replaceProductComposition,
  restoreBulkProduct,
  restoreShowcaseProduct,
  setDefaultsFromPassport,
  setShowcaseFacetElements,
} from '../modules/product/product-writes';
