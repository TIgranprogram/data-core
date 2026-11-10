import { tagPick } from '../../ui/kit/index.js';

/**
 * Признаки изделия и «Конструкция» для паспорта (C054). Коды и подписи — как на сервере
 * (backend/src/common/passport/traits.ts); условия when — строка: пробел = И, a|b = ИЛИ, !a = НЕ.
 * Нумерация разделов — перенос planNumbers (backend/src/modules/product-passport/passport-numbering.ts).
 */
export const PASSPORT_TRAITS = {
  bolts: 'Болтовые соединения', welds: 'Сварные швы', metal: 'Металл', wood: 'Древесина', concrete: 'Опоры бетонируют',
  anchors: 'Анкеры и шпильки', freestanding: 'Лежит или стоит на основании, без крепления', moving: 'Подвижные части',
  walkable: 'По изделию можно ходить', atTree: 'Приствольное размещение',
};
/** Как соединено: коды сервера bolts / welds / solid; подписи для менеджера. */
export const PASSPORT_JOINTS = { bolts: 'Болты', welds: 'Сварка', solid: 'Цельное (без крепежа)' };
// 2026-11-10 (пользователь: «не понимаю, что значит болты, сварка»): подпись — что это и что попадёт в паспорт
const JOINT_HELP = { bolts: 'части скручены болтами → «подтягивать болты»', welds: 'рама или части сварены → «осматривать швы»', solid: 'бетон, литьё, без болтов и сварки' };
export const JOINT_OPTIONS = Object.entries(PASSPORT_JOINTS).map(([value, label]) => ({ value, label, sub: JOINT_HELP[value] }));
export const jointsText = (list) => (Array.isArray(list) && list.length ? list.map((c) => PASSPORT_JOINTS[c] || c).join(', ') : '');

/** Выбор «Как соединено»: несколько вариантов; «цельное» исключает болты и сварку. Возвращает tagPick (el, value). */
export function jointsPick(value) {
  const pick = tagPick({ options: JOINT_OPTIONS, value: Array.isArray(value) ? value.map(String) : value, label: 'Как соединено' });
  const read = () => { try { return JSON.parse(pick.value); } catch { return []; } };
  let prev = new Set(read());
  pick.el.addEventListener('change', () => {
    const cur = read();
    let next = cur;
    if (cur.includes('solid') && !prev.has('solid')) next = ['solid'];
    else if (cur.includes('solid') && cur.length > 1) next = cur.filter((c) => c !== 'solid');
    if (next.length !== cur.length) pick.value = JSON.stringify(next);
    prev = new Set(next);
  });
  return pick;
}

/** Откуда признак: «Вид изделия: Решётка» → «из вида изделия: Решётка»; «Конструкция» → «выбрано». */
const FROM = [['Вид изделия', 'из вида изделия'], ['Материал', 'из материала'], ['Способ установки', 'из способа установки'], ['Конструкция', 'выбрано']];
export const fromText = (list) => (list || []).map((s) => {
  const [k, ...rest] = String(s).split(': ');
  const f = FROM.find((x) => x[0] === k);
  return f ? (rest.length ? `${f[1]}: ${rest.join(': ')}` : f[1]) : s;
}).join('; ');

// ─── условия when ───────────────────────────────────────────────────────────────────────────────
/** Строка when → части [[{code,not}]]; пусто → []. */
const parts = (when) => String(when ?? '').trim().split(/\s+/).filter(Boolean).map((t) => t.split('|').filter(Boolean).map((raw) => (raw.startsWith('!') ? { code: raw.slice(1), not: true } : { code: raw, not: false })));
const label = (code) => PASSPORT_TRAITS[code] || code;

/** when по-русски: «Болтовые соединения или Сварные швы; не: Подвижные части» (пусто — «для всех»). */
export function whenText(when) {
  const p = parts(when);
  if (!p.length) return '';
  return p.map((alts) => alts.map((a) => (a.not ? `нет: ${label(a.code)}` : label(a.code))).join(' или ')).join('; ');
}

