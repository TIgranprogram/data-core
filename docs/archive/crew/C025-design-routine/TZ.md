# C025 — рутина проектирования: «Заменить фото» и раздача задач пачкой (РУ-1, РУ-4)

- Класс: M. Исполнитель: внешний агент (GLM-5.3). Пишет код по ТЗ, **не коммитит, не выкладывает**, прод и стенды не трогает.
- Основа: черновики `docs/crew/C024-routine-audit/FIX-TZ.md` — разделы «РТ-1» (строки 7–21) и «РТ-4» (строки 52–66). Там цель, «как сейчас → как будет», файлы и критерии приёмки. Делай по ним.
- Почему: журнал прода за 30 дней — 67 циклов «убрал фото + добавил новое» в задачах проектирования и 371 правка задач по одной, серии до 73 подряд (`docs/crew/C024-routine-audit/DATA.md`).

## Читать (только это)
1. `AGENTS.md` — «Что это», «Команды», «Жёсткие правила», «Известные ловушки».
2. `docs/crew/C024-routine-audit/FIX-TZ.md` — РТ-1 и РТ-4.
3. Файлы из этих разделов (точечно, по строкам): `backend/pwa/ui/design-stickers.js`, `backend/pwa/sections/design.js`, `backend/pwa/ui/kit/board.js` (только читать — kit не менять), `backend/src/modules/design/design.controller.ts`, `design.service.ts`.
4. Вид — `docs/DESIGN.md` §2, §4 (Grep), эталоны `backend/pwa/ui/kit/index.js` (`button`, `section`, `actions`, `modal`, `select`).

## Не трогать
`backend/pwa/ui/kit/*` (только импорт; нужен новый эталон — PARTIAL и вопрос в отчёте), `backend/src/modules/salesorders/*`, `backend/pwa/sections/salesorders*.js`, `order-*.js` (там сейчас работает координатор), `docs/archive/`, секреты (`.env`, `config.env`, `CREDENTIALS.md`).

## Правила
- Новый эндпоинт или DTO — сначала собрать реальные поля запросов (ловушка ValidationPipe в AGENTS.md); ответ — `{ items, total, page, limit }` там, где список; права — как у соседних маршрутов `design.controller.ts`.
- Каждое действие пачкой пишет журнал (как одиночное) — `@AuditAction` или тот же сервисный путь.
- Тексты — по-русски, языком менеджера, без кодов на экране.
- Inline `style:` и новые классы вне kit не добавлять (design-lint R3/R5/R8); файлы > 400 строк не должны расти (L8).

## Проверки (сам, из `backend/`)
- `npx tsc --noEmit` — 0; `npx jest --silent src/modules/design` — зелёные (добавь тесты на новый серверный путь).
- `node --input-type=module --check < файл` — каждый изменённый файл `pwa`.
- Из корня: `node backend/scripts/design-lint.mjs` — «новых 0»; `tools/dc.cmd check` — зелёный.

## Результат
`docs/crew/C025-design-routine/REPORT.md` (≤ 25 строк): статус PASS/PARTIAL/FAIL; что сделано по РТ-1 и РТ-4 (файл:строки); как проверить руками (3–5 шагов); что не сделано и почему; список изменённых файлов. Код оставь незакоммиченным — координатор проверит и закоммитит.
