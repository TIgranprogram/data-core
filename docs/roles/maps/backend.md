# Карта роли backend

коммит: 61b18c6 (+ правки ПВ и DICT 2026-10-25, не закоммичены)

## Паспорта «воронкой» (ПВ) — где что
- Дерево/выбор (pure): `backend/src/common/passport/phrase-tree.ts` — `toNode`, `buildForest(nodes, category)`, `resolveChoices`, `missingChoices`, `checkNode` (запись), `checkChoices`, `parseChoices`, `presentForest`. spec рядом.
- Справочник `passportPhrases`: обёртка `modules/dicts/dicts.passport-phrases.ts` (`passportPhrasesDef`: поля, toDoc с проверками, beforeRemove, usage/related/reassign по `textChoices`); подключена в `dicts.defs.ts` (блок «Тексты паспорта»). В `DictDef` добавлены `toDoc(…, id?)` и `beforeRemove?`; `dicts.service.ts` их зовёт.
- Сборка: `product-passport/passport-v2-text.ts` (`buildV2Text` + `funnel`: purpose/installation → поля, прочие разделы → пункт №slot; `purposeText` удалён). `product-passport.service.ts`: `forest()` (кэш `passports.funnel`), `funnel()`, `choiceMissing()`, `refreshDraft()` (в `get`), `snapshot()` пишет `purpose`/`installationMethod`/`installationTypeId`, `update()` пересобирает при смене `textChoices`.
- Схема/DTO: `textChoices` в `product-passport.schema.ts`, `dto/create-product-passport.dto.ts`; `passport-consts.ts` MODEL_FIELDS.
- Изделие: `showcase/passport-defaults.ts` (`textChoices`, `mergePassportDefaults`), `showcase-bulk.ts` (мерж), `showcase.service.ts` (`setPassportDefaults` проверяет `checkChoices`, `clone`), `showcase-clone.ts` (`cloneDoc`), маршрут `POST /showcase/:id/clone`.
- Миграция: `backend/scripts/passport-funnel-migrate.js` (+ `.test.mjs`): план по умолчанию, `--apply --out`.
- Маршрут `GET /passports/funnel` — `product-passport.controller.ts` (до `:id`).
- e2e добавлены: passports.e2e-spec (ПВ воронка), showcase.e2e-spec (клон, textChoices) — не запускались.

## Фото и стикеры проектирования (DESIGN-STICKERS, 2026-10-27, не закоммичено)
- `modules/design/design-extras.service.ts` (`editable` — права user, `addPhoto`, `setStickers`), `design-sticker.service.ts` (`seedSystem`, CRUD), `design-sticker.schema.ts`, `design-sticker.controller.ts`; `design-present.ts` (photoIds/photos/stickers, один loadPhotos); `common/photos.ts`. Тесты — `design.service.spec.ts` «фото и стикеры», e2e `design.e2e-spec.ts` (прогнан, зелёный). Нет связи user↔person (`persons.userId` не задаётся) — user правит только ничьи задачи. openapi.json не обновлён (нет скрипта). коммит: —

## Обсуждение задач (DESIGN-DISCUSSION эт.1, не закоммичено)
- `modules/design/design-note.{schema,service,controller}.ts`, `design-note-rules.ts` (+spec), `dto/design-note.dto.ts`; счётчики — `design-present.ts`; фильтр `needsAnswer` — `design.service.ts` list; экран `pwa/ui/design-notes.js`. e2e добавлен, НЕ запускался. openapi не обновлён. коммит: —

## Доска проектирования (DESIGN-BOARD, 2026-10-25, не закоммичено)
- `modules/design/design-board.service.ts` (`board`:~38, `lines`, `addOrder`, `removeOrder`), `design-board.controller.ts`, `design-order.schema.ts` (`designorders`, unique orderId); `design.service.ts` `markOrder`/`markQuiet` (upsert метки в `insert()`/`fromOrder()`, `insert(f,userId,mark)`), запрет `create` сразу `done` по позиции. Тесты — в `design.service.spec.ts` (fake `Coll` умеет upsert/aggregate); e2e добавлен, НЕ запускался. openapi правлен вручную. Индекс — `ensure-indexes.js` MODELS.

## Ловушки
- Bash-инструмент ломается на длинных heredoc с кавычками — файлы писать Write-ом.
- Файлы в репо с CRLF: многострочные replace через node — сначала `\r\n`→`\n`.
- `dicts.service.remove` не ставит `updatedAt` — «справочник новее снимка» считается по max(updatedAt, deletedAt).
- openapi.json перегенерируется только в Docker (нужен Mongo).
коммит: 61b18c6 (ПРЖ-3 не закоммичена)

