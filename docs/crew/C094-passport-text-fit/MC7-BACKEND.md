# МЦ-7 — backend, 12.11.2026

Реализовано в текущем checkout, без миграций, коммита, выкладки и доступа к стендам.

- Optional `rows[].passportText/techText`, `materialsSpec.coatingTexts:[{materialId,passportText?,techText?}]`.
- Разбор проверяет строковый тип и предел 2000 символов; пустые поля опускаются, пробелы нормализуются.
- Тексты покрытий сохраняются только для выбранных coatingIds; несколько вариантов одного ID поддерживаются.
- «Взять из состава» проецирует ручные поля склада; группировка учитывает оба текста. Сам запрос ничего не записывает.
- API presentation сохраняет optional поля; DTO паспорта уточнён. Старые записи сохраняют прежнюю форму.
- Паспортное описание и materialsText выводят ручную фразу в нейтральном контексте без склонения и размеров.
- Серверное техописание заменяет автоматическую строку ручным techText; покрытия используют выбранные варианты techText.
- Без ручных текстов остаётся прежний fallback. Пути issued/snapshot не менялись, чтение склада в печать не добавлялось.

## Проверка

- `npx tsc --noEmit`: PASS, exit 0 после всех правок.
- Targeted unit (product-passport, showcase, materials-table/materials-text/tech-sheet-rows): **71 suites, 675 tests PASS**.
- Targeted eslint: PASS, exit 0, 0 errors. Шесть существующих any warnings в unit; e2e исключён конфигурацией eslint.
- Первый unit обнаружил отсутствие словаря в существующем fallback тесте; обработка undefined исправлена, повторный прогон зелёный.
- Расширен `chain-materials-to-passport.e2e-spec.ts`: ручные тексты в предложении, сохранённом составе и описании; изменение склада после выпуска сохраняет снимок и PDF issued.
- E2E здесь не запускался: полный прогон после freeze поручен координатором отдельной проверке.
- MAP/OpenAPI, UI и независимая приёмка остаются координатору/назначенным исполнителям.

## Файлы

`common/catalog/materials-text.ts`, `materials-table.ts`, `common/print/tech-sheet-rows.ts`, `modules/showcase/showcase-materials.ts`, `modules/product-passport/passport-compose-parts.ts`, `dto/create-product-passport.dto.ts`, четыре соответствующих unit-файла и `test/e2e/chain-materials-to-passport.e2e-spec.ts`.

## Полный прогон после freeze

PASS, 12.11.2026. Unit: **329 suites / 3851 tests**, e2e: **75 suites / 563 tests**. Fail 0, skip 0.

12 последовательных e2e-групп, все exit 0. T26: 12/12 на отдельной disposable БД. Собственный Mongo 4.4 `mc7-test-mongo-20261112-27994`, только loopback27994, `rs0`; БД только `datacore-test-mc7-*` и `datacore-test-t26-mc7-*`. Контейнер остановлен. C088, QA3102/3112 и рабочие БД не затрагивались. Чтение `.env` блокировалось одноразовым setup.

Первый полный unit поймал две PWA guards ошибки параллельной реализации истории карточек (preload и design-lint). Координатор исправил; после PWA freeze весь unit повторён успешно. Первая попытка повторного запуска имела ошибку относительного пути setup до запуска тестов, путь исправлен.

SHA256 манифеста backend/src + backend/test до/после e2e и после финального unit совпал: `f0ff7bfe04fe8aaac73d1a21ca88b976f7a2a56d7f598e462a8dcf6c696acf02`.

Доказательства: `evidence/mc7-full-results.json`, `evidence/mc7-full-manifest.json`; полные логи и одноразовый runner — `tools/logs/mc7-full-20261112/`, `tools/logs/mc7-full-runner.cjs`. TEST-LOG обновлён. Коммита и выкладки не было.
