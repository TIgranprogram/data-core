# Карта роли backend

коммит: 61b18c6 (+ правки ПВ 2026-10-25, не закоммичены)

## Паспорта «воронкой» (ПВ) — где что
- Дерево/выбор (pure): `backend/src/common/passport/phrase-tree.ts` — `toNode`, `buildForest(nodes, category)`, `resolveChoices`, `missingChoices`, `checkNode` (запись), `checkChoices`, `parseChoices`, `presentForest`. spec рядом.
- Справочник `passportPhrases`: обёртка `modules/dicts/dicts.passport-phrases.ts` (`passportPhrasesDef`: поля, toDoc с проверками, beforeRemove, usage/related/reassign по `textChoices`); подключена в `dicts.defs.ts` (блок «Тексты паспорта»). В `DictDef` добавлены `toDoc(…, id?)` и `beforeRemove?`; `dicts.service.ts` их зовёт.
- Сборка: `product-passport/passport-v2-text.ts` (`buildV2Text` + `funnel`: purpose/installation → поля, прочие разделы → пункт №slot; `purposeText` удалён). `product-passport.service.ts`: `forest()` (кэш `passports.funnel`), `funnel()`, `choiceMissing()`, `refreshDraft()` (в `get`), `snapshot()` пишет `purpose`/`installationMethod`/`installationTypeId`, `update()` пересобирает при смене `textChoices`.
- Схема/DTO: `textChoices` в `product-passport.schema.ts`, `dto/create-product-passport.dto.ts`; `passport-consts.ts` MODEL_FIELDS.
- Изделие: `showcase/passport-defaults.ts` (`textChoices`, `mergePassportDefaults`), `showcase-bulk.ts` (мерж), `showcase.service.ts` (`setPassportDefaults` проверяет `checkChoices`, `clone`), `showcase-clone.ts` (`cloneDoc`), маршрут `POST /showcase/:id/clone`.
- Миграция: `backend/scripts/passport-funnel-migrate.js` (+ `.test.mjs`): план по умолчанию, `--apply --out`.
- Маршрут `GET /passports/funnel` — `product-passport.controller.ts` (до `:id`).
- e2e добавлены: passports.e2e-spec (ПВ воронка), showcase.e2e-spec (клон, textChoices) — не запускались.

## Ловушки
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
