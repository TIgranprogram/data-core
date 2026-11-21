# C176 — финальный адресный review
Вердикт: **можно к full; оба прежних 🔴 закрыты**. Базаd8b03f4f + текущий C176diff; повтор просмотрел только исправления inherited-type и atomic category/product row, исходный узкий review остального сохраняется.
🟢 `showcase.service.ts:292–299`: explicit непустой incoming passportCategory отделён от merged defaults; без него выбранныйkind сравнивается с effectiveтипом ДОправки. Исходныйincoming проходит четвёртым аргументом BulkHost→applyBulkRow, пустой/nullнеобходитзащиту.
🟢 `:300–317`: настоящий Connection.transaction; финальный productCAS содержит прежние categoryId и полный passportDefaults даже при kind-only. Конфликт бросает исключение и откатывает запись новой категории.
🟢 `category(...,session)`: findOne и insertOne получают тужеsession; fields создаёт категории последним шагом, послеstatus/designer/прочейвалидации. Нет sessionless fallback на productionпути.
🟢 Смена разрешена лишь явным согласованным типом; invalidstatus/designer/lostCAS не оставляют category/productsideeffects. Публичные bulk envelope/partial/before/restore сохранены; emittedexpected добавочный.
Проверки: код и новые адресные e2e просмотрены; настоящий MongoQA10/10, tsc/eslint0 и showcase19/108 приняты по результатам координатора/QA. Собственный предыдущий audit-cycles0; новых runtimeзависимостей модулей исправления не добавляют.
Не проверено этим повтором: full, живойUI и нагрузочныйзамер. Это инженерный PASS адресных исправлений, не общий выпуск; глобальный review-scope --done не выставлялся из-за исторически более широкогоscope.
