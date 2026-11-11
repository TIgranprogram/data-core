import { api } from '../../../core/api.js';
import { h } from '../../../core/dom.js';
import { button, enhanceSelect, hint, link, section, select, sideNote, toast, toastError } from '../../../ui/kit/index.js';
import { ourCompanies } from '../common.js';
import { printDialog } from '../dialogs.js';
import { issueFromProduct } from './api.js';

/**
 * Шаг 7 «Выпуск»: номер и дата ставятся сами; «Заполнить после печати» свёрнуто и выпуск не держит;
 * «Выпустить PDF» — главная, когда нет обязательного пустого; пока есть пробелы — второстепенная и выключена.
 * После выпуска открывается окно PDF и печати (то же, что в архиве паспортов).
 * Фирма — список наших компаний; из заказа предвыбор companyId (можно сменить). Без позиции — список позиций.
 *   issueBlock({ prod, order?, goGaps(), onIssued(passport) }) → { el, paint(missingRequired[]) }
 *   order: { salesOrderId?, incomeId?, orderNo?, customerName? } — incomeId уже выбран, список позиций не нужен.
 */
const lineName = (l, i) => `поз. ${l.seqNo ?? l.lineNo ?? i + 1} · ${l.title || l.productName || 'позиция'}`;
const locked = (e) => e?.status === 409;

export function issueBlock({ prod, order, goGaps, onIssued }) {
  const box = h('div', null);
  const needLine = !!(order?.salesOrderId && !order.incomeId);
  let miss = [];
  let listsReady = false;
  let firms = [];
  let lines = [];
  let firmId = '';
  let lineId = order?.incomeId ? String(order.incomeId) : '';
  let orderDoc = null;
  let lineErr = false;
  let mismatch = false;

  function paint(missing = miss) {
    miss = missing;
    if (!listsReady) { box.replaceChildren(hint('Загружаю фирмы…')); return; }
    const gaps = !miss.length;
    const firmOk = !!firmId;
    const lineOk = !needLine || !!lineId;
    const ready = gaps && firmOk && lineOk;
    const why = !firmOk ? 'Выберите фирму' : !lineOk ? 'Выберите позицию заказа' : 'Сначала заполните недостающее';
    const firmOpts = firms.length > 1 ? [['', 'Выберите фирму'], ...firms.map((o) => [o.id, o.name])] : firms.map((o) => [o.id, o.name]);
    const firmSel = firms.length ? select({ label: 'Фирма', value: firmId, options: firmOpts, onChange: (v) => { firmId = v; paint(miss); } }) : null;
    const lineOpts = needLine && lines.length > 1 ? [['', 'Выберите позицию'], ...lines.map((l, i) => [l.id, lineName(l, i)])] : lines.map((l, i) => [l.id, lineName(l, i)]);
    const lineSel = needLine && lines.length ? select({ label: 'Позиция заказа', value: lineId, options: lineOpts, onChange: (v) => { lineId = v; paint(miss); } }) : null;
    const go = button({ label: 'Выпустить PDF', kind: ready ? 'primary' : 'ghost', disabled: !ready, title: ready ? 'Присвоить номер и талон, затем скачать или распечатать' : why,
      onClick: async (e) => {
        const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
        try {
          const res = await issueFromProduct(prod.id, {
            supplierOrgId: firmId,
            incomeId: order?.incomeId || lineId || undefined,
            salesOrderId: order?.salesOrderId,
            orderNo: order?.orderNo || orderDoc?.orderNo,
            customerName: order?.customerName || orderDoc?.customer,
          });
          if (res.missing) { toast('Для выпуска не хватает: ' + res.missing.join(', '), { error: true }); return; }
          toast(`Выпущен паспорт № ${res.passport.passportNumber}`);
          window.dispatchEvent(new CustomEvent('data-changed'));
          onIssued?.(res.passport);
          printDialog(res.passport);
        } catch (err) {
          if (locked(err)) toast(/[а-яё]/i.test(err.message || '') ? err.message : 'На эту позицию заказа паспорт уже есть. Откройте его и нажмите «Печать».', { error: true });
          else toastError(err, 'выпустить паспорт');
        } finally { b.classList.remove('is-busy'); b.disabled = !ready; }
      } });
    box.replaceChildren(...[
      sideNote('Номер, гарантийный талон и дату система поставит сама при выпуске.'),
      firmSel ? h('label', { class: 'field' }, h('span', null, 'Фирма'), firmSel) : hint('Нет наших фирм. Добавьте компанию в контрагентах.', 'warn'),
      order?.incomeId ? hint('Позиция заказа уже выбрана. Новый номер на неё не создастся, если паспорт уже есть.') : null,
      lineSel ? h('label', { class: 'field' }, h('span', null, 'Позиция заказа'), lineSel) : null,
      needLine && lineErr ? hint('Не удалось загрузить позиции заказа.', 'warn') : null,
      needLine && !lineErr && !lines.length ? hint('В заказе нет позиций. Паспорт к позиции не привязать.', 'warn') : null,
      mismatch ? hint('В заказе нет позиции этого изделия. Выберите позицию, к которой отнести паспорт.') : null,
      gaps ? null : sideNote('Не хватает для выпуска: ',
        ...miss.flatMap((m, i) => [i ? ', ' : null, link({ label: m.label, onClick: () => goGaps?.() })])),
      section({ title: 'Заполнить после печати', tone: 'neutral', body: sideNote('Покупателя, заказ, адрес, монтаж и дату продажи можно вписать позже в карточке выпущенного паспорта — выпуск они не держат.') }),
      go].filter(Boolean));
    if (firmSel) enhanceSelect(firmSel);
    if (lineSel) enhanceSelect(lineSel);
  }

  (async () => {
    try { firms = (await ourCompanies()).map((o) => ({ id: String(o.id), name: o.name || 'Фирма' })); } catch { firms = []; }
    // заказ нужен и для позиций, и для предвыбора фирмы (companyId заказа — C063)
    if (order?.salesOrderId) {
      try {
        orderDoc = await api(`/salesorders/${order.salesOrderId}`);
        if (needLine) {
          const all = (orderDoc.lines || []).filter((l) => !l.cancelledAt && l.status !== 'cancelled').map((l, i) => ({ ...l, id: String(l.id || l._id), _i: i }));
          const mine = all.filter((l) => String(l.productId || '') === String(prod.id));
          mismatch = !mine.length && all.length > 0;
          lines = mine.length ? mine : all;
          if (lines.length === 1) lineId = lines[0].id;
        }
      } catch { if (needLine) { lineErr = true; lines = []; } }
    }
    const orderFirm = String(orderDoc?.companyId || orderDoc?.company?.id || '');
    if (orderFirm && firms.some((f) => f.id === orderFirm)) firmId = orderFirm;
    else if (firms.length === 1) firmId = firms[0].id;
    listsReady = true;
    paint(miss);
  })();
  return { el: box, paint };
}
