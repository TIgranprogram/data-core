# ТЗ T23 — Pult / dcnight: безопасная остановка и ночной прогон

> Основание: read-only аудит 2026-11-03. До исправления `dc stand down` и полный ночной прогон не запускать.

**Зачем (словами пользователя):** можно безопасно пользоваться Пультом и тестовым стендом, не потеряв данные Mongo и не затронув другой работающий стенд.

**Класс:** M · **Max agents:** 1 · **Reviewers:** qa ☑ architect ☑ designer ☐ · **Max review loops:** 2 · **Проверки:** unit + безопасный локальный smoke.

## Shared pack

- `docs/DISCOVERY.md:13-17` перечисляет действующие `dcnight-mongo` / `dcnight-backend` и прямо запрещает останавливать, удалять их или менять их volumes.
- В то же время `tools/night.mjs:273-278` выполняет `docker compose down -v --remove-orphans` и пишет, что тома удалены. `cmdNight` вызывает `standDown` перед full run и повторно в `finally` (`tools/night.mjs:373-400`). Следовательно, текущая кнопка остановки/полный запуск могут удалить данные существующего тестового Mongo-volume. Это подтверждённый блокер; текущую команду не исполнять.
- Каталог Pult показывает отдельные действия legacy dcnight (`pult/catalog.mjs:182-188`), а Nightshift использует иные контейнеры (`tests_ai_tiit/nightshift/stand/docker-compose.yml:3-27`). Не переключать кнопки с legacy runner на Nightshift в рамках этой задачи.
- На проверенной машине Docker отсутствует; стандартные порты не слушали, Pult/server lifecycle и реальные контейнеры не запускались. После разрешённого loopback-прогона Pult suite дал 44/46: два server tests упали на остановке длительной test-job (`server.test.mjs:120-145`). Дополнительная проверка только на созданном диагностическом Node child показала `taskkill.exe` → `Access denied` в текущем execution environment; это не доказывает дефект рабочего Windows-ПК, но и не подтверждает работу stop. Перед объявлением готовности повторить stop/cancel tests на поддерживаемой Windows-среде либо изолировать process-termination adapter и проверить его отдельно.
- `tools/night.mjs:273-278` также означает, что тестировать stop на реальном `dcnight` запрещено: текущий путь выполняет `down -v`.
- Pult `readStatus` обращается к production `/api/health/ready` и `/app/version.json` (`pult/server.mjs:41, 68-79`). Для тестов использовать подменённый `statusFn`; не отправлять тестовые запросы к production. Любой разрешённый live-read — только через `datacore-access` по процедуре проекта.
- Отдельная команда `tools/dc.mjs:197-215` (`dc status`) вызывает `prodGet('/api/health')` и `curl PROD_URL + '/app/version.json'`. Это live-read production, а не локальная проверка; не запускать её как часть аудита/предрелизного smoke. Если статус сохраняется, обозначить в UI как «Проверить прод» и покрыть тестом с fake transport.
- Глобальное ограничение: не удалять Mongo данные, коллекции или volumes. Ни одно тестовое ТЗ не разрешает запуск текущего destructive `down -v`.

## Что сделать

1. **Сделать ownership стенда явным.** `dc stand status` остаётся read-only. `up`, `down` и nightly-run должны проверять принадлежность compose project, container, DB и volume. Если обнаружен существующий `dcnight` из `docs/DISCOVERY.md` или принадлежность неясна — команда отказывается без stop/recreate/restore.
2. **Убрать destructive lifecycle.** Удалить автоматический `docker compose down -v`; не выполнять `docker volume rm`, `mongorestore --drop` и удаление коллекций. Обычная остановка должна сохранять данные. Если полному прогону нужна чистая копия, создать новый уникальный test project/volume/DB с суффиксом `-night`, импортировать в пустую БД без удаления прежнего контура и оставить прежние volumes нетронутыми.
3. **Ограничить очистку ресурсами текущего запуска.** Полный прогон должен сохранять run/project ID; при ошибке cleanup разрешено только остановить контейнеры, созданные этим конкретным запуском, без удаления volume. Неизвестные и ранее существовавшие ресурсы сохраняются. Если гарантировать ownership нельзя — не запускать прогон.
4. **Исправить пользовательский контракт Pult.** Подпись «остановить» должна означать остановку с сохранением базы. В логе и итоговом сообщении не обещать удаление данных. Кнопка полного прогона не должна молча останавливать или пересоздавать пользовательский stand.
5. **Явно отделить live production status.** `dc status` не должен запускаться неявно из preflight/unit tests; live-запрос требует отдельной понятной команды и fake-transport теста.
6. **Проверки без реального Docker сначала.** Добавить unit-тесты с fake compose/docker, проверяющие аргументы и отказ при конфликте: ни в одной ветке нет `down -v`, `volume rm`, `mongorestore --drop`, подключения к production и изменения существующего `dcnight`. Проверить и путь исключения/cleanup.
7. **Проверить Pult отдельно от prod.** Прогнать `pult/test/catalog.test.mjs`, `advisor.test.mjs`, `server.test.mjs` на loopback-разрешённой среде, используя тестовый каталог и `statusFn`-заглушку. Если UI-smoke нужен, сначала обеспечить способ подменить статус без live URL; не вызывать `/api/status` с production конфигурацией в тесте.
8. **Только после критериев 1–7** провести локальный smoke на явно новом disposable compose project. Не использовать действующий `dcnight`; для стенда не запускать e2e на боевой БД.

