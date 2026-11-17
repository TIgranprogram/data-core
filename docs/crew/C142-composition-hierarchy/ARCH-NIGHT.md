# C142 — ночной аудит архитектора (18.11)

Вердикт: **после 🔴**. Схему `CompositionLine` ночь не меняла. Сохранение состава на прод рано.

Проверено чтением: книжка, `showcase-composition`, `composition-line`, `catalog-graph`, `purchase-needs`, модули/детали/`comp-editor`, atlas, лист паспорта, «Взять из состава». Тесты и стенд не гонял. Глаз владельца нет.

## Уже связано

- Книжка: воронка → `PUT /showcase/:id/composition`, types `material|product|module`. Деталь и покупное — строка `material`. Сырьё в шаге «Что» нет. `_id` строки уходит (C127).
- «Что купить»: `getTree` раскрывает модуль и сырьё детали. `computeNeeds` деталь в закупку не кладёт; пустая заготовка — `missingBlank`.
- Меню «Модули» и «Детали» есть. Состав модуля и заготовка — `POST/PATCH/DELETE` по строке (`toStoredLine` хранит поля). Работы детали — карточка `part-work`.
- Выпущенный паспорт — снимок: правка `products.composition` его PDF не пересобирает.
- Atlas: `modules`/`parts` с `sec`. Шаг «Состав» говорит дерево. `bron-po-sostavu` всё ещё `plan: C068-4`.

## Дыры до выкладки

✅ `book-composition-funnel.js` + `showcase-composition.ts` — C142: PUT сохраняет CRM-поля строки (`overrideDimensions`, `isPurchased`, `sourcePosition`, `sourceCode`, `unitPriceOverride`); юнит в `showcase-composition.spec.ts`. Dirty «К подсказкам» спрашивает.

✅ Модуль: `migrateLegacyMaterials` + `storedModuleMaterialLines` — до первой записи `composition` переносит `materials[]` со стабильными `_id` (не стирает CRM `materials[]`).
✅ Изделие: `seedLegacyProductModules` + `storedProductModuleLines` — то же для `productModuleIds` (`product.service.ts`). Граф до переноса читает legacy (`moduleChildLines` / `productChildLines`).

🟡 Книжка не знает имён детей: `GET /modules/:id/composition` без `name` (`book-composition-funnel.js:39`).

🟡 Паспорт дерево не читает. `book-blocks.js:111` — `passport.modules` (имя и габариты). «Взять из состава» — только прямые `material` (`showcase-materials.ts:14`). Модуль даёт пустой список.

🟡 «Обеспечить» нет: есть расчёт «Что купить», нет одного подтверждения «бронь и заявка». Себестоимость модуль не раскрывает (`showcase-composition.ts:169`).

🟡 `GET /modules` без страницы и с фото (`product-module.service.ts:59`). Воронка модуля грузит пять списков по 500. `PUT` изделия сырьё не запрещает (запрет только в UI; проверка `composition-line.service.ts:80` на другом пути).

## Схема CRM

`lineType` по-прежнему `module|material|product` (`composition-line.schema.ts:25`). Типа «деталь» нет. `products`, `productmodules` и `materials.composition` делят эту схему. У `materials.composition` стоит `default: []` — поле уже может лечь на деталь. `workTypes` без default, пустой документ CRM его не получает. Риск ночи — затирание полей и развилка legacy/`composition`, не миграция enum.

Порядок: 1) книжка не теряет поля; 2) legacy не прячется; 3) имена детей и лист паспорта; 4) «Обеспечить». Глаза на воронку до `release.sh`.

Не проверено: `dc check`, стенд, живые строки с `sourcePosition`, повтор PDM.

## Фикс legacy

Пустой `composition` и непустой `materials[]` / `productModuleIds` переносятся в `composition` до первой подмены массива (`addComposition`, `updateComposition`). Поля строки модуля: `quantity`, `unit`, `overrideDimensions`, `isPurchased`, `sortOrder`, один `_id` на строку. `materials[]` и `productModuleIds` не стираются — их читает CRM.

`getComposition` после переноса отдаёт записанный `composition` и не выдаёт новый `_id` на каждый GET. Пока переноса не было, граф (`getChildren`) читает legacy тем же разбором, без записи. Отдельного метода replace нет: add и update и так записывают весь массив. `showcase-composition.ts` `set()` не трогали.

Юнит: модуль только с `materials[]` → `addComposition` оставляет старую строку и добавляет новую; повторный GET держит `_id`. Изделие: `productModuleIds` попадают в первый `$set` без `$inc`.

Карта обновлена.
