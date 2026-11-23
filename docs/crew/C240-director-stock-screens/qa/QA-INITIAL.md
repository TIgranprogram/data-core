# C240 — независимая HTTP QA, 23.11.2026
PASS адресного backend-набора: 6/6 HTTP-тестов на реальной MongoDB/Nest; выявленных runtime-дефектов нет.
✅ Login/auth.me builtin/custom director: pipe+sheet по умолчанию; основная роль, permissions, sections, деньги и owner не расширены.
✅ []/pipe/sheet/omit/reset проходят настоящие POST/PATCH/GET; reset удаляет поле БД, не сохраняет служебную команду и сохраняет warehouse/category ограничения.
✅ Strict DTO: null/unknown/duplicate/лишние значения/reset-комбинации →400 без изменения роли; create-reset отвергнут.
✅ CRUD ролей, assigned-role409, owner-only403, чужой склад/категория403 и отсутствие stock-раздела проверены HTTP.
✅ Прежняя запись директора в разрешённом складе остаётся201 при [] и pipe+sheet; readOnly интерфейса не объявляется новым запретом API.
Проверка: `MONGO_DB_TEST=datacore-test-c240-c242`, штатный e2e harness, `--runInBand --forceExit --silent --json`; ESLint двух новых spec exit0.
Доказательство: `qa/summary.json`, собственный passed suite в `qa/c240-c242-http.json`, полный stdout `tools/logs/c240-c242-qa-http.log`.
➖ Общий процесс двух новых suites был FAIL из-за setup C242; собственные 6 C240 прошли. Первая ошибка моей фикстуры note→notes исправлена без изменения runtime/DTO.
➖ Full backend ждёт freeze C236; UI-приёмка отдельна. Новые файлы для full перечислены в C242 `qa/full-plan-union.json`; тестовые guards не ослаблены, прод не использовался.
Якоря: `backend/test/e2e/c240-stock-views.e2e-spec.ts:38`, `:49`, `:83`; карта обновлена, коммит 36bdd4dc.
