# C044 / T1 (C043) — «Остатки»: компактные плитки типов, тип-существительное, «Изменить выбранные» — отчёт исполнителя

Статус: сделано по коду и проверено (не закоммичено; приёмка, дизайнер, выкладка — координатор). ТЗ: `docs/crew/C043-stock-types-bulk/TZ.md`.

**Сделано**
- Плитки типов: kit-варианты `card S compact:true` (`backend/pwa/ui/kit/index.js:65,106,114-118`) и `tileGrid({compact:true},…)` (`ui/kit/blocks.js:15-21`), CSS на токенах (`ui/kit/kit.css:481-489`): рисунок ≈28 px (было 2:1 ≈75 px), карточка ниже в 2 раза, плотная сетка. Витрина `#kit` «Плитки типов · C043» (`sections/kit.js:212`); плитки категорий верхнего уровня не менялись. Применено в `sections/stock-types.js:22-28`.
- Правило типа: пропуск прилагательных/материалов, тип — первое существительное (`core/facets.js:18-41`), размер/единица в тип не входят (`:49-51`), таблицы `TYPE_SKIP_WORDS`/`TYPE_NOUN_WORDS` рядом с `TYPE_FAMILIES` (`:139-155`); `index()` берёт ручной `typeName` в обеих ветках (`:100-116`). Юнит `core/facets.test.mjs:38-74` (9/9).
- Ручной тип: новое необязательное поле `materials.typeName` (`backend/src/modules/material/material.schema.ts:59-65`, «только data-core, CRM не читает»; схема kppdf не менялась — Mongo без схемы), `StockItemDto`/`StockItemInput`/create/patch (`stock/dto.ts:19`, `stock.types.ts:24-25`, `stock-catalog.service.ts:125,194-195`), в строке `GET /stock/items` (`stock-search.service.ts:168`).
- «Изменить выбранные»: `PATCH /api/stock/items/bulk` {ids ≤500, set} → {updated, failed, before} и `PATCH /api/stock/items/bulk/restore` (аудит `stock.item.bulk(.restore)`, Throttle 30/мин, `assertInScope` + `scopeNewItem` — чужая категория 403; маршруты до `items/:id`) — `stock/stock.controller.ts:131-159`, логика — `stock/stock-bulk.ts:1-93`; фасад `stock.service.ts:80-83`; подпись аудита `audit/action-ru.ts:14`. Панель — `sections/stock-bulk.js:1-48` (Тип, Категория, Ед. изм., Марка стали, Сортамент/сечение), подключена на «Остатках» (`stock.js:47,162`) и в «Каталоге номенклатуры» для строк с позицией (`supplier-catalog.js:16,299-310`); DESIGN §4/§8 (`docs/DESIGN.md:109-111,210,449`).
- Доки: `docs/MAP.md:26-27`, `docs/data-model.md:374`, `docs/openapi.json` перегенерирован (473 пути, есть `/stock/items/bulk[/restore]` и `typeName`).
- Тесты: `backend/src/modules/stock/stock-bulk.spec.ts` (новый, 7), `backend/test/e2e/stock-items-bulk.e2e-spec.ts` (новый, 5).

**Проверки (факт)**: `npx tsc --noEmit` → exit 0 · `npx jest --silent` → 281/281 suites, 3144/3144 tests, exit 0 (один прогон под нагрузкой дал флейк `control.service.spec`; изолированно и в чистом прогоне зелёный) · `npx eslint "src/**/*.ts"` → 0 errors, 144 warning (прежние `no-explicit-any`) · e2e нового маршрута 5/5 · pwa: `--input-type=module --check` 8/8 файлов, `pwa-import-check` 251 файл / 0 ошибок, `node --test backend/pwa` 100/100 · design-lint: новых 0 (всего 6435) · `tools/dc.cmd check` → exit 0 (tsc 0, юнит 3144/3144, импорты 0, design-lint ок, пульт ок).

**Допущения**
1. Отдельного поля «Группа» у позиции склада нет: полочка вычисляется из типа и меняется вместе с ним (в списке типов видна подписью семейства). Поэтому в панели: Тип · Категория · Ед. изм. · Марка стали · Сортамент/сечение («признаки» из формы позиции).
2. Внешний судья `tools/c039-types.mjs` на данных прода **не прогнан** (выгрузки в репо нет, прод запрещён) — «Прочее» 19→≤5 проверять координатору; правило покрыто юнит-тестами на примерах C039.
3. Глазами/дизайнером не проверено (нужен стенд) — приёмка дизайнера и замер плитки на 1024 остаются за координатором.

**Не сделано**: full-e2e (менялся `backend/src`; прогнан только новый маршрут — полный прогон перед выкладкой), обновление `docs/roles/maps/*` и `docs/crew/BOARD.md` (запрещено/зона координатора). Посторонние правки в дереве (C041 Э2 параллельной сессии, `.claude/review/designer.json`, `docs/QUESTIONS.md`, `docs/roles/maps/*`) — не мои, не трогал.

## designer (по коду, без снимков)
Вердикт: принято с 3 замечаниями. design-lint: новых 0.
- Плитки: card S compact + tileGrid compact — токены, вариант в витрине #kit (sections/kit.js:212), иконка 28 px с aria-hidden, название в 1 строку с title — читаемо; вид на 390 px нужно посмотреть снимком.
- Панель — общий эталон openBulk (bulk-edit.js), своего вида нет; выпадающие combo, галочка «менять», подтверждение «Изменить у N записей?», «Отменить» в уведомлении — есть.
- 🟡 Заголовок панели «Изменить выбранные» без числа и сущности; лучше «Изменить 5 позиций» (bulk-edit.js, общий для всех разделов — решение координатора).
- 🟡 Текст «записей» вместо «позиций» для склада (bulk-edit.js:62,72) — параметр cfg.noun.
- 🟡 Тип в combo «впишите свой» — подсказка длинная; допустимо.
