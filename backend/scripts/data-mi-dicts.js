/* МИ.1a (docs/roles/tz/MI.md, docs/TASKS.md «Фаза МИ»): чистые списки для справочников паспорта —
 * «Материалы и покрытия» (passportMaterials: дополнение), «Сортамент» (passportSortament, новый),
 * «Части изделия» (passportParts, новый) — из свободных текстов паспортов (productpassports.materials,
 * textSnapshot.description «изготовлено из …»).
 *
 * Как устроено: канонические списки ниже (МАТЕРИАЛЫ / ПОКРЫТИЯ / ЧАСТИ) — лучшее написание, выбранное хранителем
 * данных; разбор текстов только СЧИТАЕТ, какие написания встречались и в какое склеены, и печатает нераспознанное.
 * В базу попадает только то, что встретилось в текстах (или нужно для них), и только чего ещё нет.
 *
 *   План (ничего не пишет):   MONGO_URI=… [MONGO_DB=…] node scripts/data-mi-dicts.js
 *   Таблицы для DB-AUDIT:     … --md
 *   Записать:                 … --apply   (добавляет новые записи и дописывает ПУСТЫЕ поля существующих — ответ 1;
 *                                          заполненное не меняет, ничего не удаляет и не переименовывает; повтор ничего не дублирует)
 *
 * Решения пользователя 2026-10-24 (docs/QUESTIONS.md «МИ.1 спорные 1–15») зашиты в каноне и разборе; то, что скрипт
 * не вправе угадывать, он не пишет, а печатает блоком «ПРОВЕРИТЬ».
 * Поля — по backend/src/modules/dicts/dicts.defs.ts (bb91517): passportMaterials: kind, genSingular, genPlural,
 * sizeTemplate, phrase, madeOf, hideInNew; passportSortament: name, material, incomplete; passportParts: name, genSingular, genPlural.
 *
 * Запуск на VM (контейнер с mongoose; скрипт скопировать и выполнить из /app):
 *   docker cp backend/scripts/data-mi-dicts.js datacore-backend:/app/scripts/
 *   docker exec -e MONGO_URI="$MONGO_URI" -e MONGO_DB=datacore datacore-backend node scripts/data-mi-dicts.js [--md|--apply]
 * (MONGO_URI — как у бэкенда, из его окружения; `docker exec datacore-backend printenv MONGO_URI` не печатать в чат.)
 * НА ПРОДЕ — только координатор, после «да» пользователя и бэкапа: бэкап → план на копии прода → запись → отчёт. */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

// ───────── Канон: материалы (kind: material) и покрытия (kind: coating) ─────────
// sizeTemplate: {sizes} — размеры через «и»/запятую («∅89×3 и ∅33,5×2,8»); единица — в шаблоне один раз.
const MATERIALS = [
  { code: 'PIPE_STEEL', name: 'Труба стальная', genSingular: 'стальной трубы', genPlural: 'стальных труб', sizeTemplate: '{sizes} мм' },
  { code: 'PIPE_STEEL_PROFILE', name: 'Труба стальная профильная', genSingular: 'стальной профильной трубы', genPlural: 'стальных профильных труб', sizeTemplate: '{sizes} мм' },
  { code: 'SHEET_STEEL', name: 'Лист стальной', genSingular: 'стального листа', genPlural: 'стальных листов', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'BEAM_STEEL', name: 'Двутавр стальной', genSingular: 'стального двутавра', genPlural: 'стальных двутавров', sizeTemplate: '{sizes}' },
  { code: 'ROD_STEEL', name: 'Круг стальной', genSingular: 'стального круга', genPlural: 'стальных кругов', sizeTemplate: '{sizes} мм' },
  { code: 'PIPE_STAINLESS', name: 'Труба нержавеющая', genSingular: 'нержавеющей трубы', genPlural: 'нержавеющих труб', sizeTemplate: '{sizes} мм' },
  { code: 'SHEET_STAINLESS', name: 'Лист нержавеющий', genSingular: 'листа нержавеющей стали', genPlural: 'листов нержавеющей стали', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'CHAIN_STAINLESS', name: 'Цепь нержавеющая', genSingular: 'нержавеющей цепи', genPlural: 'нержавеющих цепей', sizeTemplate: 'со звеном {sizes} мм' },
  { code: 'CHAIN_STEEL', name: 'Цепь стальная сварная', genSingular: 'стальной сварной цепи', genPlural: 'стальных сварных цепей', sizeTemplate: 'со звеном {sizes} мм' },
  { code: 'CABLE_STEEL', name: 'Трос стальной', genSingular: 'стального троса', genPlural: 'стальных тросов', sizeTemplate: '{sizes} мм' },
  { code: 'ROPE_REINFORCED', name: 'Канат армированный', genSingular: 'армированного каната', genPlural: 'армированных канатов', sizeTemplate: '{sizes} мм' },
  { code: 'WOOD_SOFT', name: 'Древесина хвойных пород', genSingular: 'древесины хвойных пород', genPlural: 'древесины хвойных пород', sizeTemplate: 'сечением {sizes} мм' },
  { code: 'WOOD_LARCH', name: 'Древесина лиственницы', genSingular: 'древесины лиственницы', genPlural: 'древесины лиственницы', sizeTemplate: 'сечением {sizes} мм' }, // ответ 7: материал = порода
  { code: 'WOOD_LOG', name: 'Бревно оцилиндрованное', genSingular: 'оцилиндрованного бревна', genPlural: 'оцилиндрованных брёвен', sizeTemplate: 'диаметром {sizes} мм' },
  { code: 'WOOD_GLUED', name: 'Клеёная древесина', genSingular: 'клеёного бруса', genPlural: 'клеёных брусьев', sizeTemplate: '{sizes} мм' },
  { code: 'PLYWOOD', name: 'Фанера', genSingular: 'фанеры', genPlural: 'фанеры', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'PLYWOOD_FSF', name: 'Фанера ФСФ влагостойкая', genSingular: 'влагостойкой фанеры ФСФ', genPlural: 'влагостойкой фанеры ФСФ', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'PLYWOOD_LAM', name: 'Фанера ламинированная', genSingular: 'влагостойкой ламинированной фанеры', genPlural: 'влагостойкой ламинированной фанеры', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'POLYCARBONATE', name: 'Поликарбонат монолитный', genSingular: 'монолитного поликарбоната', genPlural: 'монолитного поликарбоната', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'ACP', name: 'Панель алюминиевая композитная', genSingular: 'алюминиевой композитной панели', genPlural: 'алюминиевых композитных панелей', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'PE_HD', name: 'Полиэтилен низкого давления (HDPE)', genSingular: 'полиэтилена низкого давления (HDPE)', genPlural: 'полиэтилена низкого давления (HDPE)', sizeTemplate: 'толщиной {sizes} мм' },
  { code: 'PLASTIC', name: 'Пластик', genSingular: 'пластика', genPlural: 'пластика', sizeTemplate: '' },
  { code: 'STEEL', always: true, name: 'Сталь', genSingular: 'стали', genPlural: 'стали', sizeTemplate: '' }, // ответ 14
  { code: 'CONCRETE', always: true, name: 'Бетон', genSingular: 'бетона', genPlural: 'бетона', sizeTemplate: '' }, // ответ 14
  { code: 'REED', name: 'Камыш кровельный', genSingular: 'кровельного камыша', genPlural: 'кровельного камыша', sizeTemplate: '' },
].map((m) => ({ kind: 'material', ...m }));

