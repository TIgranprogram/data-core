# Карта роли analyst

коммит: 61b18c6 (DICT не закоммичен)

## Паспорта (ПВ, 2026-10-25)
- Справочники паспортов: `backend/src/modules/dicts/dicts.defs.ts:538–724`.
- Сборка текста: `product-passport/passport-v2-text.ts` (шаблон ALL + категория + части), `passport-compose-parts.ts` (описание, назначение, правила, ТО, монтаж), обязательные поля `passport-rules.ts:130–230`.
- Значения изделия по умолчанию: `showcase/passport-defaults.ts` (`PASSPORT_CATEGORY_CODES` зашит в коде).
- Тексты-сид: `backend/scripts/passport-texts.v2.json`, `seed-passport-phrases.js`.
- Нормативы и статусы: `docs/PASSPORTS-V2.md` §2; черновик/выпуск — §10.
- Моё ТЗ воронки: `docs/roles/tz/PASSPORT-FUNNEL-analyst.md`; вопросы П1–П4 в QUESTIONS.
- Ключевой вывод: монтаж живёт в 3 местах (шаблон ALL, passportInstall, passportPhrases) — сливать.
- Сверка нормативов 2026-10-25: `docs/roles/tz/PP-STANDARDS-CHECK.md` (DSP: 57538 неверно → 55677-55679; ГОСТ Р 56440-2015 для универсального спорт-оборудования).

## Справочники (DICT, 2026-10-25)
- ТЗ: `docs/roles/tz/DICT.md`. Сервер: `modules/dicts/dicts.{service,defs}.ts`. Ключевое: переименование строковых справочников без каскада ломает ссылки; `used`/`related` тяжёлые.

## Каталог поставщика (SC, 2026-10-25)
- Аудит: новая коллекция `supplieritems` (не трогать общую с kppdf `materials`).
- Поставщик-организация: `organization.type[]` уже содержит `'supplier'`; нужно добавить `catalogUrl?: string` и `lastCatalogSyncAt?: Date`.
- Уникальный ключ upsert: `{ supplierId, vendorArticle }`.
- Связь с заявками: `supplyrequests` добавить необязательный `supplierItemId?: ObjectId` + snapshot-поля.
- Граница: showcase-модуля нет; продукция — паспорта изделий; смешения нет.
- Вопросы SC-1…SC-3 в `docs/QUESTIONS.md`.

## Проектирование-доска (DESIGN-BOARD, 2026-10-25)
- ТЗ: `docs/roles/tz/DESIGN-BOARD.md`. Сервер `modules/design` (задача = позиция заказа, `designtasks`); новое — `designorders`. PWA: `sections/design.js`, `order-design.js`, `ui/board.js` (drag).
