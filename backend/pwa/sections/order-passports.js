import { api, apiFile, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDlg } from '../ui/dialog.js';
import { canEdit } from './passports/common.js';

/**
 * ПНЗ.2: «Паспорта на весь заказ». Черновики по всем позициям с изделием (кроме отменённых и тех, у кого паспорт уже есть),
 * затем «⇩ PDF пакетом» по заказу. Сервер: POST /passports (по одному — как «Выпустить» из позиции), GET /passports?salesOrderId,
 * GET /passports/zip?salesOrderId (в архив идут только выпущенные).
 */
const live = (p) => p.status !== 'annulled';

/** Позиции заказа, которым можно создать черновик: есть изделие, не отменена, паспорта ещё нет. */
export function missingLines(order, existing) {
  const have = new Set((existing || []).filter(live).map((p) => String(p.incomeId || '')).filter(Boolean));
  return (order.lines || []).filter((l) => l.productId && !l.cancelledAt && !have.has(String(l.id)));
}

/** Блок с кнопками; onChange — перерисовать строку «Паспорта N». */
export function orderPassportActions(order, existing, onChange) {
  if (!canEdit() || !session.canEdit) return null;
  const todo = missingLines(order, existing);
  const btnAll = h('button', { type: 'button', class: 'btn btn-sm', title: 'Черновики по всем позициям заказа, где выбрано изделие' }, '+ Паспорта на весь заказ');
  const btnZip = h('button', { type: 'button', class: 'btn btn-sm', title: 'Все выпущенные паспорта этого заказа — PDF в одном архиве' }, '⇩ PDF пакетом');
  const hint = h('p', { class: 'muted small' });
  if (!todo.length) { btnAll.disabled = true; hint.textContent = (order.lines || []).some((l) => l.productId) ? 'Паспорта на все позиции уже есть.' : 'У позиций не выбрано изделие.'; }

  btnAll.addEventListener('click', async () => {
    if (!(await confirmDlg('Паспорта на весь заказ', `Создать ${todo.length} ${plural(todo.length, 'черновик', 'черновика', 'черновиков')}?`, { okText: 'Создать' }))) return;
    btnAll.classList.add('is-busy'); btnAll.disabled = true;
    hint.textContent = `Создаю ${todo.length} ${plural(todo.length, 'черновик', 'черновика', 'черновиков')}…`;
    try {
      // один запрос: сервер создаёт только недостающие, повтор ничего не дублирует
      const r = await api(`/salesorders/${order.id}/passports/draft-all`, { method: 'POST' });
      toast(`Создано черновиков: ${r.created}${r.skipped ? `, уже были: ${r.skipped}` : ''}`);
    } catch (e) { toastError(e, 'создать черновики паспортов'); }
    btnAll.classList.remove('is-busy'); hint.textContent = '';
    onChange?.();
  });

  btnZip.addEventListener('click', async () => {
    btnZip.classList.add('is-busy'); btnZip.disabled = true;
    const end = toast('Собираю архив — это может занять несколько минут…', { ms: 600000 });
    try { const name = await apiFile('/passports/zip', { query: { salesOrderId: order.id, stamp: 1 }, timeout: 600000, fallback: 'Паспорта.zip' }); toast(`Скачан: ${name}`); }
    catch (e) { toastError(e, 'собрать архив паспортов'); } finally { end(); btnZip.classList.remove('is-busy'); btnZip.disabled = false; }
  });
  return h('div', {}, h('div', { class: 'actions' }, btnAll, btnZip), hint,
    h('p', { class: 'hint' }, 'В архив попадают только выпущенные паспорта. Черновики сначала доведите и выпустите.'));
}
