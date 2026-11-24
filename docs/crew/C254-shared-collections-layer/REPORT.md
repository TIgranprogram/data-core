# C254-0 — отчёт backend

**Статус:** готово, не закоммичено. Прод не трогался. Схемы shared и kppdf не менялись. L-251/252/253 не тронуты.

## Подчек-лист

- [x] **C254-0** — слой чтения + контракт полей (без перевода всех потребителей)
- [ ] **C254-a** — один потребитель (`partners`)
- [ ] **C254-b** — следующий (`finance` / `fill-audit`)
- [ ] **C254-c** — `dicts` и прочие по одному
- [ ] **C254-w** — запись shared только через `StockService` / `SupplyService`
- [ ] **C254-doc** — ARCHITECTURE / UNIFY

## Сделано

Контракт полей сырых проекций и `$` агрегатов шести shared — `backend/src/common/shared-collections/fields.ts`. `sharedFind` / `sharedCount` зовут `liveFilter`. Без проекции документ целиком. Чужое поле проекции — ошибка. Образец один: `disk/integrity` (фильтр уже `deletedAt: null`, проекция из контракта; `salesorders` мимо слоя). Остальные потребители не переведены. Агрегаты не обёрнуты.

**Файлы:** `fields.ts`, `read.ts`, `index.ts`, `read.spec.ts`, `modules/disk/integrity.ts`, карта backend, урок.

**Проверки:** `npx tsc --noEmit` — 0. `npx eslint` по этим файлам — 0. `npx jest --runTestsByPath src/common/shared-collections/read.spec.ts src/modules/disk/integrity.spec.ts --runInBand` — 6/6 PASS.

**Риски:** `materials.offcutOf` / `shortName` и `supplyrequests.photoIds` / `receivedAt` читаются, в схеме mongoose их нет — в kppdf не копировать (L-257). Перевод partners/finance сменит выдачу там, где `deletedAt` не задан. Карта обновлена. Коммит: нет.
