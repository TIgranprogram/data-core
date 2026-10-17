# Architecture — kppdf-8.0

> Корневой архитектурный документ.
> **Не читать целиком при startup.** Сначала `docs/PROJECT-MEMORY.md` и
> `docs/DOMAIN-MAP.md`, затем только релевантную секцию/модуль.

**Быстрая карта доменов:** `docs/DOMAIN-MAP.md` (домен → BE module → FE route → page.md → SoT docs).

## Local Team Room (2026-08-01)

`OrchestratorKit/team-room/` — локальный coordination layer для параллельных coding agents. Это dependency-free Node.js standard-library сервис, который слушает только `127.0.0.1`, хранит repository-scoped JSON state вне worktrees и переиспользуется всеми linked worktrees одного Git repository.

- **Startup:** первый `join` запускает room, последующие `join`/`open` используют тот же процесс; owner открывает browser dashboard только через `open`.
- **Coordination:** registration/heartbeats, task sync, atomic claim с `CONFLICT KEYS`, durable task/direct messages, activity feed и stale lease recovery.
- **Lifecycle safety:** atomic writer lock с repo identity и legacy/stale recovery; `claim` запускает detached watcher, `release`/`complete`/`stop` очищают marker и process tree.
- **Interface:** CLI (`join`, `status`, `claim`, `heartbeat`, `watch`, `send`, `inbox`, `release`, `complete`, `stop`), Windows `.cmd`, POSIX `.sh`, static responsive dashboard.
- **Boundary:** это asynchronous local coordination, не remote chat и не mechanism для wake-up остановленного AI runtime.
- **Evidence:** `tasks/_archive/2026-08/TZ-TEAM-ROOM.done.md`; 23/23 Node tests, lifecycle PASS, CDP desktop/mobile PASS.

