// Карта физического склада и рабочих таблиц по зонам.
export const STOCK = { id: 'stock', tpl: 'card', tplStatus: 'ok', band: 'stock', col: 2, sec: 'stock', t: 'Остатки', l: ['где и сколько лежит,', 'приём, бронь, выдача'],
    seq: true, inside: [
      { id: 'priem', t: 'Приём', l: 'из заявки, с телефона или вручную', in: ['requests', 'stockmobile'] },
      { id: 'pozicii-po-polkam', t: 'Позиции по полкам', l: 'категория → тип → вся номенклатура доступной зоны; фильтры мойки и размера слева, поиск размера и «Ещё»; нули серым «Нет в наличии»', out: ['needs', 'movements', 'shortage', 'shipping'] },
      { id: 'bron', t: 'Бронь', l: 'держит материал за позицией заказа' },
      { id: 'vydacha', t: 'Выдача', l: 'в работу по брони или заданию', out: ['work'] },
      { id: 'zony-sklada', t: 'Зоны склада', l: 'кто за какую зону отвечает', alt: true },
      { id: 'bron-po-sostavu', t: 'Бронь по составу', l: 'одна кнопка в позиции заказа', alt: true, plan: 'C068-4', in: ['products'] },
      { id: 'ekran-truboreza', t: 'Экран «Труборез»', l: 'рабочая сетка: сечения по строкам, мойка и длина по столбцам; количество в исходной единице, разные материалы не объединяются', href: '#stock?view=pipe', alt: true },
      { id: 'ekran-lazera', t: 'Экран «Лазер лист»', l: 'рабочие блоки по марке: толщина и формат, крупные ячейки количества и примечания; целые листы и обрезки в своих единицах', href: '#stock?view=sheet', alt: true },
      { id: 'derevoobrabotka', t: 'Деревообработка', l: 'физический остаток, бронь и свободное количество по материалам зоны', href: '#stock?view=wood', alt: true },
    ],
    rules: [
    'Дополнительные экраны «Труборез» и «Лазер лист» директор открывает только для просмотра при доступном разделе склада; свой рабочий экран роли сохраняет прежнее редактирование.','Приём, выдача и пересчёт меняют остаток; всё видно в журнале.', 'Количество — только операцией, не правкой карточки.', 'Нули видны серым «Нет в наличии»; полностью забронированные остаются в наличии. Размеры сортируются численно по всему списку; метраж не превращается в физические штуки. Собственные детали — в разделе «Детали».'],
    docs: ['docs/UNIFY-SUPPLY-WAREHOUSE.md', 'docs/MAP.md — stock, stock-zones'], tech: 'storageitems, reservations, warehouses (общие с CRM)',
    code: ['backend/src/modules/stock', 'backend/src/modules/stock-zones', 'backend/pwa/sections/stock.js', 'backend/pwa/sections/wood-grid.js', 'backend/pwa/sections/stock-worktable.js', 'backend/pwa/sections/stock-table-columns.js', 'backend/pwa/sections/reservations.js'] };
