# Карта роли qa

коммит: 3778913 (+незакоммиченное СМ.6: stock-scope.e2e describe «СМ.6», строки 187–249)

- Прогоны: `cd backend; npx tsc --noEmit`; `npx jest --silent | tail -8` (148/1500 на 2026-10-25); pwa — `node --input-type=module --check < файл`; скрипты — `node --test scripts/*.test.mjs`. TEST-LOG — дописывать строкой в конец `docs/TEST-LOG.md`.
- Паспорта «воронкой» (ПВ): сервер — `common/passport/phrase-tree.ts` (buildForest/resolveChoices/missingChoices), `product-passport.service.ts` (snapshot ~287, check ~318, choiceMissing ~351, funnel ~348), дерево справочника — `dicts/dicts.passport-phrases.ts`; клон — `showcase/showcase-clone.ts`; экран — `pwa/ui/funnel.js`, `pwa/sections/passport-tree.js`, плашка — `passports/wire-form.js` (check ~120), карточка — `passports/card-blocks.js` checkBlock.
- Стык `missing`: GET /passports/:id — строки (+`missingChoices`), /check и 400 выпуска — `[{label,key}]`; список /passports (passport-queries.ts:38) choice-пункты не считает.
- Сопоставление/паспорт-категория: e2e `backend/test/e2e/matching-assign.e2e-spec.ts`; assign-блок — `production-orders.service.ts:92-99`; снятие категории — `showcase.service.ts:221-228`.
- Металл без остатка (isEmptyMetal, СМ.6): `test/e2e/stock-scope.e2e-spec.ts:187` (describe); сервер — `stock/metal.ts:39`, `stock-search.service.ts:62,99,238`, `stock.controller.ts:48`.
- Склад СМ.5 (исправление списания, фильтры трубы): `test/e2e/stock-scope.e2e-spec.ts:115` (describe «Исправление списания и фильтры трубы»); сервер — `stock.controller.ts:81-87` (correct, ownOnly по категории), `stock-movements.service.ts:422` (correctMovement), `stock-search.service.ts:115-117` (pipeLength, wash); правило «списание: reason и issuedTo — взаимоисключающие» — `stock-target.ts:79`.
- Обновление без F5 (СМ.9): сервер — `today/today.controller.ts:24-42` (VERSION_GROUPS, GET /me/versions, no-store), `common/data-version/data-version.service.ts:63` (snapshot); e2e — `test/e2e/me-versions.e2e-spec.ts` (2 теста). В e2e нет теста `/me/counters` — спеки по `counters` не существует.
- Деньги manager/зоны/remember: `test/e2e/manager-zones-auth.e2e-spec.ts`. Параллельная сессия делит БД datacore-test — гоняй `MONGO_DB_TEST=datacore-test-qa npx jest --config ./test/jest-e2e.json --runInBand --forceExit`.
