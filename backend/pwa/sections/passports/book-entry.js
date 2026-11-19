import { session } from '../../core/api.js';
import { current, patch } from '../../core/router.js';
import { toast } from '../../ui/kit/toast.js';
import { openBookForProduct } from './open-book.js';

let openingFor = null;
/** Общая ссылка на шаблон. Старый bookFor ведёт сюда же. */
export async function openProductBookLink(productId) {
  const isCurrent = () => {
    const { section, params } = current();
    return section === 'products' && (params.templateFor || params.bookFor) === productId;
  };
  if (!isCurrent() || openingFor?.productId === productId) return;
  const entry = { productId };
  openingFor = entry;
  const clear = () => {
    if (openingFor !== entry) return;
    openingFor = null;
    if (isCurrent()) patch({ templateFor: undefined, bookFor: undefined });
  };
  if (!session.canEdit || !(session.sees('products') || session.seesDocs())) {
    toast('Для шаблона нужны права на работу с продукцией или паспортами.', { error: true });
    clear();
    return;
  }
  try {
    const onClose = (_row, changed) => {
      clear();
      if (changed) window.dispatchEvent(new Event('data-changed'));
    };
    if (!(await openBookForProduct(productId, { onClose, isCurrent }))) clear();
  } catch {
    clear();
  }
}
