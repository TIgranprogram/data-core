# C241 — независимая проверка P2, 23.11.2026
PASS адресной backend-дельты: 3 unit-набора/40 тестов и 1 реальный HTTP-набор/34 теста; 0 FAIL/SKIP, runtime-дефектов не найдено.
✅ lineMissing/update/snapshot используют existing:true; обнаруженная full-регрессия create→publicsnapshot409 исправлена приватным initial-create контекстом и узким raw-absent контролем; прежние201 восстановлены.
✅ P2: lineMissing не оценивает missing-ID через новый default; ordinary PATCH note для legacy/v1 сохраняет собственные ID/схемы/числа/снимки после двух GET; snapshot409 без записи.
✅ Явный PATCH установки сохраняет штатную смену монтажной группы; unknown/missing/deleted applicable экземпляр не достраивается default-ом, немонтажный контроль не получает новую обязательность.
✅ Матрица HTTP: точный ID/чужой ID того же kind, ready/closed/archive skip, stale/invalid выбор, old-client, rollback, replay и сохранность DB/PDF/истории — ПС-04/05/06/07/09/10.
Проверки: unit inventor-import/installation-choice/installation-profile exit0, 3,867с; `passport-import.e2e-spec.ts` exit0, 13,163с, только разрешённая `datacore-test-c172-release`.
Доказательства: `qa/unit-independent.json`, `qa/http-independent.json`, `qa/summary.json`; полный stdout `tools/logs/c241-qa-unit.log`, `c241-qa-http.log`.
✅ Финальный full unit405/4167 и e2e111/914 PASS, tsc0/ESLint0(53TS), SHA unchanged; [общая QA и FAIL-история](../C236-trainer-exercise-instructions/qa/QA-REPORT.md).
➖ Настоящий Inventor/iLogic не запускался; API/текстовые проверки VB не означают выполнение в Inventor. Прод/стенд и секреты QA не использовал.
Рабочий код и чужие тесты не менялись; новых API-прав/DTO исключений/ослабленных guards нет.
Якоря: `passport-inventor-installation-choice.spec.ts:191`, `test/e2e/passport-import.e2e-spec.ts:482`, `:491`, `:496`; карта обновлена, коммит 36bdd4dc.