## 1. Общая схема

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                                │
│   http://localhost:4200 (dev) / :4200 (prod static server)   │
└──────────┬──────────────────────────────┬────────────────────┘
           │ Angular 20 SPA                 │ proxy.conf.json (dev)
           │ standalone + signals + OnPush  │ /api/* → :3000
           │ Paper & Ink design system      │ /uploads/* → :3000
           ▼                                ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│  Frontend (Angular)  │   │  Backend (NestJS 10)             │
│  src/app/            │   │  src/                             │
│  ├── core/           │   │  ├── app.module.ts (18 modules)   │
│  │   auth, guard,    │   │  ├── common/ (guards, interceptors│
│  │   interceptor     │   │  │   plugins, decorators, seeds)  │
│  ├── layout/         │   │  ├── config/ (env validation)     │
│  │   app-layout,     │   │  ├── database/ (connectionFactory,│
│  │   kit-layout      │   │  │   softDelete, audit, userContext)│
│  ├── pages/          │   │  ├── health.controller.ts         │
│  │   materials,      │   │  └── modules/ (72 schema files,     │
│  │   organizations,  │   │      auth, product, material,     │
│  │   dictionaries,   │   │      order, warehouse, tender,    │
│  │   login,          │   │      document-template, ...       │
│  │   overview,       │   └──────────────────────────────────┘
│  │   foundations, ...│               │
│  ├── shared/         │               ▼
│  │   ui/ (24+ comps) │   ┌──────────────────────────────────┐
│  │   page/ (header,  │   │  MongoDB 7 (Replica Set rs0)     │
│  │   section, demo)  │   │  docker compose up -d mongo       │
│  │   command/ (⌘K)   │   │  port 27017                       │
│  │   theme/ (editor) │   └──────────────────────────────────┘
│  │   code/ (preview) │
│  │   playground/     │
│  └── app.routes.ts   │
│      /login (public) │
│      /kit/* (public) │
│      /* (auth)       │
└──────────────────────┘
```

**Технологии:**
- Backend: NestJS 10 + Mongoose 8 + MongoDB 7 Replica Set
- Frontend: Angular 20 standalone + TailwindCSS v4 + Lucide icons
- Design system: Paper & Ink (OKLCH, hairline borders, no shadows)
- Auth: JWT (access 15m + refresh 7d), bcryptjs, RBAC
- Infra: Docker Compose (Mongo), `start.mjs` (cross-platform orchestrator)

## 1a. Границы импортов (gate)

- Канон режимов/capabilities: `docs/AGENT-TASK-MODES.md`, `docs/CAPABILITY-LEDGER.md`.
- Автопроверка: `pnpm architecture:check` (`scripts/architecture-check.mjs`).
- Baseline известных нарушений: `scripts/architecture-check.baseline.json` (не раздувать; чинить → `--write-baseline`).
- Правила v1: `shared/{ui,page,dsl}` ↛ `pages/*`; page A ↛ component page B; module A ↛ controller module B.

## 2. Конвенции

### Frontend (Angular 20)
- **Standalone-only:** `standalone: true`, никаких `*.module.ts`
- **ChangeDetection:** `ChangeDetectionStrategy.OnPush` на всех компонентах
- **Inputs:** `input<T>()` / `input.required<T>()` (signal-based, НЕ `@Input()`)
- **DI:** `inject()` везде (НЕ constructor injection)
- **Control flow:** `@if` / `@for` / `@switch` (НЕ `*ngIf` / `*ngFor`)
- **State:** `signal()` / `computed()` / `effect()` (НЕ manual subscriptions)
- **Запрещено:** `any`, `OnInit`/`OnDestroy`, `box-shadow`, `drop-shadow`, `#[hex]`, `bg-white`, `border-dashed`
- **Borders:** hairline-first — `hairline` / `hairline-b/r/l/t` (1px, цвет через оверрайды)
- **Focus-ring:** единый класс `pi-focus-ring` через `--focus-ring-shadow`
- **Селекторы:** `app-<name>-page` (kebab), классы `<Name>Page` (PascalCase)
- **Page template:** `<pi-page-header>` + `<pi-section>` (TZ-68 primitives)

### Backend (NestJS 10)
- **Паттерн:** Module → Controller → Service → Mongoose Schema
- **DTOs:** `class-validator` + `class-transformer` (whitelist + forbidNonWhitelisted)
- **Guards (global):** JwtAuthGuard (APP_GUARD), RolesGuard (APP_GUARD)
- **Interceptors (global):** UserContextInterceptor, AuditInterceptor
- **Soft-delete:** Mongoose plugin (auto-filter `deletedAt: null`), `@Schema({ softDelete: false })` для system schemas
- **Audit:** AsyncLocalStorage → Mongoose `$locals.userId` → auditPlugin (createdBy/updatedBy)
- **Replica Set обязателен:** Counter service использует `session.withTransaction`
- **Validation:** joi для env, ValidationPipe глобальный
- **Document print bindings (TZ-ORG-ASSETS-302):** `DocumentTemplateService.build()` remains the single HTML render path for preview and generated-document snapshots. Registry field bindings resolve organization requisites and typed `Organization.assets[]` roles through `logoUrl`/`sealUrl`/`signatureUrl`; order builds cascade the linked quotation/counterparty. Missing assets are rendered as empty image/seal output or the signature placeholder, never by introducing a second PDF engine.

### Cross-cutting
- **Package manager:** pnpm (НЕ npm/yarn)
- **i18n:** все API тексты на русском, UI локализация через token'ы
- **Тестирование:** Jest (frontend **242** unit tests, **21** suites — TZ-83 +11; backend **10** e2e suites — TZ-83 +3)
- **TypeScript:** strict mode, `noPropertyAccessFromIndexSignature` (frontend)
- **Документация:** docs/ — `add-new-page.md`, `data-model.md`, `paper-and-ink.md`

## 3. Зоны ответственности агентов

| Зона | Файлы | Описание |
|------|-------|----------|
| Backend API | `backend/src/modules/` | Feature modules, CRUD endpoints. Modules route: `/modules`. **TZ-DICT-314:** `form-profiles` — org-scoped QuickCreate field matrices (product\|module × S\|M\|L), LockedRequired enforced on PUT. **TZ-DICT-315:** FE settings `/dictionaries/form-profiles` (overflow-select + chips + checkbox matrix). **TZ-DICT-316:** `QuickCreateDialog` wired to `/products` + `/modules` «Создать»; edit stays FullEditor. |
| Backend common | `backend/src/common/` | Guards, interceptors, decorators, seeds. **CurrenciesSeed (TZ-102):** idempotent RUB/USD/EUR seed. |
| Backend database | `backend/src/database/` | Connection, plugins (softDelete, audit, userContext) |
| Backend scripts | `backend/scripts/` | `audit-di.ts` — DI cascade analyzer |
| Frontend core | `frontend/src/app/core/` | Auth, interceptors, services, guards, tokens. **Capabilities (TZ-256/262):** `CapabilitiesService.hasAny()` OR-семантика, `capabilityRouteGuard` (CanMatchFn, утечка маршрута → `/forbidden`). **TZ-262 (2026-08-02):** гейты admin-маршрутов выровнены с backend — `/admin/users` (route + nav) теперь `user:admin` (backend `GET /api/admin/users` = `@Permissions('user:admin')`), `/admin/roles` остаётся `role:read`. Принцип: frontend-гейт = UX-видимость, backend — authority (TZ-255). |
| Frontend layout | `frontend/src/app/layout/` | AppLayout (operational), KitLayout (UI showcase). **TZ-UX-304/307/308:** top nav L→R = Каталог…Документы → Справочники → Админ; пункт = rect (~h-10) + icon 12px + `shortLabel` (полный RU в aria/title); header ~h-14; equal-width от коротких; **Справ.** entry/active = `/categories` (+ aliases classification/appearance/documents-ref). Stubs `/counterparties` `/design` `/supply` `/shipping`. |
| Frontend pages | `frontend/src/app/pages/` | Login, materials, organizations, dictionaries, **categories**, products, orders, contracts, work-types, modules, modules/:id, products/:id, /kit/* showcase. **Admin (TZ-257.A.1/256.B/261):** users-admin, roles-admin pages + 3 form-диалога. **TZ-261 (2026-08-02):** конвенция «никаких `as`-кастов в template-выражениях — только методы-обработчики (onXxxInput/onXxxChange)» закреплена; P0 (NG5002) устранён в 3 admin-диалогах. **TZ-265 (2026-08-02):** Paper & Ink комплаенс admin — `text-red-600` → `text-destructive` (users-admin, roles-admin), hex-фолбэки убраны из `var()` в styles 3 диалогов (токены `--color-*` на `:root`); 0 hex-цветов в 5 admin-файлах. **TZ-264 (2026-08-02):** unit-покрытие 3 admin-диалогов (reset-password, user-form, role-form) — 3 spec-файла; каждый smoke-тест инстанцирует диалог через TestBed → template-компиляция (защита от регрессии NG5xxx). Покрыты canSubmit, mismatch-пароли, loadCatalog (успех/ошибка), toggleKey/toggleSection. Jest admin: 23/23. |
| Frontend shared/ui | `frontend/src/app/shared/ui/` | 24+ Paper & Ink primitives (button, card, dialog, table, ...). **Dialog service (TZ-103):** closure-local overlay refs per DialogRef (no singleton), `parentDestroyRef` auto-close on caller destroy, RAF first-mount repositioning. **TZ-UX-DIALOG-302:** QuickCreate kind B — SIZE_TO_WIDTH S/M/L→md/lg/xl (~920), body max-h~70vh; canon kinds A–D in `docs/DIALOG-COOKBOOK.md` + `docs/pages/ui-dialog-canon.md`. **TZ-UX-FORM-301:** Field Capacity — `field-capacity.ts` + 12-col packing (`gap-x-3 gap-y-2`), dims+weight one band, textarea rows≤2; see `docs/pages/ui-form-field-capacity.md`. **TZ-UX-FORM-302…305 (landed via TZ-GIT-301):** shared `PiFormSection` + `PiPhotoDropzone`; QuickCreate M/L sections + product L photoIds/BOM reuse; Wave A dialogs on `PiFormSection` — `docs/pages/ui-form-sections-canon.md`. |
| Frontend shared/page | `frontend/src/app/shared/page/` | PageHeader, Section, Demo; **PiDictionaryShell** (DICT-302); **PiGroupWorkspace** (DICT-308 — group chips + sticky tools + body) |
| Frontend shared/command | `frontend/src/app/shared/command/` | ⌘K command palette |
| Frontend shared/theme | `frontend/src/app/shared/theme/` | Live OKLCH theme editor |
| Frontend styles | `frontend/src/styles.css` | OKLCH palette, hairline utils, spacing tokens, dark mode |
| Dev tooling | `start.mjs`, `docker-compose.yml`, `.agents/skills/run-project-checks/`, `.husky/pre-commit` | Cross-platform starter, Mongo replica set. **TZ-263 (2026-08-02):** run-project-checks теперь включает `ng build --configuration=development` (шаг 2) — tsc не компилирует Angular templates (известно с TZ-86 F.6), только ng build ловит NG5xxx. Регрессионно проверено: сломанный template → NG5002 (exit 1), откат → exit 0. Алиас `pnpm --dir frontend build:dev`; pre-commit hot-path остался lint-staged (полная проверка — вручную/CI). |
| Docs | `docs/`, `STACK.md`, `STATUS.md`, `progress.md` | Architecture, data model, design rationale |
| Deploy / Synology | `deploy/synology/`, `docker-compose.prod.yml` | **TZ-DEPLOY-301:** one-command `deploy.ps1`→`deploy.py` (pnpm FE build), canon `kppdf-crm.ru`, secrets via gitignored `config.env`, health `/api/health/ready`, auth refresh variant A |
| OrchestratorKit | `OrchestratorKit/` | TZ workflow automation, templates, archives (AGENTS.md, TZF-00, verify-status.sh, auto-archive.sh, STATUS.md) |
| Data-model consolidation | `tasks/TZ-199..205.md`, `tasks/_archive/2026-07/`, `OrchestratorKit/STATUS.md`, `OrchestratorKit/TZ-199..205.txt` | Successor-TZ batch grounded в `docs/data-model-audit.md` (2026-07-25). 9 split-TZ covering entity-pair consolidation, audit-log unification и security prerequisite. Будущий scope (отдельные TZ-кандидаты): §1.2 #16 (Client/Counterparty legalForm normalization), §4.6 (FSM `EntityStatus`→`statusId:ObjectId`), §1.1 #8 (Operation/RoutingStep merge), §3.2 (ProductPricing + WarehouseAccess Zones). Marker files (`TZ-199..205.txt`) — paired companion требуется per `AGENTS.md §3 ✅ ТРОГАЮ`. |
| Catalog composition (Wave 1) | `tasks/TZ-CATALOG-300`…`305`, `tasks/CATALOG-WAVE1.md`, `docs/data-model.md` §4 CATALOG | Канон состава Material/Module/Product/Complex. Backend 301→305 строго по порядку; Cursor Mode A = спека + review 303/304; код — локальный исполнитель. UI/Excel — Wave 2–4. **TZ-MATERIALS-311 (2026-08-04):** у Material каждый `dimensions[].type` уникален (FE + BE 400). |

## 4. Открытые вопросы / отложенные задачи

| # | Вопрос | Статус | Контекст |
|---|--------|--------|---------|
| 1 | Дубликаты в data model (16 пар) | 📋 Документированы | `docs/data-model.md` § «Дубликаты». Proposal/Quotation, SupplierOrder/PurchaseOrder, Role/Roles и др. требуют консолидации. |
| 2 | Operational pages — растут | 📋 В работе | Реализованы materials, organizations, dictionaries, categories, products, orders, contracts, work-types, modules, people, **production cockpit `/production` (TZ-PRODUCTION-303: rail + Gantt план-оценка)**. В плане: warehouse hardening, production 304+, procurement. |
| 3 | E2E тесты не запускались | 📋 Отложено | 7 suites созданы (TZ-17), но не запускались регулярно. Нужен CI pipeline. |
| 4 | SSR / hydration | ❌ REJECTED | TZ-80 — out of scope. SPA CSR через `start.mjs --prod` static server. |
| 5 | Browser-use smoke test | ⏳ DEFERRED | TZ-82 — зависит от dev server. Можно запустить независимо через `ng serve`. |
| 6 | highlight.js install | ⏳ DEFERRED | TZ-78 fallback — pnpm `ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF`. Plain mono `<pre>` без подсветки. |
| 7 | axe-core a11y audit | ⏳ DEFERRED | TZ-79 — pnpm install blocker. @media print готов. |
| 8 | `nul` файлы (Windows artifact) | ✅ Fixed | Удалены, добавлены в `.gitignore` (OS section). |

---

## 5. Search infrastructure (TZ-105.1 verdict, 2026-07-12 — CANONICAL)

**Decision:** kppdf-8.0 uses MongoDB-only search. **No Vector DB** — neither external semantic-search infrastructure nor MongoDB Atlas `$vectorSearch`. Canonical source-of-truth для любых future «do we need embeddings?» question.

### 5.1 Verification (AC-2, 2026-07-12 ripgrep sweep)

```bash
# Vector DB SDK / API семейство
rg -i '(Qdrant|Weaviate|Pinecone|pgvector|chroma|milvus|atlas_vector)' \
   package.json pnpm-lock.yaml backend/src frontend/src Dockerfile docker-compose*.yml

# MongoDB Atlas vector + text search
rg '(\$vectorSearch|\$search|\$text|\$meta)' backend/src/

# Embedding-семейство (false positives ожидаемы в OKLCH theme editor)
rg -i '(embedding|vector.?search|cosine|ANN)' backend/src frontend/src
```

**Result (verified 2026-07-12):**

| Категория | Совпадений | Comment |
|---|---|---|
| Vector DB SDK (Qdrant / Weaviate / Pinecone / pgvector / Chroma / Milvus / Atlas) | **0** | Нет外部клиентов, нет Docker-сервисов, нет npm-зависимостей |
| MongoDB `$vectorSearch` / `$text` / `$search` / `$meta` | **0** | Native MongoDB document store + compound regex индексы only |
| Embedding-семейство | **7 false positives** | Все в `shared/theme/pi-theme-editor*` + `theme-editor.service.ts` — OKLCH perceptual color (lightness/chroma/hue channels), НЕ vector embeddings |

### 5.2 Verdict methodology — 4 risk cases

1. **Exact-prefix search (NAME / INN / SKU / phone)** — 100% покрыт MongoDB regex + compound индексы (создаются в schema `@Schema({index: true})` или `Schema.index({...})` из TZ-03). Нет смысла в semantic search для фактографических данных. **Vector DB = overkill.**
2. **MongoDB `$text` (lexical stemming index)** — built-in, доступен без Vector DB. Dismissed because kppdf-8.0 search domain = structured-fact-lookup (counterparty name, INN, BIN, customer phone). Stemming добавляет index-maintenance cost без ROI. **`$text` не нужен.**
3. **Natural-language search по text-blocks документов** — TZ-86 вводит text-block конструктор для reuse, но spec не требует «найти шаблон по смыслу описания». Будущая feature «smart block recommendation» — отдельный TZ. **Сейчас нет use-case.**
4. **Рекомендательные системы (similar products / cross-sell)** — отсутствуют в TZ-83 + data-model.md; нет product owner demand. **Нет use-case.**

### 5.3 Future adapter seam (EXPLICITLY DEFERRED)

Если TZ-N+1 потребует semantic search, architecturally-warranted path:

- **MongoDB Atlas `$vectorSearch`** — если Atlas tier выбран в production infra. Никакой new infrastructure: vector index добавляется к schema + driver call. «Switch-on» migration: 1 TZ + 1 schema migration + embedding model selection.
- **Qdrant sidecar** — если MongoDB Atlas tier недоступен (community → self-hosted). Добавляется отдельный server в `docker-compose.yml` + SDK в backend. Больше infra overhead, но позволяет pair with non-Mongo data sources.

**Оба option EXPLICITLY DEFERRED.** TZ-105.1 ничего в этом направлении не ships. Если semantic-search use-case emerges — открывается separate TZ (предварительно data-model.audit.md update).

### 5.4 Forbidden (TZ-canonical rule)

❌ Adding Vector DB SDK как npm dep без explicit TZ authorization. Если требуется — открывается separate TZ с полным cost/benefit analysis + ADR.

❌ Включение MongoDB `$text` indices в production schemas без прохождения через TZ directory. `text` indexes добавляют write-amplification cost, который неоправдан для structured-fact-lookup.

### 5.5 Cross-references

- **TZ-105** — родительский TZ (3 sub-tasks: 105.1 verdict [this section] + 105.2 BOM orphan migration + 105.3 frontend error-handling standardization).
- **TZ-83** — root для BOM orphan migration fix (105.2); обоснование почему `productmodules` reference — не semantic search concern.
- **TZ-86** — text-block конструктор (натуральный кандидат для future semantic-search TZ, но НЕ в текущей roadmap).
- **TZ-100/101** — inventory dashboard; structured-name search через compound indexes, не semantic.
- **`docs/data-model-audit.md`** — cross-ref: «MongoDB-only, no Vector DB» консистентен с этой section.

### 5.6 Maintenance trigger

Если future TZ меняет вердикт (например, появляется product owner demand для «smart text-block recommendation»), explicit pre-requisites:

1. Update этой секции с новым verdict + cite конкретный use-case.
2. `tasks/_archive/<YYYY-MM>/TZ-NN.md.done` ссылается на эту секцию.
3. Update `STATUS.md` line для TZ-NN с marker «supersedes TZ-105.1 search verdict».
4. Migration script if Atlas tier switches (компания перешла на Atlas → enable $vectorSearch seam).

До тех пор этот вердикт — **CANONICAL и его inspired future choices**.

---

## Dev Tooling — Local Starter (TZ-41)
- **`D:\kppdf-8.0\start.mjs`** — кросс-платформенный Node 20+ ESM starter (~500 строк, без внешних deps).
- **Режимы:** `--check` (preflight only), `--tail` (TUI), `--stop` (kill pids), `--reset` (down -v + rm node_modules), `--no-browser`, `--help`.
- **Pre-flight:** Node 20+, pnpm 8+, Docker daemon, `.env`, project structure, ports 3000/4200 (hard-fail) / 27017 (warn).
- **Mongo:** `docker compose up -d mongo mongo-init` (НЕ backend service — Dockerfile pnpm blocker), wait `rs.status().ok === 1` до 120s.
- **Deps:** `pnpm install --prefer-offline` если `node_modules` отсутствует.
- **Spawn:** `pnpm start:dev` (backend :3000) + `pnpm start` (frontend :4200) detached. `shell: isWin` на Windows для PATHEXT resolution (.cmd/.ps1).
- **Health-check:** `checkHealth()` GET + JSON parse + latency; для `/api/health` проверяет `body.status !== 'error' && body.info.mongo.status !== 'down'` (терминус формат).
- **TUI mode (`--tail`):** TTY-only, рисует 3 строки статуса Mongo/Backend/Frontend in-place через `\x1b[3A` + `\r` + `\x1b[K\n`. Ring buffer 5 строк на сервис. Иконки: ⏳ pending, ⏵ starting, ✔ ready, ✖ failed, ⚠ degraded.
- **TUI-aware log:** `tuiPrint()` вставляет строку ниже TUI, затем redraw. `log` объект (step/ok/warn/err) все стали TUI-aware.
- **Subprocess output suppression:** в TUI режиме `startMongo`/`installDeps`/`spawnDetached` используют `stdio: 'pipe'` чтобы не ломать in-place update.
- **Cleanup:** SIGINT/SIGTERM → `taskkill /T /F` (Win) / `process.kill(-pid, SIGTERM)` (Unix) для process group. PID-файл `.start.pids.json`.
- **Browser open:** `open` (Mac) / `cmd /c start` (Win) / `xdg-open` (Linux) с `shell: isWin` для Windows built-in `start`.
- **Final panel:** латентности /api/health + GET /, ✔/⚠/✖ иконки, frontend/backend/login/showcase URLs.
- **ENV vars:** `NO_TUI=1` (force plain log), `NO_COLOR=1` (disable ANSI).
- **npm-скрипты (root `package.json`):** `start` (--check), `start:all` (full), `start:tail` (--tail), `check:start` (--check), `stop:start` (--stop), `reset:start` (--reset), `start:no-browser` (--no-browser), `start:prod` (--prod).
- **Production mode (`--prod`, TZ-42):** `pnpm build` для backend+frontend, запуск через `node dist/main.js` (NODE_ENV=production) + inline static server (Node http+fs, ~80 lines, без new deps) для раздачи `dist/frontend/browser/` на :4200. SPA fallback, path traversal protection, cache headers. Bundle sizes в Ready panel. Caveat: local prod-like testing, не реальный prod deploy (для реального prod нужен nginx/PM2/Docker — future TZ-43+).
- **Inline static server:** `serveStatic(rootDir, port)` с MIME map, `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`, `.html` → `Cache-Control: no-cache`, SPA fallback to `index.html`, error handler на `listen()` для EADDRINUSE, `server.close()` в cleanup handler.
- **Console polish (TZ-46):** все log-сообщения в start.mjs на русском (preflight, startMongo, waitMongo, installDeps, buildBackend/Frontend, banner, cleanup, waitFor). `printReadyPanel` переписан с «простынного» вывода на компактную 2D панель: ASCII-рамка `╔══╗`/`╚══╝` с заголовком `✦ kppdf-8.0 готов к работе ✦`, summary строка `⏱ Все сервисы готовы за Xs`, 2-col endpoints table (`🖥 Frontend | 👤 Логин` + `📦 Backend | 📋 Showcase`). Динамическая ширина колонок через `stdout.columns` (clamp 80..120). NG warnings fix: 3× NG8113 (unused imports в page-renderer + showcase) + 2× NG8102 (unnecessary `??` в otp-input + scroll-area). Frontend build: 0 NG warnings. NestJS logger: nestjs-pino level='info' (excludes debug/verbose).
- **Platform wrappers:** `start.cmd` (Windows native, `node start.mjs %*`), `start.sh` (bash, `cd $SCRIPT_DIR && exec node start.mjs "$@"` — работает из любой CWD).
- **Smoke test results (pre-TZ-41):** 2 бага найдено (Windows pnpm spawn ENOENT, ImportJobsModule DI cascade) — оба исправлены до TZ-41.

---

## Documentation Structure

Проект использует иерархическую документацию. При редактировании любой части — начинай с соответствующего файла.

### Корневые файлы

| Файл | Назначение | Когда читать |
|------|-----------|--------------|
| `ARCHITECTURE.md` | Полная архитектура: схема, конвенции, зоны ответственности, все TZ | Всегда, перед любой работой |
| `STACK.md` | Технологический стек: фронтенд, бэкенд, инфраструктура | При работе с зависимостями, конфигурацией |
| `STATUS.md` | Текущий статус проекта: завершённые TZ, метрики, бэклог | При оценке объёма, планировании |
| `progress.md` | Хронологический лог выполненной работы | При поиске что было сделано и когда |

### Документация (`docs/`)

| Файл/директория | Назначение |
|-----------------|-----------|
| `docs/pages/*.page.md` | **Главная документация для работы.** Каждый файл = одна страница frontend. Route, API, сервисы, signals, computed, TZ-ссылки. |
| `docs/pages/_template.md` | Шаблон для создания новой page doc |
| `docs/pages/README.md` | Индекс всех page docs |
| `docs/DEVELOPMENT-PATTERNS.md` | Паттерны реализации: SilentResult, CRUD-страница, форма-диалог, утилиты, бэкенд-модуль |
| `docs/data-model.md` | Модель данных: все сущности, связи, индексы |
| `docs/data-model-audit.md` | Аудит модели данных: дубликаты, проблемы, рекомендации |
| `docs/paper-and-ink.md` | Дизайн-система: палитра OKLCH, hairline, focus-ring, WCAG |
| `docs/add-new-page.md` | Пошаговый tutorial: добавление новой страницы |
| `docs/design-spec.md` | Дизайн-спецификация |
| `docs/security-audit.md` | Аудит безопасности |

### Задачи (`tasks/`)

| Путь | Назначение |
|------|-----------|
| `tasks/TZ-*.md` | Активные задачи (текущий бэклог) |
| `tasks/_archive/` | Архив завершённых задач |

### Правило

**При редактировании страницы:**
1. Прочитай `docs/pages/<name>.page.md` — это полный контракт страницы
2. Прочитай `docs/DEVELOPMENT-PATTERNS.md` — паттерны реализации
3. Вноси изменения
4. Обнови `.page.md` если изменился API/route/диалоги

**При добавлении новой страницы:**
1. `docs/add-new-page.md` — пошаговый tutorial
2. `docs/pages/_template.md` — шаблон документации
3. Создай `docs/pages/<name>.page.md`
4. Обнови `docs/pages/README.md` (индекс)

---

## Cost Calculation (TZ-85)

**Files:** `backend/src/modules/cost-calculation/{schema,service,controller,module}.ts` + `dto/create-cost-calculation.dto.ts` + `backend/test/e2e/cost-calculation.e2e-spec.ts` + `frontend/src/app/shared/services/pi-cost-calculations.service.{ts,spec.ts}` + `frontend/src/app/pages/products/cost-calculation-detail-dialog.component.ts` + `frontend/src/app/pages/products/product-detail.page.ts` (Section V).

### Cost formula

`totalCost = Σ materials + Σ labor + overhead + Σ productLines`  
**Overhead canon A (TZ-COST-302):** `overheadCost = totalMaterialCost × overheadPercent / 100` (только от материалов, не от labor / productLines).

Recursive module rollup: nested `composition` lines with `lineType=module` × qty; cycles skip + `infos[]` warn. `activate` → `Product.costPrice = totalCost`. Module read-only: `GET /api/modules/:id/cost-preview`.
**Product-line (TZ-COST-305):** `productLines[]` + `totalProductLineCost`; вклад = `unitPriceOverride×qty` иначе `child.costPrice×qty` (иначе 0 + `infos`). Не в базе overhead%.
**UI visibility (TZ-COST-303/305):** product list/detail show Себест. (`costPrice`) next to Прайс (`listPrice`); module list = hint «см. карточку» (no batch preview); BOM inspector = material `price×qty` / module `preview×qty` / product-line override|costPrice×qty read-only.

### Backend (NestJS)

- **Schema** (`cost-calculation.schema.ts`): `_id`, `productId` (ref), `name`, `isActive` (default true), `overheadPercent` (0-100), `notes`, `totalCost` (computed cached), `breakdown: { materials: [...], labor: [...] }`, `createdBy/updatedBy/createdAt/updatedAt`, `softDelete` plugin.
- **Service** (`cost-calculation.service.ts`): `create/findAll/findById/update/activate/remove`. `activate` snapshots current `productId` configuration into `breakdown` (prevents later changes to ProductModule from affecting historical cost calculations). Uses `ProductModule` hierarchy for source data (no Bom/TechProcess — those were dropped in Phase A rewrite).
- **Controller** (`cost-calculation.controller.ts`): `POST /api/products/:productId/cost-calculations` — controller merges `productId` from URL param into DTO (DTO `productId` is `@IsOptional`, validated by ValidationPipe whitelist).
- **DTO** (`create-cost-calculation.dto.ts`): `productId?` + `name?` + `overheadPercent?` (0-100) + `notes?` + `breakdown?` (raw material/labor list as alternative to automatic computation from ProductModule). All optional — defaults applied in service.

### Frontend (Angular 20)

- **Service** (`pi-cost-calculations.service.ts`): `list/findById/create/update/activate/remove` returning `SilentResult<T>` per project convention.
- **Breakdown dialog** (`cost-calculation-detail-dialog.component.ts`): polymorphic ui-component showing `Material` rows + `WorkType` rows + total + overhead%. Used in Section V of product-detail.page.
- **Section V** (`product-detail.page.ts`): new section "Себестоимость" showing cost calculation history + create button + activation controls.
- **Unit tests** (`pi-cost-calculations.service.spec.ts`): covers silent-http error paths per project convention.

### E2E test (Phase E.1)

- **`backend/test/e2e/cost-calculation.e2e-spec.ts`** (242 lines): 7-step scenario —
  1. Create 2 Materials (ЛДСП 16мм + Кромка ПВХ) with `pricePerUnit: 1000/500`
  2. Create WorkType (Раскрой на ЧПУ) with `hourlyRate: 2000`
  3. Create ProductModule (Корпус шкафа) with materials[] + workTypes[]
  4. Create Product + attach module
  5. POST `/products/:id/cost-calculations` → verify total = `(1000*4 + 500*12) + (2000*2.5) × (1+overhead/100)`
  6. Activate snapshot → verify `isActive` switching
  7. Delete snapshot → verify 204

### Cross-references

- **TZ-83 (ProductModule hierarchy):** cost-calculation source data is `Product.modules[].materials[] + workTypes[]`. Without TZ-83, this TZ has no source.
- **TZ-86 (Document Constructor):** polymorphic ui-component pattern reference for `cost-calculation-detail-dialog`.
- **TZ-91B.2 RBAC:** cost-calculation endpoints have `@Roles('admin','manager')` per TZ-91B.2 sweep.

---

## Database Layer (TZ-03)
- **Mongoose 8** с autoIndex=true в dev, autoIndex=false в production
- **Connection:** retryAttempts 3, retryDelay 1000, replicaSet rs0
- **Plugins (global, applied in connectionFactory):**
  - `softDeletePlugin` — auto-filter `{deletedAt: null}` в find/findOne/findOneAndUpdate/countDocuments; helpers `.softDelete()` / `.restore()` через `schema.query`
  - `auditPlugin` — pre-save (createdBy/createdAt для new, updatedBy/updatedAt для existing); pre updateOne/findOneAndUpdate/updateMany (мерж updatedBy/updatedAt в $set или wrap-in-$set)
- **$locals.userId** — Mongoose per-query local storage, устанавливается из Auth interceptor (TZ-04)
- **Counter service:** атомарный `next(entity, prefix, year)` через `session.withTransaction` + `$inc: { seq: 1 }` + `upsert: true` + `returnDocument: 'after'`. Формат: `prefix-YYYY-NNN` (3-digit pad). Требует Replica Set (есть в TZ-02).
- **Event logging:** connected / disconnected / reconnected / error → NestJS Logger → Pino (через main.ts useLogger)
- **FIXME (TZ-43):** legacy single-field `Schema.index({ field: 1 })` calls cleaned up в 6 schemas (product/material/organization/counterparty/category/certificate). Compound indexes сохранены. Если в production Mongo есть legacy duplicate `name_1` index — требуется ручной `db.<coll>.dropIndex('name_1')`.

## Snapshot-on-transition immutability pattern (TZ-CORE-301)

**Problem:** FK-only references on stage transitions leak catalog edits into
archived orders / specifications / shipments. Q9 default: **denormalize per
stage**, not a mega-collection (docs/compose/plans/2026-08-02-shop-customer-lifecycle.md §3 / §7 #16).

**Helper:** `backend/src/common/snapshot/snapshot.helper.ts` — pure functions,
SessionRunner-friendly (no DI, no DB writes; caller embeds the snapshot into
its own stage document inside the same transaction):

- `createInlineSnapshot(payload, { stage, sourceId?, capturedAt? })` →
  `{ data: Readonly<T>, _snapshot: { stage, capturedAt, sourceId, hash, version: 1 } }`
  where `data` is a **deep-frozen** clone (`structuredClone` + recursive
  `Object.freeze`) and `hash` is a sha256 fingerprint over a stable,
  key-sorted serialization.
- `snapshotHash(value)` / `snapshotMatches(stored, current)` — integrity
  verification (tamper detection after capture).
- `cloneImmutable(value)` — deep-freeze helper for embedding stage payloads.

**Contract — what we store per stage (order / specification / shipment):**

```ts
_snapshot: {
  stage: 'order' | 'specification' | 'shipment' | string;
  capturedAt: string;   // ISO date
  sourceId: string | null;
  hash: string;         // sha256 of the frozen payload
  version: 1;
}
```

**Reference impl:** unit spec `snapshot.helper.spec.ts` demonstrates a
transition capture (order payload → immutable snapshot) and verifies that
post-capture catalog edits cannot mutate the frozen data nor pass
`snapshotMatches`. A thin service method on the real transition
(КП→Order hook point) is the successor step when the corresponding
feature TZ lands (PRODUCTION-301 / ARCHIVE-301).

**Explicit non-goals (known_limitation):** no full catalog denormalization
migration; no mega-collection; legacy Proposal/Quotation merge untouched.

---

## DI Audit (TZ-45)
- **`backend/scripts/audit-di.ts`** — статический анализатор DI cascade багов (~140 lines, regex-based).
- **Алгоритм:** build reverse index `className → {moduleFile, isGlobal}` из `*.module.ts` providers → parse `*.service.ts` constructors → extract injected types → check `imports: [...]` consumer module содержит provider module name.
- **Skip logic:** framework types (ConfigService/Logger/Model/MongooseModule), @Global() modules, self-injection, forwardRef, same-module providers.
- **TZ-45 result:** 22 false positives в 14 модулях. Manual verification: `ProductModule` реально импортирует `CounterModule` (скрипт regex bug в edge cases), backend `pnpm start:dev` BOOTS чисто. **0 real DI issues**.
- **Limitations:** script false positives из-за regex (comment `imports: []` или spread `...defaultImported`). Future: AST-based парсинг через ts.createSourceFile.
- **Use case:** future TZ-50+ может использовать как pre-commit hook (защита от regression: новый сервис добавлен, импорт забыли → script fail).

## Security Architecture (TZ-91)

**Canonical contract:** `[docs/RBAC-CONTRACT.md](docs/RBAC-CONTRACT.md)`, runtime module `backend/src/common/contracts/rbac-contract.ts` — TZ-254 ships the `<section>:<action>` permission format, `effectivePermissions(user, role)` algorithm, system-role invariants (`SYSTEM_ROLE_NAMES` frozen: admin/manager/user), and the `OWNERSHIP_BY_ENTITY` matrix that TZ-251/TZ-255/TZ-257/TZ-258 consume. Runbook for operators: see §3.1 of the RBAC contract.

**Defense-in-depth chain** для всех sensitive endpoints (TZ-91 Phase A ships A.1+A.3+A.4+A.6; Phase B+C planned):

- **JWT validate** (`JwtAuthGuard`, global `APP_GUARD`): access token (15m, `JWT_SECRET`) + payload versioning через `user.refreshTokenVersion` — инвалидация по всему refresh-tree при password change / logout.
- **Roles check** (`RolesGuard`, global `APP_GUARD`): проверяет `@Roles('admin', 'manager')` decorator на handler. Role hierarchy (TZ-91 §2 Decision 9): `admin` > `manager` > `user` — `@Roles('manager')` означает «admin OR manager», не только manager.
- **Rate limit** (`@nestjs/throttler`, TZ-18 base + TZ-91A усилитель): глобально 10 req/s + 100 req/min per IP; sensitive endpoints (`/auth/login`) — `@Throttle({short: {ttl: 60_000, limit: 5}, long: {ttl: 3_600_000, limit: 20}})` → 5 req/min, 20 req/hour (brute-force protection).
- **DTO whitelist** (`class-validator`): defense-in-depth даже если `@Public()` decorator убирается — DTO-level constraint catches admin-creation attempt (пример: `register.dto.ts` `@IsIn(['user','manager'])` блокирует `role: 'admin'` через публичный API независимо от guard state).
- **Admin-password gate** (`admin.seed.ts`): `ADMIN_PASSWORD` envvar, `length < 8` → WARN+SKIP, admin NOT created. Bootstrap continues — но admin login fails до user manually sets ≥8-char password.
- **CORS multi-origin** (TZ-91A6): `CORS_ORIGIN` envvar split comma-separated; `CORS_ORIGINS` legacy fallback. `corsOrigins.length === 1` → sends single origin string (CORS-spec safe для credentials=true).
- **Swagger gating** (TZ-91 Phase C, planned): `if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true')` — Swagger docs = API leak aggregation, default-off в prod, escape hatch через env flag.
- **Audit trail** (`AsyncLocalStorage` → Mongoose `$locals.userId` → `auditPlugin`, TZ-05): `createdBy/createdAt` на insert, `updatedBy/updatedAt` на update. Sensitive поля (`passwordHash`, `password`, `refreshToken`) вырезаются из snapshot.

**Endpoint touchpoints (post TZ-91A):**
- `POST /auth/register` — `@Public()` TEMPORARY (TZ-91A1 + JSDoc, до TZ-91-extension invite-flow), DTO `@IsIn(['user','manager'])` блокирует admin via public API.
- `POST /auth/login` — `@Public()` + `@Throttle(5/min, 20/hour)` (TZ-91A3).
- `POST /auth/refresh` — `@Public()` + `JwtRefreshGuard` — refresh если `version` совпадает.
- `POST /auth/logout` — auth-only, bumps `refreshTokenVersion`, invalidates все existing refresh tokens.
- `POST /users/:id/change-password` — admin-only + bumps target user's `refreshTokenVersion`.
- `GET/POST/PATCH/DELETE /users` — `@Roles('admin','manager')` на POST/PUT/PATCH/DELETE (TZ-91 **Phase B sweep — pending**).
- `GET/POST/PATCH/DELETE /roles` — `@Roles('admin')` strict.

**DEFERRED / OUT-OF-SCOPE (full TZ-91 spec §7):**
- **A.2:** `@Public()` remove on `/register` — DEFERRED до TZ-91-extension создающего admin-invite-flow `POST /api/users/invite`. Без invite-flow → chicken-and-egg bootstrap.
- **Account lockout** после N consecutive login failures — TZ-91-extension (после rate-limit baseline).
- **Username enumeration prevention** — security deep-dive, future TZ. Сейчас `/login` возвращает разные errors для invalid-user vs wrong-password (информационный leak).

**Phase B (RBAC sweep, planned):** `@Roles('admin','manager')` на всех write endpoints в 73 controllers (Article 3 §3 Audit Table). Генерируется `backend/scripts/audit-roles-coverage.ts` для статического analysis → manual apply per batch.

**Phase C (Swagger + drift + start.mjs warning, planned):** Swagger gating `NODE_ENV !== 'production'`. Admin password drift-detector (`admin-password-drift-detector.ts`) graceful degradation. `start.mjs` preflight → warning если `JWT_SECRET` содержит `dev` / `do-not-use` substring.

## Auth & Identity (TZ-04)
- **Схемы:** Permission (key unique, section, action ∈ {read|write|admin}), Role (name unique, label, permissions[], isSystem, sortOrder, sectionIds, isActive), User (username/email unique, passwordHash bcryptjs, role, permissions[], refreshTokenVersion, isActive, lastLoginAt, phone, fullName)
- **JWT:**
  - access: 15m, secret=JWT_SECRET, payload `{sub, username, role, version}` (version = refreshTokenVersion)
  - refresh: 7d, secret=JWT_REFRESH_SECRET, payload `{sub, version}` — валидируется совпадение version с user.refreshTokenVersion
  - **TZ-DEPLOY-301 variant A:** login/register JSON body includes `{ access, refresh, user }`; FE stores refresh in localStorage and sends `Authorization: Bearer <refresh>` to `/auth/refresh`. Optional HttpOnly cookie `refreshToken` path `/api/auth` (not FE-primary). HttpOnly-only flow = successor DEPLOY-302.
  - Logout/change-password → increment refreshTokenVersion → старые refresh инвалидированы
- **Password:** bcryptjs (pure JS, 10 rounds). 8-128 chars, min для admin из ADMIN_PASSWORD env.
- **Guards (global):**
  - JwtAuthGuard (APP_GUARD) — валидирует access token, hydrates req.user из БД (fresh role/perms), @Public() пропускает
  - RolesGuard (APP_GUARD) — проверяет @Roles('admin', 'manager') decorator
- **Interceptors (global):**
  - UserContextInterceptor (APP_INTERCEPTOR) — оборачивает handler в userContext.run({userId,username,role,permissions}) из req.user
- **Propagation chain:** JWT validate → req.user → Interceptor → AsyncLocalStorage → Mongoose userContextPlugin → query.$locals.userId → auditPlugin (createdBy/updatedBy из TZ-03)
- **Endpoints:**
  - POST /auth/register (public) — создать User + access + refresh (body)
  - POST /auth/login (public) — verify password + lastLoginAt + access + refresh (body)
  - POST /auth/refresh (public, JwtRefreshGuard) — новый access если version совпадает
  - POST /auth/logout (auth) — bump refreshTokenVersion
  - GET /auth/me (auth) — текущий user (+ role.pages ACL)
  - GET/POST/PATCH/DELETE /users (admin/manager + self) — CRUD
  - POST /users/:id/change-password — bump refreshTokenVersion
  - GET/POST/PATCH/DELETE /roles (admin) — CRUD, isSystem роли не удаляются
- **Seed (OnApplicationBootstrap):**
  - PermissionsService — bulk upsert 30+ permission keys
  - AdminSeed — 3 system roles (admin/manager/user), default admin user с предупреждением

## Device enrollment (TZ-AUTH-303)
- **Модель:** устройство (именованный браузер/ПК) — субъект доступа. Две раздельные сущности:
  `DeviceInvite` (одноразовый, SHA-256 hash + display prefix; `regular` с preselected активной `role`, `owner-device` с immutable `ownerUserId`) и `BrowserDeviceGrant` (browser-only credential, SHA-256 hash, `deviceName`, `status`, `expiresAt`, `userId`, `inviteKind`).
- **Креденшал:** grant-secret — только в `__Host-` cookie (`Secure+HttpOnly+SameSite=Lax`, `Path=/`, без `Domain`), default 365d. Никогда не принимается как `Authorization: Bearer`, `X-Access-Token`, JWT или Desktop `kppd_`.
- **Эндпоинты (public, cookie-only):** `POST /device/enroll` (одноразовое атомарное погашение invite в Mongo-транзакции → создаёт `User(accountType=device)` с random невыдаваемым password и ровно выбранной ролью, либо для `owner-device` привязывает grant к существующему единственному owner), `GET /device/session` (выдаёт access JWT ≤5m без refresh), `GET /device/status` (active|revoked|expired + имя), `GET /device/auth-check` (boolean gate для nginx auth_request, без персональных данных).
- **Эндпоинты (admin, `user:admin`):** `POST /admin/devices/invites` (regular invite только после выбора активной роли), `GET/POST invites`, `GET /admin/devices`, `PATCH /admin/devices/:id` (role/name/ttl), `POST /admin/devices/:id/revoke`. Owner-only: `POST /admin/devices/owner-invite` (15m TTL + password step-up) и `GET /admin/devices/owner` — обычный admin их не видит/не перечисляет (404/403).
- **Инварианты:** role берётся ТОЛЬКО из invite (публичный клиент её не подменяет); admin-power grant/revoke — owner-only (нельзя выдать `admin`-invite или PATCH в/из `admin` обычному admin); reset-password для `accountType: device` → 409; revoke/role-change/деактивация User действуют ≤5m.
- **TTL (config):** invite 3d (1/3/7), owner-device 15m, grant 365d, device JWT 5m; secret entropy ≥192 bit. Audit: issue/consume/revoke/role-change — без plaintext secrets.

## Deploy / Synology prod (TZ-DEPLOY-301)
- **Canon domain:** `https://kppdf-crm.ru` via `CORS_ORIGIN` (alias `CORS_ORIGINS`).
- **Compose:** `docker-compose.prod.yml` — required `JWT_SECRET` / `JWT_REFRESH_SECRET` / `ADMIN_PASSWORD` (no banned default); healthcheck `/api/health/ready`.
- **One-command:** `deploy/synology/deploy.ps1` → `deploy.py` (`pnpm --dir frontend build` → SSH → compose). Secrets only in gitignored `config.env` / `CREDENTIALS.md`.
- **Runbook:** `deploy/synology/RUNBOOK.md` (secrets checklist + pre-deploy 10 lines).

## System & Workflow (TZ-05)
- **Setting:** key-value config (Mixed value), grouped (finance/general/etc). `isEnabled(key)` helper для guards/interceptors.
- **FeatureFlag:** boolean toggles с default + active. Virtual `enabled` = isActive ? enabledByDefault : (depends on override layer). 4 default flags: new_ui, e2e_payments, dark_mode, advanced_analytics.
- **EntityStatus:** (entityType, statusId, label, color, icon, sortOrder, isInitial, isFinal). 15 seeded для Proposal/Contract/Order.
- **StatusWorkflow:** (entityType, name, statuses[], transitions[{fromStatus, toStatus, roles[]}], isActive). `assertTransition(entityType, fromStatus, toStatus, userRole)` — throws BadRequest если role не в transition.roles. 3 default workflows.
- **AuditLog:** (action, entityType, entityId, userId, userName, details{before, after, meta}, packageTag, ipAddress). 3 indexes: createdAt desc, (entityType, entityId, createdAt desc), (userId).
- **AuditInterceptor (@AuditAction):** глобальный APP_INTERCEPTOR. Метаданные `{action, entityType, idParam?}`. После response берёт entityId из params.id или response._id, пишет log с userId из AsyncLocalStorage (TZ-04). Sensitive поля (passwordHash/password/refreshToken) вырезаются из snapshot.
- **Seeds (OnApplicationBootstrap):** SettingsSeed (5), FeatureFlagsSeed (4), StatusesSeed (15 statuses + 3 workflows), AdminSeed (из TZ-04).

## Organizations & Contacts (TZ-06)
- **Person:** физическое лицо (контакт). Поля: lastName, firstName, patronymic, phone, email, position, notes. Индекс по ФИО.
- **Organization:** юр.лицо (наша или партнёр). Полные реквизиты (name, shortName, legalForm, INN, KPP, OGRN/OGRNIP, банк, signer, paymentTermDays, vatRate, type[], legalType, website, directorName, registrationDate, partyTypes, photoIds[], contactPersonId, паспорт для ИП). Уникальный INN.
- **Counterparty:** контрагент (покупатель/поставщик/...). Похож на Organization, но roles[] → CounterpartyRole (customer/supplier/contractor/manufacturer).
- **OrgRole / CounterpartyRole:** справочники ролей. isSystem=true → нельзя удалить (защита в service).
- **OrganizationContact:** M2M Organization ↔ Person, unique index, isPrimary/role.
- **Interaction:** CRM-лог (counterpartyId, type∈{call|email|meeting|chat|task|note}, description, direction, occurredAt, relatedToId+Type polymorphic, outcome, tags[]). Индекс по counterpartyId + occurredAt desc.
- **@IsINN() валидатор:** декоратор с контрольной суммой ФНС для 10/12-значных ИНН.
- **Seeds:** 4 OrgRole (our-company/partner/holding/branch), 4 CounterpartyRole (customer/supplier/contractor/manufacturer).

### Party hygiene (TZ-PARTY-301, 2026-08-08)

- **Tenant-stamp:** `organizationId` / `isSystem` контрагента приходят **только** из JWT
  (`withoutTenantFields` в `counterparty.service.ts`); body-поля игнорируются и в create, и в
  quick-create, и в update — переставить контрагента в другой tenant через API нельзя.
- **Org-scope (IDOR):** `Counterparty` get/update/delete и `Organization` list/get/update/delete
  отдают **404**, а не 403, на чужой tenant. Записи без `organizationId` (legacy / `isSystem`)
  остаются общими. Политика — одна «наша» Org на `user.organizationId`.
- **Soft-delete:** `deletedAt` теперь есть в схемах Organization + Counterparty (до этого
  `remove()` писал поле, которого нет → strict-mode no-op, «удалённая» запись жила в списке).
  Списки и `findById` фильтруют `deletedAt: null`.
- **INN uniqueness:** глобальный `unique` на `Counterparty.inn` снят — уникальность
  per-tenant через compound `{organizationId, inn}` sparse unique. Иначе первый tenant
  «занимал» ИНН реальной компании для всех остальных.
- **Stub INN:** `innIsStub` (quick-create ставит `true`, ручной ввод ИНН в update снимает);
  на `/counterparties` бейдж «временный» + счётчик в тулбаре.
- **«Наша фирма»:** `Organization.isOurCompany` + `GET /organizations/current`
  (JWT-org → `isOurCompany` → единственная Org → иначе 404 с явной подсказкой настроить).
- **Миграция:** `backend/src/database/migrations/2026-08-08-TZ-PARTY-301-party-hygiene.ts`
  (drop `inn_1`, отчёт коллизий `{organizationId, inn}`, backfill `innIsStub`, разметка
  единственной Org как «наша»). Идемпотентна.

### Party FullEditors (TZ-PARTY-302 / TZ-PARTY-303, 2026-08-08)

Обе стороны сделки (наша Org и заказчик) редактируются одним каноном, потому что до этого
реквизиты для документов физически не имели UI: у организации было 7 полей из ~25, а страница
заказчиков была read-only.

- **Kind C оболочка:** `variant="content"` + `maxWidth: min(1120px, calc(100vw - 2rem))`,
  секции — `app-pi-form-section`. Компоненты:
  `pages/organizations/organization-full-editor-dialog.component.ts`,
  `pages/counterparties/counterparty-full-editor-dialog.component.ts`.
- **Один write-path на сущность:** узкий `organization-form-dialog.component.ts` удалён, а не
  оставлен рядом как «быстрый» — две формы с разной логикой расходятся молча.
- **Payload:** только DTO-поля, пустые строки не отправляются (API с `forbidNonWhitelisted`),
  даты — ISO. Клиент **никогда** не шлёт `organizationId` / `isSystem`: тенант штампует сервер
  (см. Party hygiene выше).
- **Условные блоки:** «Паспорт ИП» рендерится и отправляется только при `legalType = ip`.
- **Справочники, не хардкод:** роли контрагента читаются из `GET /counterparty-roles`
  (`description` = русская подпись) с fallback на посеянный набор — упавший справочник не должен
  блокировать сохранение, так как `roles` обязателен в create DTO.
- **Ограничение UI-кита:** `PiInputType` не содержит `date`, поэтому даты — нативный
  `<input type="date" class="pi-input">` (как на остальных страницах).
- Файлы (логотип/печать/фото) живут в отдельной секции — см. «Типизированное хранилище файлов
  организации» ниже.

### Типизированное хранилище файлов организации (TZ-ORG-ASSETS-301, 2026-08-08)

Документу нужен именно логотип, именно печать и именно подпись, а безымянный
`Organization.photoIds[]` не отвечал на вопрос «что печатать». Поэтому у организации
появились **слоты по роли**, а не ещё одна галерея.

- **Модель:** `Organization.assets[]` (`organization.schema.ts`) — `role` ∈
  `logo | seal | signature`, `photoId`, `storageUrl`, mime/размер, `uploadedAt`/`uploadedBy`.
  `storageUrl` дублируется из `Photo` осознанно: печать (ASSETS-302) читает организацию и не
  должна ходить за join-ом, файл иммутабелен.
- **Один активный файл на роль:** `PUT /organizations/:id/assets/:role` (multipart `file`)
  заменяет содержимое слота и удаляет прежнее `Photo`; истории версий нет.
  `DELETE …/assets/:role` снимает файл, пустой слот → 404, а не молчаливый успех.
- **Печать — только admin:** `seal` на upload и на remove требует `role = admin`
  (`ForbiddenException`), остальные слоты — admin/manager. UI показывает слот и превью
  менеджеру, но не даёт кнопок; отказ живёт в сервисе, не в шаблоне.
- **Один image-pipeline:** multer-конфиг вынесен в `photos/image-upload.options.ts` и
  переиспользован `OrganizationModule` — лимит 10 МБ и список mime не разъезжаются с
  `POST /photos/upload`. Файл регистрируется как `Photo`, поэтому уборка (unlink) уже есть.
- **Photo performance pipeline (TZ-PHOTO-301):** multipart upload persists the original first, then creates a separate WebP `thumb` child via Sharp (long side ≤320px, no enlargement). The API preserves the original Photo shape and adds `variants.thumb`; Sharp failure is non-fatal and leaves the original usable. Lists consume this variant in TZ-PHOTO-302, while legacy originals are handled by TZ-PHOTO-303.
- **Запись массива через `updateOne`, не `doc.save()`:** `optimisticLockPlugin` вручную
  поднимает `__v`, из-за чего любой `save()` с изменённым массивом падает `VersionError`.
  Слоты пишутся `findOneAndUpdate` (`$set` / `$pull`).
- **`legalAddress`** добавлен вместе с хранилищем: без адреса шапка документа неполная, а
  чинить это отдельной миграцией дороже.
- **Ограничение:** привязка слотов к печати PDF — `TZ-ORG-ASSETS-302`.

### Stub КП для прямого заказа (TZ-ORDERS-306, 2026-08-08)

`Order.quotationId` заполнялся только на пути КП → заказ (`convertToOrder`), поэтому прямой
заказ жил без КП, и всё, что просит ссылку на КП, для него было недостижимо.

- **Endpoint:** `POST /orders/:id/stub-proposal` → `OrderService.ensureStubProposal()`.
- **Идемпотентность:** заказ с КП возвращает существующее (`created: false`); висячий
  `quotationId` (КП удалили) пересоздаётся с warn. Кнопка не может наплодить КП.
- **Статус:** `draft` + `isStub: true`, **не** `converted` — конвертации не было. `isStub`
  отделяет заглушку от настоящего посчитанного КП в списках и печати.
- **Связь двусторонняя:** `Order.quotationId` ↔ `Quotation.sourceOrderId`.
- **Организация:** `OrganizationService.findCurrent` (JWT → `isOurCompany` → единственная,
  см. Party hygiene) — не угадываем, иначе КП уедет от чужой фирмы.
- **Отказы явные:** отменённый заказ и заказ без позиций → 400 с русским текстом.
- **Модульная развязка:** модель `Quotation` регистрируется прямо в `OrderModule`, потому что
  `QuotationModule` сам импортирует `OrderModule` (convert-to-order) — обратный импорт дал бы
  цикл. `@nestjs/mongoose` переиспользует уже созданную модель по имени.
- **Ограничение:** `BuildDocumentDto` по-прежнему принимает `orderId`/`contractId`, но не
  `quotationId` — привязка КП к builder-документам это отдельное TZ.

---

## Frontend UI Kit (`frontend/src/app/shared/ui/` — current)

UI держится на собственном Paper & Ink kit без Material/PrimeNG: standalone Angular-компоненты, Signals, OnPush, OKLCH design tokens, hairline borders и единый focus-ring. Переиспользуемые primitives находятся в `frontend/src/app/shared/ui/`; page-level composition находится в `frontend/src/app/shared/page/`.

### Три обёртки (расширяется до 4)

- **`<app-pi-page-header>`** — `frontend/src/app/shared/page/pi-page-header.component.ts`. Общий заголовок страницы с title, subtitle, back-link и actions slot.
- **`<app-pi-empty-state>`** — `frontend/src/app/shared/ui/pi-empty-state/pi-empty-state.component.ts`. Единое empty-state представление с описанием и CTA slot.
- **`<app-pi-fact-card>` / `<app-pi-fact-stack>`** — `frontend/src/app/shared/ui/fact-card/` (TZ-UX-FACT-301). Label · value · caption · `[actions]`; variants default|emphasis|danger; stack with section title. Canon `docs/pages/ui-fact-card.md`. Detail wiring → DETAIL-301+.
- **`<app-pi-badge>`** — `frontend/src/app/shared/ui/badge/badge.component.ts`. Status/isActive/isSystem indicator с семантическими вариантами и token-driven цветами.
- **`<app-pi-row-actions>`** — `frontend/src/app/shared/ui/pi-row-actions/pi-row-actions.component.ts`. Доступные row actions с hover/focus-visible состояниями и persistent visibility для выбранной строки.

### Acceptance criteria (проект-wide)

- Inline page headers and status chips are not reimplemented when a shared primitive exists.
- Components use `pi-focus-ring`, semantic tokens and keyboard-visible states instead of page-specific visual hacks.
- New primitives are added only after a pattern repeats across at least three pages (YAGNI).
- List pages compose primitives from `shared/ui/` and `shared/page/` using the `app-pi-*` selectors.

### Shell layout

- **Authenticated app shell** — owns topbar (brand + user meta + logout) and the shared page composition around `<router-outlet>`. Login bypasses the shell with a standalone centered card.
- **`frontend/src/app/app.routes.ts`** — все auth-required routes (`home / materials / units / currencies`) вложены в `MainLayout` через `children: [...]` pattern. Per-route `data.icon` → page header icon; per-route `title` → page header title (после strip `KPPDF — ` prefix). Login — отдельный top-level route.

### Migrated pages

| Page | Path | Под ui-kit обёртками |
|------|------|----------------------|
| `/materials` | `pages/materials/materials-list.page.ts` | ✅ page-header + empty-state + badges |
| `/units` | `pages/units/units-list.page.ts` | ✅ page-header + empty-state + badges |
| `/currencies` | `pages/currencies/currencies-list.page.ts` | ✅ page-header + empty-state + badges |
| `/doc-constructor/*` | `pages/doc-constructor/` | ✅ builder canvas, inspector, DSL and template data services |
| Remaining operational pages | `pages/<name>/` | Follow the same shared primitive and page contract during their next feature change |

### Cross-cutting

- **Token consistency:** shared primitives consume the Paper & Ink tokens from `frontend/src/styles.css`; page styles do not introduce competing palettes or shadows.
- **Accessibility:** controls expose labels, focus-visible states and appropriate live/semantic regions; keyboard behavior is covered by focused component tests where applicable.
- **Bundle impact:** primitives are local standalone components with no additional UI framework dependency.
- **Расширение:** новые wrappers не создаём, пока паттерн не повторяется в 3+ page'ах (YAGNI).

### Подробная документация обёрток

- **API таблицы, input specs, usage examples:** see `STACK.md §6 (UI patterns)` + `§6.4 (Global density)`.
- **Файлы, импорты, default values:** в doc-комментариях внутри каждой `ui-*.component.ts` (header doc-block в верхней части файла).
- **Глобальный dashboard / метрики:** см. `STATUS.md` → "UI Hardening Rework (2026-07-05)" секция + `progress.md` хронологическая запись rework'а.

### Структура shared UI

```
frontend/src/app/shared/
├── ui/       # buttons, forms, dialogs, tables, canvas, feedback and navigation primitives
├── page/     # page-header, section, toolbar and demo composition
├── dsl/      # entity/list schema and service contracts
└── template-block/ # document-constructor block models and helpers
```

Все три — `standalone: true`, `ChangeDetection.OnPush`, signal-based inputs (`input<T>()` / `input.required<T>()`).

---

## Toast (TZ-56 — Sonner-style service + host + a11y coverage)

- **`PiToastService`** — `frontend/src/app/shared/ui/toast/pi-toast.service.ts`. Sonner-style singleton (`providedIn: 'root'`) с in-memory queue + auto-dismiss через `setTimeout` (только если `duration > 0`) + listener fan-out через `Set<callback>`. API: `show`, `success`, `error`, `warning`, `dismiss(id?)`, `subscribe(cb) → unsubscribe`. Типы `ToastVariant` / `ToastOpts` / `QueuedToast` — все `export`нуты (раньше были internal).
- **`PiToastComponent`** — `frontend/src/app/shared/ui/toast/pi-toast.component.ts`. Sonner-style host:
  - **Host root:** `role="region"` + `aria-label="Управления"` + `aria-live="polite"` + `aria-atomic="true"`.
  - **Per-toast:** `role="status"` (default / success) ИЛИ `role="alert"` (error / warning) — screen-readers announce politely vs assertively.
  - **`.tours` / `.guides`** extra classes — для axe-core / Storybook tour markers.
  - **`Esc`** dismisses ALL queued toasts (`preventDefault` + `service.dismiss()` без id).
  - **SSR-safe** через `isPlatformBrowser(inject(PLATFORM_ID))` — `document.addEventListener` НЕ вызывается в server-side.
  - **Cleanup** через `DestroyRef.onDestroy()` (вместо `OnInit` / `OnDestroy`).
  - **Standalone + OnPush** + signal-based state.
  - **Reduced-motion** safety net: `@media (prefers-reduced-motion: reduce)` → animation-duration: 0.01ms (TZ-32 compliance).
- **Variant border map:** `default → border-rule`, `success → border-ink`, `error/warning → border-destructive`.
- **Subfolder barrel:** `frontend/src/app/shared/ui/toast/index.ts` экспортирует `PiToastComponent`, `PiToastService`, типы `ToastVariant` / `ToastOpts` / `PiToastItem` (QueuedToast rename).
- **Mount:** `<app-pi-toast-host>` ставится в `app.ts` root template.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-56-toast.lock` (стабилизирует `shared/ui/toast/*`).

---

## Progress (TZ-61 — hairline linear + circular indicator)

- **`PiProgressComponent`** — `frontend/src/app/shared/ui/progress/pi-progress.component.ts`. Standalone + OnPush + signal-based, hairline-only.
- **Variants:** `linear` (1px track + ink-filled value) и `circular` (SVG с двумя окружностями: rule-track 1px + ink-arc 1px; circumference = 2π·16 ≈ 100.53).
- **Sizes:** `sm | md | lg` (16/24/40 px square для circular; linear — full width).
- **Inputs (signal-based):** `value: input.required<number>()`, `max=100`, `variant='linear'|'circular'`, `size='sm'|'md'|'lg'`, `indeterminate=false`, `ariaLabel='Прогресс'`.
- **Computed:** `percent()` clamps [0..100], handles `max <= 0` defensively; `dashArray()` форматит SVG arc dasharray (`"20 80"` для indeterminate, `"<value> <circumference>"` для determinate).
- **A11y (WAI-ARIA compliant):** `role="progressbar"` + `aria-valuenow/min/max/label` на BOTH variants. Для indeterminate: `aria-valuenow` ОМИТТСЯ (null binding) + `aria-valuetext="Загрузка"` — WAI-ARIA: `aria-valuenow` не должен advertise value когда progress unknown.
- **Motion:** `motion-reduce:transition-none` Tailwind utility (TZ-32 compliance, `prefers-reduced-motion`).
- **NO shadow, NO hex, NO bg-white** — `box-shadow` / `drop-shadow` / `bg-white` patterns запрещены (Paper & Ink).
- **Subfolder barrel:** `frontend/src/app/shared/ui/progress/index.ts` экспортирует `PiProgressComponent`, типы `PiProgressVariant` / `PiProgressSize`.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-61-progress.lock` (стабилизирует `shared/ui/progress/*`).

---

## Skeleton (TZ-62 — static hairline placeholder blocks)

- **`PiSkeletonComponent`** — `frontend/src/app/shared/ui/skeleton/pi-skeleton.component.ts`. Standalone + OnPush + signal-based. Static `--color-rule` blocks @ 40% opacity, **NO shimmer / NO pulse / NO shadow** (Paper & Ink anti-bling principle).
- **Variants:** `text` (line-blocks, last line = 60% width via `last:w-3/5` Tailwind variant), `circle` (width=height, fully rounded, avatar placeholder), `rect` (block at width × height, card/media placeholder).
- **Inputs (signal-based):** `width='100%'`, `height='1rem'`, `variant='text'|'circle'|'rect'`, `count=1`, `ariaLabel='Загрузка'`.
- **Computed:** `lines()` materializes index array `Array.from({length: Math.max(0, count())}, (_, i) => i)` for `@for` loop. Defensive against `count=0` / negative.
- **A11y (WAI-ARIA compliant):** `role="status"` + `aria-live="polite"` + `aria-busy="true"` на host root div. Screen-reader announces "Загрузка" без прерывания текущей речи.
- **CSS-only last-item selection:** `[class.last\:w-3\/5]="variant() === 'text'"` applied to ALL spans — Tailwind `last:` pseudo-class handles per-element selection (no JS branching for last-item).
- **Spacing:** `mb-2` between text lines, `i < lines().length - 1` (no margin on last line).
- **Reduced-motion:** автоматически satisfied — нет анимации, нет `media query` нужен.
- **Subfolder barrel:** `frontend/src/app/shared/ui/skeleton/index.ts` экспортирует `PiSkeletonComponent`, тип `PiSkeletonVariant`.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-62-skeleton.lock` (стабилизирует `shared/ui/skeleton/*`).

---

## Avatar (TZ-63 — image + initials + lucide fallback, square monogram)

- **`AvatarComponent`** — `frontend/src/app/shared/ui/avatar/avatar.component.ts`. Standalone + OnPush + signal-based, 3-tier fallback chain.
- **3-tier chain** (`@if` / `@else if` / `@else`):
  1. Если `src()` задан → `<img object-cover draggable="false">` (fills container).
  2. Else if `computedInitials()` не пусто → монограмма (font-display uppercase) в центре квадрата.
  3. Else → `<i-lucide name="user" [size]="lucideSize()">` (50% of container, 12/16/20/28/40 px для xs/sm/md/lg/xl).
- **Inputs (signal-based):** `src: string | null`, `alt: string`, `initials: string`, `size='xs'|'sm'|'md'|'lg'|'xl'`, `rounded='square'|'rounded'`, `ariaLabel='Аватар'`.
- **Sizes:** `xs` (w-6 h-6, 10px), `sm` (w-8 h-8, xs), `md` (w-10 h-10, sm), `lg` (w-14 h-14, base), `xl` (w-20 h-20, xl).
- **Shape:** `square` (default, `rounded-none`) или `rounded` (`rounded-sm` 0.375rem, **НЕ pill/circular** — Paper & Ink anti-SaaS-cliché).
- **Computed `computedInitials`:** explicit `initials().trim().slice(0,2).toUpperCase()` OR derived из `alt().split(/\s+/).map(s=>s.charAt(0).toUpperCase()).slice(0,2).join('')`. `"John Doe"` → `"JD"`. Multi-space обрабатывается gracefully (no empty tokens).
- **A11y (WAI-ARIA compliant):** `role="img"` + `aria-label` на host. `<img>` имеет `alt`. Lucide icon + monogram имеют `aria-hidden="true"` (aria-label на host уже анонсирует identity).
- **Imports:** `LucideAngularModule` для `<i-lucide name="user">` fallback (matches peer badge/card pattern из TZ-34..35).
- **NO `rounded-full` / `box-shadow` / `drop-shadow` / `bg-white` / `#[hex]`** — spec acceptance #5.
- **Subfolder barrel:** `frontend/src/app/shared/ui/avatar/index.ts` экспортирует `AvatarComponent`, типы `PiAvatarSize` / `PiAvatarShape`.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-63-avatar.lock` (стабилизирует `shared/ui/avatar/*`).

---

## Separator (TZ-64 — hr OR label-on-line, hairline 1px --color-rule)

- **`PiSeparatorComponent`** — `frontend/src/app/shared/ui/separator/pi-separator.component.ts`. Standalone + OnPush + signal-based.
- **3 render branches** (`@if` / `@else if`):
  1. `horizontal` + `label` → `<div role="separator" aria-orientation="horizontal" aria-label="<label>">` flex layout: 2 hairlines (`h-px flex-1 bg-rule`) + `<span class="eyebrow text-base">` centered. Print-style bookmark для section dividers (e.g. "Foundations" между sections).
  2. `horizontal` + no `label` → `<hr role="separator" aria-orientation="horizontal" aria-label="<ariaLabel>">` с `border-0 border-t hairline border-rule`. Bare hairline divider.
  3. `vertical` → `<span role="separator" aria-orientation="vertical" aria-label="<ariaLabel>">` `inline-block w-px h-full bg-rule mx-3`. Inline sidebar / horizontal layout separator.
- **Inputs (signal-based):** `orientation='horizontal'|'vertical'`, `label=''` (Print-style bookmark text), `ariaLabel='Разделитель'`.
- **A11y (WAI-ARIA compliant):** `role="separator"` + `aria-orientation` на ВСЕХ 3 branches. Decorative hairlines в label branch помечены `aria-hidden="true"` (parent's role+aria-label уже announce the section).
- **NO shadow / NO hex / NO `border-dashed`** — spec acceptance #4.
- **Subfolder barrel:** `frontend/src/app/shared/ui/separator/index.ts` экспортирует `PiSeparatorComponent`, тип `PiSeparatorOrientation`.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-64-separator.lock` (стабилизирует `shared/ui/separator/*`).

---

## ScrollArea (TZ-65 — themed hairline scrollbar, max-height)

- **`PiScrollAreaComponent`** — `frontend/src/app/shared/ui/scroll-area/pi-scroll-area.component.ts`. Standalone + OnPush + signal-based.
- **3 orientations:** `vertical` (overflow-x-hidden + overflow-y-auto, default), `horizontal` (overflow-x-auto + overflow-y-hidden), `both` (overflow-auto).
- **Inputs (signal-based):** `maxHeight='320px'`, `orientation='vertical'|'horizontal'|'both'`, `ariaLabel='Прокручиваемая область'`.
- **Computed `computedClass`:** `pi-scroll-area ${orientationClass}` — single `[class]` binding (no static class to avoid Angular merge brittleness).
- **A11y (WAI-ARIA compliant):** `role="region"` + `tabindex="0"` + `aria-label`. Keyboard users can Tab into the scrollable region and use arrow-keys (default browser behavior, no JS).
- **Themed scrollbar (TZ-65 spec acceptance #2):**
  - Firefox: `scrollbar-width: thin; scrollbar-color: var(--color-rule) transparent`
  - Webkit/Blink: `::-webkit-scrollbar { width: 4px; height: 4px }`, track transparent, thumb `var(--color-rule)`.
  - Hairline 4px, **NO rounded overlay scrollbar** (Paper & Ink anti-bling).
- **styles.css @layer components block:** `.pi-scroll-area, .pi-scroll-area * { ... }` — applies themed scrollbar to host + all descendants (covers nested scrollers).
- **NO shadow / NO hex / NO bg-white** — spec acceptance #5.
- **Subfolder barrel:** `frontend/src/app/shared/ui/scroll-area/index.ts` экспортирует `PiScrollAreaComponent`, тип `PiScrollOrientation`.
- **Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-65-scroll-area.lock` (стабилизирует `shared/ui/scroll-area/*` + `styles.css` scrollbar block).

---

## Chart wrapper (TZ-66 — bar + line, pure-Angular SVG)

- **NO external chart lib** — hand-rolled pure-Angular SVG. ngx-charts install FAILED (pnpm `ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF`), d3 install also FAILED, so we shipped pure-Angular per thinker's fallback. Spec deviation documented in TZ-66 ARCHIVE_MARKER.

### Files
- **`PiChartComponent`** — `frontend/src/app/shared/ui/pi-chart.component.ts`. Configurator wrapper (figure + figcaption + content slot, hairline border, role=figure).
- **`PiBarChartComponent`** — `frontend/src/app/shared/ui/charts/pi-bar-chart.component.ts`. Bar chart with computed `scaleBand` + `scaleLinear` (pure-TS, see `scales.ts`), hairline 1px grid, sharp 1px rx corners.
- **`PiLineChartComponent`** — `frontend/src/app/shared/ui/charts/pi-line-chart.component.ts`. Line chart with `linePath` generator, dots r=2, 1.5px stroke (NOT 3px blob), optional legend.
- **`chart.tokens.ts`** — `frontend/src/app/shared/ui/charts/chart.tokens.ts`. 4 palettes (mono / mono-warm / mono-cool / paper-ink) using CSS custom properties; viewBox 480x320; bar/line geometry constants.
- **`scales.ts`** — `frontend/src/app/shared/ui/charts/scales.ts`. Pure-TS `scaleBand`/`scaleLinear`/`linePath` helpers (~55 lines, no d3 dep).
- **`charts/index.ts`** — barrel exports all components + types + tokens + scales.

### Reactive colorScheme (TZ-77 Theme Editor)
Each bar's `fill` and each line's `stroke` is a CSS custom property like `var(--color-accent-warm)`. TZ-77 Theme Editor updates `<html>` --color-* vars → chart re-tints automatically (0 JS listener).

### X-axis baseline
Uses `zeroY()` computed = `padding.top + yScale()(0)`. For non-negative data, equals viewBox bottom. For mixed-sign data, follows the data zero-line.

### Method calls in template
`barGeometry`, `colorFor`, `xPosFor`, `pathFor` are called on every CD cycle. Code-reviewer flagged as future optimization for large datasets (>50 points). For typical Paper & Ink editorial use (4-12 points), this is fine.

### Lock-файл
`OrchestratorKit/.mimocode/locks/TZ-66-charts.lock` (стабилизирует `shared/ui/pi-chart.component.ts` + `shared/ui/charts/*`).

---

## KitLayout (TZ-67 — sticky app shell + ⌘K hint + theme toggle)

**Файлы:** `frontend/src/app/layout/kit-layout.component.ts` + `theme-toggle.component.ts`.

**App shell** для editorial SPA (enrich поверх TZ-30 base layout):

- **Sticky top-bar:** `<header class="sticky top-0 z-20 border-b border-rule bg-paper/80 backdrop-blur">` с brand слева + ⌘K hint + theme toggle справа.
- **Sticky sidebar:** `<aside class="sticky top-14 h-[calc(100dvh-3.5rem)] border-r border-rule">` с nav через `<ng-content select="[nav]">`.
- **Content:** `<main class="px-8 py-10 max-w-6xl mx-auto"><ng-content /></main>` — standard prose width.
- **Theme toggle:** использует `ThemeService.toggle()` + `mode()` signal (НЕ manual localStorage writes — ThemeService уже инкапсулирует storage из TZ-33).
- **Default light mode** per TZ-67 spec (initial DOM is light, ThemeService.init() syncs to stored preference).
- **<kbd> element** для ⌘K hint (semantic kbd, не div).

**`theme-toggle.component.ts`:** 2-variant button (sun/moon Lucide icons) с `aria-pressed` для accessibility. Inputs: `ariaLabel='Переключить тему'` (overridable). Standalone + OnPush + signals.

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-67-kit-layout-enrich.lock` (стабилизирует `layout/kit-layout.component.ts` + `layout/theme-toggle.component.ts`).

---

## Page primitives (TZ-68 — PageHeader · Section · Demo)

**Файлы:** `frontend/src/app/shared/page/`.

**3 wrapper'а** для future pages (TZ-69..74 batch):

- **`<pi-page-header>`** — eyebrow (uppercase 12px tracking-wide + accent line) + h1 (font-display text-4xl font-light tracking-tight) + subtitle (text-ink-2 text-lg max-w-prose) + meta (small caps right-aligned). Inputs: `eyebrow`, `title` (required), `subtitle`, `meta`. Signal-based.
- **`<pi-section>`** — section wrapper с hairline border-top (1px) + padding-y 12. Inputs: `eyebrow`, `title` (required), `id` (for deep-link anchors через fragment navigation). Content slot default. Используется в TZ-69..74 pages для anchored deep-links.
- **`<pi-demo>`** — demo card с title (required) + description (optional) + preview slot default + code toggle (signal-based `codeOpen`). Code can be passed via `[code]` string OR via `<ng-content select="[source]">` slot (latter для TZ-78 live code). Toggle button: discrete `<button>` с chevron, `aria-expanded`. Mono code в `<pre>` с sharp 1px rx.

**Все 3:** standalone + OnPush + signal inputs. No any/OnInit/OnDestroy. NO shadow / NO hex / NO bg-white (Paper & Ink anti-bling).

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-68-page-primitives.lock` (стабилизирует `shared/page/*`).

---

## WAVE C: 6 lazy pages (TZ-69..74, 2026-07-05)

**6 page-файлов** под `frontend/src/app/pages/`, lazy-loaded через `app.routes.ts` → `KitLayoutComponent` (TZ-67) → `<router-outlet>`. Все standalone + OnPush + signal-based, используют `<pi-page-header>` + `<pi-section>` + `<pi-demo>` (TZ-68).

| Page | TZ | Sections | Notable primitives |
|------|-----|---------|---------------------|
| `/overview` | TZ-69 | PageHeader + Быстрый старт + Что внутри + Принципы + Sonner toast panel | pi-button, pi-card, pi-badge, lucide icons, data-toast-trigger smoke test |
| `/foundations` | TZ-70 | PageHeader + Палитра (8 OKLCH swatches) + Типографика + Spacing & Radius + Grid | pi-card (preview/info slots), native inline styles |
| `/basics` | TZ-71 | PageHeader + Buttons (6×4×2) + Inputs (signal-state) + Badges (4×2) + Cards (3 comps) | pi-button, pi-badge, pi-form-field, native input/textarea |
| `/forms` | TZ-72 | PageHeader + Validated form + Data table + Form variants | raw HTML `<table>`, raw pagination buttons, ReactiveForms + class-validator |
| `/overlays` | TZ-73 | PageHeader + Dialog + Sheet/Drawer + Tooltip/Popover + DropdownMenu + Toast | PiToastService (variants), custom dropdown, lucide icons |
| `/navigation` | TZ-74 | PageHeader + Tabs + Breadcrumb + Accordion + Progress/Skeleton/Avatar + Charts + Separator + ScrollArea | pi-tabs/tab, pi-breadcrumb/item, pi-accordion/item, pi-progress, pi-skeleton, pi-avatar, pi-separator, pi-scroll-area, pi-bar-chart, pi-line-chart |

**Spec deviations (документированы в .done.txt файлах):**
1. **Input/Textarea (TZ-71):** директивы не существуют (InputComponent/TextareaComponent — components, не directives). Реализовано native `<input>`/`<textarea>` с Tailwind-стилями.
2. **Table + Pagination (TZ-72):** TableComponent/PaginationComponent существуют но API не идеально подходит — raw HTML `<table>` + raw buttons для пагинации.
3. **Dialog demos (TZ-73):** `PiDialogService.open()` сигнатура `(component, config)` — для demo используется toast. Полная CDK-overlay flow: `dialog.open(PiDialogComponent, { data: {...} })`. **Stabilization DOC-340 / UX-DIALOG-301 / UX-DIALOG-302 / UX-FORM-301:** shell widths `min(…px, calc(100vw - 2rem))`; form xl ~920; QuickCreate S/M/L→md/lg/xl + **12-col field capacity** (не наивные 2-col). Canon kinds A–D: `docs/DIALOG-COOKBOOK.md` + `docs/pages/ui-dialog-canon.md`; ёмкость: `docs/pages/ui-form-field-capacity.md`.
4. **Breadcrumb (TZ-74):** `href` prop на custom component рендерит native `<a href>`. Для SPA nav может потребоваться `[routerLink]`.

**Total:** ~1262 lines across 6 pages. Typecheck PASS (`pnpm exec tsc -p tsconfig.app.json --noEmit` exit 0). No box-shadow/drop-shadow/hex/bg-white.

**Lock-файлы:** `OrchestratorKit/.mimocode/locks/TZ-{69..74}-{name}-page.lock` (стабилизируют `pages/*/*.page.ts`).

---

## Command Palette (TZ-75 — ⌘K fuzzy search + nav)

**Файлы:** `frontend/src/app/shared/command/pi-command-palette.component.ts` + `pi-command-palette.service.ts` + `index.ts` + `app.ts` (mount).

**Linear / Raycast-style ⌘K overlay:**
- **Service** — singleton (`providedIn: 'root'`), signal-based `_isOpen` state, SSR-safe keyboard listener (Cmd/Ctrl+K toggle, Esc close).
- **Component** — standalone + OnPush + signal-based. 30 items: 6 routes (`/overview`..`/navigation`) + 24 primitives (Button, Badge, Dialog, Sheet, Tooltip, Popover, DropdownMenu, Toast, Tabs, Breadcrumb, Accordion, Progress, Skeleton, Avatar, Separator, ScrollArea, Charts) + 1 action (theme toggle).
- **Fuzzy filter** — subsequence char-by-char match (every char in query must appear in label, in order).
- **Keyboard nav** — ArrowDown/Up cycle `selectedIdx`, Enter activates, Esc closes (service).
- **Backdrop** — `bg-ink/30` opacity (NOT blur, NOT glassmorphism — Paper & Ink anti-bling).
- **Mount** — `<app-pi-command-palette />` в `app.ts` рядом с `<app-pi-toast-host />`.

**Theme toggle action** uses `inject(ThemeService).toggle()` directly (TZ-33). Initial implementation had broken `window.__piThemeService` lookup (code-reviewer NEEDS_FIX — fixed).

**mouseenter handler** removed per code-reviewer (prevented keyboard nav clobbering).

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-75-command-palette.lock` (стабилизирует `shared/command/*` + `app.ts`).

