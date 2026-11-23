# Карта роли architect

коммит: f6b35fc5 · опорная ревизия C244, 23.11.2026. Приёмка конкретного изменения фиксируется отдельно.

Открой ТЗ, эту карту и свою часть вывода `node backend/scripts/review-scope.mjs owners --staged`.
Границы и проверяющие заданы в [реестре](../ownership.json). Читай назначенный diff и только нужные функции или разделы по ссылкам ниже.

**Ответственность.** Границы участков, публичные контракты, общие коллекции с CRM, сохранность данных, скорость и постоянные ворота. Архитектор проверяет и принимает решения по стыку. Код исправляет назначенный владелец.

- Найди затронутые модули и их потребителей в `docs/MAP.md`, затем открой соответствующий раздел `docs/ARCHITECTURE.md`. Для паспортов сверь ПС-ID в `docs/PASSPORTS-STANDARD.md`.
- Для пересечения зафиксируй основного владельца, обязанности каждой стороны и проверяемый контракт. Новую границу или обязательную проверку одобряй по конкретной дельте с причиной, положительным и отрицательным примером, стоимостью прогона.
- Владелец участка может исправить воспроизводимый дефект, добавить регрессию или замер роста и скорости. Для изменения общей политики или добавления постоянного блокирующего шага он передаёт архитектору diff и результаты.
- Зависимости модулей: `node backend/scripts/audit-cycles.js`. Публичный API: сравни затронутый маршрут, его DTO и потребителя. Для изменения транзакции или конкурентного обновления запроси адресный тест на гонку.
- Миграции: сохранность исторического чтения и область изменения новых записей. Пример адресного аудита архитектуры — [C180](../../crew/C180-passport-architecture-audit/AUDIT.md). Границы изолированной проверки выпуска — [C166](../../crew/C166-server-schedules/ARCH-HOST-REVIEW.md).
- В выводе укажи принятые пути и контракт, проверенную дельту, выполненные проверки и остаток. Для исправленного дефекта перечитай затронутый участок и необходимый стык.

История карты до сокращения: `git show 3929ea33:docs/roles/maps/architect.md | rg -n 'слово|Cxxx'`. Подробные результаты остаются в отчётах задач.

- C242: [точечное ревью склада/kit, P2 закрыт](../../crew/C242-stock-section-order/ARCH-REVIEW.md), [контракты](../../crew/C242-stock-section-order/ARCH-PLAN.md). Aggregate quantity не является baseline одной storageitem; countMode failclosed + transaction multiple409 проверены18адресными тестами.
- C241: [повтор legacy-create/both-absent](../../crew/C241-inventor-installation-choice/ARCH-REVIEW-BACKEND.md): private create bypass не публичен; отсутствие raw ID проверяется также против вычисленного installation leaf.
- C242: [outer transaction/session repeat](../../crew/C242-stock-section-order/ARCH-TX-REVIEW.md): preflight в той жеsession, outer write возвращаетvoid безprecommitresponse; публичная проекция послеcommit сохранена.
- C242 QA TX2: [локальная граница PATCH шага/barsOf](../../crew/C242-stock-section-order/QA-TX2-ARCH.md); shared transaction wrapper не меняется, txworktypes обходят globalcache.
- C244: [photo projection план](../../crew/C244-order-product-photo/ARCH-PLAN.md): income originals выше каталога/overview; shared resolver вниз вcommon, batch/no persist, прежнийphotoresponse.
- C244: [frozen backend review PASS](../../crew/C244-order-product-photo/ARCH-REVIEW.md):6SHA/16unit, productionlistcovernull и frozenarchive не менялись.
- C245: [security-plan Pultremember](../../crew/C245-pult-remember-login/ARCH-PLAN.md):exacttrustedprod+прежнийloopback, CurrentUserDPAPI onlyrefresh, singleaccount/siteerase, rotation/transient/AUTH раздельны.
