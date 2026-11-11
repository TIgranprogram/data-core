# A5 — Архитектура «как есть» (C068, 2026-11-11, HEAD f7d689f8)

Автор: роль architect. Метод: только чтение, `audit-cycles.js`, `git ls-files`, grep. Прод, стенд и e2e не трогались. «Предположение» помечено.

## 1. ARCH-PLAN: статус пунктов

| Пункт | Статус | Подтверждение |
|--|--|--|
| М1–М10 | закрыты | `[x]` в плане; `ThrottlerModule` app.module.ts:177; хелпер `common/uploads/` не вскрывался (предположение) |
| С1–С9 скорость | закрыты | `common/data-version`, `pwa-preload.mjs` |
| АБЗ-1 ядро/циклы | закрыт, цикл вернулся | 1 пара **design ↔ matching** (matching.module.ts:4, matching.service.ts:8 ← design; design-board.service.ts:10, design-present.ts:4, design.service.ts:10 ← `matching/matching-rules`) |
| АБЗ-2 тесты supply/incomes/roles | закрыт | spec: supply 9, incomes 1, permissions 1, role 3 |
| АБЗ-3 слой общих коллекций | **открыт** | нет `common/raw-query*`; 861 вызов `.collection(` в backend/src |
| АБЗ-4 фасады, sheets-sync | **устарел** | модуля `sheets-sync` нет; `index.ts` у модулей — 0 |
| АБЗ-5 разрезать stock | закрыт | `stock.service.ts` 118 строк |
| АБЗ-6 DTO и Swagger | открыт | все `[ ]` |
| АБЗ-7 ESLint-границы | открыт | `no-restricted-paths` нет; без АБЗ-4 смысла нет |
| АБЗ-8 группировка папок | открыт — предложено закрыть без действия | 72 папки плоско, выгода мала |
| АБЗ-9 PDF/ZIP | отложен | по жалобам |
| ОР-1 `base.css` на части | частично | `ui/screens.css` 1628 строк, `kit.css` 704; цель «≤ 400» не достигнута |
| ОР-2 `ui/list.js` | **устарел** | файла нет; теперь `ui/kit/list*.js` |
| ОР-3 facet-filter | открыт | `ui/facet-filter.js` есть |
| ОР-4 `esc`/форматы в `core/` | частично | `core/dom.js`, `core/format.js` |
| ОР-5 порог размера | закрыт в плане, **не соблюдается** | admin.js 1833, salesorders.js 730, main.js 664, requests.js 531 |
| ОР-6 pwa-тесты | открыт | 15 `*.test.mjs` на ~186 js |
| А1–А5 самообслуживание | закрыты | `modules/disk/integrity.ts`, /health/slow |
| А6, А7, Б5, Б6 | открыты | `[ ]` |
| Восстановление Д1–Д9 | открыты, кроме части | есть `restore-drill.sh`, `deploy/smb/offsite-smb.sh`, `deploy/backup-pull`; шифрование `age`, ротация 7/4/6 не найдены (предположение) |

## 2. C049: важные находки

| Находка | Статус | Подтверждение |
|--|--|--|
| 🔴1 Нет защиты от тихой перезаписи правок | **открыта** | TASKS.md:382 C049-1; `rev` только в my-tasks и order-line-plan |
| 🔴2 Сырые запросы без `deletedAt` | ложная тревога (DECISIONS №2), корень жив | нет АБЗ-3 |
| 🟡3 `ensure-indexes.js` — ручной список моделей | открыта | TASKS.md:383; `ensure-indexes.js:16` |
| 🟡4 Страж «у каждого маршрута объявлены права» | открыта | TASKS.md:384; `meta.controller.ts` без декораторов намеренно |
| 🟡5 Деньги точечно | открыта | вместе с №4 |
| 🟡6 Цикл incomes↔product-requests | закрыта | но появилась пара design↔matching |
| 🟡7 АБЗ-3 | открыта | см. выше |
| 🟡8 Ворота без проверки циклов | закрыта | `dc check`, шаг «циклы» |
| 🟡9 e2e race-набор | закрыта | `describe.skip` без БД |
| 🟡10 Офлайн-запись | в работе | TASKS.md:387 C051 |
| T7 №4 роли продублированы в `pwa/core/api.js:35-42` | не проверено | предположение: открыта |
| T7 №2 крупные файлы | открыта | п. 4 |

## 3. Свежесть карт

- Папок `modules/`: **72**. В app.module.ts все, кроме `document-render` (общий набор, норма). `DiskModule` и `ShowcaseModule` импортируются из `*.controller.ts` (app.module.ts:78–79) — долг «по касанию».
- MAP.md: упомянуты все 72 модуля; `document-render` — нет.
- data-model.md: из 74 коллекций схем **нет 41** (auditlogs, counterparties, expenses, materialrequests, reservations, stockmovements, storageitems, supplieritems, users и другие; часть — из-за разного написания имени). Вывод: документ — ориентир. Предложение: генерировать список из `GET /api/meta/schema`.

## 4. Здоровье кода

| Показатель | Значение |
|--|--|
| Модулей | 72; контроллер без прав: 1 (meta, намеренно) |
| Строк backend/src + pwa + admin (без spec) | ~41 000 |
| `forwardRef(` | 1 (desktop.module.ts) |
| Циклы между модулями | 1 пара (design ↔ matching) |
| Модули без spec | 10: attribute-definition, currency, entity-attribute-value, feature-flag, person, rate-limit, role-counterparty, role-org, status, stock-zones |
| Тесты | spec: product-passport 45, stock 18, showcase 14, dicts 13; pwa 15; e2e файлов 70 |
| Сырые `.collection(` | 861 |
| TODO/FIXME | 1 |
| `innerHTML` в pwa | 11 (в плане было 2) |
| `backend/scripts` | 149 файлов, разовых ≈ 90–100 |