const COATINGS = [
  { code: 'COAT_POWDER', name: 'Порошковая окраска', phrase: 'Окрашено порошковой краской методом запекания в заводских условиях.', re: /порошков|полимерн/i },
  { code: 'COAT_PRIMER_PU', name: 'Грунт и полиуретановая эмаль', phrase: 'Металл покрыт двухслойным грунтом и атмосферостойкой полиуретановой эмалью.', re: /грунт|эмал/i },
  { code: 'COAT_RUBBER', name: 'Резиновое покрытие металла', phrase: 'Металл покрыт резиновой крошкой.', re: /резинов\S*\s+(крошк|покрыти)/i },
  { code: 'COAT_OIL', name: 'Масло для древесины', phrase: 'Древесина покрыта маслом.', re: /масл/i },
  { code: 'COAT_IMPREG', name: 'Защитная пропитка древесины', phrase: 'Древесина обработана защитными пропитками.', re: /пропитк/i },
].map((c) => ({ kind: 'coating', sizeTemplate: '', ...c }));

// ───────── Канон: части изделия (имя — им. п. ед. ч.; формы — род. п. для «Состоит из …») ─────────
const PARTS = [
  ['Стойка', 'стойки', 'стоек', /^стоек|^стойк|ст[о]?лб/], // ответ 6: «столб» = «стойка»
  ['Перекладина', 'перекладины', 'перекладин', /перекладин/],
  ['Хомут', 'хомута', 'хомутов', /х[ао]мут/],
  ['Несущая рама', 'несущей рамы', 'несущих рам', /несущ\S* рам/],
  ['Ручка', 'ручки', 'ручек', /ручк|ручек/],
  ['Рычаг', 'рычага', 'рычагов', /рычаг/],
  ['Упор для ног', 'упора для ног', 'упоров для ног', /упор\S* для ног/],
  ['Упор для груди', 'упора для груди', 'упоров для груди', /упор\S* для груди/],
  ['Упор для спины', 'упора для спины', 'упоров для спины', /упор\S* для спины/],
  ['Сиденье', 'сиденья', 'сидений', /сидени|сиденье|сидения|сиденья/],
  ['Спинка', 'спинки', 'спинок', /спинк|спинок/],
  ['Лежак', 'лежака', 'лежаков', /лежак/],
  ['Подлокотник', 'подлокотника', 'подлокотников', /подл[ао]к[о]?тник/],
  ['Гиря', 'гири', 'гирь', /гир[иьяей]/],
  ['Подставка для ног поворотная', 'поворотной подставки для ног', 'поворотных подставок для ног', /подставк/],
  ['Стул откидной', 'откидного стула', 'откидных стульев', /стул/],
  ['Ступень', 'ступени', 'ступеней', /ступен/],
  ['Крючок для крепления сетки', 'крючка для крепления сетки', 'крючков для крепления сетки', /крючк/],
  ['Сетка', 'сетки', 'сеток', /^сетк[аи]?$|^сеток$/, /крючк/],
  ['Щит', 'щита', 'щитов', /^[щш]ит/],
  ['Тумба', 'тумбы', 'тумб', /тумб/],
  ['Кольцо гимнастическое', 'гимнастического кольца', 'гимнастических колец', /кольц|колец/],
  ['Покрышка', 'покрышки', 'покрышек', /[пп][ао]крышк/],
  ['Ролик для троса', 'ролика для троса', 'роликов для троса', /ролик/],
  ['Петля', 'петли', 'петель', /петл|петел/],
  ['Задвижка', 'задвижки', 'задвижек', /задвижк/],
].map(([name, genSingular, genPlural, re, not]) => ({ name, genSingular, genPlural, re, not }));

