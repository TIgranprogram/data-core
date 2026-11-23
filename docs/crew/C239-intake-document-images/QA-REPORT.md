# C239 — независимая QA, 23.11.2026
PASS локальной логики и изолированного UI-сценария; реальные записи QA не выполнял.
✅ Полный фактический прогон: 196/196 тестов, 0 FAIL/SKIP, exit 0, 10,639 с. TAP сохранён в `qa/node-tests.log`, краткая сводка — `qa/summary.json`.
✅ Новая независимая регрессия: 8 уникальных рисунков → 9 позиций, общий asset двух строк загружен один раз; ровно 8 upload, 9 attach.
✅ Фото, добавленное человеком после preview, и прежнее фото сохраняются; sourceLine/позиции и байты PDF не меняются; повтор не делает новых POST.
✅ Потерянный ответ пятой привязки → возобновление с тем же подтверждением, без дубликатов файлов/связей, оставшиеся 4 связи подтверждены.
✅ В полном наборе: prepare без POST, неизвестный upload/recovery/variants, actor/contour/source/stale, оригиналы и gate Пульта; разбор реального синтетического PDF проверяет геометрию/SKU, обратный порядок ресурсов и исключение логотипа.
✅ `DC_INTAKE_IMAGES_UI_PROOF=docs/crew/C239-intake-document-images/evidence/ui node pult/test/ui-document-intake-images.fixture.mjs` exit 0: preview → явное confirm → reopen, disabled повтор; light1440/dark1024, XSS/overflow assertions, 3 PNG.
Проверка: `node --test --test-reporter=tap tools/document-intake/*.test.mjs pult/test/*.test.mjs`; backend unit/e2e C237 не повторялись — C239 backend не меняет.
➖ Реальные backfill/просмотр сайта — отдельные доказательства access в `BACKFILL-REPORT.md`; изолированная UI-фикстура не объявляется приёмкой рабочего окна/данных.
Ограничение решения: single-writer; глобальная exactly-once/атомарная защита от конкурентного переноса позиции не заявляется. Security-review выполняется архитектором отдельно.
Файлы/якоря: `tools/document-intake/c239-images-qa.test.mjs:100`, `:122`, `pult/test/ui-document-intake-images.fixture.mjs`; TEST-LOG и карта обновлены, коммит 88fe3eff.
