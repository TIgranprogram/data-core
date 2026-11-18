/**
 * C141: единый вход в эталонную книжку паспорта.
 * Старые анкета/форма/карандаши сюда не зовут — только создание черновика при необходимости.
 */
import { api } from '../../core/api.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { openBookEditor } from './book-editor.js';

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** Найти актуальный паспорт изделия (черновик важнее выпущенного). */
export async function findProductPassport(productId) {
  const d = await api('/passports', { query: { productId, limit: 20, sort: '-updatedAt' } });
  const items = (d.items || []).filter((x) => x.status !== 'annulled');
  return items.find((x) => x.status === 'draft')
    || items.find((x) => x.status === 'issued')
    || items[0]
    || null;
}

/**
 * Открыть книжку по изделию: есть паспорт → он; нет → создать черновик и открыть.
 * extra — поля POST /passports (supplierOrgId, salesOrderId, incomeId, …).
 */
export async function openBookForProduct(productId, { extra = {}, onClose, isCurrent = () => true } = {}) {
  if (!productId) { toast('Нет изделия для паспорта', { error: true }); return null; }
  try {
    let row = await findProductPassport(productId);
    if (!isCurrent()) return null;
    if (!row) {
      row = await api('/passports', { method: 'POST', body: clean({ productId, ...extra }) });
      toast('Черновик паспорта создан — допишите в книжке и выпустите.');
    }
    const opened = await openBookEditor(row, { onClose, isCurrent });
    if (opened === false) return null;
    return row;
  } catch (e) {
    toastError(e, 'открыть паспорт');
    return null;
  }
}

/** Открыть книжку по id или объекту паспорта. */
export function openBookForPassport(passport, { onClose } = {}) {
  return openBookEditor(passport, { onClose });
}
