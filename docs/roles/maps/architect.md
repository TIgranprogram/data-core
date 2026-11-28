# Карта роли architect

коммит: 4bd23dd1 (база индекса C280, 27.11.2026). Проверены 8 файлов stock/supply и docs/openapi.json. `stock.controller.ts:105` — доступ к закупкам через раздел заявок; `supply.service.ts:1047` — остаток после частичной приёмки. История в `catalog-purchases.ts:17` читается без ограничения по дате, скорость на длинной истории не измерена.

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
- C245: [runtime review](../../crew/C245-pult-remember-login/ARCH-REVIEW.md):rotationfailure не подтверждаетстарыйdiskblob, текущийrefresh остаётсявmemory; тестовыйfreezeотдельно.
- C245 final: offline-logout guard и boundedGemma4probe review PASS,3runtimeSHA вARCH-REVIEW; QA137Node/8authUI, широкаяDOMwaitгонка исправляется толькоtest.
- C246: [заменяемость доменов 2/5](../../crew/C246-architecture-modularity/REPORT.md). audit-cycles: 1 пара order-line-plan↔work (task-bars.ts:45). products: 28 записей вне product. АБЗ-3 открыт.
- C257: черновик [CONTRACT](../../crew/C257-shared-compat-contract/CONTRACT.md) шести shared. Замок S/G только с синхроном CRM; добавка A без копии в kppdf. `orderId` движений и брони — строка, у заявки — ObjectId. CRM→API не начат. Дерево kppdf не сверялось.
- C254-doc: data-core пишет шесть shared через хозяев stock/supply; find/count вне них — `common/shared-collections`. CRM kppdf пишет напрямую. CRM→API не начат. [C254 REPORT](../../crew/C254-shared-collections-layer/REPORT.md).
- C259: [план срезов](../../crew/C259-crm-api-client-plan/PLAN-SLICES.md). Цель — снять прямую запись kppdf, не паритет схем. Diff не нужен. C260+ только после приёмки плана и L-259. Пока процесс на VM — беречь общую Mongo. Код не начат.
