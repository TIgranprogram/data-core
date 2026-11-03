# Nightshift — прогресс T22, 2026-11-03

Тема закрыта 2026-11-03. GUI, локальный ИИ и новые наборы не начинать. Решение: `docs/crew/C006-nightshift-vs-pult/VERDICT.md`.

Nightshift — отдельный Python QA harness, не legacy tools/dc night.

- [x] Новая Python 3.12 virtualenv, uv sync, реальные doctor/status/help.
- [x] Явные local/night/suite; заглушки не дают зелёный отчёт.
- [x] Реальные DataCore typecheck, ESLint, PWA imports, backend unit.
- [x] Уникальный nsqa project, две DB на -night, собственные volume/internal network, без published ports.
- [x] Реальная Docker-сборка и health на новом контуре.
- [x] Реальный refresh в новый пустой project: 141 коллекция, 12957 документов; bootstrap из копии.
- [x] Два настоящих night-профиля: harness/static/backend_unit/isolation_check/regression — passed.
- [x] Классификация app/demo/runner/timeout, точные выполненные suites и metadata.
- [x] Redaction до записи report/handoff/ZIP/log; полный безопасный журнал Docker-ошибки. Python 76/76.
- [x] Fake-Docker проверки коллизий, чужого ownership, двух refresh и сохранности volumes.
- [ ] Повторить установку на отдельной новой Windows, когда такой ПК потребуется. Чистая local virtualenv текущего ПК уже проверена.

Реальные отчёты: reports/2026-11-03_072127_620b5a52 и reports/2026-11-03_073649_84891715. Backend E2E отдельного выпуска: 62/487 passed, disposable Mongo 4.4.

Не входят в готовность: нагрузки, chaos/fuzz/mutation/visual/monkey/flaky/backup, AI/GUI/scheduler/resume. Они явно not_implemented либо вне профиля. Подробности — BLOCKERS.md.
