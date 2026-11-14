import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { button, guide, hint, table } from '../../ui/kit/index.js';

/* Воронка техописания (C114 D-UI): «Осталось N» по GET /showcase/:id/techsheet-gaps, шаги, переходы к полю, предпросмотр строк PDF.
 * Только рисуем; что не хватает — считает сервер. Строки PDF считает tech-sheet.js (те же допуски, что tech-sheet-rows.ts). */

/** Пункт сервера → поле формы изделия (name=), куда ведёт клик. materials/parts — в таблицу на этой же панели. */
const FORM_FIELD = { dimensions: 'dimL', weightKg: 'weightKg', purpose: 'purpose', installation: 'installation' };
const SPEC_KEYS = ['materials', 'parts'];
const noun = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'пункт' : 'пункта');

/** Шаги и «Осталось N». gaps — ответ сервера { ready, missing[] } или null (не загрузилось — блок скрыт). */
export function techGapsBlock(gaps, productId, toSpec) {
  if (!gaps) return null;
  const left = gaps.missing || [];
  const specLeft = left.some((g) => SPEC_KEYS.includes(g.key));
  const otherLeft = left.some((g) => !SPEC_KEYS.includes(g.key));
  const s1 = specLeft ? 'now' : 'done';
  const s2 = otherLeft ? (specLeft ? 'later' : 'now') : 'done';
  const s3 = left.length ? 'later' : 'now';
  const go = (g) => (SPEC_KEYS.includes(g.key) ? toSpec() : patch({ of: 'products', open: productId, fill: FORM_FIELD[g.key] || g.key, new: undefined }));
  const all = [
    ['materials', 'Материалы изделия'], ['parts', 'Части у материалов'], ['dimensions', 'Габариты'], ['weightKg', 'Вес'], ['purpose', 'Назначение'], ['installation', 'Монтаж'],
  ];
  const by = new Map(left.map((g) => [g.key, g]));
  const shown = all.filter(([k]) => by.has(k) || !(k === 'parts' && by.has('materials')));
  return h('div', null,
    guide.steps([{ label: 'Части и материалы', state: s1 }, { label: 'Габариты и тексты', state: s2 }, { label: 'Проверка и PDF', state: s3 }]),
    left.length ? hint(`Осталось ${left.length} ${noun(left.length)} — нажмите, чтобы перейти к полю`) : hint('Всё заполнено — проверьте строки и скачайте PDF', 'ok'),
    guide.checklist(shown.map(([k, label]) => {
      const g = by.get(k);
      return { label: g?.label || label, ok: !g, ...(g ? { onClick: () => go(g) } : {}) };
    })));
}

/** «Что попадёт в PDF»: таблица строк; «Обновить» перечитывает таблицу материалов с экрана. rowsNow() → [{ name, text }]. */
export function techPreview(rowsNow) {
  const box = h('div', null);
  const paint = () => {
    const rows = rowsNow();
    box.replaceChildren(rows.length
      ? table({ columns: [{ label: 'Строка' }, { label: 'В PDF' }], rows: rows.map((x) => ({ cells: [x.name, x.text] })) })
      : hint('Пока ни одной строки — заполните материалы выше'));
  };
  paint();
  const el = h('div', null, box, button({ label: 'Обновить просмотр', kind: 'ghost', size: 'S', title: 'Пересобрать строки по таблице выше', onClick: paint }));
  return { el, get value() { return ''; }, set value(_) { /* только показ */ } };
}
