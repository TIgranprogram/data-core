# `backend/` — место для backend-кода

> ⚠️ **Эта папка будет наполнена агентом через TZ-задачи из `tasks/`.**
> **НЕ ТРОГАЙ вручную** — только отдавай TZ агенту.

## Текущее состояние

Папка пуста потому что ни один TZ ещё не выполнен.

## Что здесь будет

| Файл | Назначение | Когда появится |
|------|------------|----------------|
| `package.json` | Node.js manifest | TZ-01 (тестовая) |
| `server.js` | HTTP-сервер (пока минимальный) | TZ-01 (тестовая) |
| `src/main.ts` | Точка входа NestJS | TZ-02+ (после выбора стека) |
| `src/modules/*` | NestJS модули по доменам | TZ-NN по доменам из `docs/data-model.md` |
| `Dockerfile` | Контейнеризация | Когда дойдём до deploy |

## Workflow

1. Берёшь файл из `tasks/TZ-NN-что-делать.md`.
2. Отдаёшь его AI-агенту вместе с этим `README.md` (для контекста).
3. Агент создаёт/изменяет файлы в этой папке согласно TZ.
4. По завершении агент удаляет TZ-файл из `tasks/`.
5. Я вижу что `tasks/` пустая → кладу следующую задачу.

## Security & Admin setup (TZ-91 Phase D docs sync)

### ADMIN_PASSWORD

- **Требование:** минимум **8 символов**. Длина < 8 → **`admin.seed.ts`** логирует `WARN` и **НЕ создаёт admin user** в `OnApplicationBootstrap`. Bootstrap продолжает работать (WARN+SKIP pattern, не hardcoded fallback) — но admin login fails до manual fix.
- **Default в `.env`:** `ADMIN_PASSWORD=admin12345678` (≥8, bootstrap-safe для dev). Override:
  ```bash
  ADMIN_PASSWORD=<your-strong-password>
  ```
- **Rotate:** bump `user.refreshTokenVersion` через `POST /api/users/:id/change-password` — инвалидирует все existing refresh-tokens (force re-login).
- **First-bootstrap flow:** clean DB → `PermissionsSeed` upserts 30+ permissions → `RolesSeed` upserts 3 system roles (admin/manager/user) → `AdminSeed` проверяет `ADMIN_PASSWORD.length >= 8` → если да, создаёт admin user (`username: 'admin'`, `role: 'admin'`). Если нет — WARN + skip, manual fix via direct DB insert или reinstall с stronger password.

### JWT Secrets

- **Default в `.env`:** `JWT_SECRET=<random>` + `JWT_REFRESH_SECRET=<random>`. **НЕ коммитить** — `.gitignore` исключает `.env` (git-ignored working-tree changes).
- **Production generation:**
  ```bash
  openssl rand -hex 32
  ```
  Скопируйте output в `.env` как `JWT_SECRET` (64-char hex) и отдельно для `JWT_REFRESH_SECRET` (другой 64-char hex). **НЕ переиспользуйте access-secret для refresh-secret.**
- **`start.mjs` dev-secret warning** (TZ-91 Phase C, planned): `node start.mjs` показывает `⚠️ JWT_SECRET looks like a development value. Generate one with: openssl rand -hex 32` если `.env` содержит `dev` или `do-not-use` substring — ненавязчивое напоминание что dev-secrets не должны идти в prod. Не блокирует startup.

### CORS multi-origin

- **TZ-91A6 format** — comma-separated list в `.env:CORS_ORIGIN`:
  ```bash
  CORS_ORIGIN=http://localhost:4200,http://localhost:3000
  ```
  `.trim()` + `.filter(Boolean)` — trailing commas и spaces вокруг commas handled graceful. Single-origin: `CORS_ORIGIN=https://app.your-domain.com` (без comma).
- **Legacy fallback:** `CORS_ORIGINS` (plural) читается если `CORS_ORIGIN` не задан. Migration path: replace `CORS_ORIGINS` → `CORS_ORIGIN` (plural deprecated).
- **Production:** `CORS_ORIGIN=https://app.your-domain.com,https://admin.your-domain.com` (multi-origin) — каждый origin echoes точно (CORS-spec requires exact origin match for credentials=true).

### Rate-limit

- **Global** (TZ-18 base): `ThrottlerModule.forRoot({short: 10/sec, long: 100/min})` — applies ко всем endpoints через `@nestjs/throttler`.
- **`/auth/login` override** (TZ-91A3): `@Throttle({short: {ttl: 60_000, limit: 5}, long: {ttl: 3_600_000, limit: 20}})` → 5 req/min, 20 req/hour per IP. Brute-force protection.
- **Dev-mode override** (TZ-91 §5 Risk 2 — future): `@SkipThrottle()` per-handler можно добавить с условным `process.env.NODE_ENV === 'development'` — для удобства debugging когда rate-limit мешает dev iterations.

### RBAC Sweep — Phase B (planned)

- **ГОТОВО через TZ-91A:** register DTO whitelist + login `@Throttle` + admin seed password gate + CORS multi-origin. **5 changes shipped в `4a2d6bd`.**
- **IN PROGRESS:** TZ-91 Phase B — `@Roles('admin','manager')` sweep на все write endpoints в **73 controllers**. Создаётся `backend/scripts/audit-roles-coverage.ts` для статического analysis output → manual `@Roles()` decorator apply per batch (1-2 atomic commits, Layer 2 SERIAL).
- **Acceptance criteria:** `audit-roles-coverage.ts` reports **0 missing** на всех 73 controllers (write endpoints only).

### Swagger Gating — Phase C (planned)

- **Default (pre-TZ-91C):** Swagger UI available on `/docs` в dev mode (TZ-86 era).
- **TZ-91 Phase C change:** `if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true')` gate — production hardening. Public API documentation = API leak aggregation (endpoint structure expose), поэтому default-off в prod. Escape hatch: `SWAGGER_ENABLED=true node dist/main.js` если prod-debug нужен.

### 🛡️ Что НЕ покрыто в TZ-91 (DEFERRED таблица)

| Feature | Future TZ | Статус |
|---------|-----------|--------|
| `@Public()` remove on `/register` (A.2) | **TZ-91-extension** | DEFERRED — ждёт admin-invite-flow implementer |
| `POST /api/users/invite` (admin invite user) | TZ-91-extension | DEFERRED — unblocks A.2 |
| Account lockout after N consecutive failures | TZ-91-extension | DEFERRED — rate-limit (5/min) covers brute-force but not targeted enumeration |
| Username enumeration prevention (`/login` same-error для invalid-user vs wrong-password) | future TZ | DEFERRED — security deep-dive |
| JWT secret rotation tooling | future TZ | DEFERRED — manual `ADMIN_PASSWORD` rotation works, но tooling nice-to-have |
| MFA / TOTP | future TZ | OUT-OF-SCOPE MVP |
| SSR/session cookies (replace JWT) | future TZ | OUT-OF-SCOPE MVP |

**Reference:** полная спецификация в `tasks/_archive/2026-07/TZ-91.md.done` (после Phase B+C completion) → сейчас lives в commit history `23d7793` (spec) + `4a2d6bd` (Phase A).
