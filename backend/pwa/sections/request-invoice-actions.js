import { session } from '../core/api.js';
import { patch } from '../core/router.js';
import { supplyKey } from '../ui/kit/badges.js';
import { requestInvoiceOperation } from './invoice-workspace-state.js';

/** Любой вход оплаты ведёт в единую правую форму; переход сам деньги не записывает. */
export function invoiceActions(rs) {
  const id = rs[0]?.invoiceId;
  if (!id || !session.canEdit) return [];
  const keys = rs.map(supplyKey);
  const open = () => { patch({ of: 'invoicecard', open: id, new: undefined }); };
  const pending = rs.some(r => r.invoiceRequiresPaymentDate || r.invoicePaymentState === 'date_required');
  const list = [];
  if ((pending || keys.includes('ordered')) && session.canMoney) list.push({ label: pending ? 'Заполнить дату' : 'Добавить оплату', kind: 'primary', title: pending ? 'Заполнить фактическую дату подтверждённой оплаты' : 'Внести фактическую дату и сумму', run: () => { requestInvoiceOperation(id, 'payment'); open(); return false; } });
  if (keys.includes('paid')) list.push({ label: 'Принять', kind: list.length ? 'secondary' : 'primary', title: 'Открыть счёт и принять позиции на склад', run: open });
  list.push({ label: 'Открыть счёт', kind: 'ghost', title: 'Все позиции и реквизиты счёта', run: open });
  return list;
}