// ───────── Разбор текста ─────────
const s = (v) => (v == null ? '' : String(v));
const norm = (v) => s(v).toLowerCase().replace(/ё/g, 'е').replace(/[xхX]/g, '×').replace(/\./g, ',').replace(/\s+/g, ' ').trim();
const num = (v) => s(v).replace('.', ',').replace(/,0$/, '');
const N = '(\\d+(?:[.,]\\d+)?)';
const X = '\\s*[хxХX×*]\\s*';

// Слово-контекст → материал (последнее слово перед размером решает, к чему размер). null — «не материал» (гири, скобы…).
const CTX = [
  [/^нерж/, 'STAINLESS'], [/^д?у?тавр|^дутавр|^двутавр/, 'BEAM_STEEL'], [/^вгп/, 'PIPE_STEEL_VGP'], [/^круг[аы]?$/, 'ROD_STEEL'],
  [/^канат/, 'ROPE_REINFORCED'], [/^цеп/, 'CHAIN'], [/^трос/, 'CABLE_STEEL'], [/^звено/, 'KEEP'],
  [/^бревн|^дерево$/, 'WOOD_LOG'], [/^брус/, 'WOOD_BEAM'], [/^доск|^досок/, 'WOOD_BOARD'], [/^лиственниц/, 'WOOD_LARCH'],
  [/^древесин/, 'WOOD_SOFT'], [/^ламинирован/, 'KEEP'], [/^клеен|^клеён/, 'WOOD_GLUED'],
  [/^фан[ае]?ер/, 'PLYWOOD'], [/^фсф/, 'PLYWOOD_FSF'], [/^поликарбонат/, 'POLYCARBONATE'], [/^акп/, 'ACP'], [/^hdpe|^пнд/, 'PE_HD'],
  [/^пол[иеe]карбонат/, 'POLYCARBONATE'], [/^пластик/, 'PLASTIC'], [/^бетон(?!ир)/, 'CONCRETE'], [/^камыш/, 'REED'],
  [/^лист|^металлопрокат$|^листов|^листа$/, 'SHEET_STEEL'], [/^профил|^профильн|^прямоугольн|^квадратн|^металлопроката$/, 'PIPE_STEEL_PROFILE'],
  [/^труб|^круглог|^круглой|^круглых|^диамет/, 'PIPE'],
  [/^гир|^скоб|^фланц|^сидень|^сидени|^покрышк|^пакрышк|^пружин|^механизм|^кольц|^сетк|^шт$|^кг$|^подвес|^длин|^высот|^ширин|^глубин|^бетонир|^пвд|^скоб|^стенк|^госта?$|^гост|^din|^отверст|^звень/, null],
];
const ctxOf = (w) => { const lw = w.toLowerCase(); for (const [re, v] of CTX) if (re.test(lw)) return { v, hit: true }; return { hit: false }; };

