import { patch } from '../../../core/router.js';

/**
 * Вход в воронку паспорта (C028). Правая панель `of=passfunnel&new=1`:
 *   вход А — «Новый паспорт» (с шага «Категория»); вход Б — «Создать паспорт» в карточке изделия (сразу «Чего не хватает»).
 * Изделие входа Б передаётся через pending (как draft в issuePassport): адрес остаётся коротким.
 */
let pending = null;
/** productId — сразу к изделию. salesOrderId без incomeId — в выпуске спросить позицию. incomeId — позиция уже выбрана. */
export function openPassportFunnel({ productId, salesOrderId, incomeId, orderNo, customerName } = {}) {
  pending = (productId || salesOrderId || incomeId)
    ? { productId: productId ? String(productId) : undefined, salesOrderId: salesOrderId ? String(salesOrderId) : undefined, incomeId: incomeId ? String(incomeId) : undefined, orderNo, customerName, at: Date.now() }
    : null;
  patch({ of: 'passfunnel', new: '1', open: undefined });
}
export function takePending() {
  const p = pending && Date.now() - pending.at < 60000 ? pending : null;
  pending = null;
  return p;
}
