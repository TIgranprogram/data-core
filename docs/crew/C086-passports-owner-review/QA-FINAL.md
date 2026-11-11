# C086 — независимый QA перед выпуском

Статус автоматической проверки: PASS, full + проверка последующих дельт. Приёмку UI этот отчёт не заменяет.

## После v1.714: материалы каталога в PDF, 2026-11-12

PASS: после freeze исполнителя (включая сохранение legacy when-фильтра) создан отдельный `D:/qa-c086/candidate-materials-v5`, HEAD `8843d3e357fbecf724b252e9e495d422cbd9c5b5` + исправление. SHA256 `manifest-materials-v5.json`: `4b9c09564551a3ccbee3a26511d0f21a924c547293a1f664ea1bf3ffd2538385`.

Сверка backend/src и backend/test с manifest-v4: изменены ровно пять согласованных файлов — passport-from-product.ts/spec.ts, passport-compose-parts.ts/spec.ts, passport-v2-text.ts; иных изменений, добавлений или удалений серверного кода/тестов нет. После прогона исходники повторно совпали с новым снимком.

Affected e2e `passports.e2e-spec.ts` и `new-endpoints-1101.e2e-spec.ts`: PASS, 2 suites / 35 tests, failed 0, skip 0, exit 0; машинный протокол в `D:/qa-c086/materials-results-1794438946662/batch-01.json`. Проверка выполнилась на новом коде Jest in-process, в owned `datacore-test-986b9160c40716ed39d10a2e-night`; запускались только собственные Mongo/proxy (:56536), прежний backend оставался остановлен. После проверки контур остановлен, volumes сохранены. Прод, :3102, пользователи прода не затронуты.

Полный backend unit повторно не запускался (поручен preflight). Реальный PDF после выкладки проверяет координатор; эти e2e подтверждают регрессии затронутого потока, но не заменяют просмотр производственного PDF. Детали исправления — MATERIAL-PDF-FIX.md.

## Узкая сверка перед коммитом, 2026-11-12

PASS: все 1150 файлов `backend/src` и `backend/test` совпадают по SHA256 с manifest-v4; отсутствующих, изменённых и новых tracked/untracked файлов вне снимка нет. Новых непроверенных серверных изменений не обнаружено. Полный QA не повторялся.

Секрет-скан только `evidence/final`: 26 файлов, 50 распакованных PDF-потоков; совпадений по JWT, kppd/provider keys, private keys, credential URI, Bearer и заполненным секретным JSON-полям нет. Проверены текст/байты и распакованные PDF streams; пиксели PNG без OCR — это ограничение автоматического скана. Содержимое потенциальных секретов не выводилось. В этом дополнении изменён только QA-FINAL.md.

## Окончательный результат

- Совокупный e2e: **74/74 suites, 560/560 tests, skip 0**. Пофайловые источники последних результатов — `QA-EVIDENCE.json`. Это full на v2 с повтором затронутых suites на v3/v4, а не повтор всех 74 suites на финальном снимке.
- Финальная серверная/PDF-дельта v3: tsc PASS, весь product-passport + pwa-guards **51 suites / 836 tests PASS**, night **26/26 PASS**; T26 **12/12 PASS** на новой disposable БД.
- Финальная дельта v4: tsc PASS; night **26/26 PASS**; e2e `passports`, `new-endpoints-1101`, `order-lines`, `products-order`, `trash-docs-orders` — **5 suites / 52 tests PASS**, skip 0. Изменены лишь два e2e-файла и два infra-файла относительно v3; серверная логика совпала по SHA256, поэтому 836 модульных тестов повторно не запускались.
- Финальный снимок: `D:/qa-c086/candidate-v4`, 2640 файлов; `D:/qa-c086/manifest-v4.json`, SHA256 `22f9917335991d73283778ac0c3a349c4e249c98f5c095c0c25b8e8be0a21d8b`. Сверка всех включённых backend/tools файлов с main после проверки: **различий нет**.
- Финальные логи: `D:/qa-c086/delta-results-1794436636133/` (v3), `D:/qa-c086/delta-results-1794436812424/` (v4).

## Реальная миграция uploads

