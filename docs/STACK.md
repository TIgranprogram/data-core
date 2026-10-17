# Stack — kppdf-8.0

> **Источник:** `frontend/package.json`, `backend/package.json`, `docker-compose.yml`.
> **Дата актуализации:** 2026-07-29.

---

## Summary

**Angular 20 standalone + Signals + OnPush** (frontend) + **NestJS 10 + Mongoose 8** (backend) + **MongoDB 7 Replica Set** (storage) + Docker Compose (infra).

**Дизайн-система:** **Paper & Ink** — editorial Swiss-minimalism на OKLCH-токенах:
- **Палитра:** OKLCH (`--color-paper`, `--color-ink`, `--color-rule`, `--color-accent-*`, `--color-destructive`)
- **Borders:** `hairline` (1px, `--color-rule`) — никаких `box-shadow` / `drop-shadow`
- **Focus-ring:** единый CSS-класс `pi-focus-ring`
- **Типографика:** системный стек + Inter / Hanken Grotesk / JetBrains Mono
- **Иконки:** Lucide (`lucide-angular`)
- **Тёмная тема:** через `oklch()` оверрайды на `[data-theme="dark"]`

> Stack нарочно **минималистичный**: никаких UI-фреймворков (Material, PrimeNG, AG Grid), никаких CSS-in-JS, никаких сторонних chart-библиотек. Paper & Ink — собственные тонкие обёртки над TailwindCSS v4 + OKLCH. Angular Material заменён на кастомные `shared/ui/*` компоненты, которые дают полный контроль над дизайном без борьбы с MD3 tokens.

---

## 1. Frontend (`frontend/`)

| | |
|--|--|
| **Framework** | Angular 20.3 (standalone components, Signals, OnPush — **strict**) |
| **Design system** | **Paper & Ink** — OKLCH palette, hairline borders, anti-bling |
| **Styling** | **TailwindCSS v4** + PostCSS + CSS custom properties (`--color-*`) |
| **Icons** | `lucide-angular@0.460` (tree-shakable, Lucide icon set) |
| **Editor** | `@tiptap` 3.27 — core + starter-kit + color, font, highlight, underline extensions |
| **State** | Angular Signals (**нет** NgRx / RxJS-store / Zustand) |
| **HTTP** | **silent-http** wrappers (`silentGet/Post/Patch/Delete`) + **httpResource** (signals-based data fetching) |
| **DSL** | `defineEntity<T,P>()` — CRUD-фабрика; `SubmitGuard` — anti-double-submit; `IdempotencyInterceptor` — idempotency-key |
| **Toast** | `PiToastService` (Sonner-style singleton, auto-dismiss, a11y roles) |
| **Progress** | `PiProgressComponent` — linear + circular, SVG-based |
| **Skeleton** | `PiSkeletonComponent` — static hairline blocks, NO shimmer/pulse |
| **Avatar** | `AvatarComponent` — image → initials → Lucide fallback chain |
| **Separator** | `PiSeparatorComponent` — hr OR label-on-line |
| **ScrollArea** | `PiScrollAreaComponent` — themed hairline scrollbar |
| **Charts** | `PiChartComponent` — **pure-Angular SVG** (NO d3, NO ngx-charts — pnpm install failed, shipped pure-TS fallback) |
| **Dialog** | `PiDialogService` — closure-local overlay refs, `parentDestroyRef` auto-close, RAF first-mount repositioning |
| **Forms** | Reactive Forms + `class-validator` (shared DTOs) |
| **Fonts** | Inter + Hanken Grotesk + JetBrains Mono Variable (via `@fontsource`) |
| **Markdown** | `marked@18` + `highlight.js@11` (code block highlighting) |
| **State mgmt** | **Angular Signals only** (no Redux, no RxJS store) |
| **TypeScript** | 5.9 strict + `noPropertyAccessFromIndexSignature: true` |
| **Tests** | Jest — **242** unit tests, **21** suites (TZ-83) |
| **Audit** | `axe-core` + lighthouse CI (`@lhci/cli`) |
| **Circular deps** | `madge` (CI gate) |
| **Package manager** | **pnpm ≥ 9** (тестировалось на 11.x) |

