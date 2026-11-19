import { api, session } from '../../core/api.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { toast } from '../../ui/kit/toast.js';
import { statusOf } from './common.js';
import { chooseStandaloneFirm, createBookDraft } from './create-book-draft.js';
import { variantName } from './book-template.js';

const pending = new Map();
const scopeOf = ({ productId }, position) => 'dc-passport-issue:' + JSON.stringify([session.user?.id, productId, position?.incomeId]);
function pendingAt(scope) {
  if (pending.has(scope)) return pending.get(scope);
  try { return JSON.parse(sessionStorage.getItem(scope) || 'null'); } catch { return null; }
}
function savePending(scope, work) {
  if (work) pending.set(scope, work);
  else pending.delete(scope);
  try {
    if (work) sessionStorage.setItem(scope, JSON.stringify(work));
    else sessionStorage.removeItem(scope);
  } catch { /* В приватном режиме повтор поддерживается в пределах вкладки до перезагрузки. */ }
}
export const pendingBookIssue = (template, position) => pendingAt(scopeOf(template, position));
export const forgetBookIssue = (template, position) => savePending(scopeOf(template, position), null);

export function issueBookInstance(row) {
  return api(`/passports/${row.id}/issue`, {
    method: 'POST',
    ...(row.presentationVersion === 1 ? { body: { presentationVersion: 1, variant: row.variant } } : {}),
  });
}

/** При неопределённом результате повтор использует тот же ключ и, если уже известен, тот же id. */
export async function issueBookTemplate(template, position, isCurrent) {
  const scope = scopeOf(template, position);
  let work = pendingAt(scope);
  if (work?.complete) return work.row;
  if (work && work.body.variant !== template.variant) {
    throw new Error(`Начат выпуск варианта «${variantName(work.body.variant)}». Выберите этот вариант, чтобы продолжить.`);
  }
  if (!work) {
    const body = { presentationVersion: 1, variant: template.variant, productId: template.productId };
    if (position) {
      if (!position.salesOrderId || !position.incomeId) throw new Error('Не определены заказ и позиция.');
      if (!(await confirmDlg('Выпустить паспорт позиции?', 'Паспорт получит номер для этой позиции заказа.', { okText: 'Выпустить' }))) return null;
      Object.assign(body, { salesOrderId: position.salesOrderId, incomeId: position.incomeId });
      if (position.supplierOrgId) body.supplierOrgId = position.supplierOrgId;
    } else {
      const supplierOrgId = await chooseStandaloneFirm();
      if (!supplierOrgId) return null;
      Object.assign(body, { supplierOrgId, creationKey: crypto.randomUUID() });
    }
    if (!isCurrent()) return null;
    work = { body, row: null };
    savePending(scope, work);
  }
  if (!work.row) {
    try {
      const row = await createBookDraft(work.body, isCurrent, (supplierOrgId) => {
        work.body = { ...work.body, supplierOrgId };
        savePending(scope, work);
      });
      if (!row) { savePending(scope, null); return null; }
      if (!row.id) throw new Error('Сервер не вернул идентификатор паспорта. Повторите выпуск.');
      work.row = { id: row.id, presentationVersion: row.presentationVersion, variant: row.variant,
        status: statusOf(row), passportNumber: row.passportNumber };
      savePending(scope, work);
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) savePending(scope, null);
      throw e;
    }
  }
  const { row } = work;
  if (statusOf(row) === 'issued' || row.presentationVersion !== 1 || row.variant !== work.body.variant) {
    savePending(scope, { ...work, complete: true });
    const message = statusOf(row) === 'issued' ? 'Открыт выпущенный паспорт этой позиции.'
      : row.presentationVersion === 1 ? `Открыт существующий черновик. Вариант — «${variantName(row.variant)}».`
      : 'Открыт паспорт старого образца этой позиции.';
    toast(message);
    return row;
  }
  const issued = await issueBookInstance(row);
  savePending(scope, { ...work, complete: true, row: { ...row, status: 'issued', passportNumber: issued.passportNumber } });
  toast(`Выпущен паспорт № ${issued.passportNumber}`);
  return issued;
}
