/**
 * Вход к записи материалов для модуля `material`: прямой импорт `modules/stock`
 * замыкает пару (stock уже берёт схему материала).
 * Тела операций — `modules/stock/stock-writes.ts`. Модель и сессию передаёт вызывающий.
 */
export {
  archiveMaterial,
  attachMaterialPhoto,
  insertMaterial,
  insertPdmMaterials,
  patchMaterial,
  patchPdmMaterial,
  patchPdmMaterialAliases,
  restorePdmMaterial,
  saveMaterialComposition,
  setMaterialPassportSpec,
  touchMaterialLastPrice,
} from '../modules/stock/stock-writes';
