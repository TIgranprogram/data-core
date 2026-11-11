import { attachCombo, button, hint, section, stack, textInput } from '../../../ui/kit/index.js';
import { fetchLastOffer, loadOfferParties, partyOptions } from '../../offer-memory.js';

/**
 * Шаг 1 «Заказчик»: поле с подсказками (недавние, контрагенты). Прошлое КП заказчика (условия, цены строк)
 * подтягивается молча и ложится в S.last / S.prices; видна одна строка «как в прошлом КП», вопросов нет.
 *   customerStep(S, { onDone }) → { el, focus }
 */
const key = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');

export function customerStep(S, { onDone }) {
  const src = { options: [] };
  const field = textInput({ label: 'Заказчик', placeholder: 'Кому: название заказчика', max: 300, value: S.customer });
  const input = field.input;
  const note = hint('');
  note.hidden = true;
  const need = hint('Впишите заказчика, чтобы перейти дальше.', 'danger');
  need.hidden = true;
  const none = hint('Подсказок пока нет — впишите название заказчика сами.');
  none.hidden = true;
  let seq = 0;
  const askLast = async () => {
    const my = ++seq;
    const d = await fetchLastOffer({ customer: input.value, counterpartyId: S.partyId });
    if (my !== seq) return;
    S.last = d; S.prices = new Map((d?.prices || []).map((p) => [String(p.productId), Number(p.unitPrice)]));
    note.hidden = !d;
    if (d) note.textContent = `Условия и цены — как в прошлом КП № ${d.number}.`;
  };
  const sync = () => {
    S.customer = input.value;
    const hit = src.options.find((o) => key(o.label) === key(input.value) && o.value);
    S.partyId = hit ? String(hit.value) : '';
  };
  attachCombo(input, { options: () => src.options, onPick: (o) => { input.value = o.label; sync(); askLast(); } });
  let timer;
  input.addEventListener('input', () => { sync(); clearTimeout(timer); timer = setTimeout(askLast, 400); });
  loadOfferParties().then((r) => { src.options = partyOptions(r.parties, r.recent); none.hidden = !!src.options.length; });
  const next = button({ label: 'Дальше — изделия', kind: 'primary', onClick: () => { sync(); need.hidden = !!S.customer.trim(); if (!S.customer.trim()) { input.focus(); return; } onDone(); } });
  const el = section({ title: 'Заказчик', open: true, tone: 'main', body: [stack(field.el, none, note, need, next)] });
  return { el, focus: () => input.focus() };
}
