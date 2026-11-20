# C170 — адресные исправления первого архитектурного прохода

База рабочего этапа `5f5b681c`, основной отчёт ARCH-REVIEW.md. Один батч исправлений, затем один узкий второй проход. Не менять C166, финансовые поля и старые номерные снимки.

## P1

1. **Живое изделие.** Выбор и effective readiness проверяют существование текущего продукта и отсутствие deletedAt, независимо от заполненности шаблона/фирмы. При missing/deleted — attachment не становится готовым; никакого автоматического fallback site. Исторические issued/PDF остаются читаемыми. Тесты select и plan/effective для missing/deleted.
2. **Повтор транзакции и изменяемый Mongoose document.** Session.withTransaction повторяет callback после transient abort, но уже сохранённый document потерял modifiedPaths/isNew. Обеспечить корректное восстановление через connection.transaction и/или создание/rehydrate документа и применение изменений заново внутри каждого retry. Проверить все action closures: восстановление флагов не означает откат произвольных значений/массивов в памяти; номер/история/счётчик не должны пропускаться или дублироваться на повторе. Fault regression с настоящей Mongo: первый save сделан, затем transient abort до commit; после retry реальные изменения сохранены ровно один раз, новый draft ровно один, счётчики/история согласованы. Не маскировать ошибку изменением моков.
3. **Binding issue.** При reread внутри transaction до любого номера/документа сравнить fingerprint income/product/order с начальным baseline. Legacy rebind A→B или standalone→B после первоначального чтения не позволяет issue с guard A либо без guard. Реальный interleaving test: pause после первого чтения, rebind на B, select attachment B, продолжить issue → конфликт, нового номера/issued нет. Историческое idempotent чтение уже issued не ломать.

## P2

4. **Область skipped PDF.** Применить explicit IDs до фильтрации attachment; unrelated attachment не добавляется в skipped и не маскирует ошибку выбранного site-паспорта. Отдельные тесты mixed/site-error/all-requested-attached; исторический адресный PDF прежний.
5. **Восстановление purge.** После ошибки файловой операции/DB или crash запись не остаётся purging навсегда. Добавить ограниченное lease/CAS-reconcile по тому же поколению/token, с проверкой фактического файла и без бесконечного цикла/неограниченного fanout. Restore/select запрещены в неопределённом состоянии до подтверждения. Тесты unlink failure и потеря DB-подтверждения после unlink, повтор cleanup и безопасный restore/removed итог.

## Проверки и границы

Реальная гонка selection↔issue должна проверять отсутствие лишнего номера/документа, а не только последовательный stale guard. Все негативные сценарии на `datacore-test-c170` owned51796, без продовых действий. После исправлений types, unit затронутых helper/сервисов, strict e2e C170, lint новых helpers. Затем freeze и второй узкий review конкретных пяти пунктов; общий full — после принятия.
