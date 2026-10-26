# Единая база: одна сущность — одна таблица (ЕБ.2, 2026-10-26)

Основа — подсчёт прода 2026-10-26 (ЕБ.1, только чтение): 102 коллекции, из них 54 пустые.
Решение пользователя (QUESTIONS ДМ-3): заказ один — наш; данные старой CRM kppdf тестовые; дублей быть не должно.

## 1. Карта: сущность → одна таблица

| Сущность | Таблица (единственная) | Записей | Что убрать / не использовать |
|--|--|--|--|
| Заказ | `salesorders` | 37 | `orders` (kppdf, 0), `productionorders` (0) |
| Позиция заказа | `incomes` | 143 | позиции внутри `orders.items` (kppdf) |
| Продукция (что делаем) | `products` | 302 | `productphotos` (0) — фото в `photos` |
| Модуль / узел | `products.composition[]` (строка `lineType: module`) | — | `productmodules` (0), `productmodulephotos` (0) — пустые, старые поля только читаем (ДМ-2) |
| Покупное, сырьё, метизы | `materials` | 267 | — (ДМ-1) |
| Остаток | `storageitems` | 265 | `materials.stockQty`, `products.stockQty` — только чтение (ДМ.5) |
| Движения склада | `stockmovements` | 157 | — |
| Бронь | `reservations` | 7 | — |
| Заявка поставщику | `supplyrequests` | 190 | `purchaserequests` (0), `purchaseorders` (0), `supplytasks` (0) |
| Каталог поставщика | `supplieritems` | 0 | наш модуль, пусто — ждёт загрузку прайса (не удалять) |
| Контрагент | `organizations` | 25 | `counterparties` (0) — старый модуль, удалить вместе с кодом |
| Паспорт | `productpassports` | 344 | — |
| КП | — (будет наша, ДМ.8) | — | `quotations` (0) |
| Производство | — (будет наше, ДМ.7, модель как в kppdf) | — | `ordertasks`, `workers`, `techprocesses`, `workorders`, `workorderoperations`, `workcenters`, `routingsteps` — все 0 |
| Сотрудники | `persons` + справочник видов работ `worktypes` | 5 / 9 | `workers` (0) |
| Шаблоны документов | `document_templates`, `doc_types` | 25 / 6 | оставить (данные есть) |

## 2. Список на удаление (ЕБ.3 — нужно «да» пользователя)

Все таблицы ниже **пустые (0 записей)**. Данные не теряются. Удаление — только порядок в базе.

**Группа А — код data-core их не использует (33 шт.), удалять сразу после остановки kppdf:**
actualcosts, cart_items, cart_sessions, catalogattachments, certificates, comments, compliancerules, desknotes, document_table_types, financial_reports, form_profiles, generated_documents, import_jobs, import_mapping_profiles, import_tasks, import_todos, interactions, inventorfiles, invoices, orderclosings, ordertasks, productionorders, purchaserequests, reconciliation_acts, routingsteps, rpps, shipments, studio_documents, supplytasks, techprocesses, template_blocks, tenders, text_blocks, workcenters, workorderoperations, workorders

**Группа Б — пустые, но код data-core на них ссылается (сначала правка кода, ЕБ.6):**
- `orders`, `quotations`, `purchaseorders`, `costcalculations`, `boms`, `workers` — проверка ссылок перед удалением изделия/материала (`common/catalog/catalog-references.ts:39–50`); убрать строки → удалить таблицы.
- `productmodules`, `productmodulephotos` — чтение старого состава (`showcase-composition.ts`, `common/catalog/product-module.schema.ts`); после ДМ.6.
- `counterparties`, `contracts` — старый модуль `counterparty` и права в сидах; удалить модуль → таблицы.
- `productphotos`, `attributedefinitions`, `entityattributevalues`, `organizationcontacts`, `sites` — модули data-core без данных; решить: удалить модуль или оставить на будущее.

**Не трогать:** `supplieritems` (наш каталог поставщика), `rate_limit_entries` (служебная, ограничение запросов), все таблицы с данными.

## 3. Порядок (из TASKS «ЕБ»)
1. ЕБ.3 — «да» пользователя на группу А (и отдельно — на группу Б).
2. ЕБ.4 — остановить kppdf на VM (`/opt/kppdf-8.0`, :3000). Иначе он заново создаст пустые таблицы при старте.
3. ЕБ.5 — свежий бэкап → удалить группу А скриптом (план → `--apply`, только если таблица пустая; иначе пропуск).
4. ЕБ.6 — правка кода по группе Б → удалить её таблицы тем же скриптом; переписать ARCHITECTURE «Единая база», AGENTS п.4.