### Структура

```
src/
  app/
    core/                 ← Auth, interceptors (idempotency, auth), silent-http, API tokens
    layout/               ← AppLayout (auth shell), KitLayout (UI showcase)
    pages/                ← Business pages (materials/, inventory/, products/, builder/, …)
    shared/
      dsl/                ← DSL: defineEntity, entity-list, submit-guard
      ui/                 ← Paper & Ink primitives (24+ компонентов)
        button/
        card/
        dialog/
        table/
        toast/
        progress/
        skeleton/
        avatar/
        separator/
        scroll-area/
        form-field/
        input/
        ...
      page/               ← Page primitives (pi-page-header, pi-section, pi-toolbar)
      services/           ← hand-written services (не-DSL)
      util/               ← search, format, lookup-table, on-dialog-close-once
      command/            ← ⌘K command palette
      theme/              ← Live OKLCH theme editor
      code/               ← Code preview component
      playground/         ← Interactive playground
  styles.css              ← TailwindCSS v4 + OKLCH palette + hairline utils
```

### Скрипты

```bash
pnpm start            # ng serve (dev, :4200)
pnpm build            # ng build (prod)
pnpm typecheck        # tsc -p tsconfig.app.json --noEmit
pnpm test             # jest
pnpm lint             # eslint
pnpm format           # prettier
pnpm analyze          # source-map-explorer
pnpm circular         # madge (circular deps check)
pnpm audit:a11y       # axe-core audit (tsx scripts/audit-a11y.ts)
pnpm lighthouse       # lighthouse CI
```

### Архитектурные решения (frontend)

| Решение | TZ | Обоснование |
|--|--|--|
| **Standalone components** | TZ-19 | Без NgModule boilerplate; tree-shakable imports |
| **Signals everywhere** | TZ-19 | Локальный state (loading/total/form) без RxJS-store |
| **OnPush по умолчанию** | TZ-19 | ChangeDetection.OnPush на каждом компоненте |
| **Paper & Ink (NOT Material MD3)** | TZ-68..104 | Полный контроль над дизайном; MD3 tokens негибкие; `@angular/material` removed from deps |
| **TailwindCSS v4** | TZ-68 | Utility-first CSS; OKLCH palette через `--color-*` токены |
| **Lucide icons** | TZ-68 | Tree-shakable, consistent 24px stroke icons |
| **silent-http pattern** | TZ-105.3 | Observable никогда не ошибается; `res.ok` / `res.error` без console.error |
| **httpResource** | TZ-232.A | Signal-зависимый data fetching; авто-перезапрос при изменении параметров |
| **defineEntity DSL** | TZ-232.C | Фабрика CRUD-сервисов; InjectionToken singleton |
| **SubmitGuard + IdempotencyInterceptor** | TZ-232.A | 3 уровня защиты от двойного сабмита (debounce → in-flight → cache) |
| **Pure-TS charts (NO d3)** | TZ-66 | pnpm install d3/ngx-charts failed; shipped 2 pure-Angular SVG components |
| **TipTap editor** | TZ-86 | Document constructor текстовых блоков |

---

## 2. Backend (`backend/`)

