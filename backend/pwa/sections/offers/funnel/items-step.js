import { money, parseNum } from '../../../core/format.js';
import { buildForm, button, failBlock, hint, iconButton, qtyInput, row, searchBox, section, select, stack, textInput } from '../../../ui/kit/index.js';
import { findProducts, intakeStatus, parseIntake } from './api.js';

/**
 * Шаг 2 «Изделия» (поиск, добавить, количество) и шаг 3 «Цвет и размер» — только у изделий, где вариантов несколько.
 * Изделие без вариантов: цвет и размер не спрашиваем, берём единственный. Цена — из прошлого КП заказчика, иначе из каталога.
 *   itemsStep(S, { onChange, onDone }) → { el, variants() → узел|null }
 */
const many = (a) => Array.isArray(a) && a.length > 1;

/**
 * «Разобрать заявку»: вставили текст заказчика — ИИ находит строки и предлагает до 3 изделий витрины на каждую.
 * Выбранные добавляются через add(p, количество, ед.). Ввод — здесь же, в панели воронки.
 */
function intakeBlock(add) {
  const el = stack();
  el.hidden = true;
  const box = stack();
  const open = button({ label: 'Разобрать заявку', onClick: () => { open.hidden = true; ask(); } });
  el.append(open, box);

  function ask(prev = '') {
    const form = buildForm([{ key: 'text', label: 'Текст заявки', type: 'textarea', wide: true, rows: 6, max: 20000, hint: 'Текст уйдёт в ИИ Claude только по этой кнопке. Каталог и цены не отправляются.' }], { text: prev });
    const go = button({ label: 'Разобрать', kind: 'primary', onClick: () => run(form, go, cancel) });
    const cancel = button({ label: 'Отмена', kind: 'ghost', onClick: () => { box.replaceChildren(); open.hidden = false; } });
    box.replaceChildren(stack(form.el, stack(go, cancel)));
    form.focus?.();
  }

  async function run(form, go, cancel) {
    const text = String(form.read().values?.text || '').trim();
    if (!text) return;
    const status = hint('Разбираю заявку…');
    go.disabled = true; go.classList.add('is-busy'); cancel.disabled = true;
    box.append(status);
    try {
      const r = await parseIntake(text);
      result(r?.items || [], text);
    } catch (e) {
      box.replaceChildren(failBlock(e, () => ask(text), { text: 'Не удалось разобрать заявку' }));
    }
  }

  function result(items, text) {
    if (!items.length) { box.replaceChildren(stack(hint('В тексте не нашли изделий.'), button({ label: 'Назад', kind: 'ghost', onClick: () => ask(text) }))); return; }
    const pick = items.map((it) => (it.variants?.length ? 0 : -1)); // -1 — не добавлять
    const addBtn = button({ label: '', kind: 'primary', onClick: () => {
      items.forEach((it, i) => { if (pick[i] >= 0) add(it.variants[pick[i]], Number(it.quantity) > 0 ? Number(it.quantity) : 1, it.unit || ''); });
      box.replaceChildren(); open.hidden = false;
    } });
    const rows = stack();
    const paint = () => {
      const n = pick.filter((x) => x >= 0).length;
      addBtn.textContent = `Добавить выбранные (${n})`; addBtn.disabled = !n;
      rows.replaceChildren(...items.map((it, i) => {
        const vs = it.variants || [];
        return stack(
          row({ title: it.asked, meta: [it.quantity ? `${it.quantity} ${it.unit || 'шт'}` : ''].filter(Boolean).join(' · ') }),
          ...(vs.length
            ? [...vs.map((p, j) => row({ title: p.name, meta: [p.sku, p.price ? money(p.price) : 'без цены'].filter(Boolean).join(' · '), active: pick[i] === j, onClick: () => { pick[i] = j; paint(); } })),
              row({ title: 'Не добавлять', active: pick[i] === -1, onClick: () => { pick[i] = -1; paint(); } })]
            : [hint('Не нашли в каталоге — добавьте поиском ниже.')]),
        );
      }));
    };
    paint();
    box.replaceChildren(stack(rows, stack(addBtn, button({ label: 'Назад', kind: 'ghost', onClick: () => ask(text) }))));
  }
  return { el, show: () => { el.hidden = false; } };
}

