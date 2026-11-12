import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { hint, tileGrid, typeArt, typeIconList, landing, miniChart, navList, photoStrip, catArt, stat, searchBox, readonlyGroup, similarBox, posPic, posPicOf, sku, section, stack, button, iconButton, segmented, headbar, link, badge, card, empty, tabs, stats, toolbar, row, actions, boardStatic, board, layout, mobile, failBlock, autoMore, openPdfPreview, stageBar, headStats, clamp, funnel, planner, qtyInput, targetPicker, toast, pick, filter, table, treeTable, textInput, fieldRow, panel, entityPanel, select, fileButton, links, guide, SUPPLY_STATUS } from '../ui/kit/index.js';
import { buildCardTabs } from '../ui/kit/card-tabs.js';

/** Витрина эталонов (#kit, только admin): семейство × варианты × пусто / длинный текст / ошибка. */
const LONG = 'Очень длинное название позиции для проверки переноса и обрезки текста в карточке эталона';
const TONES = ['neutral', 'info', 'warn', 'danger', 'ok'];
const PIC = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#eee"/><path d="M10 50 L40 10 L70 50 Z" fill="#999"/></svg>');

const block = (title, note, ...kids) => h('section', { class: 'panel' }, h('h2', null, title), note ? h('p', { class: 'k-note' }, note) : null, ...kids);
const sample = (...kids) => h('div', { class: 'k-sample' }, ...kids);
const cards = (size) => TONES.map((tone) => card({ size, tone, title: 'Заголовок ' + tone, meta: 'Мета · 12 шт', badges: badge(SUPPLY_STATUS, 'ordered'), onClick: () => toast('Клик: ' + tone) }));

function filterFacets() {
  const f = filter({ mode: 'facets' });
  f.update({});
  return f.el;
}
function filterFunnel() {
  const f = filter({ mode: 'funnel', title: 'Уточнить (пример)', steps: [{ key: 'year', label: 'Год', always: true, icon: () => h('span', { class: 'ff-ico', 'aria-hidden': 'true' }) }, { key: 'month', label: 'Месяц', when: (P) => !!P.year }],
    load: async (P) => ({ year: [{ value: '2025', n: 4 }, { value: '2026', n: 9 }], month: [{ value: '1', label: 'Январь', n: 2 }, { value: '2', label: 'Февраль', n: P.year ? 3 : 0 }] }) });
  f.update({});
  return f.el;
}

/** Локальная воронка (onChange, multi): выбор не в адресе — для панелей-мастеров (воронка паспорта). */
function filterFunnelLocal() {
  const vals = { kind: [{ value: 'a', label: 'Силовой', n: 61 }, { value: 'b', label: 'Кардио', n: 19 }], muscle: [{ value: 'm1', label: 'Спина', n: 17 }, { value: 'm2', label: 'Пресс', n: 5 }, { value: 'm3', label: 'Ноги', n: 15 }] };
  const f = filter({ mode: 'funnel', title: 'Локальная воронка, несколько значений', steps: [{ key: 'kind', label: 'Вид', always: true }, { key: 'muscle', label: 'Мышцы', always: true, multi: true }],
    load: async () => vals, onChange: (P) => f.update(P) });
  f.update({});
  return f.el;
}

/** «Дерево в таблице»: 3 уровня, «Ещё N» (10 детей), текущий месяц, вставка с операциями под строкой. */
function treeDemo() {
  const money = (n) => (n ? String(n).replace(/\B(?=(\d{3})+$)/g, ' ') : '');
  const mk = (id, label, base, kids) => ({ id, label, cells: Array.from({ length: 4 }, (_, i) => ({ v: money(base * (i + 1)), click: () => t.insert(id, { title: label + ' · квартал ' + (i + 1) }).body.append(h('p', { class: 'hint' }, 'Здесь список операций (q-list).')) })),
    total: { v: money(base * 10), click: () => t.insert(id, { title: label + ' · год' }).body.append(h('p', { class: 'hint' }, 'Все операции года.')) }, share: { text: '12,5%', ratio: base / 100 }, kids });
  const subs = Array.from({ length: 10 }, (_, i) => mk('s' + i, 'Подстатья ' + (i + 1), 90 - i * 7, i === 0 ? [mk('c1', 'ООО «Поставщик»', 40), mk('c2', LONG, 20)] : undefined));
  const t = treeTable({ label: 'Пример', periods: [{ label: 'I кв.' }, { label: 'II кв.', today: true }, { label: 'III кв.' }, { label: 'IV кв.' }], totalLabel: 'Итого', shareLabel: 'Доля',
    open: new Set(['a']), moreLabel: (rest) => 'Ещё ' + rest.length + ' · ' + money(rest.reduce((a, r) => a + r.total.v.replace(/\s/g, '') * 1, 0)) + ' ₽',
    rows: [mk('a', 'Материалы', 100, subs), mk('b', 'Аренда', 30), mk('d', 'Без подстатей', 10)] });
  return t.el;
}

function liveBoard() {
  const box = h('div', { class: 'k-board-demo' });
  box.append(button({ label: 'Показать живой пример', onClick: (e) => {
    e.currentTarget.remove();
    const b = board({ density: 'normal', groupOpen: true,
      columns: [{ key: 'queue', label: 'Распределение', tone: 'dim', query: { status: 'queue', sort: 'seq' }, per: 6 }, { key: 'work', label: 'В работе', tone: 'info', query: { status: 'work', sort: 'seq' }, per: 6 }],
      card: (r) => ({ title: r.productName || r.title || 'Без названия', meta: r.code, orderKey: r.orderId || '' }),
      group: (r) => (r.orderId ? { key: String(r.orderId), label: r.productionNo ? '№ ' + r.productionNo : 'Заказ, нет №' } : null),
      cardMenu: (r) => [{ label: 'Копировать код', run: () => { toast(String(r.code || '')); return false; } }, { sep: true }, { label: 'Опасное действие (пример)', danger: true, run: () => false }] },
    '/design-tasks', {}, { onOpen: (r) => toast('Открыть ' + (r.code || '')), onChanged: () => {}, onTotal: () => {} });
    box.append(b.el);
  } }));
  return box;
}

function pickDemo() {
  const OPTS = ['Болт М10', 'Гайка М10', 'Шайба 10', 'Труба 40х40', LONG].map((label, i) => ({ value: String(i), label, group: i < 2 ? 'Крепёж' : 'Прочее' }));
  const sel = h('select', { class: 'k-field' }, h('option', { value: '' }, 'Не выбрано'), ...OPTS.map((o) => h('option', { value: o.value }, o.label)));
  const mk = () => h('input', { placeholder: 'Начните печатать' });
  const combo = mk(), multi = mk();
  const wrap = (...k) => h('span', { class: 'sel-wrap' }, ...k);
  const s = sample(sel, wrap(combo), wrap(multi));
  const tags = pick({ mode: 'tags', options: OPTS.map((o) => ({ value: o.value, label: o.label, sub: o.group })), value: ['0'], label: 'Метки' });
  requestAnimationFrame(() => {
    pick({ mode: 'single', select: sel, force: true });
    pick({ mode: 'combo', input: combo, options: OPTS, empty: () => 'Ничего не нашлось', extra: (t) => (t ? [{ label: '+ Новое «' + t + '»', run: () => toast('Создать: ' + t) }] : []) });
    pick({ mode: 'multi', input: multi, options: OPTS });
  });
  return [s, sample(tags.el)];
}

