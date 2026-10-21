// Поиск во всех экранах (TASKS ПО.0/ПО.4) — выражение для qa-screenshot.mjs (стенд docker-compose.qa.yml):
//   QA_DIR=… node backend/scripts/qa-screenshot.mjs 1440 900 '#home' out.png "$(cat backend/scripts/qa-search-scenarios.js)"
// Для каждого экрана: сколько строк было → ввели слово → стёрли до пусто (и крестиком, и до 1 знака) → вернулось ли.
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = []; window.addEventListener('error', (e) => errs.push(e.message));
  const rows = [];
  const type = async (inp, v, ms = 900) => { inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); await w(ms); };
  const clearX = async (inp, ms = 900) => { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('search', { bubbles: true })); await w(ms); };
  const count = (sel) => document.querySelectorAll(sel).length;
  const res = (name, ok, fact) => rows.push(`${name} · ${ok ? 'ок' : 'НЕТ'} · ${fact}`);

  // 1. шапка «Найти…»: со «Склада» ищем → стираем → назад на «Склад»
  location.hash = '#stock'; await w(1500);
  const gs = document.querySelector('.gsearch input');
  await type(gs, 'болт', 1400);
  const inSearch = location.hash.startsWith('#search');
  await clearX(gs, 1200);
  res('шапка: найти → стереть → вернуться на прошлый экран', inSearch && location.hash === '#stock', `после ввода ${location.hash.startsWith('#search') ? 'ещё ' : ''}${inSearch ? '#search' : 'нет поиска'} → после стирания ${location.hash}`);
  await type(gs, 'б', 900);
  const hint = document.querySelector('.gsearch .sb-hint')?.textContent || '';
  res('шапка: 1 знак — подсказка «минимум 2 символа»', /2 символ/.test(hint), hint || 'подсказки нет');
  await clearX(gs, 600);

  // 2. списки mountList: ввести → стереть (input) → строк как было; крестиком; до 1 знака
  for (const [hash, word] of [['#requests', 'болт'], ['#stock', 'гайка'], ['#salesorders', 'качел'], ['#partners?type=customer', 'парк'], ['#movements', 'болт'], ['#products', 'качели'], ['#requests?view=board', 'краска']]) {
    if (hash.includes("board")) await w(61000); // доска = 6 запросов на шаг: пауза от лимита 100/мин (иначе 429, не баг)
    location.hash = hash; await w(1600);
    const inp = document.querySelector('.toolbar .search input');
    if (!inp) { res(`${hash}: поле поиска`, false, 'нет поля'); continue; }
    const sel = hash.includes('board') ? '.board .tcard' : 'table.list tbody tr:not(.group-row):not(.period-row)';
    const before = count(sel);
    await type(inp, word, 1400);
    const found = count(sel);
    await type(inp, '', 1400);
    const back1 = count(sel);
    await type(inp, word, 1200); await clearX(inp, 1400);
    const back2 = count(sel);
    await type(inp, word, 1200); await type(inp, word[0], 1200); await type(inp, '', 1400);
    const back3 = count(sel);
    const fast = (async () => { for (const v of [word, word.slice(0, 2), '', word, '']) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); await w(60); } await w(1500); return count(sel); })();
    const back4 = await fast;
    const fails = [...document.querySelectorAll(".board .col-more")].filter((e) => /Не загрузилось/.test(e.textContent)).map((e) => e.textContent.slice(0, 60));
    res(`${hash}: стереть / крестик / до 1 знака / быстро`, back1 === before && back2 === before && back3 === before && back4 === before && !/[?&]q=/.test(location.hash),
      `было ${before}, нашлось ${found}, стёрли ${back1}, крестик ${back2}, до 1 знака → пусто ${back3}, быстро ${back4}, адрес ${location.hash}${fails.length ? ", колонки с ошибкой: " + fails.join(" | ") : ""}`);
  }

  // 3. справочники и «Операции» (свои поля)
  location.hash = '#dicts'; await w(1500);
  const di = document.querySelector('.dict-main input[type="search"], .dict-main .search input, .dict-head input');
  if (di) { const b = count('.dict-table tbody tr'); await type(di, 'шт', 900); const f = count('.dict-table tbody tr'); await type(di, '', 900); res('#dicts: ввести → стереть', count('.dict-table tbody tr') === b, `было ${b}, нашлось ${f}, стёрли ${count('.dict-table tbody tr')}`); }
  else res('#dicts: поле поиска', false, 'нет поля');
  location.hash = '#ops'; await w(1500);
  const oi = document.querySelector('.ops-search, .ops-picker input');
  if (oi) { const b = count('.ops-results .ops-row'); await type(oi, 'болт', 600); const f = count('.ops-results .ops-row'); await clearX(oi, 600); res('#ops: ввести → стереть', count('.ops-results .ops-row') === b, `было ${b}, нашлось ${f}, стёрли ${count('.ops-results .ops-row')}`); }

  return rows.join('\n') + '\nошибки консоли: ' + JSON.stringify(errs);
})()
