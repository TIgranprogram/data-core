/* Поиск и фильтры склада «как в магазине» (без сервера, по уже загруженному списку).
 * Нормализация — как на сервере (backend/src/common/text/search-norm.ts): «м10» = «M10», х/x/× — размер.
 * Фильтры берутся из наименований: «Болт с шестигр. головкой, M10х100, DIN 933» →
 * тип «Болт с шестигр. головкой», резьба M10, длина 100, стандарт DIN 933. */
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

export function normSearch(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
    .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[«»"'(),;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Артикул — тот же, если отличается регистром, «ё», похожими буквами (KC-01 = КС-01), пробелами по краям; как skuKey на сервере. */
export const skuKey = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
  .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/\s+/g, ' ').trim();
export const searchTokens = (q) => normSearch(q).replace(/(^|\s)м\s+(\d)/g, '$1м$2').split(' ').filter(Boolean);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Ключ слова для правил типа: регистр, «ё», знаки — не различаем («Нерж.» = «нерж»). */
const wordKey = (w) => String(w ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\wа-яё-]/g, '');
/** Слово — прилагательное/материал, а не тип: таблица исключений и окончания прилагательных (C043). */
export function isTypeAdjective(word) {
  const k = wordKey(word);
  if (!k || /^\d/.test(k)) return false;
  if (TYPE_SKIP_WORDS.has(k)) return true;
  if (TYPE_NOUN_WORDS.has(k)) return false;
  return /(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/.test(k);
}
/** Первое существительное имени → тип: пропускаем ведущие прилагательные и материалы («Алюминиевый» → «Соединитель»). */
function typeOfName(n) {
  const cut = n.search(/,(?!\d)/); // запятая-разделитель, а не десятичная в размере («4,2х20»)
  const head = cut === -1 ? n : n.slice(0, cut);
  const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);
  const firstNoun = (list) => list.findIndex((w) => !isTypeAdjective(w));
  if (cut === -1) { const ws = words(n); const i = firstNoun(ws); return i === -1 ? ws[0] : ws[i]; }
  const ws = words(head);
  const i = firstNoun(ws);
  if (i >= 0) return ws.slice(i).join(' ');
  const rest = words(n.slice(cut + 1)); // перед запятой только прилагательное — существительное ищем после неё
  const j = firstNoun(rest);
  return j >= 0 ? rest[j] : head;
}

