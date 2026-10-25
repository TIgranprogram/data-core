# Data Model — data-core (подмножество kppdf-8.0)

> Описание доменной модели **действующего** backend data-core.
> Исходная модель kppdf-8.0 (ERP, ~90 сущностей, 11 доменов) — в git-истории.
> В рамках задачи H (чистка CRM-модулей, ROADMAP P1.5) граница сужена до
> платформенного ядра + канонических справочников (VISION #4). Удалённые
> транзакционные домены (Sales, Warehouse, Procurement, Documents,
> Production-ордера, Finance-акты и т.п.) из этого документа убраны.

## Обзор

Data-core — платформенное ядро (`auth`, `user`, `role`, `permissions`, `audit`, `setting`, `feature-flag`, `rate-limit`, устройства/desktop, `status`) плюс канонические справочники (организации, контрагенты, люди, площадки, категории, единицы, валюты, цвета, материалы, изделия, модули изделий, фото, EAV-атрибуты, виды работ). Описано **~28 сущностей**, сгруппированных в **7 доменов**, с явным указанием типов полей, FK-связей и обнаруженных аномалий. Актуальный состав модулей — `ROADMAP.md` (P1.5) и `backend/src/app.module.ts` (37 модулей).

**Конвенции (применены ко всем таблицам ниже):**

- `id` → `ObjectId` (PK)
- `*Id` → `ObjectId` (FK)
- `*Ids` → `ObjectId[]` (multi-FK)
- `createdAt` / `updatedAt` / `deletedAt` / `*At` → `Date`
- `is*` → `boolean`
- Прочие типы указаны вручную (по контексту)
- ⚠️ = потенциальная проблема (см. секцию «Дубликаты и аномалии»)

## Политики

### Валюта — всегда RUB

Поле `priceCurrency` в `Material` (и любых других сущностях) **удалено**. Цены — в российском рубле (₽, ISO-4217: RUB); символ `₽` подставляется на уровне UI при форматировании. Если в будущем потребуется multi-currency, поле будет добавлено обратно с миграцией. Справочник валют (`Currency`, `/api/currencies`, seed `CurrenciesSeed`) присутствует как канонический справочник.

## Карта по доменам

| #  | Домен                       | Кол-во | Ключевые сущности                              |
|----|------------------------------|--------|------------------------------------------------|
| 1  | Identity & Access            | 7      | `User`, `Role`/`Roles`, `Permissions`, `FeatureFlag`, `RateLimitEntry` |
| 2  | People & Contacts            | 4      | `Person`, `Counterparty`, `CounterpartyRole`, `OrganizationContact` |
| 3  | Organizations                | 3      | `Organization`, `OrgRole`, `Category`          |
| 4  | Products & Materials         | 10     | `Material`, `Product`, `ProductModule`, `ProductPassport`, `Photos`, `AttributeDefinition`, `EntityAttributeValue` |
| 5  | Production                   | 1      | `WorkType`                                     |
| 6  | Finance                      | 1      | `Setting`                                      |
| 7  | System & Activity            | 2      | `StatusWorkflow`, `EntityStatus`               |
| **Total** |                          | **28** |                                                |

---

## 1. Identity & Access (Идентификация и доступ)

Системные сущности для авторизации, ролей и контроля доступа.

### `Counter` (Счётчик нумерации)

**Атомарный счётчик для генерации номеров документов (КП, договоров, заказов).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `entity` | `string` | Имя сущности (`Product`, `Material`...) |
| `prefix` | `string` | Префикс номера |
| `year` | `number` | Год (для ежегодного сброса) |
| `seq` | `number` | Текущий sequence |
| `name` | `string` | Опциональное имя счётчика |
| `value` | `number` | Альтернативное значение |

### `User` (Пользователь)

**Системный пользователь платформы.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `username` | `string` | Логин |
| `email` | `string` | — |
| `displayName` | `string` | — |
| `passwordHash` | `string` | bcrypt/argon2 |
| `password` | `string` | ⚠️ дубликат `passwordHash` — кандидат на удаление |
| `role` | `string \| string[]` | Роль (одна или несколько) |
| `isActive` | `boolean` | — |
| `lastLoginAt` | `Date` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |
| `deletedAt` | `Date?` | soft delete |
| `permissions` | `string[]` | Явные разрешения |
| `phone` | `string` | — |
| `refreshTokenVersion` | `number` | Инвалидация refresh-токенов |
| `fullName` | `string` | — |

### `Role` (Роль)

**Системная роль с набором прав.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | Системное имя (slug) |
| `label` | `string` | Отображаемое название |
| `description` | `string` | — |
| `permissions` | `string[]` | Список permissions |
| `isSystem` | `boolean` | Системная (нельзя удалить) |
| `sortOrder` | `number` | — |
| `sectionIds` | `string[]` | Связь с секциями UI |
| `appSections` | `string[]?` | SK-8a: разделы «Рабочего места», видимые роли (ид из `common/app-sections.ts`); нет / пусто — по иерархии роли; только видимость, не права |
| `baseRole` | `string?` | SK-8c: только у своей роли (код `r-…`, задаёт сервер, неизменяем) — «права как у»: `user`/`manager`/`accountant`/`director` (не `admin`); права, деньги, permissions и pages — от неё. У встроенных и старых ролей поля нет |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `Roles` (Роль, MongoDB-формат)

⚠️ **Дубликат `Role`** — другой формат, мигрированный из старой MongoDB-схемы.

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `name` | `string` | — |
| `isSystemRole` | `boolean` | — |
| `status` | `string` | — |
| `permissions` | `string[]` | — |
| `description` | `string` | — |
| `deletedAt` | `Date?` | soft delete |

### `Permissions` (Права доступа)

**Каталог прав доступа (read/write/admin для каждой секции).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `key` | `string` | Уникальный ключ права |
| `section` | `string` | Секция UI |
| `action` | `string` | Действие (read/write/admin) |
| `description` | `string` | — |

### `FeatureFlag` (Фича-флаг)

**Фича-флаги для A/B-тестирования и постепенного rollout.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `key` | `string` | Уникальный ключ |
| `label` | `string` | — |
| `description` | `string` | — |
| `enabledByDefault` | `boolean` | — |
| `category` | `string` | Группировка |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `RateLimitEntry` (Ограничение частоты)

**Запись rate-limiter (Redis/БД).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `key` | `string` | Ключ (userId, IP) |
| `count` | `number` | Текущий счётчик |
| `expiresAt` | `Date` | TTL |


---

### `ClientError` (Ошибка приложения, ОШ2.1)

**Коллекция `clienterrors` (только data-core).** Журнал ошибок «Рабочего места»; без мягкого удаления, TTL 30 дней по `createdAt`. Данных форм, параметров адресов и токенов нет (сервер вырезает/маскирует).

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `sig` | `string` | Ключ группировки: sha1(name + message без чисел/id + section + url), 16 hex |
| `message` | `string` | ≤ 500 |
| `name` / `stack` | `string?` | ≤ 100 / ≤ 4000 |
| `section` / `action` | `string?` | Раздел (`#раздел`, ≤ 60) / что делал человек (≤ 120) |
| `kind` | `action \| background \| unhandled` | |
| `status` | `number?` | HTTP-код, если ошибка запроса |
| `url` | `string?` | Путь API без query, ≤ 200 |
| `version` / `ua` | `string?` | ≤ 40 / ≤ 300 |
| `userId` / `role` | `ObjectId` / `string` | Кто прислал |
| `createdAt` | `Date` | TTL-индекс 30 дн.; индекс `{sig:1, createdAt:-1}` |
---

## 2. People & Contacts (Люди и контакты)

### `Person` (Контактное лицо)

**Физическое лицо — контакт организации/контрагента.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `lastName` | `string` | — |
| `firstName` | `string` | — |
| `patronymic` | `string` | Отчество |
| `phone` | `string` | — |
| `email` | `string` | — |
| `position` | `string` | Должность |
| `notes` | `string` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `Counterparty` (Контрагент)

**Юр. лицо или ИП — контрагент (покупатель, поставщик, подрядчик).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | Полное наименование |
| `shortName` | `string` | Краткое наименование |
| `legalForm` | `string` | ООО/ИП/АО... |
| `roles` | `string[]` | Роли (`customer`, `supplier`...) |
| `inn` | `string` | — |
| `kpp` | `string` | — |
| `ogrn` | `string` | — |
| `legalAddress` | `string` | — |
| `phone` | `string` | — |
| `email` | `string` | — |
| `bankName` | `string` | — |
| `bik` | `string` | — |
| `checkingAccount` | `string` | ⚠️ `bankAccount` в `Organization` — кандидат на унификацию |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `CounterpartyRole` (Роль контрагента)

**Справочник ролей контрагента (покупатель, поставщик, подрядчик).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `name` | `string` | — |
| `description` | `string` | — |
| `slug` | `string` | — |
| `isActive` | `boolean` | — |

### `OrganizationContact` (Связь организация-контакт)

**M2M-связь между `Organization` и `Person`.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `organizationId` | `ObjectId` | FK → `Organization` |
| `personId` | `ObjectId` | FK → `Person` |

## 3. Organizations (Организации)

### `Organization` (Организация)

⚠️ **Возможный дубликат `Counterparty`** — у обеих похожий набор полей (ИНН, КПП, ОГРН, банк).

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `shortName` | `string` | — |
| `legalForm` | `string` | — |
| `inn` | `string` | — |
| `kpp` | `string` | — |
| `ogrn` | `string` | — |
| `ogrnip` | `string` | Для ИП |
| `ipRegistrationDate` | `Date` | — |
| `passportSeries` | `string` | Для ИП |
| `passportNumber` | `string` | — |
| `passportIssuedBy` | `string` | — |
| `passportIssuedDate` | `Date` | — |
| `phone` | `string` | — |
| `email` | `string` | — |
| `legalAddress` | `string` | — |
| `actualAddress` | `string` | — |
| `postalAddress` | `string` | — |
| `bankName` | `string` | — |
| `bankBik` | `string` | — |
| `bankAccount` | `string` | — |
| `signerName` | `string` | — |
| `signerPosition` | `string` | — |
| `counterpartyRoleIds` | `ObjectId[]` | FK → `CounterpartyRole` |
| `contactPerson` | `string` | — |
| `paymentTermDays` | `number` | Срок оплаты |
| `vatRate` | `number` | Ставка НДС |
| `isActive` | `boolean` | — |
| `type` | `string` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |
| `legalType` | `string` | — |
| `website` | `string` | — |
| `directorName` | `string` | — |
| `registrationDate` | `Date` | — |
| `partyTypes` | `string[]` | Типы сторон |
| `photoIds` | `ObjectId[]` | FK → `Photos` |
| `deletedAt` | `Date?` | soft delete |

### `OrgRole` (Роль организации)

**Справочник ролей организации (покупатель/поставщик/подрядчик).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `slug` | `string` | — |
| `description` | `string` | — |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `Category` (Категория)

**Универсальная иерархическая категория (parent/child).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `parentId` | `ObjectId?` | FK → `Category` (parent) |
| `fullPath` | `string` | Кэш полного пути |
| `sortOrder` | `number` | — |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

---

## 4. Products & Materials (Продукция и материалы)

> **CATALOG Phase 1 (канон 2026-08-04):** `tasks/TZ-CATALOG-300.md` + Wave 1
> `tasks/TZ-CATALOG-301`…`305`, оркестрация `tasks/CATALOG-WAVE1.md`.  
> Состав: refs+qty в `composition[]`; Product→Product да; Product→raw нет;
> `materialKind` на Material; depth max 8; Excel — desktop Wave 4.

### CATALOG Phase 1 — решения (кратко)

| ID | Правило |
|----|---------|
| D1 | Product → Product (комплекс): qty + `unitPriceOverride`; `isComplex` вычисляемый |
| D2 | Product → Material(raw) запрещён |
| D3 | Детали/метизы/покупные = `Material.materialKind` (без Part) |
| D4 | Depth: корень 0, max child 8; смешанный путь; циклы запрещены |
| F1 | Embedded `composition[]` (не deep-clone) |
| F2 | Фото из Excel — не web Phase 1 |
| Масса | Канон поля: **`weightKg`** |

Целевые поля Material (добавляет TZ-CATALOG-301): `materialKind`
(`raw|part|fastener|purchased|other`), `assortment`, `standardRef`,
`materialGrade`, `weightKg`. Legacy без kind → migration `other`.

Целевой состав (302+): `CompositionLine` с `_id`, `lineType`, `refId`,
`quantity`, `sortOrder`, …; ≤1000 строк; единственный write после 304.

### `Material` (Материал)

**Глобальный справочник материалов.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `article` | `string` | **Артикул** — пользовательский/внешний код (код поставщика, каталог клиента). Опционально, может повторяться. |
| `sku` | `string` | **Внутренний код материала** — уникальный системный идентификатор для поиска и связей. Mongo: `unique: true, sparse: true, index: true` — уникальность гарантируется сервером (E11000 → 409). Опционален: заполняется вручную или генерируется сервером (см. TZ-MATERIALS-307). |
| `unit` | `string` | Единица измерения |
| `unit` | `string` | Единица измерения |
| `category` | `string` | Категория (legacy) |
| `categoryId` | `ObjectId` | FK → `Category` (тип `material`) |
| `description` | `string` | — |
| `price` | `number` | Цена (legacy) |
| `pricePerUnit` | `number` | Цена за единицу. Всегда в **RUB** — поле валюты отсутствует (см. политику ниже). |
| `stockQty` | `number` | ⚠️ **LEGACY (deprecated)** — остаток. Создание/редактирование материала не отправляет это поле (TZ-MATERIALS-304). Складской домен (`StorageItem`, склад/приходы/расходы) удалён в рамках задачи H; поле сохранено в schema/DTO только для backward compatibility старых записей/API и не является источником истины. |
| `dimensions` | `Dimension[]` | Габариты (см. `Dimension`). Массив, не объект. |
| `mainPhotoId` | `ObjectId?` | FK → `Photo`. Главное фото (используется в карточках). Выбирается галочкой из `photoIds[]`. |
| `photoIds` | `ObjectId[]` | FK → `Photos` |
| `supplierId` | `ObjectId?` | FK → `Organization` (только организации с флагом `type: 'supplier'`) |
| `notes` | `string` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |
| `deletedAt` | `Date?` | soft delete |

#### Подсхема `Dimension` (внутри `Material.dimensions[]`)

**Массив габаритов материала. Каждый элемент описывает ОДИН измеряемый параметр (длина / ширина / высота / толщина / диаметр / глубина) с признаком неизменяемости.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `type` | `string` | Вид размера: `length` / `width` / `height` / `thickness` / `diameter` / `depth` |
| `value` | `number` | Числовое значение в мм |
| `isImmutable` | `boolean` | Если `true` — размер **нельзя изменить** downstream (например, толщина листа металла). При создании продукции/модуля это поле блокируется на редактирование. |

**Семантика `isImmutable`:**
- `true` — параметр **жёстко привязан** к материалу (толщина листа 2 мм — её нельзя «раскатать»).
- `false` — параметр можно менять downstream (длина и ширина листа могут резаться под нужный модуль).

**Пример (лист металла 2×3 м, толщина 2 мм):**
```
dimensions: [
  { type: 'length',    value: 3000, isImmutable: false },
  { type: 'width',     value: 2000, isImmutable: false },
  { type: 'thickness', value: 2,    isImmutable: true  }
]
```

### `Product` (Продукция)

**Карточка продукции с BOM-связями и атрибутами.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `sku` | `string` | — |
| `kind` | `string` | Вид (good/service) |
| `productType` | `string` | Тип (legacy) |
| `unit` | `string` | — |
| `categoryId` | `ObjectId` | FK → `Category` (тип `product`) |
| `subcategory` | `string` | — |
| `status` | `string` | — |
| `listPrice` | `number` | Прайсовая цена |
| `basePrice` | `number` | Базовая цена |
| `costPrice` | `number` | Себестоимость |
| `cost` | `number` | (legacy) |
| `defaultMarkupPercent` | `number` | — |
| `stockQty` | `number` | Остаток |
| `description` | `string` | — |
| `notes` | `string` | — |
| `photos` | `string[]` | URLs (legacy) |
| `photoIds` | `ObjectId[]` | FK → `Photos` |
| `height` / `length` / `width` | `number` | Габариты |
| `weight` / `weightKg` | `number` | ⚠️ Дубликат |
| `dimensions` | `object` | — |
| `materials` | `array` | Связанные материалы |
| `material` | `string` | Основной материал |
| `installation` | `string` | Монтаж (legacy) |
| `purpose` | `string` | Назначение |
| `ralCode` | `string` | RAL-цвет |
| `hasPassport` | `boolean` | — |
| `hasDrawing` | `boolean` | — |
| `copiedFromProductId` | `ObjectId` | Для дублей продукции |
| `productModuleIds` | `ObjectId[]` | FK → `ProductModule` |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |
| `deletedAt` | `Date?` | soft delete |

### `ProductPhoto` (Фото продукта)

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `productId` | `ObjectId` | FK → `Product` |
| `url` | `string` | — |
| `caption` | `string` | Подпись |
| `isMain` | `boolean` | — |
| `sortOrder` | `number` | — |
| `createdAt` | `Date` | — |

### `ProductModule` (Модуль продукции)

**Модуль в составе продукта (для модульной продукции).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `productId` | `ObjectId` | FK → `Product` |
| `name` | `string` | — |
| `article` | `string` | — |
| `width` / `height` / `depth` | `number` | — |
| `weight` | `number` | — |
| `image` | `string` | — |
| `sortOrder` | `number` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `ModuleWorkType` (Вид работ модуля)

**Связь модуля с видом работ + оценка часов.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `moduleId` | `ObjectId` | FK → `ProductModule` |
| `workTypeId` | `ObjectId` | FK → `WorkType` |
| `estimatedHours` | `number` | — |
| `sortOrder` | `number` | — |

### `ModuleMaterial` (Материал модуля)

**Материалы, используемые в модуле.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `moduleId` | `ObjectId` | FK → `ProductModule` |
| `name` | `string` | — |
| `quantity` | `number` | — |
| `unit` | `string` | — |
| `isPurchased` | `boolean` | Закупается отдельно? |

### `ProductPassport` (Паспорт продукции)

**Паспорт изделия (документ с характеристиками).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `productId` | `ObjectId` | FK → `Product` |
| `passportNumber` | `string` | — |
| `productCode` | `string` | — |
| `warrantyCode` | `string` | — |
| `date` | `Date` | — |
| `name` / `category` / `article` | `string` | Кэш для отчётов |
| `height` / `length` / `width` / `weight` | `number` | — |
| `description` | `string` | — |
| `installationSite` | `string` | — |
| `supplier` | `string` | — |
| `photo` | `string` | — |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `Photos` (Хранилище фото)

**Централизованное хранилище всех фото (варианты, разные размеры).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `storageUrl` | `string` | URL оригинала |
| `originalFilename` | `string` | — |
| `variant` | `string` | thumb/medium/full |
| `mimeType` | `string` | — |
| `sizeBytes` | `number` | — |
| `widthPx` / `heightPx` | `number` | — |
| `parentPhotoId` | `ObjectId?` | Родительский вариант |
| `linkedPhotoId` | `ObjectId?` | Связанное фото |

⚠️ **Нет `id`, `createdAt`, `updatedAt`** — нужен PK.

### `AttributeDefinition` (Определение атрибута)

**EAV: определение настраиваемого атрибута сущности.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `entityType` | `string` | К какой сущности |
| `categoryId` | `ObjectId?` | FK → `Category` |
| `name` | `string` | Системное имя |
| `label` | `string` | Отображаемое |
| `type` | `string` | string/number/date/... |
| `unit` | `string` | — |
| `options` | `array` | Для enum |
| `required` | `boolean` | — |
| `sortOrder` | `number` | — |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `EntityAttributeValue` (Значение атрибута)

**EAV: значение настраиваемого атрибута для конкретной сущности.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `entityType` | `string` | — |
| `entityId` | `ObjectId` | PK сущности |
| `attributeId` | `ObjectId` | FK → `AttributeDefinition` |
| `value` | `any` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

⚠️ **Нет `id` PK** — кандидат на добавление.

## 5. Production (Производство)

### `WorkType` (Вид работ)

**Справочник видов работ (сварка, покраска, сборка...).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `name` | `string` | — |
| `section` | `string` | Раздел UI |
| `description` | `string` | — |
| `isActive` | `boolean` | — |
| `department` | `string` | Цех/отдел |
| `defaultDurationHours` | `number` | — |
| `workCenterId` | `ObjectId` | ⚠️ FK → `WorkCenter` — коллекция/модуль удалены (задача H); поле никогда не популейтится, оставлено только в schema для backward compatibility |
| `hourlyRate` | `number` | Ставка по умолчанию |
| `days` | `number?` | Календарные дни для Gantt-оценки. Null допустим (срок неизвестен — stuck path, TZ-PRODUCTION-302); >0 при заполнении |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

## 6. Finance (Финансы)

### `Setting` (Настройка)

**Глобальные настройки приложения (key-value).**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `key` | `string` | Уникальный ключ |
| `value` | `any` | — |
| `description` | `string` | — |
| `group` | `string` | Группировка |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

---

## 7. System & Activity (Системные и история)

### `StatusWorkflow` (Workflow статусов)

**Определение переходов между статусами для конкретной сущности.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `entityType` / `entity` | `string` | ⚠️ Дубликат |
| `name` | `string` | Название workflow |
| `statuses` | `array` | Список статусов |
| `transitions` | `array` | Переходы |
| `fromStatus` / `toStatus` | `string` | — |
| `roles` | `array` | Роли, доступные для перехода |
| `isActive` | `boolean` | — |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

### `EntityStatus` (Статус сущности)

**Каталог статусов для конкретного типа сущности.**

| Поле | Тип | Комментарий |
|------|-----|-------------|
| `id` | `ObjectId` | PK |
| `entityType` | `string` | — |
| `statusId` | `string` | — |
| `label` | `string` | — |
| `color` | `string` | HEX |
| `icon` | `string` | — |
| `sortOrder` | `number` | — |
| `isInitial` | `boolean` | Начальный статус |
| `isFinal` | `boolean` | Финальный статус |
| `createdAt` | `Date` | — |
| `updatedAt` | `Date` | — |

## ⚠️ Дубликаты и аномалии

### Дублирующиеся сущности (нужно консолидировать)

| Сущность 1            | Сущность 2              | Что общего                  | Рекомендация                                                       |
|------------------------|--------------------------|------------------------------|--------------------------------------------------------------------|
| `Role`                 | `Roles`                  | Роль                         | Оставить одну (`Role`), мигрировать                                |
| `Organization`         | `Counterparty`           | Юр. лицо                     | Решить: это разные сущности или одна?                              |

### Потенциально избыточные поля внутри одной сущности

| Сущность           | Поле 1              | Поле 2              | Комментарий                                |
|--------------------|----------------------|---------------------|--------------------------------------------|
| `User`             | `passwordHash`       | `password`          | ⚠️ Дубликат — удалить `password`           |
| `User`             | `role`               | `permissions`       | Возможно, лучше только `role`              |
| `Material`         | `category`           | `categoryId`        | Legacy + новый                             |
| `Material`         | `price`              | `pricePerUnit`      | Legacy + новый                             |
| `Product`          | `cost`               | `costPrice`         | Legacy + новый                             |
| `Product`          | `weight`             | `weightKg`          | Дубликат                                   |
| `Product`          | `listPrice`          | `basePrice`         | Возможно дубликат                          |
| `StatusWorkflow`   | `entityType`         | `entity`            | Дубликат                                   |
| `Counterparty`     | `checkingAccount`    | `Organization.bankAccount` | Унифицировать название          |

### Сущности без `id` PK (нужен PK)

- `EntityAttributeValue`
- `Photos`

### Сущности без `createdAt` / `updatedAt`

- `CounterpartyRole`

---

## Сводная статистика

- **Сущностей:** 28
- **Доменов:** 7
- **Дубликатов пар:** 2 (`Role`/`Roles`, `Organization`/`Counterparty`)
- **Сущностей без PK `id`:** 2 (`EntityAttributeValue`, `Photos`)
- **Сущностей без `createdAt`/`updatedAt`:** 1 (`CounterpartyRole`)
- **Потенциально избыточных полей внутри entity:** 9

---

_Документ сгенерирован автоматически. При внесении изменений в модель — обновляйте соответствующие секции этого документа._


## Concurrency & Transactions

Write-paths, которые должны быть all-or-nothing, используют MongoDB-транзакции
через общий хелпер `SessionRunner` (`backend/src/common/db/session-runner.ts`).
Требуется Replica Set (есть в `docker-compose.yml`).

- **Текущие пользователи (KEEP):** `common/eav/eav.service.ts`,
  `common/snapshot/snapshot.helper.ts`, `modules/category`,
  `modules/counter`, `modules/device-enrollment`.
- **Паттерн:** транзакция открывается в сервисе-владельце; вложенные сервисы
  принимают опциональный `externalSession?: ClientSession` и НЕ открывают
  собственный `startSession`/`withTransaction` (избегаем вложенных транзакций).
- _Примечание:_ исходные инвентарные пути (`shipment.dispatch`,
  `purchase-order.receive`, `order.ship`, `stock-movement`, `reservation`)
  удалены в рамках задачи H; хелпер остался платформенным механизмом
  атомарных записей для KEEP-доменов.


## Деньги (2026-10-19)

### `Income` (Доход — строка заказа) — коллекция `incomes`, модуль `modules/incomes`
| Поле | Тип | Заметки |
|--|--|--|
| orderId | ObjectId → salesorders | шапка заказа (З.1); поля шапки ниже — кэш, истина — шапка |
| lineNo | number | № позиции в заказе (при создании с orderId — следующий) |
| orderNo | string | № заказа (кэш шапки) |
| customer | string | заказчик текстом (карточки контрагентов — фаза 4) |
| companyId | ObjectId → organizations | наша компания (`isOurCompany`: СИЮ / ССЮ) |
| paymentForm | string | б/р, нал… |
| title | string, обяз. | наименование |
| qty, unit, unitPrice | number, string, number | |
| amountManual | number | «доход вручную» — важнее qty × unitPrice |
| productId | ObjectId → products | изделие «Продукции» (БЗ-5); при создании без него — подбор по короткому названию |
| kind, color | string | «Вид», «Цвет» листа |
| size | string | размер — вариант изделия (БЗ-5) |
| shipDate, paidDate | Date | отгрузка, оплата |
| notes | string | |
| **amount** | number | вычисляется сервисом: amountManual ?? qty × unitPrice |
| **reportDate** | Date | вычисляется: paidDate ?? shipDate — дата в платёжном календаре |
| clientUid, sheetSource, sheetKey, syncHash, editedInApp, source | | повтор / синхронизация таблиц (как у заявок) |
| importKey | string | ключ импорта Excel «компания\|номер\|наименование\|ед.» (`scripts/import-orders-xlsx.js`) |
| deletedWithOrder | boolean | удалена вместе с заказом — вернётся при его восстановлении |
| deletedAt, createdBy, createdAt, updatedAt | | soft-delete, аудит |

### `SalesOrder` (Заказ заказчика — шапка) — коллекция `salesorders`, модуль `modules/salesorders` (TASKS З.1)
Имя `orders` занято CRM kppdf — не трогаем. Позиции — `incomes` с `orderId`.
| Поле | Тип | Заметки |
|--|--|--|
| orderNo | string | № как в документе («34», «110-П», «10 Новороссийск»); уникален внутри нашей компании |
| companyId | ObjectId → organizations | наша компания (СИЮ / ССЮ); пусто — не определена (Спортсет, З.9) |
| customer, title | string | заказчик, предмет заказа/контракта |
| paymentForm | string | б/р, б/р 30%… |
| contractNo, contractDate | string, Date | контракт |
| shipDate, productionDeadline, deliveryDeadline | Date | отгрузка, срок изготовления, окончание поставки |
| stage | enum | new → production → ready → shipped → closed (+ cancelled); «в работе» = new/production/ready, «выполненные» = shipped/closed |
| notes | string | |
| importKey | string, unique sparse | «компания\|номер» (`order-key.ts`); ставится при создании и не меняется — по нему лист «Заказы» и импорт находят шапку |
| clientUid, source, editedInApp, importFiles | | повтор; google-sheets / import-xlsx; правилась в приложении — лист берёт поля из шапки |
| deletedAt, createdBy, createdAt, updatedAt | | soft-delete (вместе с позициями), аудит |
| priority | enum | ПРЖ-3: urgent / high / normal / low; нет = обычный; в кэш позиций не копируется |

### `DesignTask` (задача «Проектирования») — коллекция `designtasks`, модуль `modules/design` (ПРЖ-3)
Чертежи под позицию заказа или свободная задача. Срок и приоритет заказа в задачу не копируются — берутся при выдаче; цен нет.
| Поле | Тип | Заметки |
|--|--|--|
| seq | number | сквозной номер, код «D-N» (`nextSeq('DesignTask','D')`), unique |
| status | enum | queue / work (нужен исполнитель) / done / paused (нужна причина `pauseReason`) |
| orderId, incomeId, productId | ObjectId | заказ, позиция (incomes), изделие (products); у свободной задачи пусто |
| assigneeId | ObjectId → persons | исполнитель |
| title, note | string | своё название (иначе «Чертежи <артикул> ЗНП <№ заказа> поз <№>»), заметка |
| manual | {deadline?, priority?} | свои срок и приоритет; пусто — из заказа (срок изготовления → отгрузка) |
| completedAt, completedBy | Date, ObjectId | при done; пустой `products.designerId` получает исполнителя |
| openIncomeId | ObjectId | замок «одна открытая задача на позицию» (= incomeId, пока не done и не удалена), unique sparse |
| deletedAt | Date | корзина |

### `SupplyRequest.invoiceDate` (общая с kppdf `supplyrequests`)
Необязательное `Date` — дата счёта поставщика; расход в платёжном календаре ложится на неё. Раньше лежала строкой в `sheetExtra.invoiceDate`.

### Платёжный календарь — без своих таблиц
Расход = `supplyrequests` (invoiceDate, priceHint — сумма строки с НДС, companyId; status ≠ cancelled). Доход = `incomes` (amount > 0, reportDate). Всё, где чего-то не хватает, — в `/api/finance/needs-fill`.

## ProductPassport — поля паспорта v2 (БЗ-6, 2026-10-22)

Коллекция `productpassports` общая с kppdf — поля только добавлены, все необязательные; истина — `product-passport.schema.ts`, ТЗ — [PASSPORTS-V2.md](PASSPORTS-V2.md) §3.4.

| Поле | Тип | Смысл |
|--|--|--|
| `passportCategory` | `string` | DIO / DSP / TRN / WRK / MAF; пусто — паспорт v1 |
| `elements`, `materialIds` | `ObjectId[]` | записи справочников `dict_values` (`passportElements`, `passportMaterials`) |
| `installationTypeId` | `ObjectId` | `dict_values` (`passportInstall`) |
| `isKit` | `boolean` | поставляется разобранным |
| `ageFrom`, `ageTo`, `heightMin`, `heightMax`, `weightMax`, `maxUsers`, `fallHeight`, `siteLength`, `siteWidth`, `serviceLifeYears` | `number` | ограничения и техданные |
| `certificate` | `{ number, until, hasEac }` | сертификат / декларация |
| `manufacturerOrgId` | `ObjectId` | изготовитель, если не поставщик |
| `textSnapshot` | `object` | собранный текст на момент выдачи (разделы, описание, правила, ТО, монтаж, нормативы; правленые пункты — `edited`, `original`) |
| `note` | `string` | лист «Для заметок» (и v1) |
| `images[].kind` | += `overview_callouts`, `nameplate`, `safety_zone`, `foundation`, `holes`, `assembly`, `bom_item`; `images[].refCode` | |
| `bom[]` | += `size`, `mass`, `photoId` | |

Связанное: `products.passportDefaults` (значения по умолчанию у изделия каталога), `passporttemplates.category` (версия текста категории), справочники `dict_values` группы «Паспорта» (`passportCategories`, `passportStandards`, `passportElements`, `passportMaterials`, `passportDefects` (+`photoId`), `passportInstall`, `passportStyle`).

### Дополнения 2026-10-22 (БЗ-6 Э9)

| Где | Поле | Смысл |
|--|--|--|
| `organizations` | `fullName` | полное наименование для документов (паспорт: титул, талон; КП); нет — `name` |
| `productpassports` | `schemeSource` | `standard` (по умолчанию) — стандартные схемы способа установки, где своих нет; `own` — только свои |
| `dict_values` (`passportCategories`) | `requiredFields` | обязательные поля категории, по строке ключ поля |
| `dict_values` (`passportInstall`) | `schemesFoundation`, `schemesHoles`, `schemesMounting` | id фото стандартных схем узлов |
| `dict_values` (`passportDefects`, `passportStyle`) | `photoId` | id фото (в приложении — загрузка) |
| `passporttemplates` | `category = ALL_V2` | общая часть «Для всех» паспорта v2 (отдельно от шаблона PDF v1) |
### Дополнения 2026-10-24 (Фаза МИ — материалы изделия таблицей)

| Где | Поле | Смысл |
|--|--|--|
| `products` | `materialsSpec` | только data-core (CRM не читает): `{ rows: [{ materialId: ObjectId → passportMaterials, sizes: string[] (без «мм», одно написание: ∅89×3, 2), partIds: ObjectId[] → passportParts }], coatingIds: ObjectId[] → passportMaterials (kind coating) }`; пусто — `null`. Текст «Изготовлено из… Состоит из… <фраза покрытия>» собирается `common/catalog/materials-text.ts` |
| `productpassports` | `materialsSpec` | только data-core: та же форма, что у `products.materialsSpec`; снимок таблицы изделия с правкой (форма паспорта, «Подставить из изделия»); нет — у паспорта своей таблицы нет. У выпущенного меняется только «Новой редакцией» (прежняя — в `revisions[].data`) |
| `dict_values` (`passportMaterials`) | `kind`, `genSingular`, `genPlural`, `sizeTemplate`, `phrase` | material / coating (пусто — material); род. п. ед. / мн. ч. (по числу размеров); шаблон размера с `{sizes}` («толщиной {sizes} мм»); фраза покрытия |
| `dict_values` (`passportSortament`) | `name`, `material` | размер без «мм» + код материала (`passportMaterials.code`); дубль — пара «материал + размер» |
| `dict_values` (`passportParts`) | `name`, `genSingular`, `genPlural`, `categories` | часть изделия; в тексте — род. п. мн. ч. («Состоит из стоек…») |
