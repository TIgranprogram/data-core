# A2 — опись документации (C068, 2026-11-11)

Метод: размер, дата `git log -1`, число ссылающихся файлов (grep имени по docs, .claude, pult, tools, deploy, корню; archive исключён). Скрипт ссылок: markdown-ссылки и пути `docs|deploy|tools|pult|backend|...` в обратных кавычках → существует ли файл. Большие файлы — по заголовкам. Чтение без правок.
Оговорка: в «ссылок» попадают копии репо в `.claude/worktrees/*` (73 МБ, 2 живых worktree, см. раздел 5) — числа завышены у многих файлов. Нулевые значения достоверны.

## 1. Устаревшие факты (исправить)

| Файл:строка | Сейчас написано | Должно быть / проверка |
|--|--|--|
| docs/CONTROL.md «Текущий выпуск» (~стр. 21) | `v1.595 (2026-11-07, e38bfd88)` | последний тег `release-v1.693-2f48d988` (2026-11-11). Строка Ц5 в таблице целей: `v1.595 — ОК` — то же |
| docs/CONTROL.md стр. 12, 14 заголовок колонки | «Сейчас (2026-11-07)», Ц1 «12 видов, 19 раз» | цифры 4-дневной давности; обновить из `dc errors 24` |
| docs/HISTORY.md | последняя запись v1.685 (2026-11-11) | выложены ещё v1.686…v1.693 (теги release-v1.691/692/693 есть). Журнал отстаёт на 8 выпусков |
| docs/HISTORY.md стр. 48 | строка записана в битой кодировке (`� ������, ����� VPS`, запись v1.684) | переписать в UTF-8 |
| AGENTS.md стр. 19 | «сейчас около 60 модулей» | `backend/src/modules` — 72 папки, `app.module.ts` — 161 упоминание Module; писать «70+» либо убрать число |
| docs/BACKLOG.md стр. 24 «Текущий выпуск — 2026-11-03» (роль A3, для сведения) | выпуск 11-03 | последний v1.693 (11-11) |
| docs/TEST-LOG.md | таблица заканчивается 2026-11-11 `19522b7d C062` — актуально | OK. Но с строки 153 в файле лежат не журнал, а разделы «Разбор C058 office→home…», «Учёт ошибок ИИ-тестировщика», «Чек-лист: усилить ИИ-тестировщик» — чужое содержимое (см. раздел 6) |
| docs/MAP.md стр. 31, 56, 73 | `docs/kppdf-patch-invoice-date.md`, `docs/roles/tz/WAREHOUSE-ZONES.md`, `backend/pwa/version.json` | первые два — в archive (WAREHOUSE-ZONES есть в `docs/archive/roles/tz/`); `version.json` создаётся только при выкладке (release.sh `--add-virtual-file`), в репо его нет — пояснить в MAP |
| docs/PRODUCT.md:16 | `docs/crew/C009-nomenclature-ssot/TZ.md` | в `docs/crew` нет C009; искать в `docs/archive/crew/` (там C001…) — пометить «архив» |
| docs/roles/maps/analyst.md:11 | `docs/crew/C061-passport-bind-audit/ANALYSIS.md` | папка называется `C062-passport-bind-audit` (C061 — это trainers-load). Перепутан номер |
| docs/roles/maps/analyst.md:30–69 (19 ссылок) | `docs/roles/tz/PASSPORT-FUNNEL-analyst.md`, `DICT.md`, `DESIGN-BOARD.md`, `FEEDBACK-1027.md`, `DOCS-ORDERS.md`, `SUPPLIER-CATALOG.md`, `CHAIN-AUDIT.md` и др. | файлов нет в `docs/roles/tz` — они в `docs/archive/roles/tz/` (проверено: BZ-14, PASSPORT-FUNNEL-analyst, WAREHOUSE-ZONES, CHAIN-AUDIT; DICT — как `DICT-решения.md`). Заменить на «архив: `dc doc roles/tz/…`» |
| docs/roles/maps/backend.md:15, 33; qa.md:21–23; qa.md(роль):12–13 | `C050-my-tasks/REPORT-E1.md`, `C026-kp-templates/*`, `C019-…/QA.md`, `C021-money-audit/QA.md` | в docs/crew этих папок нет (C050 есть, REPORT-E1 нет; C019/C021/C026 — в `docs/archive/crew`) → пометить «архив» |
| docs/roles/maps/data-steward.md:16, 24, 27 | `docs/PASSPORTS-TEXTS-SELECTION.md`, `roles/tz/PASSPORT-FUNNEL-data-steward.md`, `PP-TEXTS-POLISH.md` | в архиве |
| docs/DESIGN.md:426 | `docs/audit/AUDIT-ORDERS-2026-10-31.md` | нет в репо; вероятно архив |
| docs/PASSPORTS-V2.md:3 | `docs/PASSPORTS-AUDIT.md` | нет в репо; вероятно архив |
| docs/DB-AUDIT.md:3, 318 | `docs/roles/tz/BZ-14.md`, `PASSPORT-FUNNEL-data-steward.md` | в архиве (BZ-14 есть) |
| docs/audit/AUDIT-PLAN.md:27 | `AUDIT-PRODUCTION.md`, `AUDIT-UI.md`, `AUDIT-ARCH.md` | нет в docs/audit; закрытый план — в архив вместе с остальным |
| docs/audit/AUDIT-KP.md:3 | `docs/audit/KP-SOURCES.md` | нет файла |
| docs/audit/AUDIT-PASSPORTS-CONTENT.md:3 | `roles/tz/PP-STANDARDS-CHECK.md` | в архиве/нет |
| docs/audit/AUDIT-2026-11-05.md:14 | `tools/logs/audit/2026-11-03/REPORT.md` | tools/logs не в git — ожидаемо; в самом файле: «папка .cursor не закоммичена» — уже неактуально (.cursor/rules закоммичены 2026-11-10/11) |
| docs/data-model.md:707 | `backend/src/common/db/session-runner.ts` | каталога `common/db` нет; проверить реальный путь (предположение: переехал в `database/`) |
| docs/roles/maps/frontend.md:89 | `backend/pwa/ui/toast.js` | файла нет (A5/frontend проверит; отражает переименование) |
| docs/TEST-LOG.md:185 | `tools/logs/ai-tester/.../REPORT.md` | не в git, ожидаемо |
| .claude/agents/datacore-backend.md:3 (description) | «работает по ТЗ координатора (docs/roles/tz/*.md)» | с 2026-11-07 ТЗ — только `docs/crew/Cxxx-…/TZ.md` (AGENTS, CLAUDE). Агент analyst:24 в worktree-копии тоже, в основной версии — `docs/crew/Cxxx/TZ.md` (OK; плейсхолдеры `Cxxx` в roles/README:36 — не битые) |

Ссылки на `docs/crew/Cxxx/...` и `tools/logs/...` — шаблоны/не-в-git, битыми не считаю. Итого реально битых без архива: ~10 (тексты выше с «нет файла / нет в архиве»); остальные ~35 указывают в архив.

## 2. Таблица файлов (корень и docs/*.md; TASKS/BACKLOG/QUESTIONS — не мой scope)

| Файл | Размер | Посл. коммит | Ссылок | Назначение | Вердикт |
|--|--|--|--|--|--|
| AGENTS.md | 20 КБ | 11-07 | много | вход агента, карта доков, правила | исправить (число модулей) |
| CLAUDE.md | 14 КБ | 11-10 | — | правила координатора | оставить; сократить (см. п.4) |
| MANUS.md | 7.9 КБ | 11-07 | — | правила для сессий Manus + утверждённые правила счетов | оставить; «Supply invoices» вынести в PRODUCT/CANON |
| README.md | 4.9 КБ | 11-01 | — | витрина проекта | исправить (проверить схему и «в разработке»), по дате 10 дней — мелко |
| ROADMAP.md | 2.7 КБ | 10-20 | — | «Где мы (2026-10-18)» | устарел: слить в BACKLOG «Сейчас» + CONTROL «Цели», удалить |
| VISION.md | 8.9 КБ | 10-20 | — | зачем проект, принципы | оставить |
| docs/CONTROL.md | 2.9 КБ | 11-10 | 41 | состояние одной страницей | исправить (v1.595→v1.693, цифры целей) |
| docs/CANON.md | 40 КБ | 11-03 | 73 | законы дизайна/экранов | оставить; тяжёлый — вынести «Журнал»-часть, если есть |
| docs/PRODUCT.md | 23 КБ | 11-08 | 67 | что умеет, решения | исправить (ссылка C009) |
| docs/PATTERNS.md | 8 КБ | 11-10 | 28 | паттерны П-1… | оставить |
| docs/ARCHITECTURE.md | 15 КБ | 11-09 | 46 | устройство запроса, auth, единая база | оставить |
| docs/ARCH-PLAN.md | 49 КБ | 10-26 | 31 | ТЗ архитектурных задач М/АБЗ, цифры 2026-10-22 | частично в архив: закрытые АБЗ/М; живое — A5 определит. Не обновлялся 16 дней, «цифры пересчитать» |
| docs/MAP.md | 148 КБ (131 строка) | 11-11 | 248 | модуль→маршруты→коллекции | оставить, но разбить (п.6) |
| docs/data-model.md | 66 КБ | 11-11 | 45 | поля сущностей («ориентир») | оставить; сократить (истина — schema.ts, `GET /api/meta/schema`) |
| docs/DESIGN.md | 170 КБ (460 строк) | 11-11 | 178 | дизайн-система, §8 журнал решений (стр. 310–402), §9 внешние скиллы, «Карта Работа с сайтом» (439+) | разбить (п.6) |
| docs/DESIGN-MOBILE.md | 14 КБ | 11-03 | 11 | стандарт мобильных экранов | оставить |
| docs/PASSPORTS-V2.md | 88 КБ | 11-09 | 65 | ТЗ/анализ паспортов v2 (заголовок: «кода ещё нет», старый) | исправить шапку; большая часть выполнена → ужать, историю в архив |
| docs/TEST-LOG.md | 62 КБ (210 стр.) | 11-11 | 89 | журнал полных прогонов | разбить: журнал + вынести стр. 121–210 |
| docs/HISTORY.md | 27 КБ | 11-11 | 47 | журнал выкладок | исправить (отстаёт, битая стр. 48), после 20 записей — в архив старое (в шапке правило есть) |
| docs/CONNECT.md | 19 КБ | 11-01 | 22 | подключение внешних клиентов | оставить |
| docs/DATA-FIX-USER.md | 12.9 КБ | 11-09 | 26 | данные на проде (правит пользователь) | оставить |
| docs/traps.md | 8 КБ | 11-10 | 8 | редкие ловушки | оставить |
| docs/AUDIT.md | 22.8 КБ | 10-23 | 84* | аудит «паспорта волна 3» от 23.10 (✅15 ⚠6 ❌2) | в архив (законченный аудит; 84 — из-за слова «AUDIT.md» в подстроках) |
| docs/DB-AUDIT.md | 50.8 КБ | 10-25 | 26 | аудит таблиц БЗ-14, числа с прода 10-24 | в архив (числа устарели; решения перенесены в TASKS БЗ-14 — сверить) |
| docs/UNIFY-SUPPLY-WAREHOUSE.md | 10.7 КБ | 10-24 | 32 | единые коллекции склада/снабжения с kppdf | оставить (на него ссылается AGENTS «Известные ловушки» и п.4) |
| docs/BRAND-KIT-BRIEF.md | 15.4 КБ | 11-07 | 0 | задание дизайнеру (стиль) | в архив, если ответ дизайнера не ждётся; 0 ссылок. Согласовать с пользователем |
| docs/CATEGORY-ART-BRIEF.md | 12.3 КБ | 11-07 | 2 | задание на рисунки категорий | то же (живой лишь как ждущий ответ дизайнера) |
| docs/ICONS-BRIEF.md | 18.2 КБ | 11-07 | 4 | задание на иконки (решение: базовые — Lucide) | то же; 3 брифа слить в один `docs/design-briefs.md` или в архив |

## 3. docs/audit/ (19 файлов, 11 дней — 1 мес)

Живых нет: все — разовые отчёты. Исключение: `SERVERS-STATUS.md` (обновлён сегодня, 11-11; живой, но по смыслу — часть CONTROL/C058) и `ui-inventory.md` (73 КБ, генерится скриптом `backend/scripts/ui-inventory.mjs`; не хранить в git — пересоздаётся).

| Файл | Размер | Дата | Ссыл. | Вердикт |
|--|--|--|--|--|
| AUDIT-2026-11-05 | 4 КБ | 11-05 | 0 | в архив (GitHub-хвосты; пункт про .cursor устарел) |
| AUDIT-ADMIN-2026-10-31 | 5 КБ | 10-31 | 4 | в архив |
| AUDIT-ADMIN-PULT-2026-11-01 | 13 КБ | 11-01 | 0 | в архив (выводы про «Состояние/Разбор» — проверить, закрыты ли в BACKLOG) |
| AUDIT-CONTROL-CENTER | 24 КБ | 10-30 | 16 | в архив вместе с tz/CONTROL-CENTER, если Центр контроля не стартует; иначе оставить (в BACKLOG открыт [ ] п.1) |
| AUDIT-KP | 16 КБ | 10-30 | 16 | оставить до закрытия KP (TASKS [~]) |
| AUDIT-PASSPORT-PARTS | 37 КБ | 10-30 | 17 | в архив (паспорта v2 выпущены) |
| AUDIT-PASSPORTS-CONTENT | 33 КБ | 10-29 | 6 | в архив |
| AUDIT-PATTERN-FUNNEL | 8.5 КБ | 11-07 | 4 | оставить (связан с PATTERNS П-1) или архив |
| AUDIT-PLAN | 6.8 КБ | 10-29 | 15 | в архив (план, битые ссылки на три несозданных AUDIT-*) |
| AUDIT-REQUIRED-FIELDS | 11 КБ | 10-31 | 2 | в архив |
| DEPARTMENTS-FUNNEL | 12 КБ | 11-01 | 4 | в архив/оставить — по TASKS (предположение: отделы воронкой в работе) |
| PASSPORT-FLOW-AUDIT | 18.6 КБ | 11-01 | 2 | в архив (заменён C054/C055/C060–C066) |
| PASSPORT-TEXTS-REVIEW | 12 КБ | 11-01 | 5 | в архив (C060 тексты выложены v1.674) |
| PRODUCT-VARIANTS | 6 КБ | 11-01 | 6 | в архив/оставить — сверить с TASKS |
| PRODUCTS-CODE-AUDIT | 3 КБ | 11-01 | 0 | в архив |
| ROLES-ASSIGNMENT | 3 КБ | 11-01 | 0 | в архив (или перенести вывод в QUESTIONS) |
| SERVERS-STATUS | 1.5 КБ | 11-11 | 3 | оставить → влить в CONTROL «Серверы» |
| UI-KIT-INVENTORY | 11 КБ | 11-01 | 4 | в архив (kit: `docs/DESIGN.md` §4) |
| ui-inventory | 73 КБ | 11-02 | 14 | не хранить: генерируется `ui-inventory.mjs`; `git rm`, оставить скрипт |

«Закрытость» точная — A3 сверит с TASKS; здесь по датам и названию (предположение для строк с «сверить»).

## 4. docs/roles/tz/ (19 файлов; в AGENTS: «новые ТЗ в docs/roles/tz/ не писать»)

Критерий: отсылка из TASKS/BACKLOG. Открытое = пункт `[ ]` или `[~]` ссылается на файл.

| Файл | Ссылка из TASKS / BACKLOG | Вердикт |
|--|--|--|
| ORDER-LINES.md | TASKS 5.5, 6.1, 6.1а/б — `[~]` «глазами не проверено» | открыто |
| HA-TWO-SERVERS.md | TASKS:206 `[ ]` XL; BACKLOG:58 | открыто |
| CONTROL-CENTER.md | TASKS:205 `[ ]` XL; BACKLOG:57 | открыто |
| KP-1.md | TASKS:208 `[~]` | открыто |
| KP-2-TEMPLATES.md | TASKS:188 `[~]` «не выложен» | открыто |
| RIGHT-PANEL-V2.md | TASKS:466 `[ ]` ПМ-1 XL | открыто |
| POLISH-2026-11-01.md | TASKS:468 `[ ]` 11 пунктов | открыто |
| STAFF-LOGINS-MERGE.md | TASKS:243 `[ ]` СВ | открыто (в файле СВ-2 уже `[x]`) |
| RELEASE-GATE.md | TASKS:244 `[~]` | открыто |
| WORK-GANTT.md | BACKLOG:32 (CRM отключить — Гант перенос) | открыто |
| NAMES.md | TASKS:116 `[~]` ТИ-8 | открыто |
| BZ-15.md | TASKS:263 `[~]` | открыто |
| SPEED-2.md | TASKS:225 `[~]` частично | открыто |
| MC.md, MI.md | 3 упоминания каждый в TASKS (по теме МЦ/МИ) | предположение: закончены — сверить `[x]`, тогда в архив |
| DESIGN-KIT.md | 0 в TASKS/BACKLOG | в архив (kit в DESIGN.md §4, C030-kit-etalons закрыт) |
| RIGHT-PANEL-AUDIT-2026-11-06.md, RIGHT-PANEL-WAVE2, WAVE3 | 0 в TASKS/BACKLOG | в архив (волны исполнены; открыт только V2/ПМ-1) |

В архив сразу (по нулевой отсылке): DESIGN-KIT, RIGHT-PANEL-AUDIT, RIGHT-PANEL-WAVE2, RIGHT-PANEL-WAVE3 (+ MC, MI после сверки).
Предложение: открытые ТЗ перенести в `docs/crew/Cxxx-…/TZ.md` при закрытии, папку `docs/roles/tz/` убрать; в агентах и maps заменить пути.

## 5. Дубли и противоречия

| Тема | Где | Расхождение / риск |
|--|--|--|
| Экономия токенов | AGENTS.md (единственная копия) · `.cursor/rules/token-economy.mdc` (зеркало) · CLAUDE.md 8а ссылается | норм, зеркало объявлено. Рекомендация: в .mdc оставить одну строку-ссылку |
| Стандарт ответа (3–6 строк, ≤20 слов) | CLAUDE.md п.11–12 · `.cursor/rules/00-project.mdc` («3–6 строк, Сделано·Выложено·Глазами·Дальше») · MANUS.md «Пользователь и ответы» · memory «3 блока ⚡/❓/🎯, ≤15–20 строк» | три формулировки; в памяти пользователя формат другой (⚡/❓/🎯) — противоречит CLAUDE п.11. Оставить CLAUDE.md, остальные — ссылкой |
| Жёсткие правила (данные, секреты, mongo 4.4, e2e только test, коммит `-- файлы`) | AGENTS.md «Жёсткие правила» · CLAUDE.md «Правила работы» · `.cursor/rules/00-project.mdc` «Жёсткие правила (кратко)» | 00-project.mdc целиком переписывает 8 правил, уже есть в AGENTS: при правке придётся менять 2–3 места; сократить до ссылки |
| Передача между чатами | CLAUDE.md 11а · MANUS.md · BACKLOG «Сейчас» | согласованы |
| «Координатор» | CLAUDE.md: Claude/Claude Code; MANUS.md: «координатор (Cursor)»; 00-project.mdc: Cursor — «равноправный координатор» | три роли «координатора» без правила, кто главный при параллельной работе (CLAUDE: чужие правки не трогать, 00-project — то же). Описать в одном месте |
| Где лежат ТЗ | AGENTS «docs/roles/tz — не писать»; `.claude/agents/datacore-backend.md:3` «ТЗ в docs/roles/tz/*.md»; MANUS: `docs/crew` | исправить backend-агента |
| roles/README.md (12.7 КБ) vs CLAUDE.md таблица классов | оба описывают классы S/M/L/XL, лимиты агентов | CLAUDE — краткая копия; следить за совпадением чисел (оба: S 0, M ≤2, L ≤4, XL ≤5 — сейчас совпадают) |
| roles/<роль>.md (2.8–5.4 КБ) vs `.claude/agents/datacore-<роль>.md` (3–6 КБ) vs roles/maps/<роль>.md (3–47 КБ) | три файла на роль | дубли описания роли; roles/*.md (кроме lessons-coordinator) можно слить в агентов или оставить maps |
| .cursor/rules/skill-*.mdc | 5 файлов по ~500 Б — ссылки на SKILL.md | нормально |
| Версия «Cursor настроен 2026-11-10» в 00-project vs AUDIT-2026-11-05 «.cursor не закоммичен» | — | второе устарело |
| Номера заданий | docs/crew: дубли C058 (design-v1657 / two-servers-finish), C059 (design-after-assign / passport-gaps), C062 (passport-bind-audit / passport-purpose), C063 (joints-materials / passport-firm-order) | (роль A1) но вызывает ошибку C061↔C062 в maps/analyst.md:11 |

## 6. Слишком дорогие для агентов

| Файл | Размер | Предложение |
|--|--|--|
| docs/DESIGN.md | 170 КБ / 460 строк (строки по ~370 Б) | разбить: `DESIGN.md` (§0–3,5–6: токены, раскладка, чек-лист) ≈ 25 КБ; `DESIGN-KIT.md` (§4 каталог, стр. 87–255); `DESIGN-LOG.md` (§8 журнал решений, стр. 310–402, → в архив); §9 (402–438) и «Карта Работа с сайтом» (439+) — в `docs/HELP-MAP.md` |
| docs/MAP.md | 148 КБ / 131 строка (строки до 2 КБ) | разбить по группам: ядро / справочники / склад-снабжение / деньги / паспорта; строки длиннее 800 Б ужать. Секции HARDEN-1, T26 (стр. 121–152) — ссылки в историю |
| docs/TEST-LOG.md | 62 КБ | журнал (стр. 1–120) оставить, последние ~20 строк; стр. 153–210 (разбор C058, ИИ-тестировщик, чек-лист) вынести в `docs/crew/C058-two-servers-finish/` и `docs/crew/` ИИ-тестировщика; старые строки таблицы — в архив |
| docs/HISTORY.md | 27 КБ / 49 строк | в шапке сказано «только последние записи»: оставить ≤15 записей, остальное — `HISTORY-2026-11.md` в архив; дописать v1.686–1.693 |
| docs/PASSPORTS-V2.md | 88 КБ | выполненные фазы — в архив; оставить архитектуру и шаблоны |
| docs/data-model.md | 66 КБ | автогенерируемая часть → `GET /api/meta/schema`; оставить только то, чего нет в схемах |
| docs/roles/maps/frontend.md 47 КБ, backend.md 42 КБ, analyst.md 25 КБ | — | карта роли = «где что лежит»; журнальные блоки по заданиям (C0xx) ужимать/переносить в crew. analyst.md ссылается на 19 архивных ТЗ |
| docs/CANON.md | 40 КБ | при сборке агента читается каждый раз → проверить дубль с DESIGN.md §6 (чек-лист) |
| pult/README.md | 23.5 КБ | таблица кнопок генерируется `gen-docs.mjs` — оставить; не читать целиком |
| docs/ARCH-PLAN.md | 49 КБ | закрытые задачи архивировать (A5 перечень) |

## 7. «В архив сразу» (по критерию: законченное, 0 ссылок, или дата и содержание закрыты)

docs/AUDIT.md · docs/DB-AUDIT.md · docs/audit/{AUDIT-2026-11-05, AUDIT-ADMIN-2026-10-31, AUDIT-ADMIN-PULT-2026-11-01, AUDIT-PASSPORT-PARTS, AUDIT-PASSPORTS-CONTENT, AUDIT-PLAN, AUDIT-REQUIRED-FIELDS, PASSPORT-FLOW-AUDIT, PASSPORT-TEXTS-REVIEW, PRODUCTS-CODE-AUDIT, ROLES-ASSIGNMENT, UI-KIT-INVENTORY}.md · `git rm` docs/audit/ui-inventory.md (генерируется) · docs/roles/tz/{DESIGN-KIT, RIGHT-PANEL-AUDIT-2026-11-06, RIGHT-PANEL-WAVE2-2026-11-06, RIGHT-PANEL-WAVE3-2026-11-06}.md · ROADMAP.md (после слияния в BACKLOG). Ориентир: ≈ 330 КБ уходит из «чтения агентов». Порядок — по AGENTS 9а: `git mv` → выкладка отправляет на сервер → `git rm`.
Брифы дизайнеру (BRAND-KIT, CATEGORY-ART, ICONS; 46 КБ) — на решение пользователя: если ответ не ждётся, в архив.
Живые по вопросу 7 задания: UNIFY-SUPPLY-WAREHOUSE — живой (ссылки из AGENTS, ловушки). AUDIT.md и DB-AUDIT.md — закончены, мертвы. Брифы — висят без ответа (0–4 ссылок).

## 8. Прочее

- `.claude/worktrees/hungry-rubin-76fa17` и `peaceful-newton-9df4d9` — живые worktree (73 МБ, detached HEAD), содержат полные копии docs/: засоряют grep и счётчики ссылок. Они в `git worktree list`; удалять только с разрешения (`git worktree remove`). Ещё `tools/.night/worktree` и prunable в temp (`wt2`) — `git worktree prune`.
- skills: datacore-design (10-26), datacore-new-module (10-20) — не менялись с октября; проверить пути (CANON/DESIGN переименования). Агенты (11-07) свежие.
- deploy/remote-access/README.md — без даты в git (не закоммичен, возможно в .gitignore); проверить.
- Проверено: ссылки в AGENTS.md, CLAUDE.md, MANUS.md, README, ROADMAP, VISION, .cursor, SRV-ERP, deploy README, skills — битых нет. Битые только перечисленные в п.1.

## 9. Предложения по структуре

1. Один вход: AGENTS.md; CLAUDE.md — только координатор; MANUS.md/.cursor/00-project.mdc — тонкие обёртки (3–10 строк + ссылки).
2. `docs/` : живые законы (CANON, PRODUCT, PATTERNS, ARCHITECTURE, traps, CONNECT), карты (MAP, data-model — разбитые), журналы (HISTORY, TEST-LOG — короткие), CONTROL (один экран, плюс «Серверы»).
3. ТЗ/отчёты только `docs/crew/`; `docs/roles/tz` и `docs/audit` — пустеют в архив. Чистка по AGENTS 9а отдельным коммитом после SUMMARY.
4. Автообновление CONTROL «Текущий выпуск» из последнего тега (`dc start`) — иначе опять отстанет; добавить проверку `dc check`: версия в CONTROL = последний `release-v*`, HISTORY содержит последнюю версию.
5. Проверка ссылок скриптом (мой `lk.mjs`-подход) в `dc check`: путь `docs/...` либо существует, либо помечен «архив».
