# C239 — независимая QA после исправления P1/P2, 23.11.2026
PASS локальной логики и изолированного UI-сценария после исправлений; прежние 196 PASS сохранены как pre-arch-fix, не доказательство новой дельты.
✅ Новый полный прогон: 201/201 тест, 0 FAIL/SKIP, exit 0, 9,419 с. TAP — `qa/node-tests.log`, сводка с SHA проверенных файлов — `qa/summary.json`.
✅ Новая независимая регрессия: 8 уникальных рисунков → 9 позиций, общий asset двух строк загружен один раз; ровно 8 upload, 9 attach.
✅ Фото, добавленное человеком после preview, и прежнее фото сохраняются; sourceLine/позиции и байты PDF не меняются; повтор не делает новых POST.
✅ Потерянный ответ пятой привязки → возобновление с тем же подтверждением, без дубликатов файлов/связей, оставшиеся 4 связи подтверждены.
✅ Без выбранного договора — selectionRequired и 0 POST/0 GET деталей; ответ 100 заголовков без legal вместо limit20 отклонён до N+1. Явный target — ровно 1 GET карточки; владелец отдельно проверяет 20 заголовков из total100.
✅ Inline3000×1 отвергается до hashes/xrefs/extract_image; настоящий PDF проверяет геометрию/SKU/логотип. Повтор UI fixture exit0: единая цель18/11/44/Бак-Строй,9строк/8нативныхassets,sharedОГ002/004,длинныеимена;7PNG selection/new/existing light1440top/dark1024top+bottom(9ястрока+confirm),XSS/overflow. `evidence/ui/fixture-proof.json`.
Проверка: `node --test --test-reporter=tap tools/document-intake/*.test.mjs pult/test/*.test.mjs`; backend unit/e2e C237 не повторялись — C239 backend не меняет.
➖ Реальные backfill/просмотр сайта — отдельные доказательства access в `BACKFILL-REPORT.md`; изолированная UI-фикстура не объявляется приёмкой рабочего окна/данных.
Ограничение решения: single-writer; глобальная exactly-once/атомарная защита от конкурентного переноса позиции не заявляется. Security-review выполняется архитектором отдельно.
Файлы/якоря: `tools/document-intake/c239-images-qa.test.mjs:100`, `:122`, `:134`, `pult/test/ui-document-intake-images.fixture.mjs`; TEST-LOG и карта обновлены, коммит b0b60aec. QA прод и активный журнал не менял.