function plannerDemo() {
  const d0 = Date.now(), iso = (k) => new Date(d0 + k * 864e5).toISOString().slice(0, 10);
  return planner({ rows: [{ id: 'a', label: 'Иван Петров', sub: '8 ч в день', cap: 8 }, { id: 'b', label: 'Сергей Ким', sub: '8 ч в день', cap: 8 }, { id: '_none', label: 'Не назначен' }],
    bars: [{ id: '1', rowId: 'a', start: iso(0), end: iso(2), title: 'Стойки · сварка', sub: '12 ч', tone: 'info' }, { id: '2', rowId: 'a', start: iso(1), end: iso(3), title: 'Навес · раскрой', sub: '10 ч', tone: 'warn' },
      { id: '3', rowId: 'b', start: iso(2), end: iso(5), title: 'Наполнение · покраска', sub: '16 ч', tone: 'ok' }, { id: '4', rowId: '_none', start: iso(4), end: iso(6), title: 'Изделие целиком · сборка', sub: '8 ч', tone: 'dim' }],
    load: { a: { [iso(1)]: 14, [iso(2)]: 9, [iso(3)]: 7 }, b: { [iso(2)]: 6 } }, from: iso(-3), to: iso(14), scale: 'day', canEdit: true, rowsMovable: true,
    onOpen: (b) => toast('Открыта полоса: ' + b.title), onMove: async (b, to) => { toast(b.title + ' → ' + to.start + ' · строка ' + to.rowId); throw new Error('демо: возвращаем на место'); } }).el;
}

/** Дерево: заказ › позиция › шаги; человек с ёмкостью и перегрузкой. Масштаб/«Уместить»/«Сегодня» работают на месте (демо не ходит за данными). */
// части эталона planner: plannerBar, buildTree, visible, fitPx
function plannerTreeDemo() {
  const d0 = Date.now(), iso = (k) => new Date(d0 + k * 864e5).toISOString().slice(0, 10);
  const rows = [{ id: 'o1', label: 'Заказ № 118', sub: 'ООО «Север»' }, { id: 'p1', parentId: 'o1', label: 'Стойки', sub: '2 шага' }, { id: 's1', parentId: 'p1', label: 'Сварка', drop: null }, { id: 's2', parentId: 'p1', label: 'Покраска', drop: null },
    { id: 'o2', label: 'Заказ № 121' }, { id: 'p2', parentId: 'o2', label: 'Навес' }, { id: 's3', parentId: 'p2', label: 'Раскрой', drop: null },
    { id: 'u1', label: 'Иван Петров', sub: '8 ч в день', cap: 8 }];
  const bars = [{ id: 'b1', rowId: 's1', start: iso(0), end: iso(3), title: 'Сварка', sub: '24 ч', hue: 1, wt: 'w1', status: 'work', deadline: iso(8) }, { id: 'b2', rowId: 's2', start: iso(4), end: iso(7), title: 'Покраска', sub: '16 ч', hue: 3, wt: 'w2', status: 'plan', deadline: iso(8) },
    { id: 'b3', rowId: 's3', start: iso(-4), end: iso(-1), title: 'Раскрой', sub: '10 ч', hue: 4, wt: 'w3', status: 'work', overdue: true, deadline: iso(-2) }, { id: 'b4', rowId: 'u1', start: iso(1), end: iso(2), title: 'Подготовка', hue: 2, wt: 'w4', status: 'done' }];
  const box = h('div');
  const draw = (scale) => {
    const c = planner({ rows, bars, load: { u1: { [iso(1)]: 14, [iso(2)]: 9 } }, from: iso(-7), to: iso(21), scale, fitWidth: 600, canEdit: true, expanded: new Set(['o1']),
      legend: [{ id: 'w1', name: 'Сварка', hue: 1 }, { id: 'w2', name: 'Покраска', hue: 3 }, { id: 'w3', name: 'Раскрой', hue: 4 }, { id: 'w4', name: 'Сборка', hue: 2 }],
      onScale: draw, onShift: () => toast('Демо: окно не сдвигается'), onToday: () => toast('Демо: сегодня уже в окне'), onOpen: (b) => toast('Открыта полоса: ' + b.title), onMove: async () => { throw new Error('демо'); } });
    box.replaceChildren(c.el);
  };
  draw('day');
  return box;
}

