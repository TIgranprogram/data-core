# C127 — архитектор: хранилища состава, пути записи и чтения

Область: сервер (`backend/src/…`). Экраны не читал. Стенд выключен — живые данные не считал. Записал координатор по отчёту агента 16.11; три главные находки (№ 1, 2, 7) перепроверены по коду.

## 2. Где хранится состав

| Поле | Схема | Пишут | Читают |
|--|--|--|--|
| `products.composition` | `common/catalog/product.schema.ts:60-62` | `product.service.ts:303-317`, `showcase-composition.ts:103`, `pdm-write.ts:64/92`, дубль `product.service.ts:264` | getTree, work-route, showcase, stock-composition, purchase-needs |
| `productmodules.composition` | `product-module.schema.ts:71` | `product-module.service.ts:134-172`, `pdm-write.ts:60` | getTree, whereUsed, work-route |
| `materials.composition` (деталь) | `material.schema.ts:145` | `material.service.ts:119-187`, `pdm-write.ts:43/92` | `catalog-graph.service.ts:222-248`, `:350` (1 уровень) |
| `productmodules.materials` (старое) | `product-module.schema.ts:69` | запись закрыта (`product-module.service.ts:183-186`) | `catalog-graph.service.ts:144/209/305-308`, `product-module.service.ts:114-131` |
| `products.productModuleIds` (старое) | — | запись закрыта (`product.service.ts:326-327`) | `catalog-graph.service.ts:286/313`, `work-route.service.ts:43`, `product.service.ts:299/355` |
| `products.parts[]` | — | маршрут работ | `work-route.service.ts:63/81` (`lineId` → `_id` строки состава) |
| `products.materialsSpec` | — | руками; из состава один раз | паспорт (`showcase-materials.ts:11`) |

Мёртвое: `unitPriceOverride` (никто не читает); условие `'composition.productId'` в `showcase.service.ts:523` (такого поля нет, строки хранят `refId`).

## 3. Правила вложенности (`composition-line.service.ts:46-91`)

| Родитель | Что можно класть | Со «Словарём» `PRODUCT.md:30-41` |
|--|--|--|
| Изделие | модуль, изделие, материал кроме сырья | совпадает |
| Модуль | модуль, любой материал | совпадает; изделие в модуль нельзя |
| Деталь | только сырьё | совпадает |

Где правила не действуют:
- Родитель-материал не проверяется на «деталь» (`material.service.ts:124-126`): состав можно завести у сырья и покупного.
- `PUT /showcase/:id/composition` проверяет только существование позиции (`showcase-composition.ts:76-96`): сырьё кладётся прямо в изделие.
- PDM пишет без проверки правил (`pdm-write.ts`).

## 4. Пути записи

Через `composition-line.service` — 9: изделие, модуль, материал × добавить / изменить / удалить.

В обход — 7:
1. `PUT /showcase/:id/composition` — `showcase-composition.ts:64-104` (окно «Состав изделия» в приложении).
2. `POST /stock/composition-suggest/accept` — `stock-composition.service.ts:109`, уходит в п. 1.
3. PDM, детали — `pdm-write.ts:43/92`.
4. PDM, модули — `pdm-write.ts:60/92`.
5. PDM, изделия — `pdm-write.ts:64/92`; `pdm-import.service.ts:191-192`, `250-291` (`updateOne` / `insertMany`).
6. Дубль изделия (`product.service.ts:264`) и дубль материала (`material.service.ts:362`, `_id` строк те же).
7. Админка «Таблицы» (`collections-admin.controller.ts`) — сырая запись, не читал.

Потери при записи:
- `showcase-composition.ts:100` выдаёт каждой строке новый `_id`. Ссылки `products.workTypes[].lineId` и `products.parts[].lineId` становятся битыми. Следующее сохранение маршрута — 400 «Часть состава не из этого изделия» (`work-route.service.ts:113`).
- Там же теряются `overrideDimensions`, `isPurchased`, `sourcePosition`; `unit` берётся из справочника.
- `product.service.ts:351` `plainCompositionLine` не копирует `unitPriceOverride`: любая правка стирает цену у всех строк.
- Первая новая строка прячет старые поля: `product.service.ts:303-305`, `product-module.service.ts:141` стартуют от `composition ?? []`. Старые `materials` / `productModuleIds` пропадают из показа.
- У старых строк модуля `_id` случайный на каждое чтение (`product-module.service.ts:121`); изменение по нему — 404.
- Модуль пишется через `save()` без проверки версии (`product-module.service.ts:143`): два редактора затирают друг друга.

