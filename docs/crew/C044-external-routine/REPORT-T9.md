# REPORT-T9 — card.tabs: безопасное ядро (перенос панелей — отдельно с дизайнером)

**Статус: ядро сделано.** Панели «Изделие» и «Задача проектирования» НЕ переносились (отдельно с дизайнером).

## Что сделано
1. `ui/kit/card.js` — `section.card.tabs: (row, ctx) => [{ key, label, count?, tone?, when?, blocks: (row, ctx) => узлы }]` как добавка (включается только если раздел задал `card.tabs`; остальные панели — как раньше):
   - над вкладками — сведения (`view`) и кнопки; ниже — эталон `tabs({ fill })` + панель `.k-pane`;
   - панель вкладки строится при первом открытии (лениво, `busyBlock`/`failBlock`);
   - открытая вкладка запоминается на раздел (prefs `cardTab:<id>`);
   - `ctx.openTab(key)`; при вкладках пункт «Вид панели» в «⋯» скрыт, раскладка — один столбец.
2. `ui/kit/card-tabs.js` — `buildCardTabs(...)` (сборка вкладок; вынесен, чтобы card.js остался ≤ 400 строк — сейчас 374).
3. `ui/kit/tabs.js` — эталон `tabs` перенесён из `index.js` (re-export) — чтобы card.js не импортировал index.js по кругу.
4. `sections/kit.js` — витрина: блок «Вкладки панели (card.tabs / buildCardTabs) · C052»; `docs/DESIGN.md` §4 — строка `card.tabs (панель)`.
5. `pwa/index.html` — modulepreload обновлён (`pwa-preload.mjs`, 144 модуля).

## Проверки
- `node --input-type=module --check` × 5 файлов (card.js, card-tabs.js, tabs.js, index.js, kit.js) — чисто.
- `node backend/scripts/pwa-import-check.mjs` — 254 файла, ошибок 0.
- `node backend/scripts/design-lint.mjs` — новых 0 (exit 0), всего 6433.
- `npx jest src/pwa-guards --runInBand` — 250/251: падает только «design-lint» внутри pwa-guards, потому что тот запускает `design-lint.mjs` через `child_process.spawnSync`, а песочница блокирует spawnSync (EPERM → `r.stdout` undefined). Это ограничение окружения, не моя правка: сам `design-lint.mjs` прогоном напрямую даёт «новых 0».

## Не сделано (отдельно с дизайнером)
- Перенос панелей «Изделие» и «Задача проектирования» во вкладки; дубли изделия; замена `<input type=file>` у вложений; помощь «?».
- e2e и снимки не гонял (нет Docker/стенда).

## Допущения
- `section.id` беру из конфигурации раздела (fallback — `title`/`'card'`) для ключа prefs.
- Вкладки для панели — всегда один столбец (пункт «Вид панели» скрыт, как в AUDIT §3).
