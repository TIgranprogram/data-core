# Исследование: модель данных, индексы, общие с kppdf коллекции

> Часть архитектурного аудита 2026-10-22. Read-only скан `backend/src`. Живые данные не трогались.
> Смежные отчёты: [Качество кода](./RESEARCH-CODE-QUALITY-2026-10-22.md), [API и безопасность](./RESEARCH-API-SECURITY-2026-10-22.md).

---

## 1. Карта коллекций

**44 именованные коллекции** из `*.schema.ts` (+ `idempotency_records` в common). **Дублей имён внутри data-core нет.**

Дополнительно без схем (сырой драйвер / на лету):
- `dict_values` — читается в `product-passport.service.ts:312,322`, `passport-pdf.service.ts:83`;
- `app_<app>_<collection>` — создаются в `app-data.service.ts:66` (EAV-подобное приложение-хранилище).

### Перекрытия (не дубли, но зоны риска)

1. **Одна схема — много `forFeature`.** `MaterialSchema` регистрируется в 5 модулях, `CategorySchema` — в 4, `ProductSchema`/`ProductModuleSchema` — в 3. В `admin.module.ts:28-32` уже зафиксировано правило «NO forFeature here…» (повторная регистрация пересоздаёт индексы). **Факт:** правило существует, но нарушается по всей кодовой базе — это и есть «плоский монолит» на уровне Mongoose.
2. **Реестр админки `kind: 'crm'`** включает `warehouses`, `storageitems`, `stockmovements`, `reservations`, `supplyrequests`, хотя их схемы в data-core **есть** (`stock/schemas/`, `supply/`). Т.е. классификация «это только CRM» устарела: коллекции уже общие, в них пишут оба приложения. См. §4.

## 2. Глобальные плагины БД

| Плагин | Что делает | Исключения |
|--|--|--|
| `soft-delete` | автофильтр `deletedAt: null` на find/count; хелперы `.softDelete()` / `.restore()` | **20 коллекций** opt-out `@Schema({ softDelete: false })` (users, roles, settings, counters, auditlogs, idempotency…); coverage-тест обязывает каждую схему иметь `deletedAt` **или** явный opt-out |
| `audit` | pre-save/update проставляет `createdAt/createdBy`, `updatedAt/updatedBy` | полей `createdBy/updatedBy` объявлено лишь в 7 схемах — в остальных strict-mode **молча отбрасывает** (плагин не создаёт поля) |
| `user-context` | тянет `userId` из AsyncLocalStorage → `$locals` для audit | без исключений |

**Скрытый эффект (важно для аудита):** чтение через `db.collection(...)` (admin, partners, finance, showcase, stock, supply, sheets-sync) **не проходит через плагины** — `deletedAt: null` добавляется руками в каждом фильтре. Это главный источник «разных правил мягкого удаления» в разных экранах. При выносе ACL (шаг 3 основного аудита) сырой доступ стоит централизовать.

## 3. Индексы

**Все 44 коллекционные схемы индексированы.** Топ:

| Коллекция | Индексов | Примечание |
|--|--|--|
| `supplyrequests`, `stockmovements` | **16** | общие с kppdf; compound-индексы по warehouse/date |
| `incomes`, `materials` | 13 | у materials — unique sparse `{organizationId,article}` |
| `storageitems`, `reservations` | 11 | compound по warehouse+product/material |
| `categories`, `salesorders` | 9 | |
| `products` | 8 | unique sparse `{organizationId,sku}` |

`autoIndex: !isProd` — индексы строятся только вне прода. **Риск (известный класс инцидентов):** деплой новой схемы в прод не создаст индекс автоматически; нужен ручной `syncIndexes`/миграция при добавлении полей с `index: true`. Стоит зафиксировать в skill `datacore-deploy`: «после добавления индекса — команда создания на VM».

## 4. Общие с kppdf коллекции (единая база) — канонический список

**Шапка «ОБЩАЯ КОЛЛЕКЦИЯ… копия схемы из CRM kppdf» (менять синхронно):**
`supplyrequests`, `warehouses`, `storageitems`, `stockmovements`, `reservations`.

**Общие поля (блок «добавлены 2026-10-18»)** — те же 5 + **`materials`**.

**Общая с kppdf, но с полями только data-core:** `productpassports` (kppdf не пишет часть полей), поля-«допы» в `stockmovements`, `reservations`.

**Созданы, чтобы НЕ трогать CRM:** `salesorders` (имя `orders` занято CRM), `incomes` (CRM `orders` не подходит).

**Реестр `kind: 'crm'`** (таблицы kppdf без модуля в data-core) — ~55 коллекций: документы, заказы, производство, импорты, BOM и т.д. Это **живые данные kppdf** — data-core их не должен трогать (правило AGENTS.md №4).

### Расхождение, которое надо решить документом (не кодом)

`warehouses` / `storageitems` / `stockmovements` / `reservations` / `supplyrequests` в реестре админки помечены `kind: 'crm'`, но:
- схемы **есть** в data-core;
- модули `stock` / `supply` в них **пишут**;
- поля-«только data-core» уже добавлены.

**Рекомендация:** ввести третий класс в реестре — `kind: 'shared'` («общие с kppdf, есть схемы в обоих репо»), оставив `crm` только для «чисто kppdf» таблиц. Это правка одного файла `collections-admin.controller.ts` (реестр) + `docs/MAP.md`; API-контракт админки не меняется, если поле `kind` расширяется значением, а не переименовывается. Согласовать с kppdf-стороной (их `UNIFIED-DB.md`).

## 5. EAV и идемпотентность (коротко)

- **EAV:** `attributedefinitions` + `entityattributevalues`, связь строковая (`entityType`+`entityId`), без ref. Используется **только product** (+ generic CRUD). `product-passport` с EAV **не связан** — хранит свои поля. На текущем объёме это норма; расширять EAV на passport без нужды не стоит.
- **Идемпотентность:** ключ `Idempotency-Key`, фингерпринт SHA-256(method|path|body), TTL **жёстко 24 ч** (переменная `IDEMPOTENCY_TTL_HOURS` упомянута только в комментариях — в коде не читается: либо реализовать, либо убрать упоминание, чтобы не путать). Тело >256 КБ — без кэша. Исключения login/refresh/logout/health — корректно.

## 6. Выводы и безопасные улучшения

| # | Действие | Ломает ли | Эффект |
|--|--|--|--|
| 1 | Добавить `kind: 'shared'` в реестр коллекций админки (+ обновить MAP/UNIFY-доки) | нет, если значение новое | снимает путаницу «crm vs наши» у операторов и ИИ |
| 2 | Зафиксировать в skill `datacore-deploy`: «добавил `index: true` → на VM выполнить syncIndexes» | нет | предотвращает промахи autoIndex в проде |
| 3 | Правило CANON: новый `forFeature` чужой схемы — только через модуль-владелец (Token), не копирование `XSchema` | нет | останавливает рост «5 модулей на одну MaterialSchema» |
| 4 | При следующем касании admin-реестра — вынести сырой доступ с ручным `deletedAt: null` в маленький query-хелпер `common/raw-query.ts` | нет | единое правило soft-delete для сырых запросов |
| 5 | Реализовать или убрать `IDEMPOTENCY_TTL_HOURS` (комментарий vs код) | нет | убирает ложную документацию |

Чего **не** делать: не «чищать» реестр `kind:'crm'` удалением строк — это живые таблицы kppdf; не вводить транзакции Mongo 5+ (версия 4.4); не переносить EAV на passport без продуктовой задачи.