/** when → { all, not, any } для правки признаками; null — условие сложнее (несколько «или» / «не» в «или»): правится только текстом. */
export function whenToPick(when) {
  const out = { all: [], not: [], any: [] };
  for (const alts of parts(when)) {
    if (alts.length === 1) { (alts[0].not ? out.not : out.all).push(alts[0].code); continue; }
    if (out.any.length || alts.some((a) => a.not)) return null;
    out.any = alts.map((a) => a.code);
  }
  return out;
}
export const buildWhen = ({ all = [], not = [], any = [] }) => [...all, ...not.map((c) => '!' + c), ...(any.length > 1 ? [any.join('|')] : any)].join(' ');

/** Код пункта в разделе: ids[i], иначе p1…pN по позиции (как sectionItems сервера). */
export const idsOf = (sec) => (sec.paragraphs || []).map((_, i) => String(sec.ids?.[i] ?? '').trim() || `p${i + 1}`);
/** Текст пункта по коду: версия категории важнее «Для всех». texts — ответ GET /passports/texts. */
export function itemTextOf(texts, sectionKey, itemKey) {
  for (const src of [texts?.own?.sections, texts?.all?.sections]) {
    const sec = (src || []).find((s) => s.key === sectionKey);
    const i = sec ? idsOf(sec).indexOf(itemKey) : -1;
    if (i >= 0) return { text: sec.paragraphs[i], title: sec.title || '' };
  }
  return null;
}

// ─── нумерация разделов (planNumbers) ───────────────────────────────────────────────────────────
/**
 * Номера разделов PDF. layout 2 — подряд 1…N, один «Монтаж»; без layout (выданные) — как печаталось раньше.
 * input: { sections:[{key,number,items}], hasDescr, hasRules, hasMaintenance, hasInstall, layout }
 */
export function planNumbers(input) {
  const { sections, hasDescr, hasRules, hasMaintenance, hasInstall } = input;
  const printed = sections.map((s) => !!s.items?.length);
  if (input.layout === 2) {
    let next = 1;
    const descrNo = hasDescr ? String(next++) : '';
    const rulesNo = hasRules ? String(next++) : '';
    const sectionNo = sections.map((_, i) => (printed[i] ? String(next++) : ''));
    const toNo = hasMaintenance ? String(next++) : '';
    const mountIdx = sections.findIndex((s, i) => printed[i] && s.key === 'mounting');
    const mergeInstall = hasInstall && mountIdx >= 0;
    const installNo = hasInstall && !mergeInstall ? String(next++) : '';
    return { descrNo, rulesNo, sectionNo, toNo, installNo, mergeInstall, mountIdx,
      itemNo: (i, n) => (n && n.startsWith(`${sections[i].number}.`) ? `${sectionNo[i]}${n.slice(sections[i].number.length)}` : n) };
  }
  const start = parseInt(sections[0]?.number ?? '', 10) || 1;
  const lastNo = sections.reduce((m, s) => Math.max(m, parseInt(s.number, 10) || 0), 0);
  const before = start > 1;
  const mergeRules = before && start === 2;
  let next = before ? 1 : lastNo + 1;
  const descrNo = hasDescr || (mergeRules && hasRules) ? String(next++) : '';
  const rulesNo = hasRules && !mergeRules ? String(next++) : '';
  if (before) next = lastNo + 1;
  const toNo = hasMaintenance ? String(next++) : '';
  const installNo = hasInstall ? String(next++) : '';
  return { descrNo, rulesNo, sectionNo: sections.map((s, i) => (printed[i] ? s.number : '')), toNo, installNo, mergeInstall: false, mountIdx: -1, itemNo: (_i, n) => n };
}

/** Номера по снимку текста паспорта (то, что видно в карточке и уйдёт в PDF). */
export const numbersOf = (t) => planNumbers({
  sections: t.sections || [], layout: t.layout, hasDescr: true,
  hasRules: (t.rules || []).length > 0,
  hasMaintenance: (t.maintenance || []).some((m) => m.rows?.length),
  hasInstall: !!(String(t.install?.text || '').trim() || (t.install?.requirements || []).length),
});
