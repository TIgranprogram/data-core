# C024 — сводка журнала изменений прода (обезличено)

Источник: GET /api/audit-logs, 3984 записей, 2026-10-18 … 2026-11-06 (МСК), 19 дней с записями. Пользователей: 13. Имена, id и значения полей убраны; люди — только ролью.
Журнал пишет изменения данных (создать, изменить, удалить, принять, выдать…). Просмотры и поиск не пишутся.

## Действия (все роли)

| Что | Сколько |
|--|--|
| create — Фото: создано | 447 |
| designnote.created — Задача проектирования: создано | 412 |
| showcase.updated — Изделие: изменено | 385 |
| designtask.updated — Задача проектирования: изменено | 371 |
| designtask.photo.added — designtask.photo.added | 298 |
| showcase.created — Изделие: создано | 205 |
| delete — Фото: удалено | 179 |
| designtask.photo.removed — designtask.photo.removed | 179 |
| stock.item.created — Позиция склада: создано | 137 |
| dict.created — Справочник: создано | 124 |
| income.updated — Позиция заказа: изменено | 96 |
| stock.batch — stock.batch | 81 |
| designtask.created — Задача проектирования: создано | 79 |
| salesorder.updated — Заказ: изменено | 76 |
| stock.item.article.cleaned — stock.item.article.cleaned | 71 |
| supply.request.updated — Заявка: изменено | 69 |
| stock.item.updated — Позиция склада: изменено | 68 |
| income.created — Позиция заказа: создано | 62 |
| passport.updated — Паспорт: изменено | 61 |
| supply.request.received — supply.request.received | 32 |
| supply.request.created — Заявка: создано | 29 |
| worktask.done — worktask.done | 24 |
| passport.nextNumber — passport.nextNumber | 23 |
| person.zones.updated — Сотрудник: изменено | 19 |
| update — Изделие: изменено | 19 |
| supply.invoice.updated — Счёт поставщика: изменено | 16 |
| partner.updated — Партнёр: изменено | 16 |
| admin.user.created — Пользователь: создано | 14 |
| admin.user.updated — Пользователь: изменено | 14 |
| designtask.deleted — Задача проектирования: удалено | 13 |
| passport.copied — passport.copied | 13 |
| stock.movement.cancelled — stock.movement.cancelled | 12 |
| zone.updated — Зона ответственности: изменено | 12 |
| designsticker.updated — Стикер проектирования: изменено | 12 |
| person.created.fromLogin — person.created.fromLogin | 11 |
| salesorder.created — Заказ: создано | 11 |
| bundle.download — bundle.download | 11 |
| bundle.delete — Удалено | 11 |
| stock.reserve.list — stock.reserve.list | 10 |
| put_asset — put_asset | 10 |
| supply.invoice.paid — supply.invoice.paid | 10 |
| supply.request.photo.added — supply.request.photo.added | 9 |
| supply.invoice.created — Счёт поставщика: создано | 9 |
| passport.created — Паспорт: создано | 9 |
| passport.deleted — Паспорт: удалено | 9 |
| showcase.from-passports — showcase.from-passports | 9 |
| offer.created — КП: создано | 8 |
| partner.created — Партнёр: создано | 8 |
| supply.request.deleted — Заявка: удалено | 8 |
| showcase.bulk — showcase.bulk | 8 |
| showcase.deleted — Изделие: удалено | 8 |
| income.deleted — Позиция заказа: удалено | 8 |
| admin.override — admin.override | 7 |
| offer.deleted — КП: удалено | 7 |
| stock.reserve.issued — stock.reserve.issued | 6 |
| stock.item.moved — stock.item.moved | 6 |
| designboard.added — designboard.added | 6 |
| dict.updated — Справочник: изменено | 6 |
| worktask.launched — worktask.launched | 6 |
| salesorder.deleted — Заказ: удалено | 6 |

## Роль · действие