---

## Prop Playground (TZ-76 — live signal-driven controls)

**Файлы:** `frontend/src/app/shared/playground/pi-playground-button.component.ts` + `pi-playground-badge.component.ts` + `index.ts`.

**Storybook-style controls** для Button + Badge:
- **`<app-pi-playground-button>`** — split view (grid-paper preview + controls panel). Signals: variant (6 options), size (4), disabled, loading, hasLeadingIcon, label. 6×4×2 button coverage + label editor.
- **`<app-pi-playground-button>` loading state** — inline spinner span с Tailwind `animate-spin` (no box-shadow, no hex).
- **`<app-pi-playground-badge>`** — split view + signals: variant (4), size (2), dot, text. 4×2 badge coverage + dot toggle.

Все standalone + OnPush + signal-based. NO box-shadow/drop-shadow/hex/bg-white.

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-76-playground.lock`.

---

## Theme Editor (TZ-77 — live OKLCH sliders)

**Файлы:** `frontend/src/app/shared/theme/theme-editor.service.ts` + `pi-theme-editor.component.ts` + `index.ts` + `pages/playground/theme-editor.page.ts` + `app.routes.ts`.

**Live OKLCH editor** на `/playground/theme`:
- **Service** — signal-based override state, NON-DESTRUCTIVE: TZ-32 base @theme inline values сохранены, overrides applied via `style.setProperty('--color-X-override', oklch(L% C H))`. Persists в localStorage `pi.theme-overrides` (JSON). SSR-safe (isPlatformBrowser guard).
- **Component** — 3 slider groups (ink/paper/rule) × 3 dimensions (L/C/H) = 9 sliders. Live preview с Card + Badges + Button. DecimalPipe для value display.
- **Page** — PageHeader + Sliders + Reset explanation section.
- **Route** — `app.routes.ts` +`/playground/theme` lazy-loaded.

**Code-reviewer fixes applied:** (1) DecimalPipe imported + в component's imports array (для `| number: '1.0-2'` pipe), (2) `reset()` использует single `commit()` (DRY).

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-77-theme-editor.lock`.