| | |
|--|--|
| **Framework** | NestJS 10.3 (Mongoose 10 adapter) — **19+ feature modules** |
| **Database** | MongoDB 7+ (**Replica Set `rs0`** обязателен — `session.withTransaction` для counters) |
| **Auth** | JWT (access 15m + refresh 7d, `refreshTokenVersion` bump), bcryptjs (10 rounds) |
| **Rate limiting** | `@nestjs/throttler` — глобально 10 req/s + sensitive endpoints 5/min, 20/hour |
| **Validation** | `class-validator` + `class-transformer` (DTO whitelist, forbidNonWhitelisted) + `joi` (env) |
| **Logging** | `nestjs-pino` (структурный JSON) + `pino-http` request middleware |
| **Security** | `helmet` + `cors` + `compression` + CORS multi-origin via env var |
| **API docs** | `@nestjs/swagger` (OpenAPI 3) — **default-off в prod** |
| **TypeScript** | 5.4 strict |
| **Tests** | Jest — unit + e2e (10 e2e suites — TZ-83) |
| **DI audit** | `scripts/audit-di.ts` — статический анализатор DI cascade багов |
| **Package manager** | **pnpm ≥ 9** (тестировалось на 11.x) |

### Структура модуля

```
backend/src/modules/<name>/
├── dto/
│   ├── create-<name>.dto.ts
│   └── update-<name>.dto.ts
├── <name>.schema.ts          ← Mongoose @Schema({ timestamps: true })
├── <name>.service.ts         ← бизнес-логика + findAll({ page, limit, search })
├── <name>.controller.ts      ← @Controller() + @Roles() + @AuditAction()
└── <name>.module.ts          ← @Module({ imports: [...], providers: [...] })
```

### Архитектурные решения (backend)

| Решение | TZ | Обоснование |
|--|--|--|
| **Replica Set обязателен** | TZ-03 | Counter / Inventory / Shipment используют `session.withTransaction` |
| **AsyncLocalStorage → Mongoose `$locals.userId`** | TZ-04 → TZ-03 | AuditPlugin читает контекст без явной передачи по сервисам |
| **`@AuditAction()` глобальный interceptor** | TZ-05 | Все POST/PATCH/DELETE автоматически логируются с userId |
| **Production-safe soft-delete через плагин** | TZ-03 | Не отключать в prod; unique-index + `deletedAt: null` |
| **NO Vector DB / semantic search** | TZ-105.1 | MongoDB regex indexes достаточно для structured-fact-lookup |
| **JWT versioning (refreshTokenVersion)** | TZ-04 | Password change / logout → инвалидация всех refresh tokens |
| **DTO whitelist defense-in-depth** | TZ-91 | `@Roles()` guard + DTO-level `@IsIn(['user','manager'])` блокирует admin |

### Список entity (19+ modules, 70+ entities)

`Auth`, `User`, `Role`, `Permissions`, `Setting`, `FeatureFlag`, `Status`, `AuditLog`, `Organization`, `OrganizationContact`, `Counterparty`, `Person`, `Interaction`, `Category`, `Unit`, `Material`, `Product`, `ProductModule`, `ProductPhoto`, `Bom`, `WorkType`, `WorkCenter`, `Worker`, `RoutingStep`, `TechProcess`, `WorkOrder`, `WorkOrderOperation`, `Order`, `OrderTask`, `Warehouse`, `StorageItem`, `StockMovement`, `Reservation`, `Currency`, `Invoice`, `Tender`, `Rpp`, `CartItem`, `DocType`, `TemplateBlock`, `TableTemplate`, `TextBlock`, `DocumentTableType`, `Comment`, `RateLimit`, `AttributeDefinition`, `EntityAttributeValue`, `Certificate`, `ComplianceRule`, `ProductPassport`, `PurchaseRequest`, `ReconciliationAct`, `FinancialReport`, `CostCalculation`, `ActualCost`, `OrderClosing`, `ProductionOrder`, `PurchaseOrder`, `Shipment`, `Contract`, `Quotation`, `ImportJobs`, `Photos`, `InventorFile`, `GeneratedDocument`, `DocumentTemplate`, `Registry`, `Counter`, `Health`

---

## 3. Infrastructure

### Docker services