| Что | Сколько |
|--|--|
| Администратор · create — Фото: создано | 441 |
| Администратор · designnote.created — Задача проектирования: создано | 412 |
| Администратор · showcase.updated — Изделие: изменено | 384 |
| Администратор · designtask.updated — Задача проектирования: изменено | 370 |
| Администратор · designtask.photo.added — designtask.photo.added | 298 |
| Администратор · showcase.created — Изделие: создано | 205 |
| Администратор · delete — Фото: удалено | 179 |
| Администратор · designtask.photo.removed — designtask.photo.removed | 179 |
| Администратор · stock.item.created — Позиция склада: создано | 129 |
| Администратор · dict.created — Справочник: создано | 124 |
| Администратор · income.updated — Позиция заказа: изменено | 95 |
| Администратор · designtask.created — Задача проектирования: создано | 79 |
| Администратор · salesorder.updated — Заказ: изменено | 75 |
| система/скрипт · stock.item.article.cleaned — stock.item.article.cleaned | 71 |
| Администратор · stock.item.updated — Позиция склада: изменено | 62 |
| Администратор · income.created — Позиция заказа: создано | 61 |
| Администратор · passport.updated — Паспорт: изменено | 61 |
| Трубарез · stock.batch — stock.batch | 56 |
| Администратор · supply.request.updated — Заявка: изменено | 49 |
| Администратор · supply.request.received — supply.request.received | 27 |
| Администратор · supply.request.created — Заявка: создано | 27 |
| Администратор · worktask.done — worktask.done | 24 |
| Администратор · passport.nextNumber — passport.nextNumber | 23 |
| Менеджер · supply.request.updated — Заявка: изменено | 19 |
| Администратор · person.zones.updated — Сотрудник: изменено | 19 |
| Администратор · update — Изделие: изменено | 19 |
| Администратор · admin.user.created — Пользователь: создано | 13 |
| Администратор · passport.copied — passport.copied | 13 |
| Администратор · stock.batch — stock.batch | 12 |
| Администратор · designtask.deleted — Задача проектирования: удалено | 12 |
| Администратор · zone.updated — Зона ответственности: изменено | 12 |
| Проектировщик · designsticker.updated — Стикер проектирования: изменено | 12 |
| Администратор · person.created.fromLogin — person.created.fromLogin | 11 |
| Лазер лист · stock.batch — stock.batch | 11 |
| Администратор · supply.invoice.updated — Счёт поставщика: изменено | 11 |
| Проектировщик · partner.updated — Партнёр: изменено | 11 |
| Трубарез · stock.movement.cancelled — stock.movement.cancelled | 10 |
| Администратор · put_asset — put_asset | 10 |
| Администратор · salesorder.created — Заказ: создано | 10 |
| Администратор · supply.request.photo.added — supply.request.photo.added | 9 |
| Администратор · passport.created — Паспорт: создано | 9 |
| Проектировщик · bundle.delete — Удалено | 9 |
| Администратор · admin.user.updated — Пользователь: изменено | 9 |
| Администратор · passport.deleted — Паспорт: удалено | 9 |
| Администратор · showcase.from-passports — showcase.from-passports | 9 |
| Администратор · offer.created — КП: создано | 8 |
| Администратор · partner.created — Партнёр: создано | 8 |
| Трубарез · stock.item.created — Позиция склада: создано | 8 |
| Проектировщик · bundle.download — bundle.download | 8 |
| Администратор · showcase.deleted — Изделие: удалено | 8 |
| Администратор · income.deleted — Позиция заказа: удалено | 8 |
| Администратор · admin.override — admin.override | 7 |
| Администратор · stock.reserve.list — stock.reserve.list | 7 |
| Администратор · offer.deleted — КП: удалено | 7 |
| Администратор · supply.request.deleted — Заявка: удалено | 7 |
| Администратор · showcase.bulk — showcase.bulk | 7 |
| Администратор · stock.reserve.issued — stock.reserve.issued | 6 |
| Администратор · stock.item.moved — stock.item.moved | 6 |
| Лазер лист · stock.item.updated — Позиция склада: изменено | 6 |
| Администратор · dict.updated — Справочник: изменено | 6 |

## Кто сколько (по ролям)

| Что | Сколько |
|--|--|
| Администратор | 3699 |
| Трубарез | 80 |
| Проектировщик | 78 |
| система/скрипт | 72 |
| Менеджер | 35 |
| Лазер лист | 17 |
| неизвестная роль | 2 |
| Кладовщик | 1 |

## Тип записи

| Что | Сколько |
|--|--|
| DesignTask | 1352 |
| Product | 644 |
| Photo | 626 |
| Material | 286 |
| Income | 166 |
| SupplyRequest | 162 |
| DictItem | 140 |
| ProductPassport | 121 |
| StockMovement | 112 |
| SalesOrder | 96 |
| SupplyInvoice | 43 |
| WorkTask | 41 |
| User | 33 |
| Person | 31 |
| Partner | 24 |
| Bundle | 23 |
| CommercialOffer | 18 |
| Organization | 13 |
| Zone | 12 |
| DesignSticker | 12 |
| DesignOrder | 11 |
| ProductPhoto | 6 |
| PassportTemplate | 4 |
| StockZone | 2 |
| DeviceInvite | 2 |
| Backup | 1 |
| FinanceSettings | 1 |
| Warehouse | 1 |
| Shipment | 1 |