---

## Live Code Preview (TZ-78 — FALLBACK: no highlight.js)

**Файлы:** `frontend/src/app/shared/code/pi-code-preview.component.ts` + `index.ts`.

**Spec deviation:** `pnpm add highlight.js@^11` FAILED с `ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF` (тот же pnpm config blocker, что и TZ-66 charts). Fallback: plain monospace `<pre><code>` БЕЗ syntax highlighting.

**PiCodePreviewComponent** (~40 lines):
- Standalone + OnPush + signal-based.
- Inputs: `code` (required), `language` (default html), `ariaLabel`, `showLineNumbers` (default true).
- Computed `formattedCode` — line numbers через padStart(3).
- Template: `<pre class="bg-paper-2 border-t hairline border-rule p-4 overflow-auto mono text-[12px] leading-relaxed text-ink">` + `<code class="block whitespace-pre">`.
- No syntax highlighting (fallback). Future TZ-78b: re-attempt `pnpm add highlight.js@^11` после `pnpm install` reconcile.

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-78-live-code-preview.lock`.

---

## Print stylesheet (TZ-79 — @media print block, axe-core DEFERRED)

**Файлы:** `frontend/src/styles.css` (@media print block only).

**Spec deviation:** `pnpm add -D axe-core@^4.10` FAILED same reason. axe-core a11y audit spec DEFERRED.

**@media print block**:
- `:root` overrides: paper → white, ink → black, rule → #ccc.
- Hide chrome: aside, header[role='banner'], footer, palette, toast.
- main padding 0, max-width 100%.
- section break-inside avoid (page-break friendly).
- h1 22pt, h2 14pt, h3 12pt.
- Remove all animations/transitions/shadows.
- `a[href]:not([href^='#']):after` shows link URL after text.

**No new deps required** для @media print block.

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-79-print-a11y.lock`.

