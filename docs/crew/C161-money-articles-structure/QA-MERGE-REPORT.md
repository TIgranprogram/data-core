# C158+C161 — QA после сведения с main, 19.11.2026

Статус **PASS автоматических проверок** на runtime61558531 (main доv1.946); визуальная приёмка/выпуск — отдельные ворота координатора.
✅ Реальный full unit:363 suites/3720 tests PASS,0SKIP,59.769с,exit0; внутри357/357 PWA guards. Typecheck и Nest build exit0.
✅ Реальный full e2e ОДНИМ проходом:84 suites/652 tests PASS,0FAIL,538.218с,exit0; T26 opt-in1 suite/12tests SKIP по ранее согласованной причине (не выдавался отдельный disposable URI).
✅ Все64 PWA node-файла: raw362PASS/2FAIL/2SKIP из-за отсутствующего playwright-core; после локальной junction к уже установленным зависимостям только4 зависимых файла14/14PASS. Сопоставленное покрытие369 реальных тестов PASS/0SKIP; это НЕ один успешный raw full-node запуск.
✅ Импорты/синтаксис362 файла,ошибок0. До запуска изменён только C155 test guard: localhost/127.0.0.1+datacore-test[-suffix], assertconnection.name; предметные assertions не ослаблялись, ESLint этого файла0.
✅ Manifest1703 tracked+NEW src/test/pwa/admin: до/после SHA72e5f93220530abe49f295749c6df6d65c8f1b8142439dab44fadec21d63a6a4 одинаков,изменений/добавлений/удалений0. Документы в freeze не входят.
Доказательства: evidence/QA-MERGE-RESULTS.json, qa-merge-manifest-before/after.json, qa-merge-pwa-coverage.json; raw/JSON/UTC/exit/SHA в tools/logs/c161-qa-* с начала прогонов. Исторические C158/ранниеC161 FAIL/ABORTED не перезаписывались.
Безопасность: один e2e helper/owned testDb27158, отдельная от копии3198. Prod/credentials/реорганизация183статей/импорт счетов не затрагивались. Установка пакетов/правки основного checkout не выполнялись.
➖ Отчёт не присваивает designerPASS и не подменяет приёмку всех экранов стенда; найденные там вопросы разбирает координатор. Нового полного прогона после одних документов не требуется.
TEST-LOG и карта QA обновлены; активных QA/e2e процессов нет, testDb свободна. Коммитов/выкладки роль QA не делала.
