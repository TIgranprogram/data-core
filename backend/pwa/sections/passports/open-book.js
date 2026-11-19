import { toast, toastError } from '../../ui/kit/toast.js';
import { statusOf } from './common.js';
import { openBookEditor } from './book-editor.js';
import { createBookDraft } from './create-book-draft.js';
import { loadBookTemplate, variantName } from './book-template.js';

/** Изделие всегда открывается как общий шаблон. Контекст позиции передаётся только явно. */
export async function openBookForProduct(productId, { variant = 'short', position, onClose, isCurrent = () => true } = {}) {
  if (!productId) { toast('Нет изделия для паспорта', { error: true }); return null; }
  try {
    const template = await loadBookTemplate(productId, variant);
    if (!isCurrent()) return null;
    const opened = await openBookEditor(null, { template, position, onClose, isCurrent });
    return opened === false ? null : template;
  } catch (e) {
    toastError(e, 'открыть шаблон паспорта');
    return null;
  }
}

/** Создать или открыть паспорт именно позиции, по трём согласованным идентификаторам. */
export async function openBookForLine({ productId, salesOrderId, incomeId, supplierOrgId, variant = 'short' }, { onClose, isCurrent = () => true } = {}) {
  if (!productId || !salesOrderId || !incomeId) {
    toast('Для паспорта нужны изделие, заказ и его позиция.', { error: true });
    return null;
  }
  try {
    const row = await createBookDraft({ presentationVersion: 1, variant, productId, salesOrderId, incomeId,
      ...(supplierOrgId ? { supplierOrgId } : {}) }, isCurrent);
    if (!row?.id || !isCurrent()) return null;
    if (statusOf(row) === 'draft' && row.variant !== variant) {
      toast(row.presentationVersion === 1
        ? `У этой позиции уже есть черновик. Вариант — «${variantName(row.variant)}». Изменить его можно в книжке.`
        : 'У этой позиции есть паспорт старого образца.');
    }
    const opened = await openBookEditor(row.id, { onClose, isCurrent });
    return opened === false ? null : row;
  } catch (e) {
    toastError(e, 'открыть паспорт позиции');
    return null;
  }
}