/** Разбор одного текста: [{ code, size, raw }] — материалы с размерами (size '' — материал без размера), [{ raw }] — нераспознанные размеры. */
function parseMaterials(text) {
  const out = []; const left = [];
  let t = s(text).replace(/\(ГОСТ[^)]*\)/gi, ' ').replace(/ГОСТ\s*Р?\s*[\d.–-]+/gi, ' ').replace(/DIN\s*\d+/gi, ' ').replace(/R\d+/g, ' ')
    .replace(/нерж\./gi, 'нерж ').replace(/х\.\s*п\./gi, 'хвойных пород');
  // диапазоны («лист 2–8мм», «Ø33–48мм», «от 300 до 380мм», «6+8мм») — не размер сортамента: человеку
  t = t.replace(/(?:[∅Ø⌀]\s*)?\d+(?:[.,]\d+)?\s*(?:[–+-]|до)\s*\d+(?:[.,]\d+)?\s*мм|от\s+\d+\s+до\s+\d+\s*мм/gi, (r) => { left.push({ raw: r.trim(), why: 'диапазон или сумма вместо размера' }); return ' '; });
  for (const sentence of t.split(/\.(?!\d)|\n/)) {
    let ctx = null; let pipeHint = false; let dia = false; let lastWord = ''; let chainSS = false; let stopped = false; let larch = false;
    const seen = new Set();
    const chainSteel = /(сварн|стальн)\S*\s+цеп|цеп\S*\s+(сварн|стальн)/i.test(sentence);
    const add = (code, size, raw) => {
      if (code === 'PIPE_STEEL_VGP') code = 'PIPE_STEEL'; // ответ 10: ВГП — не отдельный материал
      if (/^WOOD_(SOFT|BEAM|BOARD)$/.test(code)) code = larch ? 'WOOD_LARCH' : 'WOOD_SOFT'; // ответ 7: материал = порода
      if (code === 'CHAIN_UNKNOWN') { left.push({ raw: `цепь ${size.replace('∅', '')} мм: «${raw.trim()}»`, why: 'цепь без «нерж.» — стальная сварная или нержавеющая?', chk: true }); return; } // ответ 11
      const k = code + '|' + size; if (!seen.has(k)) { seen.add(k); out.push({ code, size, raw: raw.trim(), word: lastWord }); } };
    // события по порядку: слово или размер
    const re = new RegExp(`([∅Ø⌀]\\s*${N}(?:${X}${N})?(?:\\s*мм)?)|(${N}${X}${N}(?:${X}${N})?(?:\\s*мм)?)|(${N}(?:\\s*(?:,|и)\\s*${N})*(?:\\s*,)?\\s*мм)|(${N}(?:\\s*,\\s*${N})+)|([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё-]*)`, 'g');
    let m;
    while ((m = re.exec(sentence))) {
      if (m[14]) { // слово
        const w = m[14]; const c = ctxOf(w);
        if (/^лиственниц/i.test(w)) larch = true;
        if (/^диамет/i.test(w)) dia = true;
        else if (c.hit && c.v !== 'PIPE' && c.v !== 'KEEP' && c.v !== 'STAINLESS') { dia = false; pipeHint = false; }
        if (/^кругл/i.test(w)) pipeHint = true;
        if (c.hit) {
          if (c.v === 'KEEP') continue;
          if (c.v === 'PIPE' && /^диамет/i.test(w) && stopped) continue; // «кольцо … диаметром 165 мм» — не труба
          stopped = c.v === null;
          if (c.v === 'PIPE') { if (ctx === 'STAINLESS' && /^труб/i.test(w)) pipeHint = true; if (!/^(STAINLESS|PIPE_STEEL_VGP|ROD_STEEL|WOOD|CHAIN|ROPE|CABLE)/.test(ctx || '')) ctx = 'PIPE'; }
          else if (c.v === 'SHEET_STEEL' && ctx === 'STAINLESS') { pipeHint = false; /* «лист нерж.» */ }
          else if (c.v === 'WOOD_SOFT' && ['WOOD_BEAM', 'WOOD_LOG', 'WOOD_BOARD'].includes(ctx)) { /* «брус из древесины» */ }
          else if (c.v === 'PLYWOOD_FSF' && /PLYWOOD/.test(ctx || '')) ctx = 'PLYWOOD_FSF';
          else if (c.v === 'STAINLESS' && ctx === 'CHAIN') chainSS = true;
          else if (c.v === 'WOOD_BEAM' && ctx === 'WOOD_GLUED') { /* «клеёного бруса» */ }
          else if (c.v === 'CHAIN') { chainSS = ctx === 'STAINLESS'; ctx = 'CHAIN'; }
          else ctx = c.v;
          lastWord = w;
          if (/^(дерев|диамет)/i.test(w)) continue; // слово без материала: «дерево покрыто маслом», «диаметром»
          if (c.v && !['PIPE', 'STAINLESS', 'CHAIN', 'WOOD_LARCH'].includes(c.v)) add(c.v === 'PIPE_STEEL_PROFILE' || c.v === 'SHEET_STEEL' ? c.v : c.v, '', w);
          if (c.v === 'PIPE') add('PIPE', '', w);
        }
        continue;
      }
      const raw = m[0];
      const code = (base) => {
        if (ctx === 'STAINLESS') return base === 'thick' ? 'SHEET_STAINLESS' : 'PIPE_STAINLESS';
        if (ctx === 'CHAIN') return chainSS ? 'CHAIN_STAINLESS' : chainSteel ? 'CHAIN_STEEL' : 'CHAIN_UNKNOWN';
        if (ctx === 'PLYWOOD' && /^\s*ламинир/i.test(sentence.slice(re.lastIndex, re.lastIndex + 20))) return 'PLYWOOD_LAM';
        if (ctx === 'WOOD_LARCH') return base === 'rect2' ? 'WOOD_LARCH' : null;
        return ctx;
      };
      if (m[1]) { // ∅d[×s]
        const d = num(m[2]); const w = m[3] ? num(m[3]) : '';
        let c = code('dia');
        if (!c && stopped) { left.push({ raw: raw.trim(), why: `размер не материала (рядом «${lastWord}»)` }); continue; }
        if (!c || c === 'PIPE' || c === 'PIPE_STEEL_PROFILE' || c === 'SHEET_STEEL') c = 'PIPE_STEEL';
        if (c === 'WOOD_BEAM' || c === 'WOOD_SOFT') c = 'WOOD_LOG';
        const size = c.startsWith('WOOD') || c.startsWith('CHAIN') || c === 'ROPE_REINFORCED' ? '∅' + d : '∅' + d + (w ? '×' + w : '');
        add(c, size, raw); if (c.startsWith('WOOD') && w) left.push({ raw: sentence.trim().slice(0, 80), why: `«${raw.trim()}» у дерева/бревна — «×${w}» не берём (длина/стенка?)`, chk: true });
        continue;
      }
      if (m[4]) { // a×b[×c]
        const a = num(m[5]); const b = num(m[6]); const c3 = m[7] ? num(m[7]) : '';
        const big = (x, y) => (parseFloat(x.replace(',', '.')) >= parseFloat(y.replace(',', '.')) ? [x, y] : [y, x]);
        let c = code(c3 ? 'rect3' : 'rect2');
        if (c3 && parseFloat(c3.replace(',', '.')) > 20) { left.push({ raw: raw.trim(), why: 'третий размер — не толщина стенки' }); continue; }
        if (c3) { const [p, q] = big(a, b); if (c === 'BEAM_STEEL') add(c, `${a}×${b}×${c3}`, raw); else add('PIPE_STEEL_PROFILE', `${p}×${q}×${c3}`, raw); continue; }
        if (c === 'BEAM_STEEL') { const h = Math.max(parseFloat(a.replace(',', '.')), parseFloat(b.replace(',', '.'))); if (h % 10 === 0) add(c, `№ ${h / 10}`, raw); else left.push({ raw: raw.trim(), why: 'двутавр: номер по высоте не определить', chk: true }); continue; } // ответ 11
        if (c === 'PIPE_STEEL_VGP') { const k = b === '2,8' ? { 20: '∅26,8×2,8', 25: '∅33,5×2,8' }[a] : null; add('PIPE_STEEL', k || `∅${a}×${b}`, raw); continue; } // ответ 10
        if (c && c.startsWith('WOOD')) { const [p, q] = big(a, b); add(c === 'WOOD_LOG' ? 'WOOD_BEAM' : c, `${q}×${p}`, raw); continue; }
        if (parseFloat(b.replace(',', '.')) <= 6 && c !== 'PIPE_STEEL_PROFILE') { add(c === 'STAINLESS' || c === 'PIPE_STAINLESS' ? 'PIPE_STAINLESS' : 'PIPE_STEEL', `∅${a}×${b}`, raw); continue; }
        const [p, q] = big(a, b);
        add('PIPE_STEEL_PROFILE', `${p}×${q}`, raw); left.push({ raw: raw.trim(), why: `профиль ${p}×${q} без толщины стенки` });
        continue;
      }
      // список чисел: «Лист 2,3,4,6,8 мм», «6, 2, 1,5 мм», «2 и 6мм», «42,3мм»
      const list = raw.replace(/\s*мм$/, '');
      const spaced = /,\s/.test(list);
      const isDia = dia || ctx === 'PIPE' || pipeHint;
      let vals;
      if (spaced) vals = list.split(/\s*,\s+|\s+и\s+/);
      else vals = list.split(/\s*и\s*/).flatMap((p) => (/^\d+,\d+$/.test(p.trim()) ? (!isDia && thickCtx(ctx) && !/^1,/.test(p.trim()) ? p.split(',') : [p]) : p.split(',')));
      vals = vals.map((v) => num(v.trim())).filter((v) => /^\d+(,\d+)?$/.test(v));
      if (!vals.length) continue;
      let c = code(isDia ? 'dia' : 'thick');
      if (!c && stopped) { left.push({ raw: raw.trim(), why: `размер не материала (рядом «${lastWord}»)` }); continue; }
      for (const v of vals) {
        if (c === 'PIPE' && !dia && !pipeHint && parseFloat(v.replace(',', '.')) < 10) { left.push({ raw: raw.trim(), why: 'у трубы — одно число меньше 10 мм (стенка?)' }); continue; }
        if (isDia) { const cc = c && c !== 'PIPE' && c !== 'PIPE_STEEL_PROFILE' && c !== 'SHEET_STEEL' ? c : 'PIPE_STEEL'; add(cc === 'WOOD_BEAM' || cc === 'WOOD_SOFT' ? 'WOOD_LOG' : cc, '∅' + v, raw); continue; }
        if (c === 'CHAIN_STAINLESS' || c === 'CHAIN_STEEL' || c === 'CHAIN_UNKNOWN' || c === 'ROPE_REINFORCED' || c === 'ROD_STEEL' || c === 'CABLE_STEEL' || c === 'WOOD_LOG') { add(c, '∅' + v, raw); continue; }
        if (['SHEET_STEEL', 'SHEET_STAINLESS', 'PLYWOOD', 'PLYWOOD_FSF', 'PLYWOOD_LAM', 'POLYCARBONATE', 'ACP'].includes(c)) { add(c, v, raw); continue; }
        if (c === 'WOOD_BOARD') { add(c, v, raw); continue; }
        left.push({ raw: raw.trim(), why: `размер без материала (рядом «${lastWord || '—'}»)` });
      }
    }
  }
  // «труба/труб» без размера: если в тексте нет других труб — круглая стальная
  const res = out.filter((r) => r.code !== 'PIPE' || !out.some((o) => o.code === 'PIPE_STEEL' || o.code === 'PIPE_STEEL_PROFILE' || o.code === 'PIPE_STAINLESS'))
    .map((r) => (r.code === 'PIPE' ? { ...r, code: 'PIPE_STEEL' } : r));
  if (!res.length) left.push({ raw: s(text).trim().slice(0, 90), why: 'текст без распознанного материала' });
  return { items: res, left };
}
function thickCtx(c) { return ['SHEET_STEEL', 'SHEET_STAINLESS', 'PLYWOOD', 'PLYWOOD_FSF', 'PLYWOOD_LAM', 'POLYCARBONATE', 'ACP', 'STAINLESS'].includes(c); }

