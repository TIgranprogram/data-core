# C166 — транспорт импорта журнала из worktree
Статус: готово к rootreview; --apply и API не вызывались.
✅ Удалены собственные creds/login/fetch/token; main checkout определяется git rev-parse --git-common-dir без пути D; используется только его штатный deploy/synology/api.sh.
✅ GET/POST прежних devlog маршрутов: subprocess argv shell:false/windowsHide, JSON только через закрытый tempfile (dir0700/file0600), descriptor закрыт до subprocess, очистка file+dir в finally.
✅ stderr/stdout auth, тело ошибки и JSON parse errors не печатаются; subprocess/HTTP401/неJSON дают безопасную общую ошибку. Dry-run возвращается до transport/git-common-dir, без авторизации/сети.
Файлы: backend/scripts/devlog-import.js:111 mainCheckout, :123 createApiTransport; backend/scripts/devlog-import.test.mjs — mocked main/worktree/argv/JSON/cleanup/error/dry-run8tests.
Проверки: node:test8/8PASS98ms; node--check0; git diff--check0; настоящий prod dry-run exit0,2329commits/37tasks/20kit/11closed documents, снимок95a6cef1221e.
Ограничения: настоящий api.sh/--apply требует Bash в PATH (release уже работает из Bash); Windows mode bits дополняют унаследованные права личного temp-каталога, Linux права0700/0600 проверяются тестом. Секреты не читались/не копировались, backend runtime/API/PWA/release.sh не менялись.
Нового исполняемого internal script нет: добавлен только node:test; кнопка существующего CLI и pultNOT_ON не менялись. Нужен от координатора только rootreview транспорта до реального apply штатным каналом.
Коммит: не выполнялся; карта backend обновлена. C170 остаётся заморожен.