- `modules/design/` — «Проектирование» (ПРЖ-3): `design.service.ts` (правила, from-order, замок `openIncomeId`), `design-present.ts` (выдача пакетом ``: заказы, позиции, изделия+фото, persons), `design-task.schema.ts`, `dto/design-task.dto.ts`, spec — в памяти fake `Coll`; e2e `test/e2e/design.e2e-spec.ts` (не запускался).
- `salesorders`: `priority` (схема/DTO/фильтр/сорт по рангу через aggregate), `get` → `lines[].product`; фото везде из `products.photoIds[0]`.
- Приёмы: `CounterService.nextSeq`, `loadPhotos` (showcase-common), `shortProductName` (showcase/order-product-name); Mongo 4.4 — partial-индекс без $ne/$in, поэтому замок-поле + unique sparse.
- Дома нет node_modules в worktree: junction `mklink /J node_modules D:\data-core\backend\node_modules`; python нет — правки через node/sed.
- openapi.json не перегенерирован (нужен Mongo + dist).

## Группы изделий (2026-10-25, не закоммичено)
- `modules/dicts/dicts.product-groups.ts` (`productGroupDefs`: `productGroups` + `productSections`, подключено в `dicts.defs.ts` после `categories`), spec рядом. `dicts.service.ts` `refNames` — «имя» для select-ссылок (`parentId` → `parentName`). pwa `sections/dicts.js:~295` — lockAfterCreate «Заполнится само» только у `code`.

## DICT — справочники: каскад, usage, права (2026-10-25, не закоммичено)
- `modules/dicts/dicts.meta.ts` — `DICT_META` (sections, refBy, untracked, locked: коды из `showcase/passport-defaults.ts` + `COLOR_/ICON_/FRAME_ALL/COVER_` оформления); применяется в конце `dicts.defs.ts` (`BASE` → `DICTS`), тип `DictBase` без паспорта.
- `dicts.service.ts`: `usage()`, `update()` (каскад `reassign` → потом `$set`, `renameKey`, аудит `dict.renamed`), `remove(…, user)`, `merge(…, user)` (admin для занятого; `dicts.moved.ts` `trackMoved` → `movedIds` ≤500). `DictDef.busy` — быстрая проверка (simpleList/units/colors/persons), иначе `usage()` по одной записи.
- Журнал пишет сам сервис (`AuditService`, DictsModule импортирует AuditModule); PATCH остаётся `dict.updated` + при переименовании ещё `dict.renamed`.
- `dicts.rename.spec.ts`; e2e dicts/showcase правлены, НЕ запускались; openapi правлен вручную (путь `/dicts/{key}/{id}/usage`).

## МЦ — связь позиции склада с материалом паспорта (2026-10-27, не закоммичено)
- `common/catalog/passport-link.ts` (`mergePassportSpec`, `presentPassportSpec`, spec рядом; не называть `*-spec.ts` — jest примет за тест); `material.schema.ts` `passportSpec` + sparse-индекс; `material.service.ts` `setPassportSpec`, `findAll` без текстов; маршрут `PATCH /materials/:id/passport-spec`.
- `materials-text.ts` `specFromComposition` (`link`, `hinted`); `showcase-materials.ts`; слияние — `dicts.defs.ts` passportMaterials; скрипт `scripts/material-passport-spec-fill.js` (+ `.test.mjs`).

## ЗНП → заказы и задачи (2026-10-27, не закоммичено)
- `design.service.ts:209` `update` — `incomeId` разрешён только свободной задаче (`link`, замок `ensureNoOpen`, `markQuiet`); spec «свободную задачу можно привязать»; MAP.md строка `design`.
- `backend/scripts/znp-apply.js` — план/`--apply --out`: productionNo, 6 новых заказов + позиции (clientUid `znp:…`), этап/отгрузка по карточкам YouGile, привязка задач, новые задачи, вопросы (`znp:…`). Прогнан только на mock-сервере (local не поднят). коммит: —

## «Сегодня» (СГД-1, 2026-10-28, не закоммичено)
- `modules/today/`: `today-feed.ts` (buildFeed/buildWeek/buildPulse, окна FEED_WINDOW), `today.service.ts:get`, `today.controller.ts`, specs рядом. `FinanceModule` теперь экспортирует FinanceService. openapi не обновлён (нужен Mongo). коммит: —
