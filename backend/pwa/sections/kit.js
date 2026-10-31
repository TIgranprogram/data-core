import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { button, badge, card, empty, tabs, stats, toolbar, boardStatic, failBlock, toast, SUPPLY_STATUS } from '../ui/kit/index.js';

/** Витрина эталонов (#kit, только admin): семейство × варианты × пусто / длинный текст / ошибка. */
const LONG = 'Очень длинное название позиции для проверки переноса и обрезки текста в карточке эталона';
const TONES = ['neutral', 'info', 'warn', 'danger', 'ok'];
const PIC = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#eee"/><path d="M10 50 L40 10 L70 50 Z" fill="#999"/></svg>');

const block = (title, note, ...kids) => h('section', { class: 'panel' }, h('h2', null, title), note ? h('p', { class: 'k-note' }, note) : null, ...kids);
const sample = (...kids) => h('div', { class: 'k-sample' }, ...kids);
const cards = (size) => TONES.map((tone) => card({ size, tone, title: 'Заголовок ' + tone, meta: 'Мета · 12 шт', badges: badge(SUPPLY_STATUS, 'ordered'), onClick: () => toast('Клик: ' + tone) }));

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
      block('Карточка S (.tile)', 'tone; длинный текст; без меты; с действием.',
        sample(...cards('S'), card({ size: 'S', title: LONG, meta: LONG }), card({ size: 'S', title: 'Без меты' }), card({ size: 'S', title: 'С действием', actions: button({ label: 'Открыть', size: 'S' }) }))),
      block('Карточка M (.tcard)', 'tone; с фото; плотная (compact); длинный текст.',
        sample(...cards('M'), card({ size: 'M', title: LONG, meta: LONG }), card({ size: 'M', title: 'С фото', meta: 'чертёж', photo: PIC }),
          card({ size: 'M', title: 'Плотная', meta: 'compact', photo: PIC, density: 'compact' }), card({ size: 'M', title: 'С действием', actions: button({ label: 'Принять', kind: 'primary', size: 'S' }) }))),
      block('Карточка L (.db-order)', 'Заказ / шапка сущности.', sample(...cards('L'), card({ size: 'L', title: LONG, meta: LONG }))),
      block('Бейджи', null, sample(...Object.keys(SUPPLY_STATUS).map((k) => badge(SUPPLY_STATUS, k)), badge('Одиночная', 'ok'), badge(LONG, 'warn'))),
      block('Вкладки', null, t.el),
      block('Показатели', null, stats([{ value: 12, label: 'Заказов' }, { value: '1 250 000', label: 'Сумма' }, { value: 0, label: 'Просрочено' }]), stats([{ value: 1, label: LONG }])),
      block('Панель инструментов', null, toolbar(button({ label: 'Создать', kind: 'primary' }), button({ label: 'Экспорт' }), badge('Фильтр', 'info'))),
      ...['normal', 'compact', 'pics'].map((density) => block('Доска · плотность ' + density, 'Колонки с карточками M; пустые колонки; длинный текст.',
        boardStatic({ density, columns: [
          { key: 'a', label: 'Новые', tone: 'primary', hint: 'Что делать здесь', cards: [card({ size: 'M', title: 'Задача 1', meta: 'Иванов', photo: PIC, density: dens(density) }), card({ size: 'M', title: LONG, meta: 'срок завтра', tone: 'warn', density: dens(density) })] },
          { key: 'b', label: 'В работе', tone: 'info', cards: [] },
          { key: 'c', label: 'Готово', tone: 'ok', empty: 'Ничего нет', cards: [] }] }))),
      block('Пусто и ошибка', null, empty({ title: 'Ничего нет', hint: 'Добавьте запись в панели справа.' }), failBlock(new Error('Тестовая ошибка'), () => toast('Повтор'))),
    );
    return {};
  },
};

