# Исследование: качество кода, тесты, горячие точки

> Часть архитектурного аудита 2026-10-22. Read-only скан `backend/src`. Ничего не ломалось.
> Смежные отчёты: [API и безопасность](./RESEARCH-API-SECURITY-2026-10-22.md), [Модель данных](./RESEARCH-DATA-MODEL-2026-10-22.md).

---

## 1. Покрытие тестами по модулям

**Итого:** ~374 рабочих `.ts` / ~101 spec; в `modules/` — 72 spec на 50 модулей.

### Модули без единого unit-теста (16 из 50, ~32%)

`attribute-definition`, `counter`, `currency`, `entity-attribute-value`, `feature-flag`, `fill-audit`, **`incomes`**, `permissions`, `person`, `product-photo`, `rate-limit`, `role`, `role-counterparty`, `role-org`, `status`, **`supply`**.

**Приоритет на добивку** (бизнес-домен, объём операций, ручной ввод):
1. `supply` и `incomes` — ядро «Рабочего места», сейчас покрытие 0.
2. `permissions` / `role` / `role-counterparty` / `role-org` — RBAC, регрессия = 403/500 у всех клиентов.
3. `entity-attribute-value` / `attribute-definition` — EAV, хрупкая валидация типов.

### Фавориты по покрытию (для баланса)

`product-passport` (10), `admin` и `stock` (6), `photos` (5), `desktop` / `device-enrollment` / `showcase` (3).

## 2. Мёртвые / полумёртвые модули

- **Отрезанных от дерева импортов нет** — все 50 каталогов так или иначе используются.
- `catalog`, `document-render` — без `*.module.ts`: наборы файлов, импортируемые соседями напрямую. Не баг, но кандидаты на оформление как shared-kernel (`common/catalog/`, `common/doc-render/`).
- `disk` / `showcase` — `DiskModule` / `ShowcaseModule` импортируются из `*.controller.ts`, а не из `app.module.ts` по `*.module.ts` — косметическая неоднородность канона.
- Два файла используются **только разовыми скриптами через `dist/`**: `product-passport/passport-import.ts`, `stock/article-clean.ts`. Не мёртвый код, но стоит пометить в комментарии шапки файла («не рантайм, для scripts/»), чтобы будущий аудит не «чистил» их ошибочно.

## 3. Горячие точки (самые длинные файлы)

| Строк | Файл | Риск |
|--|--|--|
| **1052** | `modules/stock/stock.service.ts` | единственный «километр»; 24 метода в stock.controller |
| 632 | `modules/device-enrollment/device-enrollment.service.ts` | security-домен, сложный lifecycle |
| 519 | `modules/admin/collections-admin.controller.ts` | реестр коллекций + сырой доступ к БД |
| 475 | `modules/product-passport/passport-pdf-v2.ts` | генерация PDF |
| 440 | `modules/catalog-graph/catalog-graph.service.ts` | агрегация по materials/products |

Порог ≥250 строк — 21 файл. **Рекомендация (не ломает контракт):** при следующем касании `stock.service.ts` вынести под-домены (`stock-movements`, `stock-reservations`, `stock-search`) в отдельные сервисы внутри модуля — публичный `StockService` остаётся Facade.

## 4. TODO / FIXME / TZ-шум

- **TODO/FIXME/HACK во всём backend: всего 2 вхождения.** Кодовая база чистая в этом отношении — редкость.
- **TZ-метки (исторические ID задач kppdf): 489 вхождений в 166 файлах.** Топ: `auth.service.ts` (17), `main.ts` (16), `users-admin.controller.ts` (13).
  - Это не технический долг в коде, а **шум для будущих аудитов и ИИ** (агент может начать искать несуществующие TZ-доки).
  - Не ломая ничего: постепенно, по касанию файла, переводить «важное» из TZ-комментариев в обычные русские объяснения; чистку 489 меток пакетно не делать (историческая трассируемость).

## 5. Выводы и безопасные улучшения (мой приоритет)

| # | Действие | Ломает ли что-то | Эффект |
|--|--|--|--|
| 1 | Добавить юнит-тесты на `supply` и `incomes` (сейчас 0) | нет | закрывает самый большой тестовый пробел в активном домене |
| 2 | Вынести «километр» `stock.service.ts` на под-сервисы внутри модуля | нет (внутри модуля, API тот же) | снижает стоимость правок склада |
| 3 | Оформить `catalog/` и `document-render/` как shared-kernel с `index.ts` | нет (только пути импортов) | убирает «серые» прямые импорты файлов |
| 4 | Пометить «скриптовые» файлы (`passport-import`, `article-clean`) комментарием шапки | нет | защита от ложной чистки |
| 5 | Правило в CANON: новые модули workplace — со spec по умолчанию | нет | останавливает рост 32% «нулевых» модулей |

Чего **не** делать: не гнаться за 100% coverage на platform-модулях (`counter`, `setting`, `currency`) — там CRUD-обёртки, ценность теста минимальна.
