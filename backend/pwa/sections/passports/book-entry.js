import { session } from '../../core/api.js';
import { current, patch } from '../../core/router.js';
import { toast } from '../../ui/kit/toast.js';
import { openBookForProduct } from './open-book.js';

let openingFor = '';
/** Прямая ссылка из Inventor использует общий вход в эталонную книжку. */
export async function openProductBookLink(productId) {
  const isCurrent = () => current().section === 'products' && current().params.bookFor === productId;
  if (!isCurrent() || openingFor === productId) return;
  const clear = () => { openingFor = ''; if (isCurrent()) patch({ bookFor: undefined }); };
  if (!session.canEdit || !session.seesDocs()) {
    toast('Для редактирования паспорта нужны права на работу с документами.', { error: true });
    clear(); return;
  }
  openingFor = productId;
  const row = await openBookForProduct(productId, { onClose: clear, isCurrent, draftOnly: true });
  if (!row) clear();
}
