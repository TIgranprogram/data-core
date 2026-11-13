// Данные «Карты сайта» (#atlas): слои сверху вниз, блоки-разделы, связи между ними и «что внутри» каждого блока.
// Карта — общая шпаргалка для менеджеров и для ИИ: правите устройство сайта — правьте и здесь (связи, «внутри», docs).
// Шаги «как работать» не дублируются: берутся из help-guide-data.js (SECTIONS[sec].steps).
// tok — цвет слоя (--sec-*); x/y — левый верхний угол блока на общей схеме (ширина схемы 1200).

/** Слои сверху вниз: путь заказа от клиента до денег. */
export const BANDS = [
  { id: 'sale', name: 'Клиенты и продажи', hint: 'кто покупает и что', tok: 'orders' },
  { id: 'prod', name: 'Продукция', hint: 'что делаем и как описываем', tok: 'products' },
  { id: 'make', name: 'Производство', hint: 'кто и когда делает', tok: 'products' },
  { id: 'supply', name: 'Снабжение', hint: 'что и у кого покупаем', tok: 'supply' },
  { id: 'stock', name: 'Склад', hint: 'что лежит и куда ушло', tok: 'stock' },
  { id: 'after', name: 'Отгрузка и сервис', hint: 'довезти, смонтировать, гарантия', tok: 'orders' },
  { id: 'money', name: 'Деньги', hint: 'кто кому должен', tok: 'money' },
];

/**
 * Блоки. sec — ключ раздела в help-guide-data (имя, адрес, шаги); t/l — заголовок и 2 строки на схеме.
 * inside — что внутри раздела (декомпозиция): { t — часть, l — пояснение }.
 * rules — что учитывать при изменении; docs — где описано (для ИИ и разработчика); tech — таблицы базы.
 * id шагов — постоянные (ссылки «блок.шаг» в задачах и сводке для ИИ): при переименовании шага id не менять.
 * code — файлы и папки кода блока (сервер и экран); dc check проверяет, что они есть, и предупреждает, если код новее карты.
 * plan: '<код задачи>' — раздел или шаг ещё в разработке (серый, полупрозрачный); код — из docs/TASKS.md / crew/BOARD.md.
 * plan: 'идея' — предложение координатора, в очереди задач нет; нужно решение владельца (взять в работу или удалить).
 * Сделали — убрать plan и проверить связи; отменили — удалить блок.
 */