export function itemsStep(S, { onChange, onDone }) {
  const found = stack();
  const list = stack();
  const sb = searchBox({ placeholder: 'Название или артикул изделия', minLength: 2, onSearch: async (q) => {
    if (q.trim().length < 2) { found.replaceChildren(); return; }
    const items = await findProducts(q.trim());
    found.replaceChildren(...(items.length
      ? items.map((p) => row({ title: p.name, meta: [p.sku, p.price ? money(p.price) : 'без цены'].filter(Boolean).join(' · '), onClick: () => add(p) }))
      : [hint('Ничего не найдено — уточните название или артикул.')]));
  } });

  function add(p, qty = 1, unit = '') {
    const ex = S.lines.find((l) => l.id === p.id);
    if (ex) ex.qty += qty;
    else {
      const colors = Array.isArray(p.colors) ? p.colors.filter(Boolean) : [];
      const sizes = Array.isArray(p.sizes) ? p.sizes.filter(Boolean) : [];
      const price = Number(S.prices?.get(String(p.id)) ?? p.price) || 0;
      S.lines.push({
        askPrice: !(price > 0), // цены нет ни в прошлом КП, ни в каталоге — спрашиваем здесь, одна на все фирмы пакета
        id: p.id, sku: p.sku, name: p.name, unit: unit || p.unit || 'шт', qty, price,
        colors, sizes, color: p.color || colors[0] || '', size: p.size || sizes[0] || '',
        photoUrl: p.photo?.thumb || p.photo?.url || '', description: String(p.description || '').trim(),
      });
    }
    sb.input.value = ''; found.replaceChildren(); paint(); onChange();
  }

  const warn = hint('', 'danger');
  const empty = hint('Найдите изделие по названию или артикулу и нажмите на него.');
  warn.hidden = true;
  const done = button({ label: 'Дальше', kind: 'primary', onClick: () => { if (S.lines.some((l) => !(l.qty > 0))) { warn.textContent = 'Укажите количество больше нуля.'; warn.hidden = false; return; } onDone(); } });
  function paint() {
    list.replaceChildren(...S.lines.flatMap((l) => [row({
      title: l.name, meta: [l.sku, l.askPrice ? '' : money(l.price)].filter(Boolean).join(' · '), wrap: true,
      side: [
        qtyInput({ value: String(l.qty), label: `Количество: ${l.name}`, onInput: (n) => { l.qty = n > 0 ? n : 0; onChange(); } }),
        iconButton({ icon: '×', label: `Убрать: ${l.name}`, size: 'S', onClick: () => { S.lines = S.lines.filter((x) => x !== l); paint(); onChange(); } }),
      ],
    }), l.askPrice ? textInput({
      label: `Цена за единицу, ₽ — ${l.name}`, value: l.price > 0 ? String(l.price) : '', inputmode: 'decimal',
      hint: 'Цены в каталоге нет. Впишите — подставится в КП всех фирм.',
      onInput: (v) => { const n = parseNum(v); l.price = n > 0 ? n : 0; onChange(); },
    }).el : null].filter(Boolean)));
    done.hidden = !S.lines.length; empty.hidden = !!S.lines.length; warn.hidden = true;
  }
  const intake = intakeBlock(add);
  const el = section({ title: 'Изделия', open: true, tone: 'main', body: [stack(intake.el, sb.el, found, empty, list, warn, done)] });
  intakeStatus().then((on) => { if (on) intake.show(); });
  paint();

  /** Шаг 3: строки, у которых несколько цветов или размеров. Нет таких — null, шаг пропущен. */
  function variants() {
    const need = S.lines.filter((l) => many(l.colors) || many(l.sizes));
    if (!need.length) return null;
    return section({ title: 'Цвет и размер', open: true, tone: 'main', body: [stack(...need.map((l) => stack(
      row({ title: l.name }),
      many(l.colors) ? select({ label: `Цвет: ${l.name}`, options: l.colors.map((c) => [c, c]), value: l.color, onChange: (v) => { l.color = v; } }) : null,
      many(l.sizes) ? select({ label: `Размер: ${l.name}`, options: l.sizes.map((c) => [c, c]), value: l.size, onChange: (v) => { l.size = v; } }) : null,
    )))] });
  }
  return { el, variants };
}
