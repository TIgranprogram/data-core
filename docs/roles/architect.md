# Уроки роли architect

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

2026-11-18 · пустое `categories` — три закона, не один: материалы/установка = все, части = не в коротком списке, элементы = никому (`elementFits`); чип «Для всех» нельзя вешать на части · docs/crew/C144-dict-cascade-scope/AUDIT.md
2026-11-03 · «автообновление Sportin не сделано» в todo и SERVERS-STATUS устарело: на ПК задачи Windows уже есть, смотреть schtasks и D:\datacore-backups\refresh.log · docs/crew/C013-ha-sportin/REPORT.md
2026-11-03 · не называть refresh-copy реальным временем: это mongorestore раз в сутки; цель пользователя — журнал replica set, и автомат макет запретил до защиты по лагу · docs/roles/tz/HA-TWO-SERVERS.md


2026-11-19 · подтверждение полной оплаты без даты — отдельное evidence, не платёж и не долг; нельзя прятать его draft-статусом или подставлять today в legacy /pay · docs/crew/C158-supply-financial-fields/UNDATED-PAYMENT-ARCH.md

2026-11-19 · «договор поставки» не определяет нашу сторону: сначала ИНН продавца/покупателя; SalesOrder — клиентский договор, productionNo только группировка. Счёт/условия аванса не создают поступление; PDF в фото позиции не заменяет юридический комплект договора · docs/crew/C164-new-documents-chain-audit/AUDIT-CODE.md

2026-11-19 · callback транзакции, выбранный по invoiceId первого GET, не защищает первоначально standalone заявку от позднего attach→confirm. Freshsource/CAS нужен на всех receipt ветках до движения; исправление обычного PATCH не покрывает приёмку · docs/crew/C165-undated-payments-and-filename-repair/ARCH-REVIEW.md

2026-11-24 · shared с CRM — контракт полей, не перевод на API: замок S/G менять только синхронно с kppdf; добавка A без required и без default на save; orderId движений и брони — строка, у заявки — ObjectId · docs/crew/C257-shared-compat-contract/CONTRACT.md
2026-11-24 · владение шестью shared только внутри data-core: запись через stock/supply, find/count вне них через common/shared-collections; CRM kppdf пишет напрямую, CRM→API не открывать · docs/crew/C254-shared-collections-layer/REPORT.md
2026-11-24 · владелец: kppdf не развиваем и diff схем не делаем; срезы C259 снимают прямую запись; пока процесс жив на VM — беречь общую Mongo (`$set`, не replace) · docs/crew/C259-crm-api-client-plan/PLAN-SLICES.md