## 5. Откуда приходит и что перезаписывает

- PDM (`pdm-plan.ts:175-224`, `pdm-write.ts:92`) заменяет состав целиком в двух случаях: состав на сайте пуст; есть расхождение и человек выбрал «PDM» или «обновить все» (`pdm-write.ts:68-73`).
- PDM состава не дал — сайт не трогают (`pdm-plan.ts:213`).
- При замене строки, которых нет в PDM, удаляются. У совпавших по «тип:ссылка» сохраняются `_id` и примечание.
- Расхождение считается только по ссылке и количеству. Ручная правка примечания, единицы, размеров расхождением не считается.
- Дубль изделия (`product.service.ts:352-359`) копирует состав и подмешивает старые `productModuleIds`.

## 6. Кто читает и как раскрывает вложенность

| Кто | Где | Как раскрывает |
|--|--|--|
| «Что купить» | `purchase-needs.service.ts:25` → `getTree(id, 8)` → `catalog-graph.service.ts:320-359`; `common/catalog/purchase-needs.ts:38-53` | полностью, 8 уровней, деталь → сырьё; цикл молча обрезается |
| Себестоимость | `showcase-composition.ts:137-168` | своя рекурсия: только изделие в изделии, до 6; модуль — без цены; деталь не раскрывается |
| Карточка изделия | `showcase-composition.ts:17-56` | плоско, 1 уровень у вложенных изделий |
| Маршрут работ | `work-route.service.ts:41-56`, `92-104` | только прямые модули и прямые детали; часы модуля не передаются |
| Паспорт | `showcase-materials.ts:11-41` | `materialsSpec`; «Взять из состава» — только прямые материалы |
| Предложение при выдаче | `stock-composition.service.ts:65-69` | только прямые материалы |
| Состав позиции заказа | `work-facts.service.ts:224` | через себестоимость |

Пример разных чисел: изделие = модуль М × 2; М = деталь Д × 3; Д = сырьё С × 1. «Что купить» даст С = 6. Паспорт — 0 материалов. Себестоимость модуля — 0. Маршрут не увидит работ детали Д.

## 7. Защита (по коду)

- Циклы: проверяются при записи через сервисы (`catalog-graph.service.ts:48-80`, глубина 8). В обход (PDM, окно состава для модулей) — нет.
- Удалённая позиция: при записи ловится. После — в дереве узел с номером вместо имени (`catalog-graph.service.ts:342`).
- Защита удаления `catalog-references.ts:4` смотрит `products` и `productmodules`, но не `materials`: сырьё из состава детали удалить можно.
- `showcase.service.ts:523` проверяет несуществующее поле: изделие, входящее в другое, удаляется.
- Дубли строк: добавление суммирует, изменение и окно состава отвергают; PDM и дубль не проверяют.
- Скрипта для счёта битых ссылок, дублей и циклов в данных нет. Нужен новый, только чтение.

## 8. Виды работ и время

- Три формы: деталь `{workTypeId, hours, days}` (`material.schema.ts:16-22`); модуль `{workTypeId, estimatedHours, days}` (`product-module.schema.ts:67`); изделие `{workTypeId, hours, lineId, partRowId}` (`product.schema.ts:66`).
- Общей функции свода нет. Планы читают только `products.workTypes` (`work-facts.service.ts`, `order-line-plan.service.ts:58`, `production-orders.service.ts:287`). Часы модулей и деталей внутри модулей в итог не входят.

## Развилки устройства данных

- **А. Один путь записи.** Окно состава, приём предложения и PDM идут через `composition-line.service` (правила, `_id` сохраняются). Запасной вариант: оставить массовую замену, но переносить `_id` по ключу «тип:ссылка» (как `pdm-write.ts:22-31`). Рекомендация — первое.
- **Б. Старые поля.** Один раз перенести `productmodules.materials` и `productModuleIds` в `composition` скриптом (план → `--apply`, копия базы), убрать двойное чтение. Коллекции общие с CRM — нужна сверка.
- **В. Один обход состава.** Общая функция раскрытия в `common/catalog` на основе `getTree`; её берут «Что купить», себестоимость, паспорт, маршрут, заказ.

## Не проверено

Админка «Таблицы»; какие типы строк допускает `pdm-plan`; `composition-line.dto.ts`; живые данные.