---

## SSR / Hydration (TZ-80 — REJECTED)

**REJECTED 2026-07-05 — out of project scope.** SSR-pretendering exits in
the project: no `@angular/ssr`, no `express`, no server build, no
hydration. Angular 20 SPA ships client-side rendered from `dist/frontend/browser/`
served by the inline static server in `start.mjs` (TZ-42).

If a future Load Test or SEO need arrives:
- Treat it as a brand-new TZ (don’t reopen TZ-80). It will need
  fresh `pnpm add` (after lockfile reconcile) + multi-file setup
  (main.server.ts + server.ts + app.config.ts provider + new
  angular.json server target). Not a quick win — at least half a day.
- Or consider static prerender (`ng build --prerender`) as a lighter
  alternative — gives HTML-first render without a node server.
- Nothing in the existing TZ-30..82 chain assumes SSR. State stays clean.

**Lock-файл:** N/A (rejected; no placeholder retained).

---

## Document Constructor (TZ-86 — 2026-07-11, flagship feature)

**Файлы:** комплексная зона — backend modules (4 new + 4 extended) + frontend pages (4 new routes) + 4 frontend services + 5 e2e specs + extended row-actions component.

### Backend modules (NestJS)

- **`backend/src/modules/text-block/`** (NEW, TZ-86A.1) — schema/service/controller/module/DTOs. Fields: name, slug (Russian transliteration), content (markdown), tags[], category, sortOrder, isActive. Slug uniqueness via Mongo unique index + 11000→409 catch.
- **`backend/src/modules/table-template/`** (EXTENDED, TZ-86A.2) — ColumnColumn gains `type: ColumnType` (text|number|date|currency|bool); TableTemplate gains `category?` (5 enum), `sortOrder`, `sampleRows?: unknown[][]`, `dataSource?`. `GET /:id/preview` endpoint.
- **`backend/src/modules/template-block/`** (EXTENDED, TZ-86A.3) — schema gains `dataBinding?: { source, field?, value?, format? }` subdoc (`_id: false`).
- **`backend/src/modules/document-template/`** (EXTENDED, TZ-86A.4 + A.6) — `build(id, dto)` service method + `POST /:id/build` controller endpoint. `uploadBackground(id, file)` method + `POST /:id/upload-background` controller endpoint. Module imports 5 new modules (Organization/Counterparty/Product/Material/WorkType) for `resolveSourceIds` parallel lookups. TZ-266 adds `assertBuildSourcesInOrganization()` as a pre-generation boundary: explicit source IDs are validated, missing/foreign organization-owned sources return safe 404s, and legacy shared relations are checked before generated-document persistence. **Stabilization DOC-337:** `CreateDocumentTemplateDto.pageSize` ∈ `A3|A4|A5` (aligned with UI chips).
- **`backend/src/modules/registry/`** (NEW, TZ-86A.5) — controller/service/module. `GET /api/registry/data-sources` lists 5 entity types + `{key, label, type}` field metadata.
- **`backend/src/common/filters/multer-exception.filter.ts`** (NEW, TZ-86A.6) — `@Catch(MulterError)` maps `LIMIT_FILE_SIZE` → 413 + other MulterErrors → 400 + Russian human-readable messages.

