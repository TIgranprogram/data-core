статус: PASS
агент: Cursor-координатор (замена Manus — лимиты)
дата: 2026-11-03
ветка: main
HEAD: 075a9af7 — docs: зафиксировать v1.481 и сохранить сверенный архив на сервере
git status: dirty → M AGENTS.md, M MANUS.md; ?? docs/crew/ (это работа координатора Crew, не хвост Manus)
сделано:
- Выпуск v1.481 @ 11:18 (HISTORY): T22–T27, paid-edit до первой приёмки, payment snapshot, merge-preview, атомарный каталог без ломки CRM-схем
- Проверки candidate (CONTROL + TEST-LOG последняя строка): unit 2395, e2e 62/487 disposable Mongo 4.4, PWA 27 экранов, Pult/T23 97/97, Nightshift 76/76, restore 141/12957
- Post-check: readiness ok, doctor красных 0 / предупреждений 5; групп ошибок новой версии 0 за час (CONTROL)
- Архив выпуска: 7/7 docs SHA на сервере (HISTORY 11:22)
- Handoff 2026-11-03: WIP/stash 0 на момент выпуска; main сведён с GitHub
- Правило paid-edit (MANUS.md): вариант B до первой принятой строки — остаётся в силе
хвосты / не делать:
- Не объявлять бизнес-задачи BACKLOG выполненными из-за v1.481
- Не docker compose down -v / чужие QA volumes
- Не считать внешние копии бэкапа и restore-drill доказанными (doctor предупреждения)
- Пользователь: пароль admin, Sportin, restore-drill — не агенты
- Следующая проверка ошибок с сайта — пульт после ~12:18 (handoff); отдельного cron не создавали
- C002 (инвентаризация АБЗ-3) — у локальной модели; не смешивать с этим отчётом
риски:
- Дерево dirty только из-за docs/crew + правки AGENTS/MANUS координатора — не коммитить чужим агентом без ТЗ
- Doctor: медленные stock/products и health/backups; старая группа ошибок «за сутки» до новой версии
нужно от координатора:
- Принять C001; вести H1 (слепок ошибок / сужение BACKLOG) после проверки C002
- Не ждать Manus — лимиты; следующие M/L брать Cursor или OpenCode по силам
