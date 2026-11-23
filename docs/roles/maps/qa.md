# Карта роли qa

коммит: 88fe3eff · опорная ревизия для поиска, 23.11.2026. Приёмка конкретного изменения фиксируется отдельно.

Открой ТЗ, эту карту и свою часть вывода `node backend/scripts/review-scope.mjs owners --staged`.
Границы и проверяющие заданы в [реестре](../ownership.json). Читай назначенный diff и только нужные функции или разделы по ссылкам ниже.

**Ответственность.** Критерии приёмки, корректность тестов и фикстур, риск регрессии на стыках, достоверность журнала. Для изменения выбери самую дешёвую проверку, которая действительно воспроизводит отказ.

- Серверный unit из `backend/`: `npx jest --runTestsByPath <путь-к-spec> --runInBand`. Клиентский Node-тест из корня: `node --experimental-vm-modules --test <путь-к-test.mjs>`. Серверные e2e — `backend/test/e2e/`, конфигурация — `backend/test/jest-e2e.json`.
- Перед e2e сверь выделенную одноразовую Mongo rs0 и допустимое имя БД в нужном тесте. Пример — `assertC170TestDatabase` в `backend/test/e2e/c170-passport-source.e2e-spec.ts`. Для сценариев файлов проверь изолированный каталог загрузок. Отсутствие подходящей среды фиксируй как SKIP с причиной.
- Для гонки, повтора запроса, старой записи или сбоя посередине тест должен наблюдать сохранённое состояние. Примеры проверок очереди — [C176](../../crew/C176-product-identification-queue/QA-REPORT.md), изоляции файловой очереди — [C169](../../crew/C169-local-document-intake/QA-REPORT.md).
- `docs/TEST-LOG.md` содержит итог общего прогона. Для адресной проверки достаточно команды, набора данных, количества прошедших/пропущенных тестов и результата в отчёте задачи.
- Владелец кода может добавить локальную регрессию. Новую постоянную блокировку передай архитектору с примерами пропуска и отказа. Визуальный вердикт по снимкам даёт дизайнер.

- C233: защита создания заказчика и подтверждения — `tools/document-intake/c233-customer-qa.test.mjs:38`; неполные текстовые таблицы — `tools/document-intake/c233-print-layout-qa.test.mjs:14`. Итоги и границы: [QA-REPORT](../../crew/C233-live-intake-control/QA-REPORT.md).
- C237: различие договора/заказа в PDF — `backend/src/modules/salesorders/production-orders.pdf.spec.ts:25`, генератор/default — `order-pdf.spec.ts:32` того же модуля; UI — `backend/pwa/sections/c237-contract-labels.test.mjs:20`. Изолированные Mongo-команды и ограничения: [QA-COMMANDS](../../crew/C237-contract-order-labels/QA-COMMANDS.md).
- C239: рисунки 8→9, сохранность чужих фото и повтор пятой привязки — `tools/document-intake/c239-images-qa.test.mjs:100`, `:122`; изолированная UI-фикстура — `pult/test/ui-document-intake-images.fixture.mjs:1`. [QA и границы](../../crew/C239-intake-document-images/QA-REPORT.md).

История карты до сокращения: `git show 3929ea33:docs/roles/maps/qa.md | rg -n 'слово|Cxxx'`. Подробные результаты остаются в отчётах задач.