### Frontend services (silent-http + signals)

- **`frontend/src/app/shared/services/pi-text-blocks.service.ts`** — `list/findById/create/update/remove`.
- **`frontend/src/app/shared/services/pi-table-templates.service.ts`** — `list/findById/create/update/remove/preview` (preview silentWrap text).
- **`frontend/src/app/shared/services/pi-document-templates.service.ts`** — `list/findById/create/update/remove/build/uploadBackground` (build silentWrap text; uploadBackground FormData multipart). TZ-267 also centralizes template setup, set-default, and duplicate JSON calls behind the service's `SilentResult` boundary.
- **`frontend/src/app/shared/services/pi-registry.service.ts`** — `getDataSources` (static catalogue).
- **`frontend/src/app/shared/services/pi-template-blocks.service.ts`** — list/create/update/reorder/remove for template blocks consumed by BuilderPage.
- **`frontend/src/app/shared/services/pi-generated-documents.service.ts`** — `list/findById/generate/remove/openHtml` for HTML snapshots produced by `document-template.build()`.

### Frontend pages (6 lazy routes)

**Paper & Ink list-page contract** (canonical reference: `templates.page.ts` / `tables.page.ts`, TZ-DOC-336):
`app-pi-page-header` + `app-pi-toolbar` (`pi-input`, `app-pi-button`, `hint` slot) + `app-pi-section` with `hairline rounded-sm` table (`pi-cell`, `pi-table-row`, `eyebrow` headers) + `app-pi-row-actions` / `app-pi-switch`. Builder workspace (`builder/:id`) keeps specialised layout but reuses the same tokens (`var(--color-*)`, hairline borders, `app-pi-button`).