## Файлы

- **Ожидаются правки:** `tools/night.mjs`, `tools/night.test.mjs`; при необходимости `tools/dc.mjs`, `tools/dc.test.mjs`, минимальная подпись команды в `pult/catalog.mjs` только после повторной сверки diff.
- **Ожидаются правки других сессий:** на момент составления ТЗ изменены `pult/catalog.mjs` и несколько файлов `tests_ai_tiit/nightshift/**`; перед исполнением проверить `git status`, не перезаписывать и не откатывать эти правки.
- **Читать:** `tools/night.mjs:211-304, 338-400`; `tools/night.test.mjs:1-50`; `tools/dc.mjs:1-18`; `tools/dc.test.mjs:1-57`; `pult/catalog.mjs:176-196`; `pult/server.mjs:41, 68-79, 100-120`; `pult/test/server.test.mjs:28-54`; `docs/DISCOVERY.md:13-17`; `tests_ai_tiit/nightshift/stand/docker-compose.yml:3-27`.
- **Читать запрещено:** `.env*`, `control-key.local.env`, credentials, production URI/данные и содержимое Mongo volumes.
- **Менять:** только legacy runner/его unit tests и при обоснованной необходимости подпись Pult. Не трогать реальные контейнеры, Mongo volumes, production, Pult write actions и бизнес-модули.

## Критерии приёмки (проверяет QA и архитектор)

- [ ] По `git grep` в lifecycle Pult/night runner нет пути, способного удалить существующие Mongo volumes/коллекции или вызвать `mongorestore --drop`.
- [ ] Unit-тесты подтверждают, что `dc status` не вызывается неявно и live-read production маркирован и проверен fake transport без сетевого обращения.
- [ ] Fake Docker tests доказывают: `status` read-only; `down` сохраняет volume; при обнаружении чужого/старого `dcnight` старт и cleanup отказываются его менять.
- [ ] Полный прогон использует только уникальные ресурсы с суффиксом `-night`; stop и error-cleanup останавливают только принадлежащие ему контейнеры, не удаляя данные.
- [ ] Существующие `dcnight-mongo`, `dcnight-backend`, их сеть и volumes остаются неизменны по сравнению с read-only снимком `docker ps/volume ls` до и после изолированного smoke.
- [ ] Pult catalog/advisor/server tests проходят на среде с loopback; тесты не обращаются к `https://kppdf-crm.ru/db`.
- [ ] Обновлён текст Pult/docs о сохранении данных; `node --test tools/night.test.mjs tools/dc.test.mjs pult/test/*.test.mjs` проходит. E2E запускается только против нового изолированного тестового контура, никогда против production.

## Нельзя

- Запускать текущие `dc stand down` / полный `dc night` до исправления `down -v`.
- Останавливать/пересоздавать `dcnight` или менять его volumes: `docs/DISCOVERY.md:13-17`.
- Удалять любые Mongo данные/коллекции/volumes; использовать `down -v`, `docker volume rm`, `mongorestore --drop`.
- Отправлять запросы к production из unit/HTTP/UI тестов или запускать production e2e.

## Отчёт роли (≤ 12 строк)

`статус | пункты ✅/❌/➖ | файлы | команды → итог | ownership/данные до и после | риски`

## Итог (координатор)

- Сделано: … · Проверено: … · Коммит: … · Выложено: не применимо.

## Завершение технической части — 2026-11-03

Принято в общем выпуске. Backend2395/2395, e2e62/487 (disposable Mongo4.4); T23 real health/stop/start сохраняет данные и3volumes; Nightshift76/76 и два реальных профиля; PWA27экранов и локальные финансовые сценарии. Исходное описание выше историческое, актуальный итог — CONTROL/TEST-LOG. Существующие бизнес-данные не исправлялись. Публикация фиксируется отдельно после фактического release.