export const kit = {
  title: 'Эталоны',
  mount(el) {
    if (session.role !== 'admin') { el.append(empty({ title: 'Раздел только для администратора' })); return {}; }
    const t = tabs({ items: [{ key: 'a', label: 'Первая', count: 3 }, { key: 'b', label: 'Вторая' }, { key: 'c', label: 'Третья', count: 0 }], value: 'a' });
    const dens = (d) => (d === 'compact' ? 'compact' : undefined);
    el.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Эталоны'), button({ label: 'Сменить тему', kind: 'ghost', size: 'S', onClick: () => window.dcTheme?.cycle() })),
      block('Кнопки', 'primary / secondary / ghost / danger × M и S; занята и выключена.',
        ...['M', 'S'].map((size) => sample(...['primary', 'secondary', 'ghost', 'danger'].map((kind) => button({ label: kind, kind, size })),
          button({ label: 'Занята', kind: 'primary', size, busy: true }), button({ label: 'Выключена', size, disabled: true })))),
      block('Мобильный рабочий экран (mobile)', 'Семейство kit mobile (docs/DESIGN-MOBILE.md): screen (шапка, шестерёнка), bigButton, choice, tiles, feed, dateChoice, qty (цифровая панель), drill (пошаговый выбор), done, error. Размеры — переменные --m-* в kit.css.',
        mobile.screen({ title: 'Сколько выдать? Болт М8', step: { n: 2, of: 4 }, back: () => toast('Назад'), body: [mobile.qty({ value: 20, unit: 'шт', max: 150 }).el, mobile.choice({ items: [{ value: 1, label: 'Заказ 1245', hint: 'Скамья парковая' }, { value: 2, label: 'Заказ 1250' }], onPick: (o) => toast(o.label) }), mobile.drill({ levels: [{ title: 'Раздел склада', load: async () => [{ value: 'a', label: 'Крепёж', hint: 'позиций: 40' }, { value: 'b', label: 'Труба' }] }, { title: 'Позиция', load: async () => [{ value: 1, label: 'Болт М8', hint: 'На складе: 150 шт' }] }], onPick: (o) => toast(o.label) }).el, mobile.tiles({ items: [{ value: 1, label: 'Скамьи', art: catArt('Скамьи') }, { value: 2, label: 'Урны', art: catArt('Урны') }], onPick: (o) => toast(o.label) }), mobile.dateChoice().el, mobile.feed({ items: [{ date: '01.11', text: 'Болт М8', qty: '20', unit: 'шт', kind: 'out' }, { date: '31.10', text: 'Труба 40', qty: '5', unit: 'м', kind: 'in' }] }), mobile.error('На складе только 150 шт.')], gear: () => toast('Настройки'), foot: mobile.bigButton({ label: 'Дальше', onClick: () => toast('Дальше') }), footHint: 'Впишите количество' }),
        mobile.screen({ title: 'Готово', body: [mobile.done({ text: 'Выдано: Болт М8 · 20 шт · на заказ 1245', again: { label: 'Ещё выдать', onClick: () => {} }, home: { label: 'На главный экран', onClick: () => {} } })] })),
      block('Мобильный сканер QR (mobile.scan)', 'Экран камеры: рамка, «Наведите на код», «Отмена». Камера включается только по нажатию.',
        (() => { const box = h('div'); const open = () => { const sc = mobile.scan({ onCode: (t) => { box.replaceChildren(mobile.bigButton({ label: 'Сканировать QR', onClick: open })); toast('Считано: ' + t); }, onCancel: () => box.replaceChildren(mobile.bigButton({ label: 'Сканировать QR', onClick: open })) }); box.replaceChildren(sc.el); }; box.append(mobile.bigButton({ label: 'Сканировать QR', onClick: open })); return box; })()),
      block('Кнопка-значок, переключатель, ссылка', 'iconButton (S и M, с меню); segmented; link (переход) и кнопка ghost S (действие).',
        sample(iconButton({ icon: '⋯', label: 'Ещё', menu: true }), iconButton({ icon: '😀', label: 'Смайлик', size: 'S' }), segmented({ items: [{ key: 'a', label: 'Первый' }, { key: 'b', label: 'Второй' }, { key: 'c', label: 'Опасный', tone: 'danger' }], value: 'a', label: 'Образец' }).el, segmented({ scroll: true, items: ['Профильная труба', 'Плитные материалы', 'Листовой материал', 'Крепёж и метизы'].map((l) => ({ key: l, label: l })), label: 'Образец с прокруткой' }).el, link({ label: 'Открыть раздел', href: '#kit' }))),
      block('Шапка формы (headbar)', 'headbar(контекст, segmented({ fit: true }).el): слева что открыто, справа режим; на узкой панели режим уходит под контекст. Вставка Ctrl+V в фото-зоны — одна цель (pasteTarget в ui/kit/photos.js): фокус сильнее мыши.',
        sample(headbar(h('div', null, h('b', null, LONG), h('div', { class: 'muted small' }, 'Категория: Благоустройство · Тип: Ограждение')), segmented({ fit: true, items: [{ key: 'a', label: 'Выпуск' }, { key: 'b', label: 'Полный' }], value: 'a', label: 'Режим' }).el))),
      block('Артикул изделия', 'sku(text) — .k-sku; впереди названия в работе с изделием, отдельной строкой в таблицах и карточках.',
        sample(h('span', null, sku('32.11'), ' Скамья «Парковая»'), h('div', null, h('div', null, 'Скамья «Парковая»'), sku('32.04')))),
      block('Компактная группа реквизитов', 'readonlyGroup: заголовок h3, пары метка — значение, пустые группы скрыты; DOM-ссылки и нули сохраняются.',
        sample(readonlyGroup({ title: 'Сведения', rows: [['Поставщик', LONG], ['Позиций', 0], ['Связь', link({ label: 'Открыть заявку', href: '#requests' })], ['Пустое', '']] }), readonlyGroup({ title: 'Пустая группа', rows: [['Нет значения', '']] }))),
      block('Сворачиваемая секция', 'section({ title, count, open, body }) — группа в правой панели: закрыта по умолчанию, в шапке число; Enter/Пробел открывает.',
        sample(section({ title: 'Для паспорта', count: 3, body: h('div', null, 'Содержимое группы') }), section({ title: 'Чертежи', count: 0, open: true, body: empty({ title: 'Чертежей нет' }) }))),
      block('Блоки панели колонкой', 'stack(...блоки) — секции правой панели одна под другой с одним зазором; пустая секция — строка внутри.',
        sample(stack(section({ title: 'Состав', count: 2, body: h('div', null, 'Материалы и узлы') }), section({ title: 'В заказах', count: 0, body: h('p', { class: 'muted small' }, 'Изделие ещё не встречается в заказах') })))),
      block('Путеводитель (guide)', 'Страница «Работа с сайтом» и обучающие схемы: cat — категория-аккордеон (одинаковый name — открыта одна), unit — подраздел с цепочкой, chain — шаги «что за чем» (номер, действие, где в меню, пояснение), flow — полоса-обзор, want — карточка «Я хочу…» (тон раздела), note — «Порядок важен / Можно потом», toggle — галочка.',
        guide.flow([{ label: 'Производство', onClick: () => toast('Клик: Производство') }, { label: 'Склад', onClick: () => toast('Клик: Склад') }, { label: 'Деньги', onClick: () => toast('Клик: Деньги') }]),
        guide.cat({ name: 'kit-guide', title: 'Склад', what: 'Остатки, приём и выдача', chips: ['Остатки', 'Журнал движений'], count: '2 раздела', open: true,
          body: [guide.unit({ name: 'Остатки', href: '#kit', what: 'Что лежит на складе', steps: [{ t: 'Примите товар', where: 'Остатки → «Принять»', d: 'Пояснение к шагу: приёмка после оплаты.' }, { t: 'Выдайте', where: 'Остатки → «Выдать»' }], strict: 'Сначала приёмка, потом выдача.', later: 'Бронь под заказ — позже.' })] }),
        h('div', { class: 'g-wants' },
          guide.want({ tok: 'supply', want: 'Нужно что-то купить', menu: 'Снабжение → Заявки', href: '#kit', start: 'Нажмите «+ Заявка», потом «Заказал» — когда заказали у поставщика.' }),
          guide.want({ tok: 'stock', want: 'Принять товар на склад', menu: 'Остатки → «Принять»', href: '#kit', start: 'В заявке «Принять» или в «Остатках» — товар встанет на склад.' }),
          guide.want({ want: 'Без раздела', start: 'Без токена — серая полоса, как у k-toned без --tone.' })),
        guide.toggle({ label: 'Показать все разделы', onChange: () => {} })),
      block('Карточка S (.tile)', 'tone; длинный текст; без меты; с действием.',
        sample(...cards('S'), card({ size: 'S', title: LONG, meta: LONG }), card({ size: 'S', title: 'Без меты' }), card({ size: 'S', title: 'С действием', actions: button({ label: 'Открыть', size: 'S' }) }))),
      block('Карточка M (.tcard)', 'tone; с фото; плотная (compact); длинный текст.',
        sample(...cards('M'), card({ size: 'M', title: LONG, meta: LONG }), card({ size: 'M', title: 'С фото', meta: 'чертёж', photo: PIC }),
          card({ size: 'M', title: 'Плотная', meta: 'compact', photo: PIC, density: 'compact' }), card({ size: 'M', title: 'С действием', actions: button({ label: 'Принять', kind: 'primary', size: 'S' }) }),
          actions(button({ label: 'Распределить', size: 'S' }), button({ label: 'Отгрузка', size: 'S' })))),
      block('Карточка: варианты long / table', 'variant:\'long\' — длинный текст, 6 строк и «Развернуть»; variant:\'table\' — body = table() внутри карточки. Наведение (подъём -2px, --shadow-lg) только у карточек с onClick; без onClick — статичны.',
        sample(
          card({ size: 'M', variant: 'long', title: 'Примечание', meta: 'длинный текст', body: Array(12).fill(LONG + '.').join(' '), onClick: () => toast('Клик: long') }),
          card({ size: 'M', variant: 'long', title: 'Короткое, без клика', body: 'Короткий текст примечания.' }),
          card({ size: 'L', variant: 'table', title: 'Заказ № 20-26', meta: 'движения', onClick: () => toast('Клик: table'),
            body: table({ columns: [{ key: 'n', label: 'Позиция' }, { key: 'q', label: 'Кол-во', num: true }], rows: [{ cells: ['Труба 57×3', '12'] }, { cells: [LONG, '3'] }] }) }),
          card({ size: 'L', variant: 'table', title: 'Без клика (статична)', body: table({ columns: [{ key: 'n', label: 'Позиция' }], rows: [], empty: 'Нет строк' }) }))),
      block('Связи (links, вид «картотека»: 1А бумага · 2Б линии · 3А сетка)', 'Сетка карточек связанных разделов в панели: от 240 px, на 390 — одна колонка; карточка с таблицей на всю строку, итог числом в шапке, до 5 строк и «Ещё N». Тёмная тема — кнопка «Сменить тему».',
        links({ items: [{ key: 'orders', title: 'Заказы', total: 7, onClick: () => toast('Клик: заказы') }, { key: 'stock', title: 'Склад', total: 120, onClick: () => toast('Клик: склад') }, { key: 'debt', title: 'Долг', total: -45000, onClick: () => toast('Клик: долг') }, { key: 'empty', title: 'Без записей', total: 0 },
          { key: 'moves', title: 'Движения', total: 7, columns: [{ key: 'n', label: 'Позиция' }, { key: 'q', label: 'Кол-во', num: true }], rows: Array.from({ length: 7 }, (_, i) => ({ cells: [i === 1 ? LONG : 'Труба 57×3 № ' + (i + 1), String(10 + i)] })), more: () => toast('Показать все') }] })),
      block('Ввод количества в таблице (qtyInput)', 'Поле «Сколько» в ячейке kit.table: число + «+1», при фокусе выделяется; свыше свободного — подсказка в title. Остаток — 5.',
        table({ label: 'Пример', columns: [{ label: 'Позиция' }, { label: 'Сколько' }], rows: [{ cells: ['Труба 40×40', qtyInput({ label: 'Сколько: труба', plusLabel: 'Добавить: труба', max: 5, maxText: (f) => 'Свободно только ' + f, onInput: () => {} })] }] })),
      block('Кому / под что (targetPicker)', 'Выдача и возврат: «Под заказ» (заказ → позиция) · «Сотруднику» · «Без заказа». Заказы грузятся по первому нажатию в поле, не при открытии экрана. Рядом в kit: targetNote, targetShort (подписи в движениях), orderLines, lineCode (позиции заказа и их код).',
        targetPicker({ mode: 'out' }).el),
      block('Подгрузка порциями (autoMore)', 'Список растёт при прокрутке вниз; внизу «Показано N из M», сбой порции — «Повторить» в подвале, строки остаются. Без IntersectionObserver появляется «Показать ещё». Только наблюдатель (когда загрузку ведёт сам экран, как kit/list) — moreSentinel внутри kit. Здесь 45 строк по 10; каждая 3-я порция даёт ошибку один раз.',
        (() => {
          const box = h('div', { class: 'state' }); let failed = false;
          const m = autoMore({ root: box, limit: 10, text: { fail: 'Список не загрузился', moreFail: 'Не удалось подгрузить строки' },
            load: async (page, { limit }) => { await new Promise((r) => setTimeout(r, 300)); if (page === 3 && !failed) { failed = true; throw new Error('Нет связи с сервером'); } return { items: Array.from({ length: Math.min(limit, 45 - (page - 1) * limit) }, (_, i) => ({ n: (page - 1) * limit + i + 1 })), total: 45 }; },
            render: (items) => box.replaceChildren(table({ label: 'Пример подгрузки', maxHeight: 'M', columns: [{ label: '№', num: true }, { label: 'Строка' }], rows: items.map((x) => ({ cells: [String(x.n), 'Позиция ' + x.n] })) })) });
          m.reload();
          return h('div', null, box, m.el);
        })()),
      block('Полоса этапов и значки шапки (stageBar, headStats)', 'Этапы — тонкая полоса «как заряд батареи» + одна строка текущего этапа; полные названия в подсказке сегмента. Значки — цифры справа в строке заголовка панели (card.headStats / card.headStrip).',
        stack(
          stageBar({ label: 'Пример', steps: [{ key: 'a', label: 'Проектирование', done: true }, { key: 'b', label: 'Производство', done: true }, { key: 'c', label: 'Готово к отгрузке', done: true }, { key: 'd', label: 'Отгружен', current: true, note: 'частично' }, { key: 'e', label: 'Закрыт' }], onPick: () => {} }),
          headStats([{ value: '1', label: 'дог.', title: 'Договоров: 1' }, { value: '8', label: 'поз.', title: 'Позиций: 8' }, { value: '—', label: 'сумма' }, { value: '—', label: 'оплачено' }]))),
      block('Воронка с памятью (funnel)', 'П-1: шаги сверху вниз, следующий — после выбора; ≤ 7 значений — вкладки с числом, больше — список с поиском; пройденный шаг — строка «… ✎»; над шагами «Дальше: …».',
        (() => {
          const kinds = [['a', 'Силовой'], ['b', 'Кардио'], ['c', 'Уличный']].map(([id, label], i) => ({ id, label, count: 12 - i * 3 }));
          const groups = Array.from({ length: 9 }, (_, i) => ({ id: 'g' + i, label: 'Группа ' + (i + 1), count: i + 1 }));
          const V = {};
          const f = funnel({ steps: [], recent: [{ title: 'Силовой тренажёр', meta: 'нажмите — выбрать «Силовой»', onClick: () => set('cat', 'a') }], onChange: (k, v) => set(k, v) });
          function set(k, v) { V[k] = v; if (k === 'cat') delete V.grp; paint(); }
          function paint() { f.update({ steps: [{ key: 'cat', label: 'Категория', value: V.cat || '', values: kinds }, { key: 'grp', label: 'Группа', value: V.grp || '', values: groups }] }); }
          paint();
          return f.el;
        })()),
      block('Окно просмотра PDF (openPdfPreview)', 'Только просмотр (КП: предпросмотр до сохранения, карточка, проверка бланка): Обновить · Печать · Скачать PDF · «Вернуться к правке». Ввод остаётся в правой панели.',
        button({ label: 'Открыть пример окна', onClick: () => openPdfPreview({ title: 'Пример', load: async () => { throw new Error('В витрине PDF не грузится'); } }) })),
      block('Длинный текст (clamp)', 'Название позиции договора: 3 строки с «…», полный текст в подсказке; второй уровень — 2 строки мельче. В таблице у колонки wrap:true.', sample(clamp(LONG + ' ' + LONG + ' ' + LONG), clamp(LONG, { lines: 2, cls: 'muted small' }))),
      block('Карточка L (.db-order)', 'Заказ / шапка сущности.', sample(...cards('L'), card({ size: 'L', title: LONG, meta: LONG }))),
      block('Строка (.k-row)', 'Список позиций, корзина с количеством, строка с галочкой. tone — полоса слева.', sample(
        row({ title: 'Труба 57×3', meta: 'на складе 120 м', side: h('b', null, '120 м'), action: button({ label: 'Принять', size: 'S' }) }),
        row({ title: LONG, meta: LONG, tone: 'warn', active: true }),
        row({ tag: 'label', lead: h('input', { type: 'checkbox', checked: true }), title: 'Лист 3 мм', meta: 'оплачено', side: [h('input', { value: '10' }), h('span', { class: 'muted small' }, 'шт')] }),
        row({ title: 'Круг 20', meta: 'на складе 5 м', qty: [h('input', { value: '8' }), h('span', { class: 'muted small' }, 'м')], diff: h('span', { class: 'k-diff num neg' }, 'свободно только 5 м'), action: button({ label: '×', kind: 'ghost', size: 'S' }), warn: h('div', { class: 'k-note neg' }, 'Меньше, чем в брони') }))),
      block('Похожее (kit.similarBox)', 'Под названием нового изделия и в сопоставлении: до 5 строк kit.row; клик — открыть/выбрать.', sample((() => { const b = similarBox({ pickLabel: 'Взять это' }); b.show([{ id: '1', name: 'Горка «Малыш»', sku: 'ГК-01', groupName: 'Горки', photo: null }, { id: '2', name: 'Горка «Малыш-2»', sku: 'ГК-02', groupName: 'Горки', photo: null }]); return b.el; })())),
      block('Фото в строке (kit.posPic)', 'Миниатюра 36 px (sm) или 72 px (lg); posPicOf — из полей lines-lookup: клик — крупно; фото нет — «нет фото». Таблицы и строки выбора изделия.', sample(posPic(null, 'sm'), posPic(null, 'lg'), posPicOf({}, 'sm'))),
      block('Выбор (pick)', 'single — список вместо select; combo — поле со списком и «+ Новое»; multi — через запятую; tags — метки. На телефоне (≤ 480 px) список — лист.', ...pickDemo()),
      block('Фильтр (kit.filter)', 'chips — фишки, один или несколько; facets — признаки склада (поиск и группы); funnel — шаги уточнения (параметры адреса).', sample(
        filter({ mode: 'chips', items: [{ key: 'a', label: 'Все', count: 12 }, { key: 'b', label: 'Новые', count: 3 }, { key: 'c', label: LONG }], value: 'a', label: 'Один выбор', onChange: (k) => toast('Выбрано: ' + k) }).el,
        filter({ mode: 'chips', multi: true, items: [{ key: 'a', label: 'Болты' }, { key: 'b', label: 'Гайки' }, { key: 'c', label: 'Шайбы' }], value: ['a', 'c'], label: 'Несколько', onChange: (k) => toast('Выбрано: ' + k.join(', ')) }).el),
        sample(filterFacets(), filterFunnel(), filterFunnelLocal())),
      block('Бейджи', null, sample(...Object.keys(SUPPLY_STATUS).map((k) => badge(SUPPLY_STATUS, k)), badge('Одиночная', 'ok'), badge(LONG, 'warn'))),
      block('Вкладки', null, t.el),
      block('Показатели', null, stats([{ value: 12, label: 'Заказов' }, { value: '1 250 000', label: 'Сумма' }, { value: 0, label: 'Просрочено' }]), stats([{ value: 1, label: LONG }])),
      block('Панель инструментов', null, toolbar(button({ label: 'Создать', kind: 'primary' }), button({ label: 'Экспорт' }), badge('Фильтр', 'info'))),
      ...['normal', 'compact', 'pics'].map((density) => block('Доска · плотность ' + density, 'Колонки с карточками M; пустые колонки; длинный текст.',
        boardStatic({ density, columns: [
          { key: 'a', label: 'Новые', tone: 'primary', hint: 'Что делать здесь', cards: [card({ size: 'M', title: 'Задача 1', meta: 'Иванов', photo: PIC, density: dens(density) }), card({ size: 'M', title: LONG, meta: 'срок завтра', tone: 'warn', density: dens(density) })] },
          { key: 'b', label: 'В работе', tone: 'info', cards: [] },
          { key: 'c', label: 'Готово', tone: 'ok', empty: 'Ничего нет', cards: [] }] }))),
      block('Доска с боковым списком (layout.split)', 'Слева список (карточки L и S), справа доска; на телефоне список за кнопкой сверху.',
        layout.split({ sideLabel: 'Список заказов', side: h('div', { class: 'k-side-item' }, card({ size: 'L', tone: 'info', title: '№ 20-26', meta: 'Заказчик', badges: badge('в работе 2', 'info') }), card({ size: 'S', title: 'поз. 1 · Изделие', meta: '2 шт' }), card({ size: 'S', title: 'поз. 2 · Длинное изделие', meta: '1 шт' })),
          main: boardStatic({ density: 'pics', columns: [{ key: 'a', label: 'Распределение', tone: 'dim', cards: [card({ size: 'M', title: 'Задача', meta: 'сюда перетаскивают изделие слева', photo: PIC })] }, { key: 'b', label: 'В работе', tone: 'info', cards: [] }] }) })),
      block('Доска: меню «⋯», группы по заказу, цветная полоса (cardMenu, group, orderKey)', 'Живой пример на данных проектирования (нажмите — загрузятся задачи). Группа по заказу (клик по карточке; в шапке колонки — «раскрыть все»), «⋯» — общее меню, полоса — цвет заказа.',
        liveBoard()),
      block('Таблица (table)', 'list — таблица списка: числа вправо, итог в подвале; money: true у колонки (и у поля panel) — скрыто без галочки «Деньги»; пустая — kit.empty. input — табличный ввод для форм (строки в ячейках, + Строка, Excel). На телефоне компактная строка — table({ cls: \'k-table-stack\' }): шапка скрыта, первая ячейка — название, управление переносится (панель «Состав и работы»).',
        table({ clickable: true, columns: [{ label: 'Название' }, { label: 'Кол-во', num: true }, { label: 'Цена', num: true, money: true }], rows: [{ cells: ['Болт М10', '120', '12,50'], onClick: () => toast('Строка') }, { cells: [LONG, '3', '1 200,00'], selected: true }],
          foot: [h('tr', null, h('td', null, 'Итого'), h('td', { class: 'num' }, '123'), h('td', { class: 'num' }, '1 212,50'))] }),
        table({ columns: [{ label: 'Название' }, { label: 'Кол-во', num: true }], rows: [], empty: { title: 'Строк нет', hint: 'Добавьте запись.' } }),
        table({ mode: 'input', columns: [{ key: 'name', label: 'Название' }, { key: 'qty', label: 'Кол-во', num: true }], rows: [{ name: 'Болт', qty: '4' }], file: 'Образец' }).el),
      block('Дерево в таблице (treeTable)', 'Вариант table.cal: статья › подстатья › контрагент. Шеврон раскрывает без запроса и без перерисовки (≤ .2s, в prefers-reduced-motion без движения); строка под курсором подсвечена, открытая — золотая полоса; колонка текущего периода выделена; у раскрытой строки больше 8 детей — 7 + «Ещё N»; нажатие на сумму открывает вставку под строкой (Esc или «Скрыть» закрывают); у статей колонка «Доля» — число и полоска.',
        treeDemo()),
      block('Правая панель (panel)', 'Шапка (тип записи, заголовок, подзаголовок, ✕), блоки полей, подвал с кнопками. Здесь — образец содержимого; настоящая панель открывается через openCard.',
        panel({ kind: 'Изделие', title: 'Качели двойные', sub: 'Артикул КЧ-02', onClose: () => toast('Закрыть'),
          blocks: [{ title: 'Основное', body: h('p', { class: 'muted' }, 'Поля блока') }, { title: 'Дополнительно', body: h('p', { class: 'muted' }, 'Ещё поля') }],
          footer: [button({ label: 'Сохранить', kind: 'primary' }), button({ label: 'Отмена' })] }).el),
      block('Правая панель v2 (entityPanel)', 'Сверху вниз: «раздел › сущность», главный блок раздела, карточки связей (сетка от 240 px, активная с рамкой), история внизу свёрнута. Нажатие на связь меняет главный блок, страница слева остаётся.',
        (() => { const p = entityPanel({ section: 'Деньги', title: 'Счёт № 4521', kind: 'Счёт', onClose: () => toast('Закрыть'), main: h('p', { class: 'muted' }, 'Главный блок: данные и кнопки раздела'), active: 'money',
          related: [{ key: 'money', title: 'Деньги', meta: 'Оплаты и график', onOpen: (r) => { p.setActive(r.key); p.setMain(h('p', null, 'Деньги')); } }, { key: 'stock', title: 'Склад', meta: 'Приёмка', count: 3, onOpen: (r) => { p.setActive(r.key); p.setMain(h('p', null, 'Склад')); } }],
          history: async () => h('p', { class: 'muted' }, 'Изменений пока нет') }); return p.el; })()),
      block('Подсказка (hint) · C030-13', 'hint(text, tone?) — подпись под полем или заголовком: приглушённая, warn/danger красная, ok зелёная. Где используется: главная, справочники, склад, каталог поставщика.',
        sample(h('div', null, hint('Обычная подсказка под полем'), hint('Нужно проверить значение', 'danger'), hint('Сохранено', 'ok')))),
      block('Колонки таблицы pic и nowrap · C030-12', 'columns: [{ pic: true }] — под posPic, ширина по фото; { nowrap: true } — без переноса. Где используется: склад, заказы.',
        table({ label: 'pic и nowrap', columns: [{ label: '', pic: true }, { label: 'Позиция' }, { label: 'Склад', nowrap: true }], rows: [{ cells: [posPic(null, 'sm'), LONG, 'Зона А · полка 12'] }] })),
      block('Карточка S: art, low, expand · C030-1', 'Плитка с рисунком 40×40, часть меты «мало» красным; expand раскрывает панель под плиткой на всю ширину сетки. Где используется: склад (категории, зоны), каталог поставщика.',
        tileGrid(card({ size: 'S', title: 'Без рисунка', meta: '12 позиций' }), card({ size: 'S', title: 'С рисунком', meta: '34 позиции', low: 'мало 3', art: catArt('Крепёж'), onClick: () => toast('Клик: категория') }),
          card({ size: 'S', title: 'Зона А (раскрыта)', meta: '8 позиций', art: catArt('Труба'), expand: { title: 'Зона А', action: button({ label: 'Принять', size: 'S' }), body: h('p', { class: 'muted' }, 'Позиции зоны') } }),
          card({ size: 'S', title: 'Зона Б (закрыта)', meta: '2 позиции', art: catArt('Лист'), expand: { title: 'Зона Б', body: h('p', { class: 'muted' }, 'Позиции зоны') } }))),
      block('Карточка S: artCover · C030-1б', 'artCover: true — рисунок сверху во всю ширину 16:10 на фоне фото, под ним название и мета; с expand панель раскрывается под плиткой. Склад и Продукция.',
        tileGrid(card({ size: 'S', artCover: true, title: 'Крепёж', meta: '34 позиции', low: 'мало 3', art: catArt('Крепёж'), onClick: () => toast('Клик: категория') }),
          card({ size: 'S', artCover: true, title: 'Труба', meta: '18 позиций', art: catArt('Труба'), expand: { title: 'Раздел «Труба»', body: h('p', { class: 'muted' }, 'Группы раздела') } }),
          card({ size: 'S', artCover: true, title: 'Лист', meta: '9 позиций', art: catArt('Лист') }))),
      block('Иконки типов · C037/C039', 'typeArt(тип) — плоская пиктограмма типа позиции: графит + один зелёный акцент на прозрачном фоне; нет своей иконки — иконка семейства (Болты, Шайбы…, правила — core/facets.js TYPE_FAMILIES), общий значок — «Прочее». Ниже — все иконки набора и шаг «Тип» воронки по полочкам (values[].group).',
        tileGrid(...typeIconList().map((i) => card({ size: 'S', artCover: true, title: i.label, meta: i.key, art: (() => { const el = h('span'); el.innerHTML = i.svg; return el; })() }))),
        funnel({ steps: [{ key: 'type', label: 'Тип', ask: 'выберите тип', values: [{ id: '1', label: 'Болт', count: 44, group: 'Болты и анкеры' }, { id: '2', label: 'Болт мебельный', count: 23, group: 'Болты и анкеры' }, { id: '3', label: 'Гайка шестигр', count: 12, group: 'Гайки' }, { id: '4', label: 'Гайка колпачковая', count: 6, group: 'Гайки' }, { id: '5', label: 'Шуруп', count: 7, group: '' }, { id: '*', label: 'Все типы' }] }] }).el),
      block('Плитки типов · C043', 'card({ size: \'S\', artCover: true, compact: true }) — плитка в 2 раза ниже (рисунок ≈28 px, название в одну строку), tileGrid({ compact: true }, …плитки) — плотная сетка: так типы выглядят в раскрытой категории «Остатков» (sections/stock-types.js). Плитки категорий верхнего уровня — по-прежнему обычные.',
        tileGrid({ compact: true }, ...typeIconList().slice(0, 8).map((i) => card({ size: 'S', artCover: true, compact: true, title: i.label, meta: '12 поз.', art: (() => { const el = h('span'); el.innerHTML = i.svg; return el; })(), onClick: () => toast('Клик: тип ' + i.label) })))),
      block('Посадочная (landing) · C030-2', 'landing({ head, action, body }) — строка «Выберите … · всего N», кнопка справа, ниже плитки. Где используется: склад, каталог поставщика.',
        landing({ head: 'Выберите категорию · всего 3', action: button({ label: 'Все позиции', size: 'S' }), body: tileGrid(card({ size: 'S', title: 'Крепёж', meta: '34', art: catArt('Крепёж') }), card({ size: 'S', title: 'Труба', meta: '18', art: catArt('Труба') }), card({ size: 'S', title: 'Лист', meta: '9', art: catArt('Лист') })) })),
      block('Секция: fixed, urgent, more · C030-3', 'fixed — всегда раскрыта, без стрелки; urgent — полоса danger слева; more: { limit, label } — первые limit строк и «Все (ещё N) →». Где используется: главная.',
        sample(
          section({ title: 'Показатели', count: 3, fixed: true, body: h('p', { class: 'muted' }, 'Содержимое') }),
          section({ title: 'Просрочено', count: 2, fixed: true, urgent: true, body: h('p', { class: 'muted' }, 'Срочные дела') }),
          section({ title: 'Заявки', count: 6, fixed: true, more: { limit: 3, label: 'Все' }, body: Array.from({ length: 6 }, (_, i) => row({ title: 'Заявка ' + (i + 1), meta: 'Труба 57×3' })) }))),
      block('Связанные поля и рисунки (layout.related)', 'По ширине самого блока: поля, затем рисунок; на узкой панели одна колонка.',
        layout.related({ main: stack(textInput({ label: 'Длина, мм', value: '1200', short: true }).el, textInput({ label: 'Ширина, мм', value: '600', short: true }).el, textInput({ label: 'Высота, мм', value: '900', short: true }).el), side: section({ title: 'Габаритный чертёж', fixed: true, body: hint('Связанный рисунок и действия с ним') }) })),
      block('Две колонки (layout.cols) · C030-4', '2 колонки от 1100 px, ниже одна. Где используется: главная.',
        layout.cols(section({ title: 'Слева', count: 1, fixed: true, body: h('p', { class: 'muted' }, 'Блок 1') }), section({ title: 'Справа', count: 1, fixed: true, body: h('p', { class: 'muted' }, 'Блок 2') }))),
      block('Показатель-пилюля (stat с onClick) · C030-5', 'stat({ value, label, onClick, tone, active }): число красное при tone danger и > 0, приглушённое при 0; active — рамка. Где используется: главная.',
        sample(stat({ value: 4, label: 'Просрочено', tone: 'danger', onClick: () => toast('Просрочено') }), stat({ value: 7, label: 'Сегодня', active: true, onClick: () => toast('Сегодня') }), stat({ value: 0, label: 'Ждут', tone: 'danger', onClick: () => toast('Ждут') }))),
      block('Вкладки-дни (tabs layout days) · C030-6', "tabs({ layout:'days', items:[{ key, label, sub, marks, today }] }) — 7 клеток по 56 px, сегодня с рамкой, до 3 точек по тонам. Где используется: главная.",
        tabs({ layout: 'days', value: 'c', items: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d, i) => ({ key: String.fromCharCode(97 + i), label: String(10 + i), sub: d, today: i === 2, marks: [['info'], [], ['warn', 'danger'], ['ok', 'info', 'warn'], [], [], []][i] })) }).el),
      block('Мини-график (miniChart) · C030-7', "miniChart({ type:'bar', parts:[{value,tone}] }) — полоса долей; type:'spark', points:[…] — линия с нулевой осью. Лежит в слоте graph карточки S. Где используется: главная.",
        sample(card({ size: 'S', title: 'Заявки', meta: '12', graph: miniChart({ type: 'bar', parts: [{ value: 5, tone: 'ok' }, { value: 4, tone: 'warn' }, { value: 3, tone: 'danger' }] }) }),
          card({ size: 'S', title: 'Приход за 7 дней', meta: '+18', graph: miniChart({ type: 'spark', points: [2, 5, 3, 8, 6, 9, 12] }) }))),
      block('Столбики по месяцам (miniChart columns) · C040', "miniChart({ type:'columns', groups:[{ label, values:[{value,tone}] }], legend:[{label,tone}], empty }) — столбики по периодам, только чтение, без кнопок; под графиком строка значений (C044-T2: число видно без наведения, подписи месяцев обрезаются с «…», а не режутся); все 0 — подсказка empty. Где используется: аналитика позиции номенклатуры.",
        sample(miniChart({ type: 'columns', legend: [{ label: 'Заказано', tone: 'info' }, { label: 'Получено', tone: 'ok' }, { label: 'Выдано', tone: 'warn' }],
          groups: ['янв', 'фев', 'мар', 'апр', 'май', 'июн'].map((m, i) => ({ label: m, values: [{ value: [4, 0, 8, 6, 2, 9][i], tone: 'info' }, { value: [3, 0, 8, 5, 2, 7][i], tone: 'ok' }, { value: [2, 1, 5, 6, 3, 4][i], tone: 'warn' }] })) }),
          miniChart({ type: 'columns', groups: [], legend: [], empty: 'Пока не заказывали' }))),
      block('Навигация (navList) · C030-8', 'navList({ groups:[{ title, fold, items:[{ key, label, count, href }] }], value, onPick }) — группы, одна свёрнута, пункт-ссылка «→». Где используется: справочники, каталог поставщика.',
        sample(panel({ title: 'Справочники', blocks: [{ body: navList({ value: 'a', onPick: (k) => toast('Пункт: ' + k), groups: [{ title: 'Основные', items: [{ key: 'a', label: 'Единицы', count: 12 }, { key: 'b', label: 'Цвета', count: 8 }] }, { title: 'Редкие', fold: true, open: false, items: [{ key: 'c', label: 'Склады', count: 3 }] }, { title: 'Каталог', fold: true, items: [{ key: 'd', label: 'Поставщик', href: '#kit' }] }] }).el }] }).el)),
      block('Ряд фото (photoStrip) и бейдж с цветом (badge dot) · C030-9', 'photoStrip(list) — квадраты 56 px, клик — крупно; badge(hex, tone, { dot }) — цветной кружок 12 px. Где используется: справочники.',
        sample(photoStrip([{ url: PIC }, { url: PIC }, { url: PIC }]), badge('Красный', 'dim', { dot: '#c0392b' }), badge('Синий', 'dim', { dot: '#2a6fdb' }), badge('Серый', 'dim', { dot: '#888888' }))),
      block('Карточка M fields · C030-10', "card({ size:'M', variant:'fields', price:{ value, note }, body: readonlyGroup }) — цена слева и пары в 2 колонки (на 390 — 1). Где используется: каталог поставщика.",
        sample(card({ size: 'M', variant: 'fields', title: 'Труба 57×3', meta: 'арт. 32.11', price: { value: '1 250 ₽', note: 'цена на 01.11' }, body: [readonlyGroup({ title: 'Сведения', rows: [['Поставщик', 'Металл-Сервис'], ['Мин. партия', '10 м'], ['Срок', '3 дня'], ['Склад', 'Москва']] })] }))),
      block('Карточка L: шапка + вкладки · C030-11', "card({ size:'L', head:{ title, badges, menu }, tabs:{ items, panes:{ key: () => узел } } }) — в DOM только активная панель. Где используется: заказы.",
        card({ size: 'L', head: { title: 'Договор № 20-26', badges: badge('в работе', 'info'), menu: iconButton({ icon: '⋯', label: 'Ещё', menu: true }) }, tabs: { items: [{ key: 'a', label: 'Позиции', count: 2 }, { key: 'b', label: 'Оплаты' }], panes: { a: () => h('p', { class: 'muted' }, 'Панель «Позиции»'), b: () => h('p', { class: 'muted' }, 'Панель «Оплаты»') } } })),
      block('Вкладки панели (card.tabs / buildCardTabs) · C052', 'Раздел задаёт section.card.tabs: над вкладками — сведения (view) и кнопки, ниже — tabs({ fill }) + панель вкладки строится при открытии; открытая вкладка запоминается на раздел (prefs), «Вид панели» скрыт. Пример — собранный buildCardTabs.',
        (() => {
          const el = buildCardTabs({
            section: { id: 'demo' }, row: {}, actx: () => ({ close() {}, changed() {}, edit() {}, reload() {}, run: async () => true, setRow() {}, openTab() {} }),
            setPref: () => {}, getPref: () => '', onOpenTab: () => {},
            tabDefs: [
              { key: 'info', label: 'Сведения', count: 2, blocks: () => h('p', { class: 'muted' }, 'Панель «Сведения»') },
              { key: 'docs', label: 'Документы', blocks: () => h('p', { class: 'muted' }, 'Панель «Документы» (построена при первом открытии)') },
            ],
          });
          return el;
        })()),
      block('Выпадающий список (select)', 'Без поиска, до ~10 значений. Длинные списки — pick.', sample(select({ options: [['a', 'Первый'], ['b', 'Второй']], value: 'a', label: 'Образец' }))),
      block('Кнопка выбора файла (fileButton)', 'Кнопка-подпись со скрытым полем файла; выбранный файл уходит в onFile.', sample(fileButton({ label: 'Загрузить файл…', accept: '.csv', onFile: (f) => toast(f.name) }))),
      block('Отметка происхождения (data-k)', 'Каждая фабрика kit (через mark / markEl из ui/kit/mark.js) ставит на корень data-k="<эталон>": button, badge, card, row, tabs, table, modal, panel, drawer, form, list, board, filter, pick, empty, mobile.* и др. Большая проверка сайта (правило s) считает элементы экрана без этой отметки — «не из kit».', sample(...[button({ label: 'button' }), badge('badge', 'ok'), empty({ title: 'empty' })].map((n) => h('span', { class: 'muted' }, n.dataset.k + ' → ', n)))),
      block('Строка поиска (searchBox)', 'Единственное поле поиска: крестик, пауза ввода, Esc — очистить, подсказка про минимум знаков. Пусто = «без поиска». Сырой input type=search в разделе нельзя.', searchBox({ placeholder: 'Поиск…', onSearch: (q) => toast('Поиск: ' + (q || 'всё')) })),
      block('Поле ввода (textInput) · C044-T2', "Однострочное поле эталона формы: подпись сверху, подсказка под полем, Enter → onEnter. Ввод данных — не поиск: у поиска своя фабрика searchBox. Где используется: «Название новой части» в панели «Состав и работы».", sample(
        textInput({ label: 'Название новой части', placeholder: 'Например, Стойка', onEnter: (v) => toast('Enter: ' + v) }),
        textInput({ label: 'Часов на 1 шт.', value: '1.5', inputmode: 'decimal', hint: 'Можно дробное — 1,5' }))),
      block('Ряд полей (fieldRow) · 2026-11-10', 'Короткие числовые поля в ряд с переносом: 2–4 в строке на широком экране, 1–2 на телефоне. Не stack — в колонке поле не растягивается по высоте. Где используется: «Эксплуатация и гарантия», «Габариты» в шаблоне паспорта.', sample(
        fieldRow(textInput({ label: 'Срок службы, лет', value: '10', type: 'number' }), textInput({ label: 'Гарантия, мес.', value: '12', type: 'number' }), textInput({ label: 'Возраст от, лет', type: 'number' }), textInput({ label: 'Возраст до, лет', type: 'number' })))),
      block('Планировщик цеха (planner)', 'Строки — люди или заказы, полосы — шаги работ. Перетащите полосу: по горизонтали — сдвиг дат, на другую строку — другой исполнитель (в демо возвращается на место). Красное — перегрузка дня, жёлтое — день почти полон. ←/→ на полосе — сдвиг на день.', plannerDemo()),
      block('Планировщик деревом (planner)', 'Заказ › позиция › шаги: узел показывает сводную полосу, шеврон раскрывает; у человека видна перегрузка и на свёрнутой строке. Цвет полосы — вид работ (легенда сверху, клик подсвечивает), рамка — статус: сплошная — идёт, пунктир — ждёт, бледная с галочкой — сделано, красная — просрочено. Ромб — срок заказа. Масштаб, «Уместить», «Сегодня», «Раскрыть всё».', plannerTreeDemo()),
      block('Пусто и ошибка (empty)', 'Единственная фабрика пустых состояний: kind "empty" (записей нет, подсказка и ссылка), "notFound" (поиск ничего не дал, сброс), "noData" (за период пусто). Тексты «Пусто / Ничего не найдено / Нет данных» — только через empty().', empty({ title: 'Ничего нет', hint: 'Добавьте запись в панели справа.' }), empty({ kind: 'notFound', query: 'болт М99', onReset: () => toast('Сброс') }), empty({ kind: 'notFound', onReset: () => toast('Сброс') }), empty({ kind: 'noData' }), failBlock(new Error('Тестовая ошибка'), () => toast('Повтор'))),
    );
    return {};
  },
};