## Самые правимые поля (тип · поле, сколько раз менялось)

| Что | Сколько |
|--|--|
| Material · article | 71 |
| Material · internalArticle | 71 |
| Income · matchStatus | 49 |
| Income · productId | 48 |
| SalesOrder · stage | 21 |
| SupplyRequest · priceHint | 5 |
| SupplyRequest · invoiceAmount | 5 |
| SupplyRequest · status | 2 |
| SupplyRequest · cancelledQty | 2 |

## Серии одинаковых действий подряд (≥ 3, пауза ≤ 10 мин)

| Роль · действие · тип | Серий | Действий в сериях | Самая длинная |
|--|--|--|--|
| Администратор · designnote.created — Задача проектирования: создано · DesignTask | 3 | 412 | 203 |
| Администратор · showcase.updated — Изделие: изменено · Product | 8 | 298 | 167 |
| Администратор · designtask.updated — Задача проектирования: изменено · DesignTask | 11 | 228 | 73 |
| Администратор · showcase.created — Изделие: создано · Product | 2 | 180 | 177 |
| Администратор · stock.item.created — Позиция склада: создано · Material | 2 | 119 | 67 |
| Администратор · dict.created — Справочник: создано · DictItem | 5 | 114 | 39 |
| Администратор · create — Фото: создано · Photo | 17 | 92 | 18 |
| Администратор · income.updated — Позиция заказа: изменено · Income | 4 | 84 | 46 |
| Администратор · designtask.photo.removed — designtask.photo.removed · DesignTask | 20 | 83 | 7 |
| Администратор · delete — Фото: удалено · Photo | 20 | 83 | 7 |
| система/скрипт · stock.item.article.cleaned — stock.item.article.cleaned · Material | 1 | 71 | 71 |
| Администратор · salesorder.updated — Заказ: изменено · SalesOrder | 7 | 69 | 20 |
| Администратор · income.created — Позиция заказа: создано · Income | 5 | 59 | 15 |
| Администратор · stock.item.updated — Позиция склада: изменено · Material | 6 | 48 | 16 |
| Администратор · designtask.photo.added — designtask.photo.added · DesignTask | 10 | 45 | 7 |
| Администратор · passport.updated — Паспорт: изменено · ProductPassport | 4 | 38 | 16 |
| Трубарез · stock.batch — stock.batch · StockMovement | 7 | 34 | 11 |
| Администратор · worktask.done — worktask.done · WorkTask | 2 | 21 | 14 |
| Администратор · supply.request.received — supply.request.received · SupplyRequest | 3 | 20 | 14 |
| Администратор · supply.request.updated — Заявка: изменено · SupplyRequest | 4 | 17 | 8 |
| Менеджер · supply.request.updated — Заявка: изменено · SupplyRequest | 2 | 13 | 7 |
| Администратор · designtask.deleted — Задача проектирования: удалено · DesignTask | 2 | 12 | 9 |
| Проектировщик · designsticker.updated — Стикер проектирования: изменено · DesignSticker | 1 | 12 | 12 |
| Администратор · supply.request.created — Заявка: создано · SupplyRequest | 2 | 9 | 5 |
| Администратор · showcase.from-passports — showcase.from-passports · Product | 1 | 9 | 9 |
| Проектировщик · partner.updated — Партнёр: изменено · Partner | 2 | 8 | 4 |
| Трубарез · stock.movement.cancelled — stock.movement.cancelled · StockMovement | 1 | 8 | 8 |
| Администратор · put_asset — put_asset · Organization | 2 | 7 | 4 |
| Администратор · income.deleted — Позиция заказа: удалено · Income | 1 | 7 | 7 |
| Администратор · offer.deleted — КП: удалено · CommercialOffer | 2 | 7 | 4 |
| Администратор · showcase.deleted — Изделие: удалено · Product | 1 | 5 | 5 |
| Администратор · person.created.fromLogin — person.created.fromLogin · Person | 1 | 5 | 5 |
| Администратор · worktask.plan — worktask.plan · WorkTask | 1 | 5 | 5 |
| Администратор · stock.reserve.list — stock.reserve.list · StockMovement | 1 | 5 | 5 |
| Проектировщик · supply.request.received — supply.request.received · SupplyRequest | 1 | 5 | 5 |
| Администратор · dict.imported — dict.imported · DictItem | 1 | 4 | 4 |
| Администратор · salesorder.deleted — Заказ: удалено · SalesOrder | 1 | 4 | 4 |
| Администратор · stock.reserve.issued — stock.reserve.issued · StockMovement | 1 | 4 | 4 |
| Лазер лист · stock.item.updated — Позиция склада: изменено · Material | 1 | 4 | 4 |
| Администратор · dict.updated — Справочник: изменено · DictItem | 1 | 3 | 3 |