| Service | Image / Source | Port | Notes |
|--|--|--|--|
| MongoDB | `mongo:7` (Replica Set `rs0`) | 27017 | Обязателен — counters/transactions |
| mongo-init | `mongo:7` (init replica set) | — | `restart: "no"`, завершается после инициализации |
| Backend | локально (через `start.mjs` spawn) | 3000 | NestJS в dev mode (`pnpm start:dev`) |
| Frontend | локально (через `start.mjs` spawn) | 4200 | Angular dev server (`ng serve --host 0.0.0.0`) |

**Compose file:** `docker-compose.yml`

### Local starter

**Файл:** `start.mjs` (Node 20+ ESM, ~550 строк, без внешних deps)

```bash
node start.mjs                   # полный запуск
node start.mjs --tail            # TUI-режим (in-place статус 3 сервисов)
node start.mjs --check           # только pre-flight
node start.mjs --stop            # остановить процессы
node start.mjs --reset           # docker down -v + rm node_modules
node start.mjs --no-browser      # без авто-открытия браузера
node start.mjs --prod            # production: build + serve
```

**Что делает:**
1. Pre-flight: Node 20+, pnpm 11+, Docker daemon, `.env`, порты
2. `docker rm -f kppdf-mongo` + `docker compose up -d mongo mongo-init`
3. Ждёт `rs.status().ok === 1`
4. `pnpm install` в `backend/` + `frontend/` (если нужно; auto-approve build scripts при `ERR_PNPM_IGNORED_BUILDS`)
5. `pnpm start:dev` (backend :3000) + `pnpm start` (frontend :4200)
6. Polls `/api/health` + `GET /` до готовности
7. Открывает браузер на `http://localhost:4200`
8. Ctrl+C → чистая остановка (Mongo остаётся)

---

## 4. Cross-cutting

- **Runtime:** Node.js ≥ 20
- **Package manager:** **pnpm ≥ 9** (НЕ npm/yarn; тестировалось на 11.x)
- **TypeScript:** strict mode (frontend 5.9 + `noPropertyAccessFromIndexSignature`, backend 5.4)
- **Lint / Format:** ESLint + Prettier
- **i18n:** все API тексты — на русском; UI — через токены
- **Security:** defense-in-depth: JWT guard → Roles guard → DTO whitelist → Rate limit → Audit trail
- **Запрещено:** Vector DB, `@Input()`, constructor DI, `*ngIf`/`*ngFor`, `subscribe({ next, error })`, `any`, `box-shadow`, `#[hex]`, `bg-white`

---

## 5. Основные UI primitives (Paper & Ink — `shared/ui/`)

Полная документация: `docs/paper-and-ink.md`, `docs/AI-AGENT-GUIDE.md`

> Всего 24+ primitives. В таблице — основные 16. Остальные: `RowActions`, `Badge`, `Pagination`, `EmptyState`, `DashedPanel` и др.

| Компонент | Файл | Назначение |
|--|--|--|
| `PiTableComponent` | `shared/ui/pi-table.component.ts` | Data table с сортировкой, пагинацией, selection, sticky cols |
| `PiPageHeaderComponent` | `shared/page/pi-page-header.component.ts` | Стандартный H1 заголовок страницы |
| `PiSectionComponent` | `shared/page/pi-section.component.ts` | Секция с eyebrow + hint |
| `PiToolbarComponent` | `shared/page/pi-toolbar.component.ts` | Toolbar (search + action buttons) |
| `ButtonComponent` | `shared/ui/button/` | Paper & Ink кнопки |
| `PiCardComponent` | `shared/ui/card/` | Card контейнер |
| `PiDialogService` + comps | `shared/ui/dialog/` | Dialog система (form, alert, destructive) |
| `PiToastService` | `shared/ui/toast/` | Sonner-style toast |
| `PiProgressComponent` | `shared/ui/progress/` | Hairline linear + circular |
| `PiSkeletonComponent` | `shared/ui/skeleton/` | Static placeholder blocks |
| `AvatarComponent` | `shared/ui/avatar/` | Image → initials → Lucide fallback |
| `PiSeparatorComponent` | `shared/ui/separator/` | hr OR label-on-line |
| `PiScrollAreaComponent` | `shared/ui/scroll-area/` | Themed hairline scrollbar |
| `PiChartComponent` | `shared/ui/pi-chart.component.ts` | Chart wrapper |
| `PiBarChartComponent` | `shared/ui/charts/` | Bar chart (pure SVG) |
| `PiLineChartComponent` | `shared/ui/charts/` | Line chart (pure SVG) |
| `FormFieldComponent` | `shared/ui/form-field/` | Form field wrapper |
| `InputComponent` | `shared/ui/input/` | Input control |

