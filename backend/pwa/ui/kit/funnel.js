import { h } from '../../core/dom.js';
import { PREFIX } from '../../core/api.js';
import { mark } from './mark.js';
import { attachCombo } from './pick.js';
import { link, row, tabs } from './index.js';

/**
 * funnel({ steps, onChange, next?, recent?, done? }) — эталон «Воронка с памятью» (docs/PATTERNS.md П-1), один вид для паспорта и склада.
 *   step: { key, label, ask? («Дальше: …» пока шаг не выбран), value? (выбрано: id или id через запятую), values:[{id,label,count,thumb?,group?}], multi?, skip?, optional? }
 *   Шаги идут сверху вниз; следующий не показан, пока не выбран предыдущий. skip или одно значение — шаг пропущен сам.
 *   group у значений (C039) — «полочки»: фишки одной группы подряд под подписью группы (порядок — как пришёл), без группы — отдельной строкой в конце; значения сразу фишками, без списка с поиском.
 *   optional — шаг не задерживает следующих (признаки: можно не выбирать). ≤ 7 значений — вкладки/фишки с числом, больше — список с поиском.
 *   Пройденный шаг — строка «Категория: Уличный тренажёр ✎»; нажатие = onChange(key, '') (экран сбрасывает нижние).
 *   next — текст «Дальше: …» (нет — от первого невыбранного шага); recent: [{ title, meta?, onClick }] — строка «Недавно: …»; done — шаги закрыты, видны только пройденные.
 * → { el, update({ steps, next, recent, done }), setNext(text|null), setRecent(items) } */
const SHORT = 7;
const ids = (v) => String(v ?? '').split(',').filter(Boolean);
const thumbIcon = (src) => h('span', { class: 'ff-ico', 'aria-hidden': 'true' }, h('img', { src: PREFIX + src, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => { e.target.parentNode.hidden = true; } }));

