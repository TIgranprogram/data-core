# ТЗ SC-1 — Каталог поставщиков: бэкенд (модуль supplier-catalog)

> Пишет координатор. Файл: `docs/roles/tz/SC-1.md`. Исполнитель читает только ТЗ и перечисленные места.

**Зачем (словами пользователя):** парсить сайты поставщиков и хранить их прайс-листы; при нажатии «Синхронизировать» в карточке контрагента — обновлять позиции без дублей.

**Класс:** XL · **Max agents:** 1 исполнитель + qa · **Reviewers:** architect ☐ qa ☐ · **Max review loops:** 2 · **Проверки:** full
**Язык менеджера (если UI):** нет (бэкенд) · **Приёмка:** smoke на стенде — POST /supplier-catalog/sync/:orgId → статус running → ok, список позиций

## Shared pack

- Парсер живёт **внутри NestJS**: отдельный модуль `supplier-catalog`. Нет cron, нет exec. Сайты разные — каждый домен получает свой адаптер-класс.
- **Upsert — bulkWrite пачками по 500**, `ordered:false`, как `sheets-sync.service.ts:351`. Ключ — `{supplierId, vendorArticle}` (+ `organizationId`). После синхронизации позиции с `syncedAt < runStart` — `active:false`, не удалять (на них могут ссылаться заявки).
- **SSRF-защита обязательна**: `catalogUrl` вводит пользователь, запрос идёт с сервера → проверять хост: только http/https, запрет localhost, 127.*, 10.*, 192.168.*, 172.16–31.*; проверять и после редиректов.
- **Фото — скачивать и хранить локально** в `backend/uploads/suppliers/<supplierId>/` (создавать папку при первой синхронизации). Имя файла — `<vendorArticle>_<N>.jpg` (или оригинальное расширение). В БД хранить относительный путь `/uploads/suppliers/<supplierId>/...`. Внешние URL не хранить. Максимум 5 фото на позицию.
- Поля `supplierItemId` в `supplyrequests` — отдельное ТЗ SC-3, сейчас не трогать.
- Общая с CRM коллекция `supplyrequests` — в SC-1 не трогать.

## Что сделать

### 1. Новая коллекция `supplieritems`

`backend/src/modules/supplier-catalog/schemas/supplier-item.schema.ts`:

```
supplierId:    ObjectId → Organization  // required, indexed
vendorArticle: string                   // required — артикул поставщика
name:          string                   // required
description?:  string
priceRetail?:  number                   // розничная (последний порог или единственная цена)
prices?:       [{minQty: number, price: number}]  // все ценовые пороги
photoUrls?:    string[]                 // внешние https-URL, проверить schema при записи
sourceUrl?:    string                   // URL страницы товара
specs?:        Map<string, string>      // характеристики: {Материал: '...', Вес: '0.0037 кг'}
inStock?:      boolean
stockQty?:     number
unit?:         string                   // ед. изм. из сайта
category?:     string                   // хлебные крошки ('Опоры / Резьбовые регулируемые')
syncedAt:      Date                     // дата последней синхронизации
active:        boolean (default true)   // false = не нашлось при последней синхронизации
organizationId?: ObjectId → Organization // наша компания (multi-tenant)
deletedAt?:    Date
createdAt, updatedAt: timestamps
```

Уникальный индекс: `{ supplierId, vendorArticle, organizationId }` (sparse по organizationId).
Дополнительные индексы: `{ supplierId, active }`.

### 2. Поля в `organizations`

В `backend/src/modules/organizations/schemas/organization.schema.ts` добавить:
- `catalogUrl?: string` — URL каталога/категории для парсинга
- `catalogSyncStatus?: 'idle' | 'running' | 'ok' | 'error'` — статус (idle по умолчанию)
- `catalogSyncError?: string` — текст ошибки последней синхронизации
- `lastCatalogSyncAt?: Date` — дата последней успешной синхронизации

В DTO (`organizations.dto.ts` или аналог) добавить эти поля с валидацией.

### 3. Модуль `supplier-catalog`

`backend/src/modules/supplier-catalog/`:
- `supplier-catalog.module.ts`
- `supplier-catalog.service.ts` — логика синхронизации (bulkWrite, статус, SSRF-проверка)
- `supplier-catalog.controller.ts` — маршруты ниже
- `adapters/zaglushka.adapter.ts` — парсер zaglushka.ru
- `adapters/base.adapter.ts` — базовый интерфейс адаптера
- `schemas/supplier-item.schema.ts`

**Маршруты:**
- `GET /supplier-catalog?supplierId=:id&q=:q&page=&limit=` → `{items, total, page, limit}` — позиции поставщика, поиск по наименованию/артикулу, только `active:true`
- `POST /supplier-catalog/sync/:orgId` → `{status:'running'}` — запустить синхронизацию в фоне; если уже идёт — 409
- `GET /supplier-catalog/sync/:orgId` → `{status, lastSyncAt, error, total}` — текущий статус

Роль: `canEdit` (менеджер и выше). Синхронизация — только canEdit.

### 4. Адаптер zaglushka.ru (`adapters/zaglushka.adapter.ts`)