---

## 6. DSL слой (`shared/dsl/`)

| Компонент | Файл | Назначение |
|--|--|--|
| `defineEntity<T,P>()` | `shared/dsl/entity/entity-service.ts` | Фабрика 5-CRUD сервисов |
| `paramsToHttpParams()` | `shared/dsl/entity/entity-service.ts` | Преобразование params → HttpParams |
| `PaginatedResponse<T>` | `shared/dsl/entity/entity-service.ts` | Generic paginated envelope |
| `PiEntityListComponent` | `shared/dsl/entity-list/entity-list.component.ts` | Reusable list page (pagiation, search, sort) |
| `SubmitGuard` | `shared/dsl/submit-guard.ts` | Anti-double-submit (3 уровня: debounce → in-flight → cache) |
| `IdempotencyInterceptor` | `core/idempotency.interceptor.ts` | Idempotency-Key header на POST/PATCH/DELETE |

---

## 7. Quickstart

```bash
# Полный запуск (Mongo + backend + frontend + browser)
#   start.cmd — Windows-обёртка (вызывает start.mjs)
#   start.sh — Unix-обёртка
#   start.mjs — единый entry point (Node 20+, без внешних deps)
.\start.cmd              # Windows
./start.sh                # Unix
node start.mjs            # напрямую

# Режимы
node start.mjs --check    # только pre-flight
node start.mjs --prod     # production: build + serve
node start.mjs --tail     # TUI-режим
node start.mjs --stop     # остановить процессы
node start.mjs --no-browser

# Login: admin / admin123 (username, НЕ email)
# Frontend: http://localhost:4200
# Backend:  http://localhost:3000/api/health
# Swagger:  http://localhost:3000/docs
```

---

## 8. Архитектурные решения (полная таблица)

| Решение | TZ | Статус |
|--|--|--|
| Mongoose Replica Set → atomic counters / transactions | TZ-03 | ✅ |
| AsyncLocalStorage → user context для audit | TZ-04 → TZ-03 | ✅ |
| Audit-action interceptor глобально | TZ-05 | ✅ |
| Soft-delete plugin (auto-filter `deletedAt: null`) | TZ-03 | ✅ |
| **Paper & Ink (NOT Material MD3)** | TZ-68..104 | ✅ |
| **TailwindCSS v4 + OKLCH palette** | TZ-104 | ✅ |
| **silent-http для всех HTTP** | TZ-105.3 | ✅ |
| **NO Vector DB / semantic search** | TZ-105.1 | ✅ |
| **defineEntity DSL** | TZ-232.C | ✅ |
| **SubmitGuard + IdempotencyInterceptor** | TZ-232.A | ✅ |
| **PiEntityListComponent** | TZ-232.C | ✅ |
| Production-ready docker-compose | TZ-02 | ✅ |

---

## 9. Что это НЕ

- **НЕ** task tracker → `OrchestratorKit/STATUS.md`
- **НЕ** changelog / release notes → git log + tags
- **НЕ** API documentation → OpenAPI из `@nestjs/swagger` (Swagger UI на `/docs` в dev)
- **НЕ** dependency manifest → `frontend/package.json`, `backend/package.json`
- **НЕ** deployment manifest → `docker-compose.yml`
- **НЕ** design doc → `ARCHITECTURE.md` + `docs/data-model.md`

---

_Актуализирован 2026-07-29. При изменении стека — обновить эту таблицу._
