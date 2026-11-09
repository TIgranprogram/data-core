# ТЗ C057-Э1 — сервер «Загрузка из PDM»

**Зачем:** сайт принимает дерево `pdm-tree/1` от приложения, показывает план (новое / уже есть / расхождения), применяет решения одной транзакцией, хранит PDF/DXF с версиями, отдаёт приложение на скачивание.

**Класс:** L внутри XL · **Max agents:** 2 (`datacore-backend` исполнитель + `datacore-qa`) · **Проверки:** tsc, юнит модуля, e2e `pdm-import` на `datacore-test`; full перед выкладкой (Э4).
**Читать первым:** `DECISIONS.md` (весь), `CONTRACT.md` (весь). `ANALYSIS.md` — только по ссылкам ниже.

## Что сделать

### 1. Поля (только добавить; CRM не ломается)
- `backend/src/modules/material/material.schema.ts`: `pdmCode?`, `pdmAliases?: string[]`, `pdm?: {fileId, version, state, path, configuration, syncedAt}`, `dimSource?: 'dxf'|'pdm'|'manual'`, `isProfile?`, `profileId?: ObjectId → Material`, `isDefaultFormat?`, `scrapFactor?` (≥1, по умолч. 1), `needsName?`.
  Индексы: `{organizationId:1, pdmCode:1}` unique + `partialFilterExpression {pdmCode:{$type:'string'}}`; `{organizationId:1, pdmAliases:1}` partial; `{profileId:1}` sparse. **Не трогать** индекс `organizationId+article` (`:162`) и `sku`.
- `backend/src/common/catalog/product-module.schema.ts`, `product.schema.ts`: `pdm?: {…}`, `needsName?`.
- DTO создания/правки материала, модуля, изделия: новые поля **необязательные** (ловушка ValidationPipe `forbidNonWhitelisted` — AGENTS.md).
- Копия схем kppdf (`materials`, `productmodules`, `products`) — добавить те же необязательные поля в `D:\kppdf-8.0` **не нужно** (kppdf заморожена; новые поля он просто не видит). Записать в `docs/ARCHITECTURE.md` «Единая база» одной строкой.

### 2. Ключ сравнения (на лету)
- `backend/src/common/catalog/match-key.ts` (новый): `matchKey(input)` из `{kind, typeName, standardRef, materialGrade, assortment, dimensions | сортамент+материал PDM}` → строка. Таблица приведения: Л/К (`С/C, Р/P, Н/H, Х/X, ШП/SHP, ПРШ/PRSH…`), `х/×/x`, `,`→`.`, `М8/M8`, «нерж.»=«AISI 304», «Ст 3»=«Ст3». Юнит-тесты на 20 пар из 6104 и прода (`ANALYSIS.md` 5в).
- Тот же код — отчёт дублей (Э0).

### 3. Файлы — коллекция `pdmfiles` (новый модуль `backend/src/modules/pdm-files/`)
- Схема — `DECISIONS.md` п. 9. Сохранение — `uploads/pdm/<обозначение>/v<версия>/<имя>`; regex на обозначение и имя (п. 10).
- `backend/src/common/uploads/upload-folder.ts:2` — добавить `'pdm'`. `backend/src/main.ts:135-145` — `/uploads/pdm/*` как `/uploads/drawing/*` (`attachment` + `nosniff`).
- Сигнатура PDF/DXF и ≤ 50 МБ — как у `purpose=drawing` (`image-upload.options.ts`).
- `GET /api/pdm-files?ownerKind=&ownerId=` → текущие + `versions` (для экрана «Файлы» и паспорта).

### 4. Импорт — модуль `backend/src/modules/pdm-import/`
- Коллекция `pdmimports` (план, хэш дерева, найденные записи с `updatedAt`, решения, итог, кто/когда).
- `POST /api/pdm-import/preview` (`@Roles('admin')`): проверка дерева (CONTRACT §2 правила, лимиты п. 14) → по каждому `designation`: `create | link(by) | suggest(кандидаты) | conflict(поля сайт|PDM) | same` + `needFiles` + `blockers`. Поиск: детали/модули/изделия — по `article`/`sku` = обозначение (**с удалёнными**); метизы/покупные — `pdmCode` → `pdmAliases` → `matchKey`. Сырьё детали — сортамент по `matchKey` (`isProfile`), нет → `create` сортамента.
- `POST /api/pdm-import/apply` `{planId, decisions}`: 409, если записи изменились; идемпотентно по `planId`; **одна транзакция**; порядок — `DECISIONS.md` п. 12; составы — проверка ссылок **в памяти по плану** (п. 13), не через `validateReference` без сессии. `needsName:true` и `name` = обозначение у новых. `sku` материалов не заполнять. Удалённые — восстановить.
- `POST /api/pdm-import/files` (multipart) → `pdmfiles`; `sha256` проверить; повтор → `stored:false`.
- Расход сырья детали: лист/фанера — `blank.length × blank.width / 1e6` м²; труба/брус — `blank.length / 1000` м. `overrideDimensions` = заготовка. Нет заготовки → строки сырья нет, `dimSource` пуст, метка «Нужен размер заготовки».

### 5. «Что купить» — `GET /api/products/:id/purchase-needs?qty=1`
- Обход дерева (`catalog-graph.service.ts`) → сырьё по сортаментам (× `scrapFactor`, − остатки форматов, → штуки основного формата), метизы, покупные. Ответ: строки `{позиция, нужно, ед., есть, купить, формат}`.

### 6. Скрытие на складе (Л1) — API
- Списки `materials`, каталог номенклатуры (`/supply/catalog/items`), выдача/приёмка: по умолчанию **без** `materialKind:'part'` и `isProfile:true`. Параметр `withParts=1` — показать. Экранам ничего менять не надо, чтобы скрыть.

### 7. Приложение на скачивание
- `GET /api/apps/pdm-loader` (admin) → `{version, size, sha256, uploadedAt}`; `GET /api/apps/pdm-loader/download` → файл из `uploads/apps/pdm-loader/<версия>/DataCore.PdmLoader.exe` (`attachment`). Кладётся вне git: кнопка пульта «Собрать приложение PDM» (позже, после Э2) + шаг в `release.sh` — **отдельным пунктом**, не в этой задаче.

### 8. Доки
- `docs/MAP.md` (модули pdm-import, pdm-files, apps), `docs/openapi.json` (перегенерировать), `docs/data-model.md` (новые поля), skill `datacore-docs-sync`.

## Критерии приёмки (qa)
- [ ] tsc 0; юнит: `match-key`, расход сырья, порядок записи, 409, идемпотентность.
- [ ] e2e на `datacore-test`: preview → apply на `samples/6104.pdm-tree.json` (когда Э2 положит; до того — ручной фикстура-сэмпл из 10 позиций) → повтор apply → 0 новых; второе изделие с той же каталожной деталью → ссылка на ту же запись; удалённая деталь восстанавливается.
- [ ] Списки склада и каталога без `withParts` не содержат `part`/`isProfile`.
- [ ] Путь с `../` в обозначении → 400.
- [ ] Не admin → 403.
- [ ] Старые клиенты: запросы без новых полей проходят как раньше (контракт API).

## Нельзя
- Удалять/переименовывать поля общих коллекций; менять индекс `article`/`sku`.
- Трогать `backend/pwa`, `backend/admin` (Э3), `apps/` (Э2), `backend/scripts/c057-*` (Э0).
- Прод.

## Отчёт
`REPORT-E1.md` — по шаблону (`docs/roles/TZ-TEMPLATE.md`).
