# Nightshift — отдельный QA harness

Тема закрыта 2026-11-03. Окно и новые кнопки не делаем. Пульт запускает только pytest этой папки из кнопки «Пакет выпуска: собрать показатели». Решение: `docs/crew/C006-nightshift-vs-pult/VERDICT.md`.

Это **не** legacy `tools/dc night` / Pult / `dcnight`. Старые `nightshift-*`, `dcnight-*`, `datacore-*` контейнеры и volumes не управляются этим harness.

## Установка (Windows, Python 3.12)

Из `tests_ai_tiit/nightshift` в текущей рабочей копии:

```powershell
uv sync --extra dev --python 3.12
.\.venv\Scripts\nightshift.exe --help
.\.venv\Scripts\nightshift.exe doctor
.\.venv\Scripts\nightshift.exe status --json
.\.venv\Scripts\python.exe -m pytest -q
```

`uv` использует существующий поддерживаемый Python 3.12; зависимости устанавливаются только в локальную `.venv`. Если перенос старой `.venv` приводит к `uv trampoline ... permission denied`, эта среда непереносима: переименуйте **только** локальную `.venv` в `.venv.bak`, затем повторите `uv sync`. Глобальная pip-установка не нужна. На этой машине новая локальная среда создана и работает; установка на отдельной чистой Windows не проверялась.

Doctor реально проверяет Python/зависимости, версии git/node/uv/Docker/Compose и доступность Docker daemon. `.env*`/credentials не читаются. Status без project читает только локальный реестр и последний отчёт; `status --project nsqa-<32 hex>` выполняет scoped read-only Docker inspect с проверкой владения. Отсутствующий manifest — отказ, а не выдуманный idle.

## Профили и достоверность

```powershell
.\.venv\Scripts\nightshift.exe run --profile local
.\.venv\Scripts\nightshift.exe run --suite static
```

Без `--profile` / `--suite` запуск запрещён. `local`: Python unit/fake-Docker harness, затем настоящие DataCore typecheck, ESLint, PWA imports, backend Jest unit. Используются только существующие `backend/node_modules`; установки npm/npx, git pull и production fallback нет. `tsc --incremental false` не пишет build metadata в backend.

`night`: тот же минимум плюс runtime ownership/internal-network gate и **read-only DataCore regression** внутри тестового app: `/api/health/ready`, anonymous `/api/stock/items` → 401, Mongo ping/список коллекций. Это не полный backend E2E. Обычный `test/setup/test-db.ts` удаляет коллекции, поэтому здесь не вызывается. Для `night` обязателен `--project` из нового ownership manifest. При отсутствии/неоднозначности ownership API-проверки получают `blocked`, без сетевого обращения.

`backup/load/soak/chaos/fuzz/mutation/visual/monkey/flaky` не реализованы, исключены из профилей и при явном выборе возвращают `not_implemented` (exit 2). Demo намеренно возвращает 1, классифицируется `expected_demo_failure` и не доказывает готовность DataCore.

Отчёт JSON/HTML перечисляет suite/команду/commit/UTC-время/статус/причину/выполненные проверки. Ошибка приложения, static/harness failure, demo, runner error, timeout и blocked различаются. Redaction применяется в runner **до** сохранения логов, отдельно в report, handoff Markdown/JSON/ZIP, CLI и doctor. Сырые stdout/stderr и inherited Mongo/JWT/SMTP/DOCKER_HOST/NODE_OPTIONS не сохраняются/не используются.

## Выделенный контур — только при отдельном разрешении lifecycle

```powershell
.\.venv\Scripts\nightshift.exe stand up
.\.venv\Scripts\nightshift.exe stand status --project nsqa-<32 hex>
.\.venv\Scripts\nightshift.exe run --profile night --project nsqa-<32 hex>
.\.venv\Scripts\nightshift.exe stand down --project nsqa-<32 hex>
.\.venv\Scripts\nightshift.exe stand refresh --backup D:\test-backups\datacore-2026-11-03_000000.tgz
```

В текущем T22 lifecycle **не запускался**. Примеры не означают разрешение запуска. `up` и `refresh` всегда создают новый случайный `nsqa-<UUID>` project, именованные контейнеры/внутреннюю сеть/volume и DB `datacore-<UUID>-night` / `datacore-test-<UUID>-night`. Ни один порт не публикуется; хост-браузер не поддерживается. App собирается собственным Dockerfile из текущего backend с scoped `Dockerfile.dockerignore`, без секретов, uploads или живых данных; health проверяется внутри контейнера. Реальную сборку и health ещё должен подтвердить координатор в разрешённом контуре.

Refresh требует явный backup, отказывает существующему project/volume/непустой DB; restore без `--drop` и с `--stopOnError`. Старые volumes автоматически не чистятся, даже после неудачи. `down` требует local manifest и совпадающие Docker ownership labels, internal network и отсутствие опубликованных портов; `-v` не используется. Неизвестные ресурсы не усыновляются. Runtime изоляция доказывается Compose и inspect; production/IP/VM/интернет никогда не используются как probe. Fake-Docker тесты контролируют коллизии/подмену владения/два refresh и отсутствие destructive команд.

Состояние приёмки: [docs/PROGRESS.md](docs/PROGRESS.md), реальные ограничения: [docs/BLOCKERS.md](docs/BLOCKERS.md).
