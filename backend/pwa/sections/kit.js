import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { readonlyGroup, similarBox, sku, section, button, iconButton, segmented, link, badge, card, empty, tabs, stats, toolbar, row, actions, boardStatic, board, layout, mobile, failBlock, autoMore, qtyInput, targetPicker, toast, pick, filter, table, panel, entityPanel, links, SUPPLY_STATUS } from '../ui/kit/index.js';

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
        mobile.screen({ title: 'Сколько выдать? Болт М8', step: { n: 2, of: 4 }, back: () => toast('Назад'), body: [mobile.qty({ value: 20, unit: 'шт', max: 150 }).el, mobile.choice({ items: [{ value: 1, label: 'Заказ 1245', hint: 'Скамья парковая' }, { value: 2, label: 'Заказ 1250' }], onPick: (o) => toast(o.label) }), mobile.drill({ levels: [{ title: 'Раздел склада', load: async () => [{ value: 'a', label: 'Крепёж', hint: 'позиций: 40' }, { value: 'b', label: 'Труба' }] }, { title: 'Позиция', load: async () => [{ value: 1, label: 'Болт М8', hint: 'На складе: 150 шт' }] }], onPick: (o) => toast(o.label) }).el, mobile.tiles({ items: [{ value: 1, label: 'Скамьи', art: mobile.catArt('Скамьи') }, { value: 2, label: 'Урны', art: mobile.catArt('Урны') }], onPick: (o) => toast(o.label) }), mobile.dateChoice().el, mobile.feed({ items: [{ date: '01.11', text: 'Болт М8', qty: '20', unit: 'шт', kind: 'out' }, { date: '31.10', text: 'Труба 40', qty: '5', unit: 'м', kind: 'in' }] }), mobile.error('На складе только 150 шт.')], gear: () => toast('Настройки'), foot: mobile.bigButton({ label: 'Дальше', onClick: () => toast('Дальше') }), footHint: 'Впишите количество' }),
        mobile.screen({ title: 'Готово', body: [mobile.done({ text: 'Выдано: Болт М8 · 20 шт · на заказ 1245', again: { label: 'Ещё выдать', onClick: () => {} }, home: { label: 'На главный экран', onClick: () => {} } })] })),
      block('Мобильный сканер QR (mobile.scan)', 'Экран камеры: рамка, «Наведите на код», «Отмена». Камера включается только по нажатию.',
        (() => { const box = h('div'); const open = () => { const sc = mobile.scan({ onCode: (t) => { box.replaceChildren(mobile.bigButton({ label: 'Сканировать QR', onClick: open })); toast('Считано: ' + t); }, onCancel: () => box.replaceChildren(mobile.bigButton({ label: 'Сканировать QR', onClick: open })) }); box.replaceChildren(sc.el); }; box.append(mobile.bigButton({ label: 'Сканировать QR', onClick: open })); return box; })()),
      block('Кнопка-значок, переключатель, ссылка', 'iconButton (S и M, с меню); segmented; link (переход) и кнопка ghost S (действие).',
        sample(iconButton({ icon: '⋯', label: 'Ещё', menu: true }), iconButton({ icon: '😀', label: 'Смайлик', size: 'S' }), segmented({ items: [{ key: 'a', label: 'Первый' }, { key: 'b', label: 'Второй' }, { key: 'c', label: 'Опасный', tone: 'danger' }], value: 'a', label: 'Образец' }).el, link({ label: 'Открыть раздел', href: '#kit' }))),
      block('Артикул изделия', 'sku(text) — .k-sku; впереди названия в работе с изделием, отдельной строкой в таблицах и карточках.',
        sample(h('span', null, sku('32.11'), ' Скамья «Парковая»'), h('div', null, h('div', null, 'Скамья «Парковая»'), sku('32.04')))),
      block('Компактная группа реквизитов', 'readonlyGroup: заголовок h3, пары метка — значение, пустые группы скрыты; DOM-ссылки и нули сохраняются.',
        sample(readonlyGroup({ title: 'Сведения', rows: [['Поставщик', LONG], ['Позиций', 0], ['Связь', link({ label: 'Открыть заявку', href: '#requests' })], ['Пустое', '']] }), readonlyGroup({ title: 'Пустая группа', rows: [['Нет значения', '']] }))),
      block('Сворачиваемая секция', 'section({ title, count, open, body }) — группа в правой панели: закрыта по умолчанию, в шапке число; Enter/Пробел открывает.',
        sample(section({ title: 'Для паспорта', count: 3, body: h('div', null, 'Содержимое группы') }), section({ title: 'Чертежи', count: 0, open: true, body: empty({ title: 'Чертежей нет' }) }))),
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
      block('Карточка L (.db-order)', 'Заказ / шапка сущности.', sample(...cards('L'), card({ size: 'L', title: LONG, meta: LONG }))),
      block('Строка (.k-row)', 'Список позиций, корзина с количеством, строка с галочкой. tone — полоса слева.', sample(
        row({ title: 'Труба 57×3', meta: 'на складе 120 м', side: h('b', null, '120 м'), action: button({ label: 'Принять', size: 'S' }) }),
        row({ title: LONG, meta: LONG, tone: 'warn', active: true }),
        row({ tag: 'label', lead: h('input', { type: 'checkbox', checked: true }), title: 'Лист 3 мм', meta: 'оплачено', side: [h('input', { value: '10' }), h('span', { class: 'muted small' }, 'шт')] }),
        row({ title: 'Круг 20', meta: 'на складе 5 м', qty: [h('input', { value: '8' }), h('span', { class: 'muted small' }, 'м')], diff: h('span', { class: 'k-diff num neg' }, 'свободно только 5 м'), action: button({ label: '×', kind: 'ghost', size: 'S' }), warn: h('div', { class: 'k-note neg' }, 'Меньше, чем в брони') }))),
      block('Похожее (kit.similarBox)', 'Под названием нового изделия и в сопоставлении: до 5 строк kit.row; клик — открыть/выбрать.', sample((() => { const b = similarBox({ pickLabel: 'Взять это' }); b.show([{ id: '1', name: 'Горка «Малыш»', sku: 'ГК-01', groupName: 'Горки', photo: null }, { id: '2', name: 'Горка «Малыш-2»', sku: 'ГК-02', groupName: 'Горки', photo: null }]); return b.el; })())),
      block('Выбор (pick)', 'single — список вместо select; combo — поле со списком и «+ Новое»; multi — через запятую; tags — метки. На телефоне (≤ 480 px) список — лист.', ...pickDemo()),
      block('Фильтр (kit.filter)', 'chips — фишки, один или несколько; facets — признаки склада (поиск и группы); funnel — шаги уточнения (параметры адреса).', sample(
        filter({ mode: 'chips', items: [{ key: 'a', label: 'Все', count: 12 }, { key: 'b', label: 'Новые', count: 3 }, { key: 'c', label: LONG }], value: 'a', label: 'Один выбор', onChange: (k) => toast('Выбрано: ' + k) }).el,
        filter({ mode: 'chips', multi: true, items: [{ key: 'a', label: 'Болты' }, { key: 'b', label: 'Гайки' }, { key: 'c', label: 'Шайбы' }], value: ['a', 'c'], label: 'Несколько', onChange: (k) => toast('Выбрано: ' + k.join(', ')) }).el),
        sample(filterFacets(), filterFunnel())),
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
      block('Таблица (table)', 'list — таблица списка: числа вправо, итог в подвале; money: true у колонки (и у поля panel) — скрыто без галочки «Деньги»; пустая — kit.empty. input — табличный ввод для форм (строки в ячейках, + Строка, Excel).',
        table({ clickable: true, columns: [{ label: 'Название' }, { label: 'Кол-во', num: true }, { label: 'Цена', num: true, money: true }], rows: [{ cells: ['Болт М10', '120', '12,50'], onClick: () => toast('Строка') }, { cells: [LONG, '3', '1 200,00'], selected: true }],
          foot: [h('tr', null, h('td', null, 'Итого'), h('td', { class: 'num' }, '123'), h('td', { class: 'num' }, '1 212,50'))] }),
        table({ columns: [{ label: 'Название' }, { label: 'Кол-во', num: true }], rows: [], empty: { title: 'Строк нет', hint: 'Добавьте запись.' } }),
        table({ mode: 'input', columns: [{ key: 'name', label: 'Название' }, { key: 'qty', label: 'Кол-во', num: true }], rows: [{ name: 'Болт', qty: '4' }], file: 'Образец' }).el),
      block('Правая панель (panel)', 'Шапка (тип записи, заголовок, подзаголовок, ✕), блоки полей, подвал с кнопками. Здесь — образец содержимого; настоящая панель открывается через openCard.',
        panel({ kind: 'Изделие', title: 'Качели двойные', sub: 'Артикул КЧ-02', onClose: () => toast('Закрыть'),
          blocks: [{ title: 'Основное', body: h('p', { class: 'muted' }, 'Поля блока') }, { title: 'Дополнительно', body: h('p', { class: 'muted' }, 'Ещё поля') }],
          footer: [button({ label: 'Сохранить', kind: 'primary' }), button({ label: 'Отмена' })] }).el),
      block('Правая панель v2 (entityPanel)', 'Сверху вниз: «раздел › сущность», главный блок раздела, карточки связей (сетка от 240 px, активная с рамкой), история внизу свёрнута. Нажатие на связь меняет главный блок, страница слева остаётся.',
        (() => { const p = entityPanel({ section: 'Деньги', title: 'Счёт № 4521', kind: 'Счёт', onClose: () => toast('Закрыть'), main: h('p', { class: 'muted' }, 'Главный блок: данные и кнопки раздела'), active: 'money',
          related: [{ key: 'money', title: 'Деньги', meta: 'Оплаты и график', onOpen: (r) => { p.setActive(r.key); p.setMain(h('p', null, 'Деньги')); } }, { key: 'stock', title: 'Склад', meta: 'Приёмка', count: 3, onOpen: (r) => { p.setActive(r.key); p.setMain(h('p', null, 'Склад')); } }],
          history: async () => h('p', { class: 'muted' }, 'Изменений пока нет') }); return p.el; })()),
      block('Отметка происхождения (data-k)', 'Каждая фабрика kit (через mark / markEl из ui/kit/mark.js) ставит на корень data-k="<эталон>": button, badge, card, row, tabs, table, modal, panel, drawer, form, list, board, filter, pick, empty, mobile.* и др. Большая проверка сайта (правило s) считает элементы экрана без этой отметки — «не из kit».', sample(...[button({ label: 'button' }), badge('badge', 'ok'), empty({ title: 'empty' })].map((n) => h('span', { class: 'muted' }, n.dataset.k + ' → ', n)))),
      block('Пусто и ошибка (empty)', 'Единственная фабрика пустых состояний: kind "empty" (записей нет, подсказка и ссылка), "notFound" (поиск ничего не дал, сброс), "noData" (за период пусто). Тексты «Пусто / Ничего не найдено / Нет данных» — только через empty().', empty({ title: 'Ничего нет', hint: 'Добавьте запись в панели справа.' }), empty({ kind: 'notFound', query: 'болт М99', onReset: () => toast('Сброс') }), empty({ kind: 'notFound', onReset: () => toast('Сброс') }), empty({ kind: 'noData' }), failBlock(new Error('Тестовая ошибка'), () => toast('Повтор'))),
    );
    return {};
  },
};

