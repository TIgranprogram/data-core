# Исследование: API-поверхность и безопасность

> Часть архитектурного аудита 2026-10-22. Read-only скан `backend/src`. Секреты не выводились.
> Смежные отчёты: [Качество кода](./RESEARCH-CODE-QUALITY-2026-10-22.md), [Модель данных](./RESEARCH-DATA-MODEL-2026-10-22.md).

---

## 1. Инвентаризация API

**53 контроллера, ~338 HTTP-методов:** GET 141 · POST 100 · DELETE 48 · PATCH 36 · PUT 13.

### Топ «толстых» контроллеров

| Контроллер | Методов | Комментарий |
|--|--|--|
| `stock/stock.controller.ts` | **24** | самый широкий фасад; кандидат на вербальные роуты (`/movements`, `/reservations`) при следующей крупной правке |
| `product-passport/product-passport.controller.ts` | 18 | |
| `product/product.controller.ts` | 15 | |
| `supply`, `material`, `showcase`, `admin/users-admin`, `product-module` | по 12 | |

Контракт ответов `{items,total,page,limit}` и префикс `/api` — публичный, менять нельзя (AGENTS.md №1).

## 2. Public-роуты (без JWT)

Механизм: `@Public()` → `JwtAuthGuard`. Всего **~12 endpoint'ов** в 5 файлах:

| Где | Роуты | Оценка |
|--|--|--|
| `api-root`, `health` | `GET /api`, `/health/*` | норма |
| `auth.controller` | `register` (410 Gone), `login`, `refresh` | норма, login под `@Throttle` 5/мин |
| `desktop/compat` | `GET /desktop/compat` | норма |
| `device-enrollment.controller` | `enroll`, `session`, `status`, `auth-check` | **весь контроллер public, cookie-only** — критичный контур, покрыт rate-limit 6/мин на enroll |

Других байпасов JWT не найдено. Meta-контроллер (`/api/meta/*`) — «любому авторизованному» без `@Roles`/`@Permissions`: осознанное решение (самоописание API).

## 3. RBAC-покрытие

- `@Roles` — 304 использования, `@Permissions` — 55. 49 из 53 контроллеров содержат хотя бы один.
- Без явных прав (кроме public): `meta` (см. выше), `GET /rate-limits` в `rate-limit.controller` — read без ролей, удаление под admin/manager. Минимальный пробел: **GET списка rate-limit доступен любому залогиненному** — стоит добавить `@Roles('admin')` при следующем касании (не ломает клиентов, если они не читают этот роут вне админки).

Порядок guard'ов зафиксирован и документирован в `app.module.ts` (JWT → Permissions → Roles) — менять нельзя без ре-теста UX ошибок.

## 4. Security-скан: что нашлось и чего нет

**Чисто (0 находок):** `eval(`, `new Function`, `child_process`/`exec`/`spawn` в `backend/src`.

**Находки (не критичные, к разбору):**

| # | Находка | file:line | Оценка риска |
|--|--|--|--|
| 1 | Склейка пути `join(uploadDir(), storageUrl…)` без проверки на `..` при чтении/удалении | `product-passport/passport-pdf.service.ts:28-41`, `photos.service.ts:200-204` | **средний**: источник — `storageUrl` из БД (не query), но при компрометации БД/импорта CSV возможен path traversal. В `document-render.utils.ts` такая проверка **уже есть** (`SAFE_UPLOAD_URL_RE`, `includes('..')`) — нужно переиспользовать её в двух местах выше. |
| 2 | `express.json({ limit: '16mb' })` на `/api/apps` | `app-data.body-parser.ts` | низкий: осознанно (bulk), за rate-limit |
| 3 | `JSON.parse(readFileSync(GOOGLE_SA_FILE))` | `sheets-sync.service.ts:99` | низкий: путь из env, не из запроса |
| 4 | `as any` в проде auth — **нет**; в `last-admin.guard.ts:66` — один cast | | косметика |

## 5. Rate-limit и загрузка файлов

- Глобально: 10/с и 100/мин; `DISABLE_THROTTLE` в проде = стоп-бойт (защита от «отключил и забыл») — сильное решение, оставить.
- Точечные `@Throttle`: только login (5/мин, 20/ч) и device-enroll (6/мин, 30/ч). **Пробел:** остальные mutation-эндпоинты (особенно `POST /stock/*`, `POST /supply/*`, `POST /photos/upload`) живут только на общем 10/с — при штатной работе ок, при ошибочном цикле клиента быстрее упрётся в 100/мин, чем в per-route лимит. Не срочно.
- Multer: единые опции `photos/image-upload.options.ts` — 10 МБ, 1 файл, whitelist `jpeg|png|webp|gif|avif`, **SVG отклонён** (XSS), имя = `randomUUID()+ext`. Хорошая практика, задокументировать в CANON как обязательную для новых upload-точек (сейчас upload также в `organization.controller`).

## 6. Разнобой env-vars

- `configuration.ts` читает ~25 переменных (канон).
- **Снаружи `configuration.ts` напрямую `process.env` — ещё ~20 уникальных** (NODE_ENV, UPLOAD_DIR ×6, TRUST_PROXY, GOOGLE_SA_FILE, DESKTOP_*, HOST_DATA_DIR…).
- Не ломая ничего: при следующем касании соответствующего модуля переносить чтение в ConfigService; отдельный «big-bang» рефакторинг env не нужен.

## 7. Выводы и безопасные улучшения

| # | Действие | Ломает ли | Эффект |
|--|--|--|--|
| 1 | Переиспользовать `SAFE_UPLOAD_URL_RE` из `document-render.utils` в `passport-pdf.service` и `photos.service` (чтение/удаление) | нет (строже, не шире) | закрывает единственный реальный path-traversal вектор |
| 2 | Добавить `@Roles('admin')` на `GET /rate-limits` | почти нет (если только админка не ходит под non-admin) | закрывает info-leak списков лимитов |
| 3 | Зафиксировать в CANON: любой новый upload = копия `image-upload.options` (лимит + mime-whitelist + UUID-имя) | нет | единый стандарт |
| 4 | При ближайшем касании — `@Throttle` на «опасные» mutation stock/supply (аналогично login) | нет | защита от циклов клиентов |
| 5 | Не тащить env-чтение в ConfigService «сразу всюду» — только по касанию | нет | без лишнего шума в git |

Чего **не** делать: не включать строже CSP/HSTS без проверки PWA и админки (сейчас `style-src 'unsafe-inline'` нужен vanilla-JS админке); не убирать public device-enrollment без отдельного проектирования — это фича, не дыра.