export const NODES = [
  // ── Клиенты и продажи
  { id: 'partners', band: 'sale', col: 0, sec: 'partners', href: '#partners', t: 'Контрагенты', l: ['заказчики, поставщики,', 'наши фирмы'],
    inside: [
      { id: 'zakazchiki', t: 'Заказчики', l: 'кому продаём: реквизиты, контакты', out: ['offers', 'salesorders'] },
      { id: 'nashi-firmy', t: 'Наши фирмы', l: 'от чьего имени КП, счёт, паспорт', out: ['offers'] },
      { id: 'postavschiki', t: 'Поставщики', l: 'у кого покупаем: счета, договоры', out: ['requests'] },
      { id: 'kontakty-i-ploschadki', t: 'Контакты и площадки', l: 'люди и адреса контрагента' },
    ],
    rules: ['Одна организация — одна запись. Дубль раздваивает долги и историю заказов.', 'ИНН проверяется при сохранении.'],
    docs: ['docs/PRODUCT.md — «Контрагенты»', 'docs/MAP.md — partners, counterparty'], tech: 'organizations (поставщики, наши фирмы, реквизиты заказчиков); заказчик в заказе — текст customer в salesorders/incomes',
    code: ['backend/src/modules/partners', 'backend/src/modules/organization', 'backend/pwa/sections/partners.js'] },
  { id: 'offers', band: 'sale', col: 1, sec: 'offers', t: 'КП', l: ['подбор изделий, цена', 'с наценкой, PDF'],
    seq: true, inside: [
      { id: 'zakazchik-i-firma', t: 'Заказчик и фирма', l: 'из контрагентов', in: ['partners'] },
      { id: 'pozicii-kp', t: 'Позиции КП', l: 'изделия из «Продукции» с количеством', in: ['products'] },
      { id: 'cena-i-nacenka', t: 'Цена и наценка', l: 'копия для другой фирмы пересчитывает' },
      { id: 'pdf', t: 'PDF', l: 'бланк нашей фирмы', out: ['salesorders'] },
      { id: 'kp-po-shagam', t: 'КП по шагам', l: 'тот же путь мастером: заказчик → изделия → цвет', alt: true },
      { id: 'razobrat-zayavku-ii', t: 'Разобрать заявку (ИИ)', l: 'текст заказчика → строки КП с подбором', alt: true, plan: 'C092' },
    ],
    rules: ['КП не меняет изделие: цена в КП — своя, у изделия — базовая.'],
    docs: ['docs/PRODUCT.md — «КП»', 'docs/MAP.md — offers'], tech: 'offers',
    code: ['backend/src/modules/offers', 'backend/pwa/sections/offers.js', 'backend/pwa/sections/offers/', 'backend/pwa/sections/kp.js'] },
  { id: 'salesorders', band: 'sale', col: 2, sec: 'salesorders', t: 'Заказы', l: ['позиции, срок, этапы:', 'в работу → отгрузка'],
    seq: true, inside: [
      { id: 'zakaz-i-dogovory', t: 'Заказ и договоры', l: 'заказчик, его договоры (внутри заказа), КП', in: ['partners', 'offers'] },
      { id: 'pozicii', t: 'Позиции', l: 'изделие, новое изделие или услуга', in: ['products', 'matching'], out: ['matching'] },
      { id: 'raspredelenie', t: 'Распределение', l: 'все позиции распределены — задачи проектирования создаются сами', out: ['design'] },
      { id: 'v-rabotu', t: 'В работу', l: 'позиции уходят в производство', out: ['work', 'shortage'] },
      { id: 'pasporta-zakaza', t: 'Паспорта заказа', l: 'по одному на экземпляр', out: ['docs'] },
      { id: 'otgruzka', t: 'Отгрузка', l: 'предлагаются изготовленные; не весь остаток — с причиной', out: ['shipping'] },
      { id: 'raschety', t: 'Расчёты', l: 'оплаты заказчика по заказу', out: ['money'] },
    ],
    rules: ['Задачи проектирования создаются сами, только когда распределены все позиции заказа.', 'Позиция связывает изделие, количество, срок и работу.', 'Изменение заказа не переписывает выпущенный паспорт.', '«В производство» недоступно, пока есть нераспределённые позиции.'],
    docs: ['docs/PRODUCT.md — «Заказы»', 'docs/MAP.md — salesorders, shipments, incomes'], tech: 'salesorders, incomes, shipments',
    code: ['backend/src/modules/salesorders', 'backend/src/modules/incomes', 'backend/src/modules/shipments', 'backend/pwa/sections/salesorders.js', 'backend/pwa/sections/order-lines.js', 'backend/pwa/sections/order-shipments.js'] },
  { id: 'contracts', band: 'supply', col: 1, sec: 'contracts', t: 'Договоры', l: ['с поставщиками:', 'номер, срок, файлы'],
    inside: [
      { id: 'dogovor-postavki', t: 'Договор поставки', l: 'поставщик, номер, дата; выбирается в счёте', out: ['requests'] },
      { id: 'srok-i-status', t: 'Срок и статус', l: 'действует до; закрытые не предлагаются' },
      { id: 'faily', t: 'Файлы', l: 'скан и приложения' },
    ],
    rules: ['Здесь — только договоры с поставщиками. Договоры заказчика ведутся внутри заказа («+ Добавить договор»).'],
    docs: ['docs/PRODUCT.md — «Договоры»'], tech: 'contracts',
    code: ['backend/src/modules/supply', 'backend/pwa/sections/contracts.js'] },

  { id: 'matching', band: 'sale', col: 3, sec: null, href: '#matching', t: 'Сопоставление', l: ['позиция заказа ↔', 'изделие из каталога'],
    seq: true, inside: [
      { id: 'nesopostavlennye', t: 'Несопоставленные', l: 'позиции заказов без изделия', in: ['salesorders'] },
      { id: 'podbor', t: 'Подбор', l: 'похожие изделия: по артикулу, названию', in: ['products'] },
      { id: 'podtverdit', t: 'Подтвердить', l: 'изделие закрепляется за позицией', out: ['salesorders'] },
    ],
    rules: ['Пока позиция не сопоставлена, состав и паспорт для неё не подтянутся.'],
    docs: ['docs/MAP.md — matching'], tech: 'salesorders (позиции), products',
    code: ['backend/src/modules/matching', 'backend/pwa/sections/matching-queue.js', 'backend/pwa/sections/salesorders-matching.js'] },

  // ── Продукция
  { id: 'dicts', band: 'prod', col: 0, sec: 'dicts', href: '#dicts', t: 'Справочники', l: ['типы паспортов, тексты,', 'цвета, виды работ'],
    inside: [
      { id: 'kategorii-izdelii', t: 'Категории изделий', l: 'Раздел → Группа → Подгруппа → Серия', out: ['products'] },
      { id: 'cveta-ral-i', t: 'Цвета RAL и виды работ', l: 'для деталей, изделий и производства', out: ['products'] },
      { id: 'teksty-i-chasti', t: 'Тексты и части паспорта', l: 'общие на тип паспорта или «Для всех»', out: ['docs'] },
      { id: 'stati-rashodov', t: 'Статьи расходов', l: 'дерево статей для «Денег»', out: ['expenses'] },
    ],
    rules: ['Запись справочника используют многие изделия. Перед правкой проверьте, кому она подходит.', 'Выпущенный паспорт не получает новые тексты сам.'],
    docs: ['docs/MAP.md — dicts, category, work-type, color-reference', 'docs/PASSPORTS-V2.md'], tech: 'categories, worktypes, color_references, passporttemplates',
    code: ['backend/src/modules/dicts', 'backend/src/modules/category', 'backend/src/modules/work-type', 'backend/src/modules/color-reference', 'backend/src/modules/expense-articles', 'backend/pwa/sections/dicts.js'] },
  { id: 'products', band: 'prod', col: 1, sec: 'products', t: 'ИЗДЕЛИЕ', big: true, l: ['артикул, фото, категория,', 'состав, работы, файлы'],
    productMap: true,
    inside: [
      { id: 'kartochka', t: 'Карточка', l: 'артикул = обозначение PDM, название, фото, категория', in: ['design', 'dicts'], out: ['offers', 'salesorders', 'docs', 'matching'] },
      { id: 'sostav', t: 'Состав ♻', l: 'модули, детали, сырьё и метизы', in: ['suppliercatalog'], out: ['needs'] },
      { id: 'raboty', t: 'Работы', l: 'виды работ и часы на 1 шт.', in: ['work'], out: ['work'] },
      { id: 'faily', t: 'Файлы ♻', l: 'PDF и DXF с версиями' },
      { id: 'sebestoimost', t: 'Себестоимость', l: 'материалы + работы по ставкам' },
    ],
    rules: ['Общие сведения задаются в изделии. Черновик паспорта берёт их отсюда.', 'Выпущенный паспорт хранит снимок: правка изделия его не меняет.', '♻ — запись одна на весь каталог: правка меняет все изделия.', 'Файлы PDM скачиваются только после входа: по прямой ссылке без входа их не открыть.'],
    docs: ['docs/PRODUCT.md — «Продукция»', 'docs/crew/C057-pdm-import/DECISIONS.md', 'docs/MAP.md — product, product-module, material'], tech: 'products, productmodules, materials, pdmfiles',
    code: ['backend/src/modules/product', 'backend/src/modules/product-module', 'backend/src/modules/material', 'backend/src/modules/pdm-files', 'backend/pwa/sections/products.js', 'backend/pwa/sections/products/', 'backend/pwa/sections/composition.js'] },
  { id: 'design', band: 'prod', col: 2, sec: 'design', t: 'Проектирование', l: ['новые изделия', 'из заказов'],
    seq: true, inside: [
      { id: 'na-raspredelenii', t: 'На распределении', l: 'появляется, когда все позиции заказа распределены', in: ['salesorders'] },
      { id: 'v-rabote', t: 'В работе', l: 'проектировщик ведёт по доске' },
      { id: 'zaversheny', t: 'Завершены', l: 'изделие создано — позицию можно запускать', out: ['products'] },
      { id: 'eto-dubl', t: '«Это дубль»', l: 'такое изделие уже есть в «Продукции»', alt: true },
    ],
    rules: ['Пока задача не закрыта, заказ нельзя отправить «В производство».'],
    docs: ['docs/PRODUCT.md — «Проектирование»', 'docs/MAP.md — design, product-requests'], tech: 'designtasks, productrequests',
    code: ['backend/src/modules/design', 'backend/src/modules/product-requests', 'backend/pwa/sections/design.js', 'backend/pwa/sections/design-requests.js'] },
  { id: 'docs', band: 'prod', col: 3, sec: 'docs', t: 'Документация', l: ['паспорта: черновик →', 'выпуск PDF, редакции'],
    seq: true, inside: [
      { id: 'ochered', t: 'Очередь', l: '«Нужно сделать паспорт» по заказам', in: ['salesorders'] },
      { id: 'chernovik', t: 'Черновик', l: 'данные из изделия: модули сборного изделия и глубина Г для схемы установки', in: ['products'] },
      { id: 'vid-izdeliya', t: 'Вид изделия', l: 'что это, назначение и тип паспорта — из вида группы или своё', in: ['dicts'] },
      { id: 'shablon-kategorii', t: 'Шаблон типа паспорта', l: 'тексты и рисунки из справочников', in: ['dicts'] },
      { id: 'vypusk-pdf', t: 'Выпуск PDF', l: 'текст и рисунки фиксируются', out: ['warranty'] },
      { id: 'novaya-redakciya', t: 'Новая редакция', l: 'единственный способ изменить выпущенный', alt: true },
      { id: 'pasporta-zakaza', t: 'Паспорта заказа', l: '«Печать паспортов…» — из карточки заказа, «По заказам» и панели', alt: true },
    ],
    rules: ['Без типа паспорта PDF не выпускается.', 'Выпущенный паспорт меняется только новой редакцией.'],
    docs: ['docs/PASSPORTS-V2.md', 'docs/crew/C096-passport-system-audit/', 'docs/MAP.md — product-passport'], tech: 'productpassports, passporttemplates',
    code: ['backend/src/modules/product-passport', 'backend/pwa/sections/passports.js', 'backend/pwa/sections/passports/', 'backend/pwa/sections/docs.js', 'backend/pwa/sections/docs-queue.js'] },

  // ── Производство
  { id: 'staff', band: 'make', col: 0, sec: 'staff', t: 'Сотрудники', l: ['роли, зоны,', 'ставки, доступ'],
    inside: [
      { id: 'chelovek-i-rol', t: 'Человек и роль', l: 'галочки: что видит в меню', out: ['work', 'gantt'] },
      { id: 'zony-otvetstvennosti', t: 'Зоны ответственности', l: 'кто отвечает за склад, закупку…' },
      { id: 'stavka', t: 'Ставка', l: 'для себестоимости и зарплаты', out: ['payroll'] },
      { id: 'vhod', t: 'Вход', l: 'есть ли логин на сайт' },
    ],
    rules: ['Убрать галочку раздела — человек перестанет его видеть.'],
    docs: ['docs/MAP.md — user, role, zones'], tech: 'users, roles, zones',
    code: ['backend/src/modules/user', 'backend/src/modules/role', 'backend/src/modules/zones', 'backend/src/modules/person', 'backend/pwa/sections/staff.js'] },
  { id: 'work', band: 'make', col: 1, sec: 'work', t: 'В работе', l: ['части × работы,', 'доска, Гант, факт'],
    seq: true, inside: [
      { id: 'sostav-pozicii', t: 'Состав позиции', l: 'части × виды работ, часы на 1 шт.', in: ['salesorders', 'products'] },
      { id: 'provereno-i-sohranit', t: '«Проверено» и «Сохранить»', l: 'зелёная метка; правка часов снимает' },
      { id: 'zadaniya', t: 'Задания', l: 'по видам работ, с исполнителями', in: ['staff', 'master'], out: ['gantt'] },
      { id: 'nachal-zakonchil', t: '«Начал» / «Закончил»', l: 'материалы со склада; из отметок — факт', in: ['stock'] },
      { id: 'fakt-norma', t: 'Факт → норма', l: '«Принять как норму» пишет в изделие', out: ['products', 'reports'] },
    ],
    rules: ['Порядок: части и работы → «Проверено» → «Сохранить» → «Запустить».', '«И в продукцию» меняет состав изделия для будущих заказов.'],
    docs: ['docs/PRODUCT.md — «В работе»', 'docs/MAP.md — work, order-line-plan, my-tasks'], tech: 'worktasks, orderlineplans',
    code: ['backend/src/modules/work', 'backend/src/modules/order-line-plan', 'backend/pwa/sections/work.js', 'backend/pwa/sections/order-work.js', 'backend/pwa/sections/work-facts.js'] },
  { id: 'gantt', band: 'make', col: 2, sec: null, href: '#workschedule', t: 'Гант', l: ['сроки по людям', 'и позициям'],
    inside: [
      { id: 'po-poziciyam', t: 'По позициям', l: 'заказ › позиция › часть › шаги', in: ['work'] },
      { id: 'po-lyudyam', t: 'По людям', l: 'человек › позиция › шаги', in: ['staff'] },
      { id: 'polosa-shaga', t: 'Полоса шага', l: 'цвет — вид работ, рамка — статус, ромб — срок' },
      { id: 'peredat-rabotu', t: 'Передать работу', l: 'перетащить полосу на другого человека', out: ['master'] },
      { id: 'moi-zadaniya', t: 'Мои задания', l: 'у исполнителя — свои шаги на «Сегодня»' },
    ],
    rules: ['Сдвиг полосы меняет плановые даты шага, а не срок заказа.'],
    docs: ['docs/MAP.md — work, my-tasks'], tech: 'worktasks, orderlineplans',
    code: ['backend/src/modules/work', 'backend/src/modules/my-tasks', 'backend/pwa/sections/work-schedule.js'] },

  { id: 'master', band: 'make', col: 3, sec: null, plan: 'C050', t: 'Мастер, мои задания', l: ['экран рабочего на телефоне,', 'мастер распределяет'],
    seq: true, inside: [
      { id: 'master-raspredelyaet', t: 'Мастер распределяет', l: 'кому какой шаг — в Ганте', in: ['gantt'] },
      { id: 'moi-zadaniya', t: 'Мои задания', l: 'только свои шаги, без цен, на телефоне' },
      { id: 'porucheniya', t: 'Поручения сотрудникам', l: 'из любой карточки: кому, что, чек-лист, срок', alt: true, plan: 'ЗАДАЧИ-СОТРУДНИКАМ' },
      { id: 'nachal-zakonchil-otlozheno', t: '«Начал / Закончил / Отложено»', l: 'одним нажатием', out: ['work'] },
    ],
    rules: ['В разработке: требования пишет аналитик. Сервер «Мои задания» уже есть, отдельного экрана и роли «Мастер» нет.'],
    docs: ['docs/crew/C050-my-tasks/', 'docs/TASKS.md — C050'], tech: 'orderlineplans',
    code: ['backend/src/modules/my-tasks'] },

  // ── Снабжение
  { id: 'suppliercatalog', band: 'supply', col: 0, sec: 'suppliercatalog', t: 'Каталог номенклатуры', l: ['всё, что покупаем:', 'цены, поставщики'],
    inside: [
      { id: 'poziciya', t: 'Позиция', l: 'артикул, название, единица', out: ['requests'] },
      { id: 'detali-i-syre', t: 'Детали и сырьё', l: 'те же позиции — в составе изделий', out: ['products'] },
      { id: 'predlozheniya-postavschikov', t: 'Предложения поставщиков', l: 'цена и срок у каждого' },
      { id: 'svyaz-so-skladom', t: 'Связь со складом', l: '«Связать с позицией»' },
      { id: 'sravnenie', t: 'Сравнение позиций', l: 'Отметьте две карточки → «Сравнить…» → «Показать только различия»' },
    ],
    rules: ['Название позиции меняют здесь, количество — только складской операцией.', 'Одна позиция — во всех изделиях, заявках и остатках.'],
    docs: ['docs/UNIFY-SUPPLY-WAREHOUSE.md', 'docs/MAP.md — supply, material'], tech: 'materials (общая с CRM)',
    code: ['backend/src/modules/supply', 'backend/src/modules/material', 'backend/pwa/sections/supplier-catalog.js'] },
  { id: 'requests', band: 'supply', col: 2, sec: 'requests', t: 'Заявки', l: ['заявка → заказал →', 'счёт → оплачено → получено'],
    seq: true, inside: [
      { id: 'zayavka', t: 'Заявка', l: 'что купить и сколько', in: ['suppliercatalog', 'needs', 'shortage'] },
      { id: 'zakazal', t: '«Заказал»', l: 'у поставщика, по договору', in: ['partners', 'contracts'] },
      { id: 'schet', t: 'Счёт', l: 'неоплаченный — в план и долги', out: ['money'] },
      { id: 'oplacheno', t: '«Оплачено»', l: 'оплата — в фактическое движение денег', out: ['money'] },
      { id: 'priemka', t: 'Приёмка', l: 'товар приходит на склад', out: ['stock'] },
    ],
    rules: ['Удалять оплаченные строки нельзя.', 'После первой приёмки суммы счёта не правятся.'],
    docs: ['docs/PRODUCT.md — «Заявки»', 'docs/UNIFY-SUPPLY-WAREHOUSE.md'], tech: 'supplyrequests (общая с CRM)',
    code: ['backend/src/modules/supply', 'backend/pwa/sections/requests.js', 'backend/pwa/sections/invoice-workspace.js'] },
  { id: 'needs', band: 'supply', col: 3, sec: null, where: 'Продукция → карточка изделия → «Что купить»', t: 'Что купить', l: ['изделие × количество', '− остатки склада'],
    seq: true, inside: [
      { id: 'potrebnost', t: 'Потребность', l: 'состав изделия × количество: листы, хлысты, метизы', in: ['products'] },
      { id: 'minus-ostatki', t: 'Минус остатки', l: 'что уже лежит на складе', in: ['stock'] },
      { id: 'v-zayavku', t: 'В заявку', l: 'нехватка одной кнопкой', out: ['requests'] },
    ],
    rules: ['Считается по одному изделию на заданное количество, из его состава: пустой состав — пустая потребность.'],
    docs: ['docs/MAP.md — product (purchase-needs)'], tech: 'products, storageitems',
    code: ['backend/src/modules/product', 'backend/pwa/sections/products/'] },

  // ── Склад
  { id: 'stockmobile', band: 'stock', col: 0, sec: 'stock-mobile', t: 'Склад · телефон', l: ['крупные кнопки, QR,', 'работает без связи'],
    inside: [
      { id: 'vydat-prinyat', t: 'Выдать / Принять', l: 'две большие кнопки', out: ['stock'] },
      { id: 'qr-nakleika', t: 'QR-наклейка', l: 'камера открывает позицию' },
      { id: 'bez-svyazi', t: 'Без связи', l: 'операции уйдут, когда появится сеть' },
    ],
    rules: ['Это те же остатки — просто другой экран.'],
    docs: ['docs/DESIGN-MOBILE.md'], tech: 'storageitems, stockmovements',
    code: ['backend/pwa/sections/stock-mobile.js', 'backend/pwa/sections/warehouse-mobile.js'] },
  { id: 'stock', band: 'stock', col: 2, sec: 'stock', t: 'Остатки', l: ['где и сколько лежит,', 'приём, бронь, выдача'],
    seq: true, inside: [
      { id: 'priem', t: 'Приём', l: 'из заявки, с телефона или вручную', in: ['requests', 'stockmobile'] },
      { id: 'pozicii-po-polkam', t: 'Позиции по полкам', l: 'категория → тип → позиция', out: ['needs', 'movements', 'shortage', 'shipping'] },
      { id: 'bron', t: 'Бронь', l: 'держит материал за позицией заказа' },
      { id: 'vydacha', t: 'Выдача', l: 'в работу по брони или заданию', out: ['work'] },
      { id: 'zony-sklada', t: 'Зоны склада', l: 'кто за какую зону отвечает', alt: true },
      { id: 'bron-po-sostavu', t: 'Бронь по составу', l: 'одна кнопка в позиции заказа', alt: true, plan: 'C068-4' },
    ],
    rules: ['Приём, выдача и пересчёт меняют остаток; всё видно в журнале.', 'Количество — только операцией, не правкой карточки.'],
    docs: ['docs/UNIFY-SUPPLY-WAREHOUSE.md', 'docs/MAP.md — stock, stock-zones'], tech: 'storageitems, reservations, warehouses (общие с CRM)',
    code: ['backend/src/modules/stock', 'backend/src/modules/stock-zones', 'backend/pwa/sections/stock.js', 'backend/pwa/sections/reservations.js'] },
  { id: 'movements', band: 'stock', col: 3, sec: 'movements', t: 'Журнал движений', l: ['каждый приход', 'и каждая выдача'],
    seq: true, inside: [
      { id: 'zapis-operacii', t: 'Запись операции', l: 'кто, что, сколько, когда', in: ['stock'] },
      { id: 'ispravit', t: '«Исправить»', l: 'старая запись отменяется, новая проходит' },
    ],
    rules: ['Записи не удаляются — только исправляются.'],
    docs: ['docs/MAP.md — stock'], tech: 'stockmovements (общая с CRM)',
    code: ['backend/src/modules/stock', 'backend/pwa/sections/movements.js'] },

  { id: 'shortage', band: 'stock', col: 1, sec: null, plan: 'C048-8', t: 'Не хватает под заказы', l: ['состав заказов в работе', '− свободный остаток'],
    seq: true, inside: [
      { id: 'potrebnost-zakazov', t: 'Потребность заказов', l: 'состав позиций в работе × количество', in: ['salesorders'] },
      { id: 'minus-svobodnoe-i', t: 'Минус свободное и «в пути»', l: 'свободный остаток и заказанное', in: ['stock'] },
      { id: 'zayavka-na-nedostayuschee', t: 'Заявка на недостающее', l: 'одна кнопка — заявка на нехватку', out: ['requests'] },
    ],
    rules: ['В разработке: главный пробел контроля производства (аудит C048). Будет блоком на «Сегодня» и в заказе.'],
    docs: ['docs/crew/C048-business-audit/DECISIONS.md', 'docs/TASKS.md — C048-8'], tech: 'salesorders, products, storageitems, supplyrequests',
    code: [] },

  // ── Отгрузка и сервис (набросок будущего, 2026-11-12: «идея» — решение за владельцем)
  { id: 'shipping', band: 'after', col: 0, sec: null, plan: 'идея', t: 'Отгрузки и доставка', l: ['что везём на неделе,', 'документы, кто везёт'],
    seq: true, inside: [
      { id: 'k-otgruzke', t: 'К отгрузке', l: 'изготовленные позиции всех заказов', in: ['salesorders', 'stock'] },
      { id: 'plan-dostavki', t: 'План доставки', l: 'дата, адрес, машина, кто везёт' },
      { id: 'dokumenty', t: 'Документы', l: 'накладная, паспорта, акт передачи' },
      { id: 'otgruzheno', t: 'Отгружено', l: 'отметка с фото и подписью получателя', out: ['install'] },
    ],
    rules: ['Сейчас отгрузка — шаг внутри заказа («Отгрузить»). Отдельного раздела со всеми отгрузками нет.'],
    docs: ['docs/MAP.md — shipments'], tech: 'shipments (сейчас — внутри заказа)' },
  { id: 'install', band: 'after', col: 1, sec: null, plan: 'идея', t: 'Монтаж на объекте', l: ['бригада, сроки,', 'акт монтажа'],
    seq: true, inside: [
      { id: 'obekt', t: 'Объект', l: 'адрес, заказчик, что ставим', in: ['shipping'] },
      { id: 'brigada-i-srok', t: 'Бригада и срок', l: 'кто едет, когда, что взять' },
      { id: 'akt-montazha', t: 'Акт монтажа', l: 'фото установленного, подпись заказчика', out: ['warranty'] },
    ],
    rules: ['Идея: нужен ли монтаж в этой системе — решает владелец.'],
    docs: ['docs/PRODUCT.md'], tech: null },
  { id: 'warranty', band: 'after', col: 2, sec: null, plan: 'идея', t: 'Гарантия и рекламации', l: ['обращения заказчиков,', 'ремонт по гарантии'],
    seq: true, inside: [
      { id: 'obraschenie', t: 'Обращение', l: 'что сломалось, фото, номер паспорта', in: ['docs', 'install'] },
      { id: 'proverka-garantii', t: 'Проверка гарантии', l: 'срок по паспорту (12 мес.), условия' },
      { id: 'remont-ili-otkaz', t: 'Ремонт или отказ', l: 'запчасти со склада, выезд, ответ заказчику' },
    ],
    rules: ['Идея: гарантийный срок уже пишется в паспорте, но обращения нигде не ведутся.'],
    docs: ['docs/PASSPORTS-V2.md'], tech: null },

  // ── Деньги
  { id: 'expenses', band: 'money', col: 0, sec: 'expenses', t: 'Прочие расходы', l: ['траты без заявки', 'по статьям'],
    seq: true, inside: [
      { id: 'statya', t: 'Статья', l: 'из справочника «Статьи расходов»', in: ['dicts'] },
      { id: 'rashod', t: 'Расход', l: 'сумма, дата', out: ['money'] },
      { id: 'faily', t: 'Файлы', l: 'чек или счёт' },
    ],
    rules: ['Статья обязательна — без неё расход не попадёт в отчёт.'],
    docs: ['docs/MAP.md — expenses, expense-articles'], tech: 'expenses',
    code: ['backend/src/modules/expenses', 'backend/pwa/sections/expenses.js'] },
  { id: 'payroll', band: 'money', col: 1, sec: 'payroll', t: 'ФОТ', l: ['ставка × табель,', 'начислено, выплачено'],
    seq: true, inside: [
      { id: 'tabel', t: 'Табель', l: 'отработанные дни и часы', in: ['staff'] },
      { id: 'nachisleno', t: 'Начислено', l: 'ставка (из карточки сотрудника) × табель' },
      { id: 'vyplacheno-i-ostatok', t: 'Выплачено и остаток', l: 'с датой выплаты', out: ['money'] },
    ],
    rules: ['Ставка берётся из карточки сотрудника.'],
    docs: ['docs/MAP.md — payroll'], tech: 'payroll_timesheets (табель), payroll_payments (выплаты); ставка — persons',
    code: ['backend/src/modules/payroll', 'backend/pwa/sections/payroll.js'] },
  { id: 'money', band: 'money', col: 2, sec: 'money', t: 'Доходы и расходы', l: ['поступления, выплаты,', 'долги, остаток по дням'],
    inside: [
      { id: 'postupleniya', t: 'Поступления', l: 'оплаты заказчиков по заказам', in: ['salesorders'] },
      { id: 'vyplaty', t: 'Выплаты', l: 'оплаченные счета, прочие расходы, зарплата', in: ['requests', 'expenses', 'payroll'] },
      { id: 'dolgi-i-plan', t: 'Долги и план', l: 'неоплаченные счета и ожидаемые поступления', in: ['requests'] },
      { id: 'kalendar', t: 'Календарь', l: 'остаток денег по дням', out: ['reports'] },
    ],
    rules: ['Оплата не подтверждает, что товар пришёл на склад.', 'Привязка платежа определяет, чей долг закрыт.'],
    docs: ['docs/PRODUCT.md — «Деньги»', 'docs/MAP.md — finance, incomes'], tech: 'сводка finance: incomes.payments, supplyrequests (счета), expenses, payroll_*, finance_settings',
    code: ['backend/src/modules/finance', 'backend/src/modules/incomes', 'backend/pwa/sections/money.js'] },

  { id: 'reports', band: 'money', col: 3, sec: null, plan: 'идея', t: 'Сводка руководителю', l: ['прибыль по заказам,', 'загрузка, долги'],
    inside: [
      { id: 'pribyl-po-zakazam', t: 'Прибыль по заказам', l: 'выручка − материалы − работы', in: ['money'] },
      { id: 'zagruzka', t: 'Загрузка производства', l: 'часы в работе против людей', in: ['work'] },
      { id: 'dolgi', t: 'Долги и риски', l: 'просрочки оплат и сроков' },
    ],
    rules: ['Идея: часть цифр уже есть («Доходы и расходы», себестоимость позиции) — сводки на одном экране нет.'],
    docs: ['docs/PRODUCT.md — «Деньги»'], tech: null },
];

