import { go } from '../../../core/router.js';
import { money } from '../../../core/format.js';
import { button, errText, funnel, hint, link, section, stack } from '../../../ui/kit/index.js';
import { toast, toastError } from '../../../ui/kit/toast.js';
import { createPack, packBody, sumOf, writePrefs } from './api.js';
import { customerStep } from './customer-step.js';
import { firmsStep } from './firms-step.js';
import { itemsStep } from './items-step.js';

/**
 * Воронка «Новое КП» (C081, docs/crew/C070-passports-kp-focus/KP.md §6; П-1): одна правая панель сверху вниз
 * Заказчик → Изделия → Цвет и размер (только где есть выбор) → От каких фирм → Проверка → «Создать N КП».
 * Пройденный шаг — строка «Заказчик: … ✎». Создание — один вызов POST /offers/pack: N КП или ни одного.
 */
function build() {
  const S = { customer: '', partyId: '', lines: [], last: null, prices: new Map() };
  let busy = false; let fail = '';
  let stage = 1; // 1 заказчик · 2 изделия · 3 цвет и размер · 4 фирмы и проверка
  const nextLine = funnel({ steps: [] });
  const body = stack();
  const summary = stack();
  const create = button({ label: 'Создать КП', kind: 'primary', disabled: true, onClick: submit });

  const cust = customerStep(S, { onDone: () => go2(2) });
  const items = itemsStep(S, { onChange: paintSummary, onDone: () => go2(items.variants() ? 3 : 4) });
  const firms = firmsStep({ onChange: paintSummary });
  const finish = section({ title: 'Проверка', open: true, tone: 'gold', body: [stack(summary, create)] });

  function go2(n) { stage = n; paint(); }

  function paintSummary() {
    const f = firms.picked();
    const noPrice = S.lines.filter((l) => !(Number(l.price) > 0)).map((l) => l.name);
    const problem = !S.lines.length ? 'Добавьте изделия.' : !f.length ? 'Отметьте хотя бы одну фирму.' : firms.bad();
    summary.replaceChildren(
      hint(f.length ? `Получится ${f.length} КП: ${f.map((x) => `${x.name} ${money(sumOf(S.lines, x.pct))}`).join(' · ')}` : 'Отметьте фирмы — получится по КП на каждую.'),
      ...(noPrice.length ? [hint(`Нет цены: ${noPrice.join(', ')}. КП создастся, но отправить его можно будет после ввода цены.`, 'warn')] : []),
      ...(problem ? [hint(problem, 'danger')] : []),
      ...(fail ? [hint(fail, 'danger')] : []),
    );
    create.textContent = f.length ? `Создать ${f.length} КП` : 'Создать КП';
    create.disabled = busy || !!problem;
    const total = items.variants() ? 4 : 3; const num = stage === 4 ? total : stage;
    const say = stage === 1 ? 'впишите заказчика' : stage === 2 ? 'добавьте изделия и количество' : stage === 3 ? 'выберите цвет и размер' : problem ? problem.toLowerCase().replace(/\.$/, '') : 'нажмите «Создать КП»';
    nextLine.setNext(`Шаг ${num} из ${total} · ${say}`);
  }

  function paint() {
    const parts = [];
    if (stage > 1) parts.push(link({ label: `Заказчик: ${S.customer.trim()} ✎`, title: 'Изменить заказчика', onClick: () => go2(1) }));
    if (stage === 1) parts.push(cust.el);
    if (stage > 2) parts.push(link({ label: `Изделия: ${S.lines.length} ✎`, title: 'Изменить изделия и количество', onClick: () => go2(2) }));
    if (stage === 2) parts.push(items.el);
    if (stage === 3) {
      const v = items.variants();
      parts.push(v, button({ label: 'Дальше', kind: 'primary', onClick: () => go2(4) }));
    }
    if (stage === 4) { const v = items.variants(); if (v) parts.push(link({ label: 'Цвет и размер ✎', title: 'Изменить цвет и размер', onClick: () => go2(3) })); parts.push(firms.el, finish); }
    body.replaceChildren(...parts.filter(Boolean));
    paintSummary();
  }

  async function submit() {
    const f = firms.picked();
    busy = true; fail = ''; create.disabled = true;
    try {
      const res = await createPack(packBody(S, f));
      writePrefs({ companies: f.map((x) => ({ id: x.id, markup: x.pct })) });
      toast(`Создано КП: ${res.items?.length || f.length}`);
      go('offers', { open: res.items?.[0]?.id });
    } catch (e) { toastError(e, 'создать КП'); fail = `Не удалось создать КП: ${errText(e)}`; busy = false; paintSummary(); }
  }

  paint();
  return { el: stack(nextLine.el, body), readonly: true, dirty: () => false, focus: () => cust.focus(), read: () => ({ values: {} }) };
}

export const offerFunnel = {
  id: 'offerfunnel', title: 'КП', newTitle: 'Новое КП', card: { heading: () => 'Новое КП' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