/** Признаки позиции по наименованию. */
export function facetsOf(name) {
  const n = String(name || '');
  const thread = n.match(/(?:^|[\s,(])[MМ]\s?(\d+(?:[.,]\d+)?)(?![\d.,]*\s?мм)/);
  const len = n.match(/[MМ]\s?\d+(?:[.,]\d+)?\s?[xхX×]\s?(\d+(?:[.,]\d+)?)/);
  const std = n.match(/\b(DIN|ГОСТ|ISO)\s?(\d+)/i);
  let type = typeOfName(n);
  // размер и единица в тип не входят: «Саморез 4,2х20» → «Саморез», «Уголок 40х40 3 мм» → «Уголок» (резьба, длина, сечение — свои признаки)
  type = cap(type.replace(/\s+[MМ]\s?\d.*$/, '').replace(/(?:\s+(?:[Øø]?\d[\w,.×хX-]*|мм|м²|м³|м|шт|кг|л))+$/, '').replace(/[.\s]+$/, '').trim());
  type = type.replace(/\s+\d.*$/, '').trim(); // «Пластина 12*12*2,2 35°…», «Полиэтилен НПЭ 1,05м*25м» — всё с первой цифры
  if (type.length > 40) type = type.split(/\s+/).slice(0, 2).join(' ');
  return {
    type: type || null,
    thread: thread ? 'M' + thread[1].replace(',', '.') : null,
    length: len ? len[1].replace(',', '.') : null,
    std: std ? `${std[1].toUpperCase()} ${std[2]}` : null,
  };
}

export const FACETS = [['wash', 'Мойка'], ['pipe', 'Труба'], ['section', 'Сечение'], ['grade', 'Марка'], ['thick', 'Толщина, мм'], ['type', 'Тип'], ['thread', 'Резьба'], ['length', 'Длина, мм'], ['std', 'Стандарт']];
/** Признаки металла (СМ.1) — из полей позиции, а не из названия; в «Остатках» уходят на сервер отдельными фильтрами. */
/** Вид трубы для кнопки и цвета: профильная, круглая, нержавеющая. */
export const PIPE_KINDS = [['rect', 'Профильная'], ['round', 'Круглая'], ['steel', 'Нержавейка']];
const pipeKind = (it) => (/нерж/i.test(it.name || '') ? 'steel' : it.dims?.diameter ? 'round' : 'rect');
/** Значение кнопки трубы: вид|сортамент|длина, мм (0 — куски). У чёрной и нержавеющей сечения совпадают, поэтому вид в значении. */
export const pipeKey = (it) => `${pipeKind(it)}|${it.assortment}|${it.dims?.length || 0}`;
export const pipeParts = (v) => {
  const parts = String(v ?? '').split('|');
  const [kind, section, len] = parts;
  // Старый адрес мог хранить одно сечение без вида/длины: хлебная крошка не должна падать.
  return { kind: parts.length === 1 ? 'rect' : kind, section: section ?? kind, len: Number.isFinite(Number(len)) ? Number(len) : 0 };
};
/** Подпись значения: без лишних слов — «80×80×3 6м», «Ø57×3,5 12м», лист «3 мм». */
export const facetLabel = (key, v) => {
  if (key === 'section') return String(v ?? '').replace(/^(Труба|Лист)\s+/i, '');
  if (key !== 'pipe') return v;
  const { section, len } = pipeParts(v);
  // section может быть пустым у старого адреса фильтра — не звать .replace у undefined (ошибка «для разбора» на складе).
  const label = String(section ?? '').replace(/^Труба\s+/i, '').replace(/\s*\(.*\)$/, '');
  return label ? `${label} ${len ? len / 1000 + 'м' : 'куски'}` : 'Сечение не указано';
};
const sizes = (v) => (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
const bySize = (a, b) => { const x = sizes(a), y = sizes(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };

/** Подготовить позиции: признаки + строка для поиска (один раз после загрузки). */
export function index(items) {
  // марка и сечение — одно написание на вариант (регистр, ё, лишние пробелы не различаем; берём самое частое), иначе в фильтре дубли (SPR-1)
  const one = (field) => {
    const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
    const k = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
    const n = new Map(), best = new Map();
    for (const it of items) { const v = clean(it[field]); if (v) n.set(v, (n.get(v) || 0) + 1); }
    for (const [v, c] of n) { const b = best.get(k(v)); if (!b || c > n.get(b)) best.set(k(v), v); }
    return (v) => (clean(v) ? best.get(k(v)) : null);
  };
  const section = one('assortment'), grade = one('materialGrade');
  for (const it of items) {
    const isPipe = it.metal === 'pipe' && !!it.assortment;
    // ручной тип важнее вычисленного (C043): typeName правит пользователь в «Изменить выбранные»
    const manual = it.typeName ? { type: String(it.typeName).trim() } : {};
    if (isPipe) {
      it._f = { pipe: pipeKey(it), wash: it.washed == null ? null : it.washed ? 'Мытая' : 'Не мытая', ...manual };
    } else {
      // C009 / СКФ.7: заполненные dimensions[] важнее разбора имени; имя — запасной источник
      const fromName = it.metal ? {} : facetsOf(it.name);
      const len = it.dims?.length != null ? String(it.dims.length) : (fromName.length || null);
      it._f = {
        ...fromName,
        ...manual,
        ...(len ? { length: len } : {}),
        section: section(it.assortment),
        grade: grade(it.materialGrade),
        thick: it.dims?.thickness != null ? String(it.dims.thickness) : null,
      };
    }
    it._s = normSearch([it.name, it.article, it.sku, it.categoryName, it.assortment, it.materialGrade].filter(Boolean).join(' '));
  }
  return items;
}

/** Отбор по запросу, категории и выбранным признакам. */
export function pick(items, { q = '', cat = '', sel = {} } = {}) {
  const tokens = searchTokens(q);
  return items.filter((it) => (!cat || it.categoryId === cat)
    && tokens.every((t) => it._s.includes(t))
    && Object.entries(sel).every(([k, v]) => !v || it._f[k] === v));
}

/** Значения признаков среди найденного (для кнопок-фильтров), по убыванию частоты; числа — по порядку. */
export function facetValues(items, key) {
  const m = new Map();
  for (const it of items) { const v = it._f[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
  const num = (v) => parseFloat(String(v).replace(/^M/, ''));
  if (key === 'pipe' || key === 'section') return [...m].sort((a, b) => bySize(a[0].split('|')[1] ?? a[0], b[0].split('|')[1] ?? b[0]) || (pipeParts(a[0]).len || 1e9) - (pipeParts(b[0]).len || 1e9));
  return [...m].sort((a, b) => (key === 'type' ? b[1] - a[1] || a[0].localeCompare(b[0], 'ru') : num(a[0]) - num(b[0]) || a[0].localeCompare(b[0])));
}

/** Слова-прилагательные и материалы, которые не могут быть типом (C043): «Алюминиевый» — прилагательное, тип — первое существительное («Соединитель»). Таблица — рядом с TYPE_FAMILIES; дополнена эвристикой окончаний в isTypeAdjective. */
export const TYPE_SKIP_WORDS = new Set([
  'алюминиевый', 'алюминиевая', 'алюминиевое', 'алюминиевые', 'алюм', 'алюминий',
  'оцинкованный', 'оцинкованная', 'оцинкованное', 'оцинкованные', 'оцинк', 'оцинковка',
  'нержавеющий', 'нержавеющая', 'нержавеющее', 'нержавеющие', 'нержав', 'нержавейка', 'нерж',
  'стальной', 'стальная', 'стальное', 'стальные', 'сталь',
  'медный', 'медная', 'медное', 'медные', 'медь', 'латунный', 'латунная', 'латунное', 'латунные', 'латунь',
  'хромированный', 'хромированная', 'хромированное', 'хромированные',
  'пластиковый', 'пластиковая', 'пластиковое', 'пластиковые',
  'полипропиленовый', 'полипропиленовая', 'полипропиленовое', 'полипропиленовые',
  'сменный', 'сменная', 'сменное', 'сменные',
]);
/** Существительные с «прилагательным» окончанием — тип, а не прилагательное («Изделие», «Крепление»). */
export const TYPE_NOUN_WORDS = new Set([
  'изделие', 'изделия', 'крепление', 'соединение', 'покрытие', 'основание', 'оборудование', 'приспособление',
  'строение', 'здание', 'снаряжение', 'сооружение',
]);

/** Семейства типов (C039): «полочки» шага «Тип» — id, подпись полки, правило по названию типа (первое совпадение сверху вниз). Одна копия: рисунки семейств — ui/cat-art.js FAMILY_ICON. */
export const TYPE_FAMILIES = [
  { id: 'rig', label: 'Такелаж и цепи', re: /рым|[cс]коб|шакле|вертлюг|цеп|х[ао]мут|карабин|зажим|петл|винт-кольц|такелаж/i },
  { id: 'washer', label: 'Шайбы', re: /шайб/i },
  { id: 'bolt', label: 'Болты и анкеры', re: /болт|анкер|дюбел/i },
  { id: 'nut', label: 'Гайки', re: /гайк/i },
  { id: 'screw', label: 'Саморезы и шурупы', re: /саморез|шуруп/i },
  { id: 'vint', label: 'Винты и шпильки', re: /^винт|шпильк/i },
  { id: 'rivet', label: 'Заклёпки', re: /закл[её]пк/i },
  { id: 'pipe', label: 'Трубы', re: /^труб/i },
  { id: 'sheet', label: 'Листы и профиль', re: /^лист|^профил|рифл|сетк/i },
  { id: 'cut', label: 'Сверла, фрезы, диски', re: /сверл|фрез|^бит[аы]?(\s|$)|^диск|^круг|цанг|лезви|^нож/i },
  { id: 'tool', label: 'Инструмент', re: /молот|рулетк|микрометр|штангенц|уровень|пистолет|шпател|[cс]труб|инструмент|весы|набор|сменн/i },
  { id: 'ppe', label: 'Защита и одежда', re: /перчатк|костюм|маска|пелерин/i },
  { id: 'chem', label: 'Краска, клей, плёнка', re: /краск|маркер|шпаклев|шпаклёв|шпатл|полиэтил|стреппинг|клей|смазк|скотч|стрейч|упаков|лент|рулоны|вспен|пэт/i },
  { id: 'bearing', label: 'Подшипники и пружины', re: /подшипник|^вал(\s|$)|модуль линейн|пружин|колес|втулк/i },
  { id: 'elec', label: 'Электрика', re: /неон|ибп|wi-?fi|роутер|блок|разъ[её]м|быстроразъ|марганц|lc\d/i },
  { id: 'play', label: 'Игровое оборудование', re: /качел|сиден/i },
  { id: 'fix', label: 'Крепёж и фурнитура', re: /соедин|креплен|фиксатор|прижим|заглушк|колпач|^опор|гильз|демпфер|пластин|подошв|механизм|^ручк/i }, // «Прочее» на проде 2026-11-08
];
const OTHER_FAMILY = { id: 'other', label: 'Прочее' };
/** Семейство типа по его названию ({ id, label }); не нашлось — «Прочее». */
export const familyOf = (type) => TYPE_FAMILIES.find((f) => f.re.test(String(type || '').trim())) || OTHER_FAMILY;

/** Типы по полочкам: [{ family, label, count, types:[{id,label,count}] }]. Полки с двумя и больше типами — по числу позиций, затем одиночные типы (шапка не нужна), «Прочее» последним; внутри полки — по числу позиций. */
export function typeGroups(items) {
  if (items.length && !items[0]._f) index(items);
  const by = new Map();
  for (const [id, count] of facetValues(items, 'type')) {
    const f = familyOf(id);
    if (!by.has(f.id)) by.set(f.id, { family: f.id, label: f.label, count: 0, types: [] });
    const g = by.get(f.id); g.count += count; g.types.push({ id, label: id, count });
  }
  const rank = (g) => (g.family === 'other' ? 2 : g.types.length > 1 ? 0 : 1);
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.label.localeCompare(b.label, 'ru'));
}

/** Шаг «Тип» воронки (П-1): типы выбранных позиций по полочкам (group — подпись полки, у одиночных типов пусто) и последняя фишка «Все типы». Пусто — шаг пропускают (skip). */
export const TYPE_ALL = '*';
export function typeValues(items) {
  const vals = typeGroups(items).flatMap((g) => g.types.map((t) => ({ ...t, group: g.types.length > 1 ? g.label : '' })));
  return vals.length ? [...vals, { id: TYPE_ALL, label: 'Все типы' }] : [];
}
/** Позиции выбранного типа ('' или «Все типы» — все). */
export const byType = (items, type) => (!type || type === TYPE_ALL ? items : items.filter((it) => it._f?.type === type));