/** Связи: [откуда, куда, что передаётся]. Это связь записей, а не автоматический переход статуса. */
export const LINKS = [
  ['partners', 'offers', 'заказчик и наша фирма'], ['offers', 'salesorders', 'основание для заказа'],
  ['partners', 'salesorders', 'заказчик'],
  ['products', 'offers', 'изделия и цены'], ['products', 'salesorders', 'изделия в позициях'],
  ['salesorders', 'design', 'новое изделие, когда всё распределено'],
  ['salesorders', 'matching', 'позиции без изделия'], ['products', 'matching', 'изделия-кандидаты'], ['matching', 'salesorders', 'изделие в позиции'],
  ['gantt', 'master', 'шаги исполнителей'], ['master', 'work', 'отметки «Начал / Закончил»'],
  ['salesorders', 'shortage', 'позиции в работе'], ['stock', 'shortage', 'свободный остаток'], ['shortage', 'requests', 'заявка на недостающее'], ['design', 'products', 'созданное изделие'],
  ['dicts', 'products', 'категории, цвета, работы'], ['dicts', 'docs', 'тексты и рисунки'],
  ['products', 'docs', 'общие сведения'], ['salesorders', 'docs', 'экземпляры заказа'],
  ['salesorders', 'work', 'позиции в работу'], ['products', 'work', 'состав и нормы'],
  ['work', 'products', 'факт → норма'], ['staff', 'work', 'исполнители'], ['work', 'gantt', 'шаги и сроки'], ['staff', 'gantt', 'люди'],
  ['suppliercatalog', 'products', 'детали и сырьё'], ['suppliercatalog', 'requests', 'что заказать'],
  ['partners', 'requests', 'поставщик'], ['contracts', 'requests', 'договор поставки'],
  ['products', 'needs', 'состав × количество'], ['stock', 'needs', 'остатки'], ['needs', 'requests', 'нехватка'],
  ['requests', 'stock', 'приёмка'], ['stockmobile', 'stock', 'те же остатки'], ['stock', 'movements', 'каждая операция'],
  ['stock', 'work', 'выдача материалов'], ['requests', 'money', 'счета: план, после оплаты — факт'], ['salesorders', 'money', 'оплаты заказчика'],
  ['expenses', 'money', 'расходы'], ['dicts', 'expenses', 'статьи расходов'], ['payroll', 'money', 'выплаты'], ['staff', 'payroll', 'ставки'],
  ['salesorders', 'shipping', 'что отгрузить'], ['stock', 'shipping', 'готовые изделия'], ['shipping', 'install', 'что везём на объект'],
  ['docs', 'warranty', 'срок гарантии по паспорту'], ['install', 'warranty', 'акт монтажа'],
  ['money', 'reports', 'деньги по заказам'], ['work', 'reports', 'часы и загрузка'],
];