Топ-20 файлов (строки): admin/admin.js 1833 · pwa/ui/screens.css 1628 · dicts.defs.ts 933 · supply.service.ts 822 · supply-invoice.service.ts 803 · product-passport.service.ts 757 · pwa/sections/salesorders.js 730 · pwa/ui/kit/kit.css 704 · device-enrollment.service.ts 682 · showcase.service.ts 677 · pwa/main.js 664 · collections-admin.controller.ts 588 · supplier-catalog.service.ts 569 · salesorders.service.ts 537 · pwa/sections/requests.js 531 · stock-movements.service.ts 510 · supply.controller.ts 484 · stock-mobile.js 481 · home.js 479 · incomes.service.ts 471.
Порог «≤ 500 строк» нарушают 8 серверных файлов; растут против C049 (supply.service 783→822, dicts.defs 896→933, supply-invoice 763→803).

Разовые скрипты — кандидаты в архив: c028-*, c054-*, c057-*, c061-*, c062-*, c063-*, c066-*, passport-fields-to-product, passport-images-to-product, passport-funnel-migrate, passport-install-method, passport-text-dupes, passports-to-v2, fix-bolt-photos, fix-sport-passports, migrate-maf-to-blg, rename-maf, weight-grams-to-kg, yougile-*, import-metal-stock, tz-photo-303-backfill-thumbs.ts, **drop-archive-collections, drop-empty-collections** (опасные). Оставить: audit-cycles, ensure-indexes, design-lint, check-map, review-scope, pwa-preload, timing-lists, orphan-uploads, data-audit-counts, mongo-bootstrap-auth, qa-*. Разовые также `deploy/synology/c054…c066*.sh`.

## 5. Риски

| Приор. | Риск | Где | Что делать |
|--|--|--|--|
| P0 | Тихая перезапись правок двух людей (заказ, позиция, заявка, счёт) | TASKS.md:382 | `rev` + ответ 409 |
| P0 | Нет шифрованной копии вне дома; секреты без шифрования | ARCH-PLAN Д1–Д3; `backup.sh:44–67` | решение владельца о месте + скрипт |
| P1 | Индексы не доезжают до прода | `ensure-indexes.js:16` | C049-3 |
| P1 | Нет стража прав на все маршруты | TASKS.md:384 | C049-4 |
| P1 | `/uploads/*` публичен (имена-UUID) | main.ts:131–140 | решить при первом закрытом типе файлов |
| P1 | 861 сырой запрос, правила «удалённое не показывать» у каждого свои | АБЗ-3 | слой доступа |
| P1 | Общий `admin` | предположение | решение владельца |
| P2 | Цикл design↔matching | п. 1 | `matching-rules` → `common/` |
| P2 | Крупные файлы растут; `admin.js` без порога | п. 4 | порог в design-lint |
| P2 | Склад `limit: 10000`, 1 ядро, туннель ~1 с | maps/architect.md:4 | серверная фильтрация |
| P2 | Переключение серверов не включено, refresh Sportin падал 3.11 и 6.11 | maps/architect.md:13–14 | отдельное решение |

## 6. Мусор в корне

| Папка | Что это | В git | Размер | Вердикт |
|--|--|--|--|--|
| `apps/` | `pdm-loader` (C#, C057) | 21 | 1,73 ГБ локально (сборка, игнор) | оставить |
| `mcp/` | MCP-сервер | 3 | 20 КБ | оставить |
| `tests_ai_tiit/` | оркестратор ночных тестов | 81 | 4,2 МБ | проверить на дубль `tools/night*`; кандидат в архив |
| `remote-access/` | выкладка с работы | 7 | 32 КБ | оставить |
| `SRV-ERP/` | второй сервер | 10 | 71 КБ | оставить |
| `данные для анализа и внедрения/` | xlsx каталога | 1 | 17 МБ | вынести из git |
| `задачи от Тиграна/`, `файлы Тиграна/` | txt и СТАРТ.md | по 1 | 40 КБ | в архив |
| `рисунки для разбора/` | пусто | 0 | 0 | удалить |
| `Заказы для оформления на сайт/` | рабочие файлы | 0 | — | в `.gitignore` (сделано 2026-11-11) |

## 7. Порядок исправления

| # | Цель | Класс | Что разблокирует |
|--|--|--|--|
| 1 | C049-4: страж «маршрут объявил права» | S | безопасность новых маршрутов |
| 2 | C049-3: `ensure-indexes` из реестра моделей | M | индексы на проде |
| 3 | Разорвать design↔matching | S | циклов 0 |
| 4 | Чистка репо: данные клиента из git, пустые папки, `tests_ai_tiit` | S | размер, риск утечки |
| 5 | Разовые скрипты → `scripts/archive/` | S | навигация, меньше опасных `drop-*` |
| 6 | Актуализация ARCH-PLAN / MAP / data-model | S | карты = правда |
| 7 | C049-1: `rev` + 409 | L | главный риск данных |
| 8 | Копия вне дома с шифрованием | M–L | восстановление |
| 9 | АБЗ-3: единый слой сырых запросов | L (серия M) | единые правила удаления |
| 10 | Пороги размера; разрезать supply-invoice, supply, product-passport, admin.js | M×4 | остановить рост |
| 11 | Spec для status, person, stock-zones | S | страховка перед 7 и 9 |
| 12 | АБЗ-6 DTO; АБЗ-7/8 переоценить или закрыть | L | контракт |

## Не проверено

`safeUploadPath`, число `@Query` без DTO, остаток `esc` в pwa, живое состояние прода и копий, связь `tests_ai_tiit` с `tools/night*`, работа `offsite-smb.sh`.
