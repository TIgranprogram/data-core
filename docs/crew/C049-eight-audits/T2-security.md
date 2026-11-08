# T2 — Безопасность и права

**Охват:** RBAC (`jwt-auth.guard`, `permissions.guard`, `roles.guard`, `app-section.guard`, порядок в `app.module.ts:243-262`), машинные ключи `kppd_` (`key-scope.ts`, `jwt-auth.guard:105-114`), деньги (`MoneyMaskInterceptor`, `session.canMoney` в приложении), загрузка (`safe-path.ts`, `image-upload.options`, вложения по тикетам), XSS (`innerHTML` в pwa, CSP), заголовки (`main.ts`), секреты (redact в pino, `SecretValidationService`). Код не правил.

## Находки

| № | Где | Сценарий «что случится» | Совет | Важн. |
|--|--|--|--|--|
| 1 | `permissions-boot-validator.ts:46-91` + `roles.guard.ts:23` | Boot-скан проверяет только, что ключи `@Permissions` канонические, а не что у **каждого** не-`@Public` маршрута объявлено право. `RolesGuard`/`PermissionsGuard` без метаданных пропускают. Новый маршрут без `@Roles`/`@Permissions` — доступен любому вошедшему, включая роль «наблюдатель» (JwtAuthGuard останавливает лишь анонима). | Boot-скан/тест: у каждого хендлера есть `@Roles` или `@Permissions` или `@Public`/`@AppSectionFree`; иначе падение. | 🟡 |
| 2 | `key-scope.ts:55-67` | `isAdminRoute` — ручной список: `/api/admin`, `/api/roles`, `/api/users` (запись), `/api/desktop/pairing-keys`. Другие admin-эндпоинты (devlog, control, rate-limits, client-errors/top, health/disk\|security\|visits, audit-logs/app/users) в списке нет: read/write-ключ от админа до них дойдёт (роль владельца ключа = admin). | Единый признак «admin-маршрут» (декоратор) вместо ручного списка; тест на полноту. | 🟡 |
| 3 | `MoneyMaskInterceptor` на 14 контроллерах + ручная маскировка в `record-history.ts:12`, `work-facts`, `fill-audit`, `today` | Маскировка денег — не глобальная, а точечная. Новый эндпоинт с `amount/price` без интерсептора и без ручной маски → суммы увидит роль без права «Деньги». Тесты `roles-money.e2e-spec` есть, но «все money-поля покрыты» не проверяется. | Тест/линт: поле, помеченное `money:true`/деньгами, отдаётся только через маскирующий путь; или глобальный интерсептор по признаку поля. | 🟡 |
| 4 | `app-data.validation.ts:80-123,155-202` | P1 (JSON-хранилище) закрыт от NoSQL-инъекции: `sanitizeDocument` отбрасывает служебные поля и запрещает ключи с `$`/`.`; `parseFilter` — белый список операторов (`$where/$regex/$expr/$function` → 400); `parseSort`/`parsePagination` — по regex. | Не трогать; образец. | 🟢 |
| 5 | `safe-path.ts:15-20`, `image-upload.options`, вложения по тикетам | Загрузка: путь — только через `safeUploadPath` (regex + resolve + relative, `..` и %-кодирование отклоняются); mime-белый список без SVG, имена `uuid`; чертежи — по сигнатуре; вложения — по одноразовому тикету, `/uploads/attachments` статикой закрыт (`main.ts:129`). | Не трогать. | 🟢 |
| 6 | `main.ts:88-111`, `aviars.js:60` и др. `innerHTML` | CSP: `scriptSrc 'self'`, `scriptSrcAttr 'none'` (нет inline-скриптов/eval), HSTS на проде, `nosniff` на чертежах, CORS из env. Все `innerHTML` в pwa — только статичный SVG из кода (avatars/kit/catArt), данных пользователя нет. XSS-вектор закрыт. | Не трогать. | 🟢 |
| 7 | `jwt-auth.guard.ts:85-114`, `app.module.ts:243-262`, `permissions.guard.ts` | RBAC-лестница JWT→Permissions→Roles→AppSection глобально; неактивный пользователь/роль → 401; `isOwner` гидрируется сервером (не из JWT); иерархия ролей для денег; `X-Confirm-Token` на опасные DELETE/restore. | Не трогать. | 🟢 |
| 8 | `switch.controller.ts:24-75`, `qr`, `productattachments` | `@Public` — только ожидаемые точки: health, auth, QR 302, download-тикеты, `/control/switch/ping` и `/report` (report требует `X-Switch-Secret` из файла и отказывает через прокси); мутирующие switch-маршруты — `@Roles('admin')`. | Не трогать. | 🟢 |
| 9 | `app.module.ts:129-146`, `main.ts:43-70` | Секреты: redact в pino (authorization, x-api-key, password, token, secret, refreshToken), `SecretValidationService` падает на слабых секретах в prod, Sentry DSN только из env. | Не трогать. | 🟢 |

## Топ-3 и порядок исправления

1. 🟡 №1 — страховка «каждый маршрут объявил права» (дёшево, закрывает целый класс будущих дыр).
2. 🟡 №3 — тест на покрытие маскировки денег (риск утечки сумм ролям без права).
3. 🟡 №2 — единый признак admin-маршрута для key-scope (сейчас список ведётся руками).

## Сомнения

- `key-scope.ts:25-35` `normalizeKeyScope`: битый/пустой scope в БД → `full`. Осознанно (legacy-ключи), но новый ключ с ошибкой записи получит полные права. Стоит ли падать в `full` или дефолт в `read`?
- Публичные `POST /desktop/pairing` и device-enrollment: не проверял цепочку «одноразовый ключ/приглашение не выдаёт сессию без валидного секрета» — стоит посмотреть при доработке этих модулей.