## Цепочки: действие → следующее за 5 мин (тот же человек)

| Что | Раз |
|--|--|
| Администратор · create → designtask.photo.added | 186 |
| Администратор · designtask.updated → create | 130 |
| Администратор · designtask.photo.added → create | 110 |
| Администратор · designtask.photo.added → designtask.created | 72 |
| Администратор · delete → designtask.updated | 69 |
| Администратор · designtask.created → designtask.updated | 67 |
| Администратор · create → designtask.photo.removed | 67 |
| Администратор · designtask.photo.removed → designtask.photo.added | 67 |
| Администратор · designtask.photo.added → delete | 67 |
| Администратор · create → showcase.updated | 54 |
| Администратор · showcase.updated → create | 29 |
| Администратор · designtask.created → create | 12 |
| Администратор · zone.updated → person.zones.updated | 12 |
| Администратор · showcase.created → create | 11 |
| Администратор · person.zones.updated → zone.updated | 11 |
| Администратор · create → supply.request.photo.added | 9 |
| Администратор · showcase.created → income.updated | 8 |
| Трубарез · stock.item.created → stock.batch | 8 |
| Администратор · showcase.updated → showcase.created | 7 |
| Администратор · salesorder.created → income.created | 7 |
| Администратор · stock.item.created → stock.item.updated | 7 |
| Администратор · update → showcase.updated | 7 |
| Трубарез · stock.batch → stock.item.created | 7 |
| Администратор · supply.request.updated → create | 6 |
| Администратор · passport.copied → passport.updated | 6 |
| Администратор · designtask.updated → designtask.created | 6 |
| Администратор · admin.user.created → person.created.fromLogin | 6 |
| Администратор · income.updated → showcase.created | 6 |
| Администратор · create → update | 6 |
| Администратор · passport.updated → create | 6 |
| Администратор · update → passport.deleted | 6 |
| Администратор · showcase.updated → update | 6 |
| Администратор · stock.item.updated → stock.item.created | 6 |
| Администратор · create → supply.request.updated | 5 |
| Администратор · income.created → salesorder.created | 5 |
| Администратор · supply.invoice.updated → supply.invoice.paid | 5 |
| Администратор · admin.override → supply.invoice.line_updated | 5 |
| Менеджер · supply.invoice.updated → supply.invoice.paid | 5 |
| Администратор · update → passport.copied | 5 |
| Администратор · passport.deleted → update | 5 |

## По часам (МСК)

| Что | Сколько |
|--|--|
| 00 | 83 |
| 01 | 438 |
| 02 | 8 |
| 04 | 76 |
| 05 | 35 |
| 06 | 6 |
| 07 | 65 |
| 08 | 140 |
| 09 | 165 |
| 10 | 207 |
| 11 | 91 |
| 12 | 182 |
| 13 | 217 |
| 14 | 127 |
| 15 | 67 |
| 16 | 137 |
| 17 | 20 |
| 18 | 494 |
| 19 | 114 |
| 20 | 662 |
| 21 | 12 |
| 22 | 61 |
| 23 | 577 |

## По дням недели

| Что | Сколько |
|--|--|
| пн | 188 |
| вт | 1873 |
| ср | 825 |
| чт | 261 |
| пт | 531 |
| сб | 260 |
| вс | 46 |

## По дням

| Что | Сколько |
|--|--|
| 2026-10-18 | 3 |
| 2026-10-20 | 12 |
| 2026-10-21 | 111 |
| 2026-10-22 | 42 |
| 2026-10-23 | 132 |
| 2026-10-24 | 54 |
| 2026-10-25 | 27 |
| 2026-10-26 | 42 |
| 2026-10-27 | 1832 |
| 2026-10-28 | 647 |
| 2026-10-29 | 201 |
| 2026-10-30 | 358 |
| 2026-10-31 | 206 |
| 2026-11-01 | 16 |
| 2026-11-02 | 146 |
| 2026-11-03 | 29 |
| 2026-11-04 | 67 |
| 2026-11-05 | 18 |
| 2026-11-06 | 41 |