/** «Состоит из …» → части. */
function parseParts(text) {
  const out = []; const left = [];
  const t = s(text).replace(/\bC(?=[а-яё])/g, 'С');
  for (const m of t.matchAll(/состоит из ([^.]*)/gi)) {
    for (const piece0 of m[1].split(/,|\sи\s/)) {
      const piece = piece0.trim().toLowerCase(); if (!piece) continue;
      const words = piece.split(/\s+/);
      let hit = false;
      for (const p of PARTS) {
        const ok = (p.re.source.includes(' ') ? p.re.test(piece) : words.some((w) => p.re.test(w))) && !(p.not && p.not.test(piece));
        if (ok) { out.push({ name: p.name, raw: piece0.trim() }); hit = true; }
      }
      if (!hit && !/^\d|кг$|^по \d/.test(piece)) left.push(piece0.trim());
    }
  }
  return { items: out, left };
}

const parseCoatings = (text) => COATINGS.filter((c) => c.re.test(s(text)) && (c.code !== 'COAT_POWDER' || /окраш|покры|краск|красител/i.test(s(text))))
  .map((c) => ({ code: c.code, raw: (s(text).match(new RegExp(`[^.,]*(${c.re.source})[^.,]*`, 'i')) || [''])[0].trim() }));

// ───────── Основное ─────────
(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const md = process.argv.includes('--md');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const dv = db.collection('dict_values');

  // источники: свободный текст паспортов + «изготовлено из …» снимков
  const groups = await db.collection('productpassports').aggregate([
    { $match: { deletedAt: null } },
    { $project: { t: { $concat: [{ $ifNull: ['$materials', ''] }, ' ¶ ', { $ifNull: ['$textSnapshot.description', ''] }] } } },
    { $group: { _id: '$t', n: { $sum: 1 } } },
  ]).toArray();
  const totalPp = groups.reduce((a, g) => a + g.n, 0);

  const mat = new Map(); // code → { n, sizes: Map(size → { n, raw: Map }) , words: Map }
  const parts = new Map(); const coats = new Map(); const leftSizes = new Map(); const leftParts = new Map(); const check = new Map();
  const bump = (map, k, n) => map.set(k, (map.get(k) || 0) + n);
  let withText = 0;
  for (const g of groups) {
    const [own, snap] = s(g._id).split(' ¶ ');
    const madeOf = (s(snap).match(/изготовлен[оа]? из ([^.;]*)/i) || [])[1] || '';
    const text = [own, madeOf].filter(Boolean).join('. ');
    if (!text.trim()) continue;
    withText += g.n;
    const pm = parseMaterials(text);
    // ответ 5: ∅33,7×2,8 в том же паспорте, где есть ∅33,5×2,8 — это она; иначе не угадываем
    if (pm.items.some((i) => i.code === 'PIPE_STEEL' && i.size === '∅33,7×2,8')) {
      if (!pm.items.some((i) => i.code === 'PIPE_STEEL' && i.size === '∅33,5×2,8')) bump(check, 'труба ∅33,7×2,8 без ∅33,5×2,8 в том же паспорте — проверить по чертежу (в сортамент не добавляется)', g.n);
      pm.items = pm.items.filter((i) => !(i.code === 'PIPE_STEEL' && i.size === '∅33,7×2,8'));
    }
    for (const it of pm.items) {
      const e = mat.get(it.code) || { n: 0, sizes: new Map(), words: new Map() }; mat.set(it.code, e);
      if (!it.size) { bump(e.words, it.raw.toLowerCase(), g.n); continue; }
      const z = e.sizes.get(it.size) || { n: 0, raw: new Map() }; e.sizes.set(it.size, z);
      z.n += g.n; bump(z.raw, it.raw.replace(/\s+/g, ' ').replace(/[,\s]+$/, ''), g.n);
    }
    for (const code of new Set(pm.items.map((i) => i.code))) mat.get(code).n += g.n;
    for (const l of pm.left) bump(l.chk ? check : leftSizes, `${l.why} · «${l.raw}»`, g.n);
    const pp = parseParts(own);
    const seenP = new Set();
    for (const it of pp.items) { const e = parts.get(it.name) || { n: 0, raw: new Map() }; parts.set(it.name, e); if (!seenP.has(it.name)) e.n += g.n; seenP.add(it.name); bump(e.raw, it.raw.toLowerCase(), g.n); }
    for (const l of pp.left) bump(leftParts, l, g.n);
    for (const c of parseCoatings(own)) { const e = coats.get(c.code) || { n: 0, raw: new Map() }; coats.set(c.code, e); e.n += g.n; bump(e.raw, c.raw.toLowerCase(), g.n); }
  }

  // что уже есть в базе (в т. ч. в корзине — не дублируем и их)
  const have = async (dict) => dv.find({ dict }).project({ code: 1, name: 1, material: 1, deletedAt: 1, kind: 1, genSingular: 1, genPlural: 1, sizeTemplate: 1, phrase: 1, madeOf: 1, hideInNew: 1, incomplete: 1 }).toArray();
  const exM = await have('passportMaterials'); const exS = await have('passportSortament'); const exP = await have('passportParts');
  const exMCodes = new Set(exM.map((d) => s(d.code))); const exMNames = new Set(exM.map((d) => norm(d.name)));
  const exSKeys = new Set(exS.map((d) => s(d.material) + '|' + norm(d.name))); const exPNames = new Set(exP.map((d) => norm(d.name)));

  const usedM = [...MATERIALS, ...COATINGS].filter((m) => mat.has(m.code) || coats.has(m.code) || m.always);
  const addM = usedM.filter((m) => !exMCodes.has(m.code) && !exMNames.has(norm(m.name)));
  // ответ 4: размер без стенки — «неполный», в выборе ниже полных; с полными не склеиваем
  const isIncomplete = (material, name) => (['PIPE_STEEL', 'PIPE_STAINLESS'].includes(material) && /^∅[\d,]+$/.test(name)) || (material === 'PIPE_STEEL_PROFILE' && /^[\d,]+×[\d,]+$/.test(name));
  const sortament = [];
  for (const m of MATERIALS) for (const [size, z] of [...(mat.get(m.code)?.sizes || new Map())].sort((a, b) => (isIncomplete(m.code, a[0]) - isIncomplete(m.code, b[0])) || b[1].n - a[1].n)) sortament.push({ material: m.code, name: size, n: z.n, raw: z.raw, incomplete: isIncomplete(m.code, size) });
  const addS = sortament.filter((r) => !exSKeys.has(r.material + '|' + norm(r.name)));
  const addP = PARTS.filter((p) => parts.has(p.name) && !exPNames.has(norm(p.name)));
  // ответ 1: у существующих записей дописываем только ПУСТЫЕ поля; ответ 2: STEEL_POWDER не предлагать в новых
  const empty = (v) => v == null || v === '';
  const canon = [...MATERIALS, ...COATINGS];
  const patches = []; // { dict, _id, label, set }
  for (const d of exM) {
    if (d.deletedAt) continue;
    if (s(d.code).toUpperCase() === 'STEEL_POWDER') { if (empty(d.hideInNew)) patches.push({ dict: 'passportMaterials', _id: d._id, label: d.name, set: { hideInNew: true } }); continue; }
    const c = canon.find((m) => s(d.code) === m.code || norm(d.name) === norm(m.name));
    if (!c) { bump(check, `существующий материал «${d.name}» [${s(d.code)}] — нет в каноне скрипта, поля не дописаны`, 1); continue; }
    const set = {};
    for (const [k, v] of [['kind', c.kind], ['genSingular', c.genSingular], ['genPlural', c.genPlural], ['sizeTemplate', c.sizeTemplate], ['phrase', c.phrase], ['madeOf', c.genSingular]]) if (v && empty(d[k])) set[k] = v;
    if (Object.keys(set).length) patches.push({ dict: 'passportMaterials', _id: d._id, label: `${d.name} [${s(d.code)}]`, set });
  }
  for (const d of exS) if (!d.deletedAt && empty(d.incomplete) && isIncomplete(s(d.material), s(d.name))) patches.push({ dict: 'passportSortament', _id: d._id, label: `${d.material} ${d.name}`, set: { incomplete: true } });
  for (const d of exP) {
    if (d.deletedAt) continue;
    if (norm(d.name) === 'столб') bump(check, 'в «Частях изделия» уже есть «Столб» — по ответу 6 это «Стойка»: объединить в админке (кнопка объединения), скрипт не трогает', 1);
    const p = PARTS.find((x) => norm(x.name) === norm(d.name)); if (!p) continue;
    const set = {}; if (empty(d.genSingular)) set.genSingular = p.genSingular; if (empty(d.genPlural)) set.genPlural = p.genPlural;
    if (Object.keys(set).length) patches.push({ dict: 'passportParts', _id: d._id, label: d.name, set });
  }
  const nFields = (dict) => patches.filter((x) => x.dict === dict).reduce((a, x) => a + Object.keys(x.set).length, 0);
  // ответ 7: форма по ГОСТ 18288 — по сечению (справочно; хранить форму пока негде)
  const woodForm = (size) => { const m = /^([\d,]+)×([\d,]+)$/.exec(size); if (!m) return ''; const [t, w] = [m[1], m[2]].map((x) => parseFloat(x.replace(',', '.'))).sort((a, b) => a - b); return t > 100 && w > 100 ? 'брус' : w > 2 * t ? 'доска' : 'брусок'; };
  const nameOf = (code) => [...MATERIALS, ...COATINGS].find((m) => m.code === code)?.name || code;

  const top = (map, k = 6) => [...map].sort((a, b) => b[1] - a[1]).slice(0, k).map(([r, n]) => `«${r}» ${n}`).join(', ');
  if (!md) {
    console.log(`База ${db.databaseName}: паспортов ${totalPp}, с текстом материалов ${withText}`);
    console.log(`\n1) Материалы и покрытия — добавить ${addM.length} (есть в справочнике: ${exM.length}):`);
    for (const m of usedM) console.log(`  ${addM.includes(m) ? '+' : '='} ${m.kind === 'coating' ? 'покрытие' : 'материал'} · ${m.name} [${m.code}] · ${m.genSingular || ''} / ${m.genPlural || ''} · ${m.sizeTemplate || m.phrase || ''} · паспортов ${(mat.get(m.code) || coats.get(m.code) || { n: 0 }).n}`);
    console.log(`\n2) Сортамент — добавить ${addS.length}:`);
    for (const m of MATERIALS) { const r = sortament.filter((x) => x.material === m.code); if (r.length) console.log(`  ${m.name}: ${r.map((x) => `${x.name}${x.incomplete ? '*' : ''} (${x.n})`).join(', ')}`); }
    console.log('  * — неполный размер (без стенки): incomplete=true, в выборе ниже полных');
    console.log(`\n3) Части изделия — добавить ${addP.length}: ${PARTS.filter((p) => parts.has(p.name)).map((p) => `${p.name} (${parts.get(p.name).n})`).join(', ')}`);
    console.log(`\n4) Склейки написаний (размер ← написания, раз):`);
    for (const r of sortament) if (r.raw.size > 1 || [...r.raw.keys()][0] !== r.name) console.log(`  ${nameOf(r.material)} ${r.name} ← ${top(r.raw)}`);
    for (const [name, e] of parts) console.log(`  часть ${name} ← ${top(e.raw)}`);
    for (const [code, e] of coats) console.log(`  покрытие ${nameOf(code)} ← ${top(e.raw, 4)}`);
    console.log(`\n5) Не распознано (решает человек): размеры ${leftSizes.size}, части ${leftParts.size}`);
    for (const [k, n] of [...leftSizes].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);
    for (const [k, n] of [...leftParts].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× часть «${k}»`);
    console.log(`\n6) Дописать пустые поля у существующих (ответы 1, 2): записей ${patches.length}`);
    for (const x of patches) console.log(`  ${x.dict} · ${x.label} ← ${Object.entries(x.set).map(([k, v]) => k + '=' + v).join('; ')}`);
    console.log('\n7) Форма дерева по ГОСТ 18288 (справочно, в базу не пишется — поля формы нет):');
    for (const m of MATERIALS.filter((x) => x.code.startsWith('WOOD_') && x.code !== 'WOOD_LOG' && x.code !== 'WOOD_GLUED')) { const r = sortament.filter((x) => x.material === m.code); if (r.length) console.log(`  ${m.name}: ${r.map((x) => `${x.name} — ${woodForm(x.name) || '?'}`).join(', ')}`); }
  } else {
    const esc = (v) => s(v).replace(/\|/g, '\\|');
    console.log('| | Тип | Название | Код | Род. п. ед. | Род. п. мн. | Шаблон размера / фраза | Паспортов |\n|--|--|--|--|--|--|--|--|');
    for (const m of usedM) console.log(`| ${addM.includes(m) ? '+' : '= есть'} | ${m.kind === 'coating' ? 'покрытие' : 'материал'} | ${m.name} | ${m.code} | ${m.genSingular || ''} | ${m.genPlural || ''} | ${esc(m.sizeTemplate || m.phrase)} | ${(mat.get(m.code) || coats.get(m.code) || { n: 0 }).n} |`);
    console.log('\n| Материал | Размеры (паспортов) |\n|--|--|');
    for (const m of MATERIALS) { const r = sortament.filter((x) => x.material === m.code); if (r.length) console.log(`| ${m.name} | ${r.map((x) => `${x.name} (${x.n})`).join(', ')} |`); }
    console.log('\n| Часть (им. п.) | Род. п. ед. | Род. п. мн. | Паспортов |\n|--|--|--|--|');
    for (const p of PARTS) if (parts.has(p.name)) console.log(`| ${p.name} | ${p.genSingular} | ${p.genPlural} | ${parts.get(p.name).n} |`);
    console.log('\n| Склеено в | Написания в текстах (сколько раз) |\n|--|--|');
    for (const r of sortament) if (r.raw.size > 1 || [...r.raw.keys()][0] !== r.name) console.log(`| ${nameOf(r.material)} **${r.name}** | ${esc(top(r.raw, 8))} |`);
    for (const p of PARTS) if (parts.has(p.name)) console.log(`| часть **${p.name}** | ${esc(top(parts.get(p.name).raw, 8))} |`);
    for (const [code, e] of coats) console.log(`| покрытие **${nameOf(code)}** | ${esc(top(e.raw, 4))} |`);
    for (const m of MATERIALS) { const e = mat.get(m.code); if (e && e.words.size) console.log(`| материал **${m.name}** (слова) | ${esc(top(e.words, 8))} |`); }
    console.log('\nНе распознано:');
    for (const [k, n] of [...leftSizes].sort((a, b) => b[1] - a[1])) console.log(`- ${n}× ${esc(k)}`);
    for (const [k, n] of [...leftParts].sort((a, b) => b[1] - a[1])) console.log(`- ${n}× часть «${esc(k)}»`);
  }
  // «проверить» — решает человек, скрипт не угадывает (выводится всегда)
  console.log(`\nПРОВЕРИТЬ (${check.size}) — скрипт ничего не угадывал и не записывает:`);
  for (const [k, n] of [...check].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);

  if (apply) {
    const now = new Date(); const base = { deletedAt: null, createdAt: now, updatedAt: now };
    const strip = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 're' && k !== 'always'));
    if (addM.length) console.log(`\n+ Материалы и покрытия: ${(await dv.insertMany(addM.map((m) => ({ dict: 'passportMaterials', ...strip(m), madeOf: m.genSingular || '', ...base })))).insertedCount}`);
    if (addS.length) console.log(`+ Сортамент: ${(await dv.insertMany(addS.map((r) => ({ dict: 'passportSortament', name: r.name, material: r.material, ...(r.incomplete ? { incomplete: true } : {}), ...base })))).insertedCount}`);
    if (addP.length) console.log(`+ Части изделия: ${(await dv.insertMany(addP.map((p) => ({ dict: 'passportParts', name: p.name, genSingular: p.genSingular, genPlural: p.genPlural, ...base })))).insertedCount}`);
    for (const x of patches) await dv.updateOne({ _id: x._id }, { $set: { ...x.set, updatedAt: now } }); // только пустые поля (проверено выше)
    if (patches.length) console.log(`~ Дописано пустых полей у существующих: записей ${patches.length}`);
    if (!addM.length && !addS.length && !addP.length && !patches.length) console.log('\nДобавлять и дописывать нечего — всё уже есть.');
  } else {
    console.log('\n════ ОТЧЁТ ПЛАНА ════');
    console.log(`Материалы и покрытия: добавится ${addM.length}, дописывается пустых полей ${nFields('passportMaterials')} (в ${patches.filter((x) => x.dict === 'passportMaterials').length} записях)`);
    console.log(`Сортамент:            добавится ${addS.length} (из них неполных ${addS.filter((x) => x.incomplete).length}), дописывается пустых полей ${nFields('passportSortament')}`);
    console.log(`Части изделия:        добавится ${addP.length}, дописывается пустых полей ${nFields('passportParts')}`);
    console.log(`Проверить (решает человек): ${check.size} пунктов — см. блок ПРОВЕРИТЬ выше`);
    console.log('Ничего не записано. Записать: --apply');
  }
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
