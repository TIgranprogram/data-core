import { h } from '../../../core/dom.js';
import { button, link, section, sideNote, toast, toastError } from '../../../ui/kit/index.js';
import { printDialog } from '../dialogs.js';
import { issueFromProduct } from './api.js';

/**
 * Шаг 7 «Выпуск»: номер и дата ставятся сами; «Заполнить после печати» свёрнуто и выпуск не держит;
 * «Выпустить PDF» — главная, когда нет обязательного пустого; пока есть пробелы — второстепенная и выключена.
 * После выпуска открывается окно PDF и печати (то же, что в архиве паспортов).
 *   issueBlock({ prod, goGaps(), onIssued(passport) }) → { el, paint(missingRequired[]) }
 */
export function issueBlock({ prod, goGaps, onIssued }) {
  const box = h('div', null);

  function paint(missing = []) {
    const ready = !missing.length;
    const go = button({ label: 'Выпустить PDF', kind: ready ? 'primary' : 'ghost', disabled: !ready, title: ready ? 'Присвоить номер и талон, затем скачать или распечатать' : 'Сначала заполните недостающее',
      onClick: async () => {
        try {
          const res = await issueFromProduct(prod.id);
          if (res.missing) { toast('Для выпуска не хватает: ' + res.missing.join(', '), { error: true }); return; }
          toast(`Выпущен паспорт № ${res.passport.passportNumber}`);
          window.dispatchEvent(new CustomEvent('data-changed'));
          onIssued?.(res.passport);
          printDialog(res.passport);
        } catch (e) { toastError(e, 'выпустить паспорт'); }
      } });
    box.replaceChildren(...[
      sideNote('Номер, гарантийный талон и дату система поставит сама при выпуске.'),
      ready ? null : sideNote('Не хватает для выпуска: ',
        ...missing.flatMap((m, i) => [i ? ', ' : null, link({ label: m.label, onClick: () => goGaps?.() })])),
      section({ title: 'Заполнить после печати', tone: 'neutral', body: sideNote('Покупателя, заказ, адрес, монтаж и дату продажи можно вписать позже в карточке выпущенного паспорта — выпуск они не держат.') }),
      go].filter(Boolean));
  }
  return { el: box, paint };
}