export function funnel({ steps = [], onChange, next, recent, done = false } = {}) {
  let S = steps; let forced = next ?? null; let rec = recent || null; let fin = done;
  const nextEl = h('div'); const recentEl = h('div', { class: 'k-stack' }); const body = h('div', { class: 'k-stack' });
  const el = mark(h('div', { class: 'k-stack k-funnel' }, nextEl, recentEl, body), 'funnel');

  const skipped = (s) => s.skip || (s.values || []).length === 1 && !ids(s.value).length;
  const labelOf = (s, id) => (s.values || []).find((v) => String(v.id) === String(id))?.label ?? id;

  /** Шаги, которые видны сейчас: пройденные свёрнуты, первый невыбранный обязательный — открыт, дальше — ничего. */
  function visible() {
    const out = [];
    for (const s of S) {
      if (skipped(s)) continue;
      const has = ids(s.value).length > 0;
      if (has && !s.multi) { out.push({ s, mode: 'folded' }); continue; }
      if (fin) { if (has) out.push({ s, mode: 'folded' }); continue; }
      out.push({ s, mode: 'open' });
      if (!s.optional && !has) break; // следующий шаг — только после выбора
    }
    return out;
  }
  /** Значения по убыванию числа; «не указан / прочее» — в конце. */
  const grouped = (s) => (s.values || []).some((v) => v.group);
  const sorted = (s) => { if (grouped(s)) return s.values; const tail = (v) => v.id === 'none' || /не указан|прочее/i.test(String(v.label)); return [...(s.values || [])].sort((a, b) => tail(a) - tail(b) || (b.count ?? 0) - (a.count ?? 0)); };
  const open = (s, v) => onChange?.(s.key, v);

  /** Группы значений в порядке появления; значения без группы — последней строкой. */
  function shelfKeys(values) {
    const keys = [];
    for (const v of values) if (!keys.includes(v.group || '')) keys.push(v.group || '');
    return keys.filter(Boolean).concat(keys.includes('') ? [''] : []);
  }
  /** Фишка значения: клик выбирает; у шага с несколькими — добавить или снять, выбранная подсвечена. */
  function shelfChip(s, v, on) {
    const id = String(v.id);
    const pressed = on.includes(id);
    const pick = () => (s.multi ? open(s, (pressed ? on.filter((x) => x !== id) : [...on, id]).join(',')) : open(s, v.id));
    return h('button', { type: 'button', class: 'chip' + (pressed ? ' active' : ''), 'aria-pressed': String(pressed), onclick: pick },
      v.label, v.count != null ? h('b', null, String(v.count)) : null);
  }
  /** Полка: подпись группы (muted) и фишки её значений; у значений без группы подписи нет. */
  function shelf(s, group, on) {
    const chips = s.values.filter((v) => (v.group || '') === group).map((v) => shelfChip(s, v, on));
    return h('div', { class: 'k-stack' }, group ? h('span', { class: 'muted small' }, group) : null, h('div', { class: 'chips' }, ...chips));
  }
  /** Фишки по полочкам: подпись группы и её фишки; значения без группы — строкой в конце без подписи. */
  function shelves(s) {
    const on = ids(s.value);
    return h('div', { class: 'k-stack', role: 'group', 'aria-label': s.label }, ...shelfKeys(s.values).map((g) => shelf(s, g, on)));
  }
  function chips(s) {
    if (grouped(s)) return shelves(s);
    if (!s.multi) return tabs({ items: sorted(s).map((v) => ({ key: v.id, label: v.label, count: v.count })), value: ids(s.value)[0] ?? null, label: s.label, onChange: (k) => open(s, k) }).el;
    const on = ids(s.value);
    return h('div', { class: 'chips', role: 'group', 'aria-label': s.label }, ...sorted(s).map((v) => h('button', { type: 'button', class: 'chip' + (on.includes(String(v.id)) ? ' active' : ''), 'aria-pressed': String(on.includes(String(v.id))),
      onclick: () => { const cur = ids(s.value); const i = cur.indexOf(String(v.id)); if (i >= 0) cur.splice(i, 1); else cur.push(String(v.id)); open(s, cur.join(',')); } },
    v.thumb ? thumbIcon(v.thumb) : null, v.label, v.count != null ? h('b', null, String(v.count)) : null)));
  }
  function combo(s) {
    const input = h('input', { placeholder: 'Найти: ' + s.label.toLowerCase(), 'aria-label': s.label });
    attachCombo(input, { options: () => sorted(s).map((v) => ({ value: v.id, label: v.label, sub: v.count != null ? String(v.count) : '' })), onPick: (o) => { input.value = ''; open(s, o.value); } });
    return input;
  }
  function stepEl({ s, mode }) {
    if (mode === 'folded') return h('div', null, link({ label: `${s.label}: ${ids(s.value).map((id) => labelOf(s, id)).join(', ')} ✎`, title: `Изменить: ${s.label}`, onClick: () => open(s, '') }));
    const long = !s.multi && s.values.length > SHORT && !grouped(s);
    return h('div', { class: 'field wide', 'data-step': s.key }, h('span', null, s.label), long ? combo(s) : chips(s));
  }

  function paint() {
    const list = visible();
    const first = list.find((x) => x.mode === 'open' && !ids(x.s.value).length);
    const text = forced || (first ? (first.s.ask || `выберите: ${first.s.label.toLowerCase()}`) : '');
    nextEl.replaceChildren(...(text ? [row({ tone: 'info', title: 'Дальше: ' + text })] : []));
    nextEl.hidden = !text;
    recentEl.replaceChildren(...(rec?.length ? [h('span', { class: 'muted small' }, 'Недавно:'), ...rec.map((x) => row({ title: x.title, meta: x.meta, onClick: x.onClick }))] : []));
    recentEl.hidden = !rec?.length || fin;
    body.replaceChildren(...list.map(stepEl));
  }
  paint();
  return {
    el,
    update: (o = {}) => { if (o.steps) S = o.steps; if ('next' in o) forced = o.next ?? null; if ('recent' in o) rec = o.recent || null; if ('done' in o) fin = !!o.done; paint(); },
    /** Все обязательные шаги выбраны или пропущены (список объектов можно показывать). */
    ready: () => S.length > 0 && S.every((s) => s.optional || skipped(s) || ids(s.value).length > 0),
    setNext: (t) => { forced = t ?? null; paint(); },
    setRecent: (items) => { rec = items || null; paint(); },
  };
}