PASS: в собственном старом backend без uploads-volume создан PNG `c086-preserve-9a94a708e54344ef.png`; штатный refresh сохранил файлы, заменил контейнер и восстановил их в owned volume `dc-986b9160c40716ed39d10a2e-night_uploads`. SHA256 до/после: `c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77`; файл существует, журнал миграции `verified`. ID контейнеров различаются, записаны в QA-EVIDENCE. Свой контур остановлен, volume и резервная копия сохранены. Контуры :3102/:27118 и datacore остались работающими.

Реальная проверка выявила неподдерживаемый `compose create --no-deps`; исполнитель исправил на `up --no-start --no-deps --build backend` (`tools/night-stand.mjs:153`). Повтор успешно продолжил миграцию из сохранённого журнала. Рабочий runner QA не изменял.

## Изменения тестов

`new-endpoints-1101.e2e-spec.ts:77,124`: manager preview/plan успешно возвращают PDF и строки заказа; user получает 403. `passports.e2e-spec.ts:136,283,305`: рабочие операции менеджера, индивидуальный снимок и bulk; глобальные template/texts по-прежнему запрещены. Реальные PNG создаются только в уникальных тестовых путях (`:23` и `new-endpoints-1101:25`) и удаляются после тестов. Это требуется новым контрактом readable-image; фиктивная ссылка больше не считается готовым рисунком.

Серверный контракт WORK: `backend/src/modules/product-passport/product-passport.controller.ts:434`; экранный доступ — `backend/pwa/sections/passports/funnel/index.js:158` (canWorkPassport), проверен pwa-guards. Браузерную проверку прав этот прогон не подменяет.

## Проверенный снимок

- `D:/qa-c086/candidate-v2`: 2639 файлов из tracked + пять новых C086 TypeScript-файлов; `.env`, секреты и реальные uploads исключены. Зависимости — junction на локальные node_modules.
- Базовый HEAD: `205808f9312e1be60d6283012003ee0985f3a025`, плюс незакоммиченные изменения. SHA256 каждого файла: `D:/qa-c086/manifest-v2.json`; SHA256 manifest: `71ab387c4d60b9a45e0d08c7fe6d76f6ade134b45325ff394b7d9d45df94b384`.
- Результаты: `D:/qa-c086/results-1794434731523/`; последовательные группы e2e: `D:/qa-c086/e2e-batches-1794435317213/`.

## Фактические проверки

| Проверка | Результат |
|---|---|
| TypeScript | PASS, exit 0 |
| Jest unit | PASS, 325 suites / 3794 tests |
| ESLint, imports, design-lint | PASS, exit 0 каждый |
| PWA + audit | PASS, 130/130, skip 0 |
| Safety tools/pult | PASS, 102/102, skip 0 |
| E2E, первый процесс | exit 134: Node heap OOM около 4 ГБ; полного результата нет |
| E2E, 10 последовательных групп | 74 suites; 543 PASS / 17 FAIL / 0 SKIP из 560 tests |
| OpenAPI | Экспорт из собственного backend выполнен; SHA256 `9203b2238d2d51fc26efb16d80149958b012bf22e1b3abad1d7a1364d1def686`, обновлён `docs/openapi.json` |

17 падений второго e2e: пять устаревших ожиданий manager=403 в `new-endpoints-1101.e2e-spec.ts` и `passports.e2e-spec.ts`; контракт WORK подтверждён координатором и `MANAGER-ACCESS.md`. Тесты обновлены на успешный ответ и содержимое; добавлены отрицательные user-проверки, запреты manager на глобальные template/texts сохранены. Ещё 12 — T26 setup: повторно использованная disposable БД содержала counters после первого прогона, где T26 уже PASS. Все закрыты указанными выше финальными перепроверками.

## Границы и безопасность

Собственный Docker project `dc-986b9160c40716ed39d10a2e-night`, testDb `datacore-test-986b9160c40716ed39d10a2e-night`; T26 — отдельная БД с префиксом datacore-test-t26. Действующий UI-стенд и datacore не изменялись. Созданные контейнеры остановлены; volumes сохранены. Корневые env не читались. Тестовые JWT в сохранённом HTTP-логе замаскированы.

Первый технический снимок отброшен до Docker: фильтр ошибочно исключил исходники common/uploads. Фильтр исправлен; полный кодовый прогон выполнен заново на v2. Это не дефект candidate.

UI-критерии, повторное заполнение, Ctrl+V и реальный выпуск в этом задании не проверялись: отдельная приёмка исполнителя/дизайнера. Этот отчёт подтверждает автоматические проверки, а не заменяет UI-REVIEW.
