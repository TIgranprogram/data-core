# Карта роли data-steward

коммит: 61b18c6 (2026-10-25, работа ПВ — правки не закоммичены)

## Законы (выжимка)
- CANON §5: одна сущность — одна таблица; данные священны. AGENTS «Жёсткие правила» №2 (без deleteMany/drop без «да»), №4 (общая база с kppdf: таблицы `kind:'crm'` и схемы общих коллекций не ломать).
- README «Охрана своей зоны», «Сверка перед отчётом», отчёт ≤ 15 строк. Зона: `backend/scripts/data-*.js` (+ скрипты по прямому ТЗ), `docs/DB-AUDIT.md`, `docs/roles/data-steward.md`.
- Удаление — только мягкое: `deletedAt` (+ `mergedInto` при объединении — как `dicts.service.ts` `merge` ~159).

## Справочники «Паспорта» (`dict_values`, поле `dict`)
- Описание полей: `backend/src/modules/dicts/dicts.defs.ts:538–720` (categories, standards, elements, materials, sortament, parts, defects, install, phrases, style). `norm` — :83; ссылки и «Объединить» (`withProducts`, `ppUsage`) — там же.
- Ссылки: products `passportDefaults.{elements[],materialIds[],installationTypeId}`, `materialsSpec.rows[].{materialId,partIds[],sizes[]}`, `materialsSpec.coatingIds[]`; productpassports — те же + `purpose`/`installationMethod` (ТЕКСТ фразы, не id), `status` draft|issued|annulled|нет (старый). Коды: categories.standards, elements.standard, materials.defects, defects.applies, sortament.material.
- Сборка текста: `product-passport/passport-compose-parts.ts` (`purposeText` — «Предназначено для: …», `usageRules`, `installText`), `passport-v2-text.ts`.
- Подстановка «Установки» по способу: `pwa/sections/passports/wire-form.js:92` `INSTALL_VARIANT` (по НАЗВАНИЮ варианта + категории).
- Наполнение: `scripts/seed-passport-categories|standards|dicts|category-fields|phrases.js`, `passport-texts-transfer.js` (П-10), `data-mi-dicts.js` (МИ: материалы/сортамент/части из текстов паспортов). `seed-metal-dicts.js` — не паспорта (склад).
- Эталоны: `docs/PASSPORT-TEXTS-ETALON.xlsx` (лист 1 «Эталоны», 3 «Правило категорий», 5 «Вопросы»; читать `unzip` + node-разбор XML, python нет), `docs/PASSPORTS-TEXTS-SELECTION.md`.

## Мои скрипты
- `scripts/passport-dicts-cleanup.js` — ПВ: план/`--apply`/`--out`; экспорт `buildPlan(db)`, `applyPlan(db, plan, {ObjectId})`, `printPlan`; `DECISIONS` (назначения элементов, правила/ТО, уход/дефекты материалов), `DISPUTED_RULES`, `ID_REFS`. Эталоны берёт из ROWS `seed-passport-phrases.js`.
- `scripts/data-mi-dicts.js` — МИ.1a; `scripts/customers-cleanup.js` — образец «только план».
- Проверка без Mongo: scratchpad `fakemongo.js` (MongoClient в памяти), `runseeds.js` (сиды → dump.json), `t2.js` (сценарий + assert). Пересоздать при нужде — по описанию в уроках.

## Отчёты
- `docs/DB-AUDIT.md` (§1–5 таблицы реестра, МИ.1, ПВ), `docs/roles/tz/PASSPORT-FUNNEL-data-steward.md`.

## ПВ2 «Тексты» (2026-10-25)
- `scripts/passport-texts-polish.js` — 32 правки по `_id` (CHANGES: dict,id,label,field,was,to,why); `buildPlan(db,{ObjectId})`, `applyPlan`, `printPlan`; `--apply`, `--out`. Отчёт — `docs/roles/tz/PP-TEXTS-POLISH.md`.
- Выгрузка прода — одна JSON-строка в конце `для анализа/паспорта-2026-10-25/pp-dicts.json` (до неё — mongo-shell мусор). `{std:КОД}` в полях справочников НЕ подставляется (только блоки шаблона «Для всех»).
- Проверка: scratchpad `t3.js` (fakemongo + дамп прода).
