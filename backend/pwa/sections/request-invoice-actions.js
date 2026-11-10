import { session } from '../core/api.js';
import { money } from '../core/format.js';
import { patch } from '../core/router.js';
import { supplyKey } from '../ui/kit/badges.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { toast } from '../ui/kit/toast.js';
import { getInvoice, writeInvoice } from './invoice-workspace-api.js';

/** Кнопки счёта на карточке группы доски «Заявки» (C067): оплата всего счёта, открыть счёт, принять. */
/** Оплата счёта с карточки группы: черновик сначала выставляем, потом оплачиваем. true — доска перечитается. */
async function payInvoiceGroup(rs) {
  const id = rs[0].invoiceId;
  let inv = await getInvoice(id);
  const no = inv.no ? '№ ' + inv.no : 'без номера';
  const draft = inv.status === 'draft';
  const text = [session.canMoney && inv.amount ? 'Сумма ' + money(inv.amount) + '.' : '', draft ? 'Счёт будет выставлен и сразу отмечен оплаченным.' : ''].filter(Boolean).join(' ');
  if (!(await confirmDlg(`Отметить счёт ${no} оплаченным?`, text, { okText: 'Счёт оплачен' }))) return false;
  try {
    if (draft) { await writeInvoice(inv, session, 'issue'); inv = await getInvoice(id); }
    await writeInvoice(inv, session, 'pay');
    toast(`Счёт ${no} оплачен`);
    return true;
  } catch (e) {
    if (await confirmDlg('Счёт не оплачен', String(e?.message || e) + ' Откройте счёт, заполните недостающее и нажмите «Счёт оплачен».', { okText: 'Открыть счёт' })) patch({ of: 'invoicecard', open: id, new: undefined });
    return !draft; // мог успеть выставиться — доску стоит перечитать
  }
}
/** Кнопки счёта на карточке группы доски (по этапу позиций группы). Позиции без счёта — без кнопок. */
export function invoiceActions(rs) {
  const id = rs[0]?.invoiceId;
  if (!id || !session.canEdit) return [];
  const keys = rs.map(supplyKey);
  const open = () => { patch({ of: 'invoicecard', open: id, new: undefined }); };
  const list = [];
  if (keys.includes('ordered') && session.canMoney) list.push({ label: 'Счёт оплачен', kind: 'primary', title: 'Отметить весь счёт оплаченным', run: () => payInvoiceGroup(rs) });
  if (keys.includes('paid')) list.push({ label: 'Принять', kind: list.length ? 'secondary' : 'primary', title: 'Открыть счёт и принять позиции на склад', run: open });
  list.push({ label: 'Открыть счёт', kind: 'ghost', title: 'Все позиции и реквизиты счёта', run: open });
  return list;
}
