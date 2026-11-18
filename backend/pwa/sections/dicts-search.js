import { searchTokens, normSearch } from '../core/facets.js';

/** Токены поиска справочника: «оцинк…» → ещё «цинк» (покрытия C055). */
export function dictSearchTokens(q) {
  return searchTokens(q).flatMap((w) => (w.startsWith('оцинк') || w.startsWith('цинк') ? [w, 'цинк'] : [w]));
}

/** Строка для поиска: название, код латиницей как есть (GALV), kind покрытие/материал. */
export function dictHaystack(x) {
  const kind = x.kind === 'coating' ? 'покрытие coating' : x.kind === 'material' ? 'материал material' : '';
  const code = String(x.code || '').toLowerCase();
  const rest = normSearch([x.name, x.madeOf, x.phrase, x.categories, x.genSingular, x.genPlural, kind, ...Object.values(x).filter((v) => typeof v === 'string')].filter(Boolean).join(' '));
  return `${rest} ${code}`.trim();
}

// Группы меню (решение DICT 2026-10-25): серверные названия → понятные; порядок фиксирован
export const GROUP_NAME = { 'Склад и позиции': 'Склад и продукция', 'Люди и ФОТ': 'Люди и работа', 'Заявки и счета': 'Заявки и оплата', 'Паспорта': 'Документы (паспорта)' };
export const GROUP_ORDER = ['Склад и продукция', 'Люди и работа', 'Заявки и оплата', 'Документы (паспорта)'];
export const PASS_GROUP = 'Документы (паспорта)';
// Справочников паспортов много — одна группа «Паспорта», внутри сверху вниз по каскаду (C145): главное → зависимое.
export const PASS_SUBS = [
  // тип → элементы → вид (берёт тип и элементы) → признаки → значения признака
  ['Что за изделие', ['passportCategories', 'passportElements', 'passportKinds', 'productFacets', 'productFacetValues']],
  // части → материалы/покрытия → сортамент (к материалу)
  ['Части и материалы', ['passportParts', 'passportMaterials', 'passportSortament']],
  // тексты → шаблон разделов → установка → дефекты → нормативы
  ['Тексты и правила', ['passportPhrases', '__texts', 'passportInstall', 'passportDefects', 'passportStandards']],
  ['Вид документа', ['passportStyle']],
];

export function menuGroups(groups) {
    const m = new Map();
    for (const g of groups) { const n = GROUP_NAME[g.group] || g.group; if (!m.has(n)) m.set(n, []); m.get(n).push(...g.items); }
    const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => rank(a.name) - rank(b.name));
  }

/** Одна группа «Паспорта» с вложенными подкатегориями (для navList.groups). textsKey — ключ экрана «Общие разделы». */
export function passMenuTree(items, textsKey = 'ptexts') {
  const mapKey = (k) => (k === '__texts' ? textsKey : k);
  const used = new Set();
  const subs = PASS_SUBS.map(([title, keys]) => {
    const list = keys.map((k) => items.find((it) => it.key === mapKey(k))).filter(Boolean);
    list.forEach((it) => used.add(it.key));
    return { title, fold: true, items: list };
  });
  const rest = items.filter((it) => !used.has(it.key));
  if (rest.length) subs.push({ title: 'Прочее', fold: true, items: rest });
  return [{ title: 'Паспорта', fold: true, groups: subs.filter((s) => s.items.length), parentTitle: PASS_GROUP }];
}

export const flatNavItems = (g) => (g.groups ? g.groups.flatMap((sg) => sg.items || []) : (g.items || []));

/** Собрать группы меню справочников + раскрытие/поиск (C145: Паспорта → подкатегории). */
export function buildDictsNav({ serverGroups, admin, zonesKey, textsKey, term, cur, expanded, markOpen }) {
  const gs = menuGroups(serverGroups).flatMap((g) => {
    const items = [...g.items.map((d) => ({ key: d.key, label: d.key === 'passportParts' ? 'Части изделия (для паспорта)' : d.title, keywords: d.key === 'passportParts' ? 'часть каркас' : '', count: d.count }))];
    if (g.name === GROUP_ORDER[0] && admin) items.push({ key: zonesKey, label: 'Склады' });
    if (g.name !== PASS_GROUP) return [{ title: g.name, items }];
    items.push({ key: textsKey, label: 'Общие разделы (шаблон)' });
    return passMenuTree(items, textsKey);
  });
  gs.push({ title: 'Контрагенты', items: [{ key: '#partners', label: 'Поставщики, заказчики, наши компании', href: '#partners' }] });
  if (markOpen) {
    const own = gs.find((g) => flatNavItems(g).some((it) => it.key === cur));
    if (own) {
      expanded.set(own.title, true);
      (own.groups || []).forEach((sg) => { if (sg.items.some((it) => it.key === cur)) expanded.set(sg.title, true); });
    }
  }
  const q = String(term || '').trim().toLocaleLowerCase('ru');
  const foldGroup = (g) => {
    if (g.groups) {
      const nested = g.groups.map((sg) => {
        const hit = (sg.title + ' ' + (g.title || '')).toLocaleLowerCase('ru').includes(q);
        const items = !q || hit ? sg.items : sg.items.filter((it) => (it.label + ' ' + (it.keywords || '')).toLocaleLowerCase('ru').includes(q));
        if (!expanded.has(sg.title)) expanded.set(sg.title, items.some((it) => it.key === cur));
        return { ...sg, items, fold: true, open: q ? true : expanded.get(sg.title), onToggle: (v) => { if (!q) expanded.set(sg.title, v); } };
      }).filter((sg) => sg.items.length);
      if (!expanded.has(g.title)) expanded.set(g.title, nested.some((sg) => sg.items.some((it) => it.key === cur)));
      return { ...g, groups: nested, fold: true, open: q ? true : expanded.get(g.title), onToggle: (v) => { if (!q) expanded.set(g.title, v); } };
    }
    const groupMatch = (g.title + ' ' + (g.parentTitle || '')).toLocaleLowerCase('ru').includes(q);
    const items = !q || groupMatch ? g.items : g.items.filter((it) => (it.label + ' ' + (it.keywords || '')).toLocaleLowerCase('ru').includes(q));
    if (!expanded.has(g.title)) expanded.set(g.title, items.some((it) => it.key === cur));
    return { ...g, items, fold: true, open: q ? true : expanded.get(g.title), onToggle: (v) => { if (!q) expanded.set(g.title, v); } };
  };
  const visible = gs.map(foldGroup).filter((g) => (g.groups ? g.groups.length : g.items?.length));
  const curItem = q && !visible.some((g) => flatNavItems(g).some((it) => it.key === cur)) ? gs.flatMap(flatNavItems).find((it) => it.key === cur) : null;
  if (curItem) visible.unshift({ title: 'Открыт: ' + curItem.label, items: [curItem] });
  return { gs, visible };
}
