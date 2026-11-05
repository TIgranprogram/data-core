/**
 * Экран-список (CANON §2) — один на все разделы. Состояние — в адресе: page, limit, q, sort, фильтры, view, open.
 * Экран строится ОДИН раз; смена фильтра/страницы/сортировки — update(params): элементы управления не пересоздаются,
 * строки заменяются, когда пришли новые данные (старые остаются видны, без моргания).
 * section.list = {
 *   toolbarExtra?() → { el, update(P) } — свой элемент в панели инструментов (фильтры по признакам у «Остатков»), extraKeys — его ключи в адресе;
 *   path, sortDefault, searchPlaceholder, createLabel, headActions?() → [кнопки рядом с «+ Создать»],
 *   moreActions?(reload) → [{ label, title?, onSelect?, href? }] | [{ title?, sep?, items }] — второстепенные действия шапки в меню «Ещё ▾» (вместе с «⇩ Excel»); в шапке остаётся одна главная кнопка (аудит П2),
 *   columns: [{ key, label, sort?, cls?, render(row) }],
 *   card: { title(row), sub(row), side(row), thumb?(row) },        // вид на телефоне
 *   filters: [{ key, label, type: 'chips'|'select'|'date'|'hidden', options: async () => [{ value, label, hint? }], count?(resp, value) }],
 *   footer?(resp), query?(params),
 *   board?: см. ui/board.js — вид «Доска» (board.mount — своя доска вместо ui/board.js: «Проектирование», sections/design-data.js; board.alt — ещё одно значение ?view=, открывающее доску), ?view=board (board.default — доска по умолчанию, таблица — ?view=table),
 *   landing?: { when(P) → bool, render({ pick }) → Node | Promise<Node> } — первая страница вместо галереи (плитки категорий); pick(value) — выбрать плитку L.tiles.key,
 *   limit?: число строк таблицы по умолчанию (25); выбор 25/50/100 — внизу.
 *   gallery?: { default?, limit, sort, lastGroup?, groupBy(row) → подпись группы, card(row) → { pic, title, meta, price?, badge } } — вид «Галерея» (?view=gallery): карточки с фото по группам,
 *   bulk?: { label?, open?(ids, { done }), extra?: [{label, run(ids, rows)}] } — отметка записей галочками (таблица, карточки, галерея; «все на странице») и
 *     полоса «Выбрано: N · Изменить выбранные · Снять выбор» (БЗ-9); open — панель массового изменения справа, done() — снять отметки и обновить.
 *   tiles?: { key, title?, load: async () => [{ value, label, n, sub, head? }] } — плитки-фильтр над списком; с sidebar — список «Категории» в левой панели (head — раздел-заголовок),
 *   chipsTop?: true — с sidebar чипы-фильтры не в панели, а строкой над таблицей (СКФ.2: «Состояние» сверху, слева — только «что ищем»),
 *   sidebar?: true — левая панель (280 px, всегда открыта): поиск, tiles, фильтры chips/select/date, toolbarExtra, «Сбросить всё»; на телефоне — лист по кнопке «Фильтры · N» (NAV F1),
 *   defaults?: { status: 'requested' } — фильтры при входе в раздел без параметров в адресе (попадают в адрес; чип «Все» снимает),
 *   quick?: { placeholder, fields, create(values) } — быстрое добавление одной строкой (ui/quick.js),
 *   hints?: { [значение фильтра status]: 'что делать с этими записями' } — подсказка под вкладками,
 *   rowAction?(row) → { label, title, run(row) } | null — кнопка следующего шага в строке (как на «Сегодня»),
 *   groupBy?(row) → подпись группы (строка-заголовок при смене значения: дни в «Движениях»), groupTotal?(rows) → узел,
 *   колонка { money: true } — только тем, кто видит деньги (session.canMoney);
 *   periods?(P) → null | { date(row) → дата, total?(rows) → узел } — завершённое сворачивается по месяцам/годам
 *     (TASKS фаза М): список грузится целиком (до 2000), текущий месяц раскрыт, прошлые — строкой «Сентябрь 2026 · 34»,
 *     прошлые годы — строкой года; раскрытое запоминается. При поиске — всё раскрыто.
 * }
 * Возвращает { el, update(params), reload(), focusSearch(), destroy() }.
 */
/** Вид списка (таблица / доска / галерея / гант): запоминается в localStorage по viewKey раздела; st() — состояние из адреса. */
export function viewStore(L, getP) {
  const vKey = () => L.viewKey ? 'dc-view-' + L.viewKey : null;
  const savedView = () => { const k = vKey(); if (!k) return ''; try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const saveView = (v) => { const k = vKey(); if (!k) return; try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* */ } };
  const st = () => {
    const P = getP();
    const sv = !P.view ? savedView() : '';
    return {
      limit: Number(P.limit) || L.limit || 25,
      page: Math.max(1, Number(P.page) || 1),
      sort: P.sort || L.sortDefault,
      gantt: !!L.gantt && (P.view === 'gantt' || (!P.view && sv === 'gantt')),
      board: !!L.board && !(!!L.gantt && (P.view === 'gantt' || (!P.view && sv === 'gantt'))) && (P.view === 'board' || (!!L.board.default && !P.view && sv !== 'table') || (!!L.board.alt && P.view === L.board.alt) || (!P.view && sv === 'board')),
      gallery: !!L.gallery && (P.view === 'gallery' || (!!L.landing && !P.view && L.landing.when(P)) || (!!L.gallery.default && !P.view && sv !== 'table') || (!P.view && sv === 'gallery')),
    };
  };
  return { savedView, saveView, st };
}

/** Клавиатура: ↑/↓ — соседняя запись, N — новая, Esc — закрыть панель фильтров на телефоне. */
export function listKeys({ side, closeSheet, rows, P, st, onOpen, canCreate, onCreate }) {
  const onKey = (e) => {
    if (e.key === 'Escape' && side()?.classList.contains('open')) { closeSheet(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('.modal-back')) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows().length && !st().board && !st().gantt) {
      e.preventDefault();
      const i = rows().findIndex((r) => r.id === P().open);
      const next = e.key === 'ArrowDown' ? Math.min(rows().length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      onOpen(rows()[next]);
    } else if ((e.key === 'n' || e.key === 'т') && canCreate) { e.preventDefault(); onCreate(); }
  };
  return onKey;
}