Парсит страницы zaglushka.ru через cheerio (`npm i cheerio`). Реализует интерфейс `BaseAdapter`:

```
interface ParsedItem {
  vendorArticle: string
  name: string
  description?: string
  priceRetail?: number
  prices?: {minQty: number, price: number}[]
  photoUrls?: string[]
  sourceUrl: string
  specs?: Record<string, string>
  category?: string
  inStock?: boolean
  stockQty?: number
  unit?: string
}

interface BaseAdapter {
  fetchItems(catalogUrl: string, fetchFn: FetchFn): AsyncGenerator<ParsedItem>
}
```

Как парсит (по аудиту страницы `zaglushka.ru/opora-rezbovaya-...`):
- Артикул: `h2` (первый внутри main, после h1 с названием)
- Название: `h1` (главный заголовок)
- Фото: `src` изображений слайдера, только https, шаблон `https://zaglushka.ru/images/item/...`
- Цены: таблица с ценовыми порогами; строки «от N шт.» / «розница»; парсить все пороги в `prices[]`, розничную — в `priceRetail`
- Характеристики: таблица «Материал / Вес» → `specs`
- Наличие: таблица «Цвет / Количество» → `inStock`, `stockQty`
- Категория: хлебные крошки (второй и третий элемент) → `category`
- Список позиций для обхода: страница каталога; пагинация через URL-параметры; лимит — не более 2000 позиций за один прогон
- **Аккуратный парсер (чтобы не забанили):**
  - User-Agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
  - Пауза между страницами каталога: **1–2 с** (случайная, `Math.random() * 1000 + 1000` мс)
  - Пауза между страницами товаров: **500–1500 мс** (случайная)
  - Фото скачивать последовательно (не параллельно), пауза 200 мс между файлами
  - При 429 Too Many Requests — ждать 30 с и повторить один раз, затем остановить синхронизацию с ошибкой
  - Заголовки: `Accept-Language: ru-RU,ru;q=0.9`, `Accept: text/html,application/xhtml+xml`
  - Никакого параллельного обхода

`FetchFn` — та же что в `sheets-sync.service.ts:59` (подменяется в тестах). Таймаут на страницу — 15 с. Размер ответа ≤ 5 МБ. Защита SSRF в сервисе, адаптер её не дублирует.

**Ловушка:** если на странице нет артикула — пропустить позицию (залогировать), не падать.

### 5. Тесты

`backend/src/modules/supplier-catalog/supplier-catalog.service.spec.ts`:
- SSRF: localhost → reject; внутренний IP → reject; внешний → pass
- bulkWrite upsert: 3 позиции → 2 те же + 1 новая → итого 3 (не 5)
- active:false для пропавших: синхронизация с 2 позиций после 3 → пропавшая помечается active:false

`backend/src/modules/supplier-catalog/adapters/zaglushka.adapter.spec.ts`:
- Тест на сохранённом HTML фрагменте (без сети): парсирует артикул, название, цены, фото

## Файлы

- **Ожидаются правки параллельно:** нет.
- **Читать:**
  - `backend/src/modules/sheets-sync/sheets-sync.service.ts:50–90` (fetchFn), `:340–360` (bulkWrite)
  - `backend/src/modules/organizations/schemas/organization.schema.ts` — только поля, не весь файл
  - `backend/src/modules/organizations/dto/` — структура DTO
  - `docs/ARCHITECTURE.md` §«Модули» — структура нового модуля
  - `docs/roles/datacore-new-module.md` — канон нового модуля
- **Читать запрещено:** DESIGN/CANON/HISTORY/TASKS целиком, `docs/openapi.json` целиком.
- **Менять:**
  - Создать: `backend/src/modules/supplier-catalog/` (всё новое)
  - Добавить поля: `backend/src/modules/organizations/schemas/organization.schema.ts`, `backend/src/modules/organizations/dto/`
  - Добавить модуль в: `backend/src/app.module.ts`

## Критерии приёмки (проверяет qa)

- [ ] `npx tsc --noEmit` — 0 ошибок
- [ ] Юниты модуля: SSRF-защита (оба случая), upsert без дублей, active:false для пропавших, парсер zaglushka.ru на сохранённом HTML
- [ ] `POST /supplier-catalog/sync/:orgId` при уже запущенной синхронизации → 409
- [ ] `GET /supplier-catalog?supplierId=X` → `{items,total,page,limit}`, только active:true
- [ ] Поля в organizations: `catalogUrl` сохраняется через PATCH /partners/:id
- [ ] Ничего не сломано: `npx jest --silent` — весь юнит зелёный

## Нельзя

- Трогать коллекцию `supplyrequests` (общая с CRM kppdf) — это SC-3.
- Хранить фото в `backend/uploads/` — только внешние URL.
- Запускать парсер в cron или через exec — только REST-эндпоинт.
- `docs/openapi.json` и `docs/MAP.md` не трогать — обновит координатор после SC-1 + SC-2.

## Отчёт роли (≤ 12 строк)

`статус | сделано (пункты ✅/❌/➖) | файлы | проверки (команда → итог) | риски / нужно от других`

## Итог (координатор)

- Сделано: … · Проверено: … · Коммит: … · Выложено: v1.N
