# C011 — инвентарь артефактов бизнес-логики

Рассинхрон: **док** = `PRODUCT.md` отстаёт; **схема** = поле есть не там, где читает экран; **экран** = второй путь делает то же иначе.

| Домен | Документ | Схема / сервис | Экран | Сверка |
|--|--|--|--|--|
| Заявки | PRODUCT §1 статусы словами | `supply-request.schema.ts:91` enum без `paid`; флаг `paid` :129 | `requests.js`, `ui/badges.js:4–20` | Экран и флаг согласованы. PRODUCT пишет «Оплачено» как статус — это язык экрана. |
| Счета | ЦП-3: вкладка в «Заявках» | `supply-invoice.schema.ts`, `supply-invoice.service.ts` receive → `SupplyService.receive` | вкладка `invoices-tab.js` + карточка `invoice-workspace.js`; отдельно `invoice.js` «Счёт без заявок» | **Два пути.** Старый не создаёт счёт. |
| Приёмка | PRODUCT §2 одно «Принять» | `supply.service.ts:560` receive | заявка `reqReceive`; счёт `invoice-workspace`; склад `stock-ops.js` ещё и `/stock/batch` | Пакет без заявки допустим. Пакет при открытой заявке — дыра C011-B. |
| Склад, бронь, выдача | PRODUCT §2 | `stock-movements.service.ts` move; брони `stock-reservations` | `stock.js`, `stock-ops.js`, `issue.js` | Компьютер: кому выдать — вид работ. |
| Склад телефон | DESIGN-MOBILE | отделы `dicts.defs.ts` `departmentId` | `stock-mobile.js:189` | Схема вида работ — строка `department` (`work-type.schema.ts:21`). |
| Заказы | PRODUCT §4 «В работе / Готов» | `order-key.ts:8` этапы; позиции `incomes` | `salesorders.js` + карточка `orders.js` | Экран богаче документа. Вкладок договора хватает. |
| Сопоставление | КМ, ВР | `productByTitle` `incomes.service.ts:211` | меню `matching` и метка в строке `salesorders.js:293` | Дубль входа. Автопривязка по имени опасна. |
| Проектирование | DESIGN-BOARD | `designtasks` | `design.js`; вкладка договора `order-design.js` | Два входа осмысленны: доска и заказ. |
| В работе | AUDIT-PRODUCTION, ОТД | `worktasks`, `products.workTypes` | `work.js`; вкладка `order-work.js` | Чек-листы отделов в QUESTIONS О-3, в коде маршрута нет. |
| Отгрузка | AUDIT-SHIPMENT | `shipments`, готовность `order-readiness.ts` | `order-shipments.js`; вкладка договора | Этап не блокируется проверками — так решено (ЦП-1). |
| Продукция | PRODUCT §5а, ЕН | `products.composition` | `products.js`, `composition.js` | Состав для склада. |
| Паспорт | PASSPORTS-V2, §5а | `materialsSpec` снимок текста | `docs.js` вкладки; выпуск из изделия | Второй «состав». Монтаж всё ещё в шаблоне и справочнике. |
| КП | PRODUCT «не делаем»; аудит КП сделан | `commercialoffers` | меню `offers.js`, корзина `kp.js` | Статус не рождает заказ. |
| Контрагенты | PRODUCT §3 `counterparties` | `organizations` + текст заказчика | `partners.js`, вход из `dicts.js:97`, в меню слева нет | Док называет не ту коллекцию. |
| Договоры поставщиков | ДП | `suppliercontracts` | меню «Договоры» `contracts.js:212` | Имя совпадает с договором заказчика. |
| Деньги | PRODUCT §5 «операции» | нет кассы; `finance.service.ts` из заявок и оплат позиций | `money.js` 5 вкладок | Кассы нет — это правильно. Документ врёт. |
| Общее с CRM | UNIFY | `materials`, `storageitems`, `stockmovements`, `supplyrequests`, `organizations`, `worktypes` | — | Enum и имена полей CRM не переименовывать. |