- **`/doc-constructor/texts`** — Pi chrome catalog + optional full-page `text-block-editor` above (not modal; successor). Search + category filter in toolbar; row-actions; `editId` deep-link. Editor: `app-pi-switch` «Активен», Lucide align icons.
- **`/doc-constructor/tables`** — Pi chrome list (no promo aside); copy via `PiRowActions` copy slot; `editId` deep-link (DOC-335). Dialog `table-template-dialog`: FormField/Input/Switch canon.
- **`/doc-constructor/templates`** — «Реестр шаблонов»: search, active toggle, default star, duplicate via `copyLabel`/(copy) → builder, pagination. TZ-267 distinguishes loading, empty, and initial-load error states, exposes retry, and reports action failures without optimistic success/navigation. **Stabilization DOC-338/339:** create setup = system categories only + required `categoryId`; duplicate setup hides category (source kept server-side); pageSize A3–A5.
- **`/doc-constructor/documents`** — «Сформированные документы»: search + month filter, status dots, open HTML preview, delete.
- **`/doc-constructor/builder`** — empty-state picker (no `:id`): template dropdown → navigate to `/builder/:id` or accepts `?source=order&sourceId=X` query params (cross-feature wiring from /orders + /contracts).
- **`/doc-constructor/builder/:id`** — 3-pane canvas (280 / flex-1 / 320):
  - **Left tool pane** (4 sections + Decorations tab): Blocks (5 blockType «+» buttons) · Texts (list from `pi-text-blocks`) · Tables (list from `pi-table-templates`) · Data (DataSourceDescriptor groups from `pi-registry`) · Decorations (background image upload via `pi-document-templates.uploadBackground`).
  - **Center canvas**: `<pi-canvas-page>` (A4 paper wrapper, OKLCH paper + 1px hairline + 32px padding) + `<pi-canvas-block-handle>` (cdkDragHandle GripVertical, hover-only) + `cdkDropList` for reorder.
  - **Right inspector**: block config (type, content, dataBinding, font-size, alignment, color, padding) when block selected; empty state otherwise.
  - **Auto-save 1500ms debounce** (Subject piped through groupBy+debounceTime+switchMap, per-block debounce so editing block A doesn't reset block B's timer).
  - **Last-saved indicator** (small chip in `PiPageHeader`): «✓ Сохранено» / «Сохранение…» / «⚠ Ошибка» via `saveStatus: signal<'idle'|'saving'|'saved'|'error'>`.
  - **Drag-from-palette:** `cdkDrag` on all 4 tool-pane palette lists + `cdkDropListConnectedTo: [CANVAS_DROPLIST_ID]` linking them to the canvas `cdkDropList`. `CANVAS_DROPLIST_ID` exported from `builder-canvas.component.ts` (single source of truth).

