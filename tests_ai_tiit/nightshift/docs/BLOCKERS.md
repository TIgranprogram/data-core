# Nightshift — состояние 2026-11-03

Тема закрыта. Новые наборы, GUI и локальный ИИ не начинать. Решение: `docs/crew/C006-nightshift-vs-pult/VERDICT.md`.

## Технические блокеры T22 устранены

Установлена новая локальная Python 3.12 среда через `uv sync --extra dev`. Doctor и status реальны. Python: 76 tests passed. Исправлены сохранение полного маскированного Docker-журнала, варианты pwd/credential/private_key/-p и справочник паспортов в Dockerfile.

Реальный новый внутренний контур собран и прошёл health. Профиль night дважды выполнил harness, static, backend_unit, isolation_check, regression: все пять категорий passed. Первый отчёт: `reports/2026-11-03_072127_620b5a52`; второй на восстановленной копии: `reports/2026-11-03_073649_84891715`.

Refresh создал отдельный новый project nsqa-f9f1e50466174092be28a77139485d90: 141 коллекция, 12957 документов. Импорт без очистки существующих баз и томов. Bootstrap берётся из копии; production и legacy dcnight не используются.

## Ограничения, не выдавать за выполненное

- Проверена чистая локальная virtualenv текущей Windows. Установка на другой, заново установленной Windows не проверялась.
- Regression Nightshift read-only; полный backend E2E исполняется отдельно. В общем выпуске он прошёл: 62 suites / 487 tests, только disposable Mongo 4.4 rs0.
- backup/load/soak/chaos/fuzz/mutation/visual/monkey/flaky: not_implemented, исключены из профилей. AI/GUI/scheduler/resume не входят в приёмку T22.
- Автоматической очистки прежних QA volumes нет. Остановка требует manifest и ownership; рабочие данные не удаляются.

Старый static RED был настоящим результатом промежуточного WIP; он устранён и не описывает текущий выпуск.