### Cross-feature integration (TZ-86E)

- **`PiRowActionsComponent`** extended with optional 3rd slot: `documentLabel: input<string|null>(null)` + `dataTestDocument: input<string|null>(null)` + `document: output<T>()`. Template renders the new `<button>` BEFORE the Edit button (Document → Edit → Delete; destructive-at-edge UX convention). Wrapped in `@if (documentLabel())` so the 5+ existing consumers (Materials/Organizations/Dictionaries/WorkTypes/Modules) see **ZERO visual change** (backwards-compat).
- **`OrdersPage` + `ContractsPage`** — `Router` inject + `[documentLabel]`/`[dataTestDocument]` bindings + `(document)="onCreateDocument($event)"` handler. Navigation to `/doc-constructor/builder?source=order&sourceId=X` (or `source=contract`).
- **TZ-ORDERS-302 (2026-08-08):** `/orders/:id` detail — chrome «Заказ №…» + live BOM via shared `app-composition-tree` (line roots → `getProductTree`). No deal prices on tree. List number links to detail.
- **TZ-UX-311 (2026-08-08):** composition-tree row — mini-thumb after kind badge (`photoUrl` from catalog-graph / Lucide placeholder); name `line-clamp-2` + `break-words` (not truncate). Same component for product/module/order trees.
- **TZ-SUPPLY-301 (2026-08-08):** `backend/src/modules/supply/` — `SupplyTask` (draft→confirmed→ordered→received; `confirmedBy`/`confirmedAt`). FE `/supply` list + manual create. BOM explode → SUPPLY-302.
- **Simplification note (historical TZ-86E):** originally assumed missing detail pages; ORDERS-302 added order detail; contracts still list-only unless a later TZ.

### Tests (TZ-86F.1, 5 NEW e2e suites, 34 tests)

- `backend/test/e2e/text-blocks.e2e-spec.ts` (7 tests) — CRUD + slug uniqueness (409) + Russian transliteration auto-slug + soft-delete.
- `backend/test/e2e/table-templates.e2e-spec.ts` (8 tests) — CRUD + `/preview` HTML + `Intl.NumberFormat` ru-RU/RUB currency + softDelete.
- `backend/test/e2e/document-templates-build.e2e-spec.ts` (5 tests) — `{{organization.name}}` substitution + static dataBinding Mongoose bypass + empty placeholder fallback + invalid templateId 400.
- `backend/test/e2e/registry.e2e-spec.ts` (7 tests) — 5 data sources + `{key, label, type}` field metadata.
- `backend/test/e2e/document-templates-upload-background.e2e-spec.ts` (7 tests) — multer whitelist (png/jpeg/webp) + 5MB cap + 5-image limit + URL return.
- **Pattern:** uses `createTestApp()` + `loginAsAdmin()` from `test/setup/` (the e2e baseline from TZ-17/46). HTTP for most operations; Mongoose direct only for the static dataBinding bypass (legitimate test pattern when `CreateTemplateBlockDto` lacks `dataBinding` field + global `ValidationPipe whitelist: true` strips unknowns).

### Verification

- Backend `pnpm exec tsc -p tsconfig.build.json --noEmit` → exit 0 ✅
- Frontend `pnpm exec tsc -p tsconfig.app.json --noEmit` → exit 0 ✅
- 5/5 e2e suites green, 34/34 tests pass (~26s total) ✅
- Code-reviewer: PASS-WITH-NITS (4 TZ-87 followups logged)
- 9 atomic commits on origin/main: `cdb2737` (D.1) → `d70646d` (D.2) → `1d7a51d` (E) → `f4a2bd2` (F.1) → `555eeed` (F.4 doc sync) + 4 prior Phase A/B/C atomic commits

## Browser-use smoke test (TZ-82 — INDEPENDENT)

**INDEPENDENT — runs against dev server :4200 (`ng serve`).** No SSR
required; smoke tests target the angular router + lazy routes that already
work in CSR mode. Stack: Playwright + Lighthouse + Codebuff `browser-use`
agent fallback. See `OrchestratorKit/_archive/2026-07/TZ-82.done.txt`
(when implemented) for runbook.

**Lock-файл:** `OrchestratorKit/.mimocode/locks/TZ-82-smoke-test.lock` (placeholder, no code changes).

> **Security audit reference (TZ-205, 2026-07-25):** brute-force protection on /auth/login, bcrypt-hashed User.passwordHash, refresh-token version revocation, and /auth/me projection hardening are documented in [docs/security-audit.md](docs/security-audit.md). TZ-202.B unblocked from this prerequisite; remaining gate is PO + senior security engineer cosign per AGENTS.md §7.5.


## Desktop MCP socket (TZD-11)

Local MCP host for any MCP client (not Cursor-specific):

- Package: `desktop/mcp` (`@kppdf/desktop-mcp`), workspace member of `desktop/`
- Transports: Streamable HTTP (`127.0.0.1:9743` default) + stdio
- Auth: same pairing JWT as desktop (`KPPDF_API_KEY`); HTTP requires matching Bearer
- Tools: reads (TZD-12) + writes propose/confirm/undo Material (TZD-13) via `/api/mutation-journal`
- Text drafts: TZD-30 tools list/create `TextBlockCategory` shelves and inactive `TextBlock` drafts, then create manager todos linking to `/doc-constructor/texts?editId=`; no publish, overwrite, `notes`, or silent category fallback
- Docs: `desktop/docs/MCP.md` (manager 3-step connect + safety)
- Vision: `docs/superpowers/specs/2026-08-05-desktop-mcp-agent-vision.md`
- **Owner:** Cursor owns desktop/MCP quality end-to-end
- Follow-ups: TZD-14 host UI · TZD-15 inbox · TZD-05 web pairing (FE parallel)

## Inventory transaction contract (Z-001)

The accounting/warehouse domain guarantees the following atomicity for
write-paths:

1. `shipment.dispatch` is atomic — movements + reservation fulfills +
   shipment status update either all succeed or all abort.
2. `purchase-order.receive` is atomic — movements + status update.
3. `order.ship` is atomic — shipment creation + order.status update.

Reverse-movement (`stock-movement.remove` variant a) keeps the warehouse-side
delta at zero by emitting a complementary movement in the same transaction.
Subordinate services (`StockMovementService.create`, `ReservationService.fulfill`)
honor an optional `externalSession` so the caller can run them on its own
transaction. See `docs/data-model.md` § Concurrency & Transactions.

## Quotation family — multi-org КП (TZ-SALES-303 / D21 layer 1)

`backend/src/modules/quotation/` — schema-first family on existing Quotation
(no separate proposal module):

- Fields: `familyRole` (`solo`|`master`|`variant`), `masterId?`, `familyVersion`
  (default 1), `orgMarkupPercent?`; unique sparse `{ masterId, organizationId }`.
- Thin API: `POST :id/family/attach-organizations`, `POST :id/family/sync-from-master`,
  `GET :id/family`. Convert of a **variant** → 400 (master/solo only).
- UI expand / markup dialog / variant editor → **TZ-SALES-313 DONE** (ex-304; family list UI on `/proposals`).

## KP create studio (WAVE-KP-VITRINE)

- **IA chrome (310):** Deals dark TOC КП|Договоры|Заказы; proposal-only yellow **Создать КП**|**Все КП**; guarded `/proposals/create` stub.
- **Layout SoT (311):** `docs/ux/kp-create-studio-spec.md` — desktop 3 columns (Left 280–320 / Center flex A4 / Right 300–340), tablet/mobile drawers, empty RU copy; page doc `docs/pages/proposals-create.page.md`.
- **Vitrine (348 DONE):** chips Изделия/Модули/Материалы; «В КП: N» from draft; add qty; `lineKind` module|material + `refId` on QuotationItem (legacy `productId` catalog intact).
- **Shell (312 DONE):** `proposal-create.page.ts` three-zone placeholders + narrow toggles; fill → **314/315/316**; family list → **313**.
- **Shell (312):** `/proposals/create` three-zone placeholder studio with narrow toggles; fill remains 314/315/316; print **320 PARKED**.
- **Next:** rails 314/315 → template 316; list family UI **313**; print **320 PARKED**.
