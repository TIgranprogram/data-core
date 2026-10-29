# Перечень приложения «Рабочее место» (собран скриптом)

Создан: `node backend/scripts/ui-inventory.mjs`. Файлов: 136, всего 1399.6 КБ JS (без CSS).

Как читать: каждая строка — пункт проверки аудита. Ничего не отмечено «проверено» здесь: отметки — в `docs/audit/AUDIT-PLAN.md`.

## 1. Файлы: размер и способы открытия

| Файл | КБ | Строк | Правая панель | Окно (modal) | Подтверждение | Переход go() | Импортов |
|--|--|--|--|--|--|--|--|
| sections/products.js | 50.3 | 514 | 6 | 0 | 2 | 2 | 20 |
| sections/salesorders.js | 45.8 | 510 | 9 | 2 | 3 | 2 | 20 |
| ui/design-board.js | 45.6 | 551 | 0 | 4 | 2 | 6 | 14 |
| ui/list.js | 44.7 | 593 | 0 | 0 | 0 | 0 | 13 |
| main.js | 41.9 | 512 | 2 | 1 | 1 | 4 | 61 |
| sections/requests.js | 38.1 | 465 | 2 | 2 | 0 | 1 | 20 |
| sections/dicts.js | 32.8 | 376 | 5 | 1 | 2 | 3 | 16 |
| sections/money.js | 30.5 | 330 | 0 | 1 | 0 | 3 | 9 |
| sections/stock-ops.js | 28.0 | 342 | 1 | 0 | 4 | 0 | 22 |
| sections/supplier-catalog.js | 27.3 | 395 | 0 | 1 | 0 | 0 | 14 |
| sections/partners.js | 26.6 | 337 | 1 | 2 | 0 | 2 | 10 |
| ui/form.js | 26.5 | 356 | 0 | 0 | 0 | 0 | 8 |
| sections/orders.js | 26.2 | 321 | 0 | 3 | 0 | 2 | 14 |
| sections/home.js | 25.1 | 370 | 4 | 1 | 0 | 10 | 11 |
| ui/materials-spec.js | 25.0 | 316 | 0 | 0 | 0 | 0 | 6 |
| sections/stock.js | 24.8 | 283 | 0 | 0 | 0 | 1 | 17 |
| sections/design.js | 24.3 | 326 | 0 | 0 | 0 | 2 | 13 |
| sections/invoice.js | 24.1 | 263 | 0 | 0 | 0 | 0 | 15 |
| ui/card.js | 24.0 | 291 | 1 | 0 | 5 | 1 | 14 |
| sections/passport-texts.js | 23.6 | 308 | 5 | 0 | 1 | 0 | 6 |
| sections/request-step.js | 22.7 | 266 | 2 | 1 | 0 | 0 | 11 |
| ui/board.js | 20.7 | 298 | 0 | 0 | 0 | 0 | 7 |
| sections/kp.js | 20.5 | 212 | 0 | 0 | 0 | 0 | 11 |
| ui/spec-import.js | 19.5 | 233 | 0 | 0 | 0 | 0 | 10 |
| sections/contracts.js | 18.5 | 244 | 2 | 0 | 1 | 0 | 9 |
| core/api.js | 18.4 | 272 | 0 | 0 | 0 | 0 | 0 |
| sections/staff.js | 18.3 | 232 | 0 | 0 | 1 | 3 | 7 |
| ui/target-picker.js | 17.4 | 229 | 0 | 0 | 0 | 0 | 9 |
| sections/passports.js | 17.2 | 185 | 0 | 0 | 1 | 2 | 17 |
| sections/passport-tree.js | 17.0 | 204 | 6 | 1 | 1 | 0 | 10 |
| sections/chat.js | 16.9 | 228 | 0 | 0 | 0 | 3 | 11 |
| sections/invoices-tab.js | 14.1 | 207 | 2 | 0 | 0 | 0 | 10 |
| sections/help.js | 14.0 | 222 | 0 | 0 | 0 | 0 | 2 |
| sections/composition.js | 13.3 | 149 | 0 | 0 | 0 | 0 | 5 |
| sections/payroll.js | 13.1 | 157 | 0 | 1 | 1 | 0 | 7 |
| sections/docs.js | 13.0 | 177 | 1 | 0 | 0 | 4 | 13 |
| ui/facet-filter.js | 12.3 | 142 | 0 | 0 | 0 | 0 | 7 |
| sections/order-shipments.js | 10.6 | 131 | 1 | 0 | 1 | 0 | 8 |
| sections/salesorders-unassigned.js | 10.6 | 156 | 0 | 2 | 0 | 1 | 10 |
| sections/docs-orders.js | 9.9 | 143 | 0 | 1 | 0 | 1 | 8 |
| sections/help-flow-data.js | 9.5 | 87 | 0 | 0 | 0 | 0 | 0 |
| ui/funnel.js | 9.4 | 156 | 0 | 0 | 0 | 0 | 3 |
| ui/cat-art.js | 9.2 | 78 | 0 | 0 | 0 | 0 | 0 |
| ui/design-notes.js | 9.0 | 145 | 0 | 0 | 1 | 0 | 5 |
| core/prefs.js | 9.0 | 171 | 0 | 0 | 0 | 0 | 1 |
| ui/weight-count.js | 8.9 | 123 | 0 | 0 | 0 | 0 | 2 |
| sections/stock-ops-res.js | 8.8 | 111 | 0 | 0 | 1 | 0 | 8 |
| sections/design-settings.js | 8.4 | 111 | 0 | 0 | 1 | 0 | 5 |
| ui/design-stickers.js | 8.3 | 136 | 0 | 0 | 1 | 0 | 7 |
| sections/movements.js | 8.2 | 115 | 0 | 0 | 1 | 2 | 7 |
| ui/avatars.js | 8.1 | 88 | 0 | 0 | 0 | 0 | 2 |
| sections/matching-queue.js | 7.9 | 109 | 0 | 0 | 0 | 0 | 6 |
| sections/salesorders-matching.js | 7.7 | 109 | 1 | 0 | 0 | 0 | 7 |
| sections/item-orders.js | 7.6 | 107 | 1 | 2 | 0 | 0 | 9 |
| ui/photos.js | 7.4 | 97 | 0 | 0 | 0 | 0 | 3 |
| sections/reservations.js | 7.1 | 81 | 1 | 0 | 0 | 0 | 7 |
| sections/request-fill.js | 7.0 | 114 | 0 | 0 | 0 | 0 | 4 |
| sections/design-order.js | 6.9 | 92 | 0 | 0 | 0 | 0 | 8 |
| ui/drag.js | 6.9 | 122 | 0 | 0 | 0 | 0 | 0 |
| ui/combo.js | 6.9 | 82 | 0 | 0 | 0 | 0 | 3 |
| sections/issue.js | 6.8 | 98 | 0 | 1 | 0 | 0 | 7 |
| sections/warehouse-mobile.js | 6.7 | 131 | 0 | 0 | 0 | 0 | 7 |
| ui/composition-suggest.js | 6.6 | 78 | 1 | 0 | 0 | 0 | 6 |
| ui/bell.js | 6.5 | 109 | 0 | 0 | 0 | 0 | 6 |
| sections/metal.js | 6.5 | 82 | 0 | 1 | 0 | 0 | 6 |
| core/xlsx-write.js | 6.4 | 59 | 0 | 0 | 0 | 0 | 0 |
| sections/order-issue.js | 6.3 | 101 | 0 | 0 | 0 | 0 | 7 |
| sections/stock-passport.js | 6.2 | 77 | 0 | 0 | 0 | 0 | 4 |
| sections/money-forecast.js | 6.0 | 57 | 0 | 0 | 0 | 0 | 4 |
| sections/bulk-edit.js | 6.0 | 79 | 1 | 0 | 1 | 0 | 6 |
| ui/rows-table.js | 5.9 | 88 | 0 | 0 | 0 | 0 | 4 |
| core/paste-parse.js | 5.7 | 83 | 0 | 0 | 0 | 0 | 0 |
| sections/history.js | 5.7 | 90 | 0 | 0 | 0 | 1 | 7 |
| sections/fill.js | 5.5 | 69 | 1 | 0 | 0 | 1 | 6 |
| ui/phrases.js | 5.4 | 70 | 0 | 0 | 0 | 0 | 3 |
| ui/cat-chips.js | 5.4 | 72 | 0 | 0 | 0 | 0 | 1 |
| core/update-check.js | 5.3 | 76 | 0 | 0 | 0 | 0 | 2 |
| sections/docs-queue.js | 5.2 | 64 | 0 | 0 | 0 | 1 | 9 |
| core/xlsx-read.js | 5.2 | 78 | 0 | 0 | 0 | 0 | 0 |
| ui/quick-order.js | 5.2 | 58 | 1 | 0 | 0 | 0 | 6 |
| ui/bulk.js | 5.1 | 50 | 0 | 0 | 0 | 0 | 5 |
| sections/order-design.js | 5.1 | 60 | 0 | 0 | 0 | 0 | 5 |
| sections/reservation-edit.js | 5.0 | 64 | 1 | 0 | 1 | 0 | 9 |
| sections/order-reservations.js | 5.0 | 54 | 1 | 0 | 1 | 0 | 8 |
| core/facets.js | 5.0 | 74 | 0 | 0 | 0 | 0 | 0 |
| ui/icons.js | 4.7 | 49 | 0 | 0 | 0 | 0 | 0 |
| core/router.js | 4.7 | 81 | 0 | 0 | 0 | 0 | 1 |
| ui/gallery.js | 4.7 | 60 | 0 | 0 | 0 | 0 | 2 |
| core/errors.js | 4.6 | 70 | 0 | 0 | 0 | 0 | 3 |
| ui/popup.js | 4.5 | 71 | 0 | 0 | 0 | 0 | 1 |
| ui/pop-menu.js | 4.3 | 82 | 0 | 0 | 0 | 0 | 2 |
| sections/profile.js | 4.1 | 68 | 0 | 0 | 0 | 0 | 4 |
| sections/search.js | 4.0 | 58 | 0 | 0 | 0 | 0 | 11 |
| ui/errors.js | 3.9 | 58 | 0 | 0 | 0 | 0 | 0 |
| ui/step-funnel.js | 3.9 | 50 | 0 | 0 | 0 | 0 | 3 |
| sections/ops.js | 3.9 | 59 | 0 | 1 | 0 | 0 | 5 |
| ui/resizer.js | 3.7 | 67 | 0 | 0 | 0 | 0 | 2 |
| ui/suggest.js | 3.7 | 52 | 0 | 0 | 0 | 0 | 3 |
| ui/tag-pick.js | 3.6 | 49 | 0 | 0 | 0 | 0 | 1 |
| core/bulk-match.js | 3.5 | 51 | 0 | 0 | 0 | 0 | 2 |
| ui/busy.js | 3.5 | 53 | 0 | 0 | 0 | 0 | 5 |
| ui/history.js | 3.5 | 39 | 0 | 0 | 0 | 0 | 2 |
| sections/trash.js | 3.4 | 56 | 0 | 0 | 0 | 0 | 11 |
| core/dom.js | 3.4 | 76 | 0 | 0 | 0 | 0 | 0 |
| ui/select.js | 3.2 | 40 | 0 | 0 | 0 | 0 | 2 |
| ui/toast.js | 3.2 | 45 | 0 | 0 | 0 | 0 | 4 |
| ui/notices.js | 3.1 | 48 | 0 | 0 | 0 | 0 | 0 |
| core/passport-kinds.js | 3.0 | 25 | 0 | 0 | 0 | 0 | 0 |
| ui/badges.js | 2.8 | 44 | 0 | 0 | 0 | 0 | 1 |
| ui/searchbox.js | 2.7 | 39 | 0 | 0 | 0 | 0 | 2 |
| core/nav-stack.js | 2.6 | 34 | 0 | 0 | 0 | 0 | 0 |
| core/stock-list.js | 2.5 | 42 | 0 | 0 | 0 | 0 | 1 |
| ui/notice-card.js | 2.5 | 42 | 0 | 0 | 0 | 0 | 2 |
| core/orders-lookup.js | 2.4 | 38 | 0 | 0 | 0 | 0 | 1 |
| ui/chat-window.js | 2.3 | 43 | 0 | 0 | 0 | 0 | 3 |
| sections/lookups.js | 2.3 | 36 | 0 | 0 | 0 | 0 | 4 |
| ui/quality.js | 2.2 | 30 | 0 | 0 | 0 | 0 | 1 |
| ui/dict-options.js | 2.2 | 27 | 0 | 0 | 0 | 0 | 1 |
| ui/list-export.js | 2.2 | 36 | 0 | 0 | 0 | 0 | 3 |
| ui/chat-button.js | 2.1 | 34 | 0 | 0 | 0 | 0 | 5 |
| ui/quick.js | 2.1 | 35 | 0 | 0 | 0 | 0 | 3 |
| core/passport-images.js | 2.1 | 39 | 0 | 0 | 0 | 0 | 0 |
| sections/ops-weight.js | 2.0 | 32 | 0 | 1 | 0 | 0 | 4 |
| ui/responsible.js | 1.9 | 31 | 0 | 0 | 0 | 0 | 3 |
| core/format.js | 1.9 | 54 | 0 | 0 | 0 | 0 | 0 |
| ui/dialog.js | 1.8 | 32 | 0 | 2 | 1 | 0 | 1 |
| sections/requests-tabs.js | 1.7 | 39 | 0 | 0 | 0 | 1 | 3 |
| core/order-color.js | 1.6 | 31 | 0 | 0 | 0 | 0 | 0 |
| ui/crumbs.js | 1.5 | 27 | 0 | 0 | 0 | 0 | 1 |
| ui/search-logic.js | 1.5 | 28 | 0 | 0 | 0 | 0 | 0 |
| ui/confirm-password.js | 1.5 | 25 | 0 | 1 | 0 | 0 | 3 |
| ui/op-row.js | 1.4 | 16 | 1 | 0 | 0 | 0 | 4 |
| ui/pager.js | 1.3 | 26 | 0 | 0 | 0 | 0 | 1 |
| ui/app-badge.js | 0.8 | 14 | 0 | 0 | 0 | 0 | 0 |
| ui/empty.js | 0.6 | 10 | 0 | 0 | 0 | 0 | 1 |
| ui/links.js | 0.5 | 7 | 0 | 0 | 0 | 0 | 1 |

## 2. Одна подпись — в нескольких файлах (кандидаты в дубли или в «одни слова»)

| Подпись (label / кнопка) | Где |
|--|--|
| Примечание | sections/design.js, sections/movements.js, sections/orders.js, sections/partners.js, sections/products.js, sections/requests.js, sections/salesorders.js, sections/stock.js, sections/supplier-catalog.js |
| Ед. изм. | sections/orders.js, sections/products.js, sections/request-step.js, sections/requests.js, sections/stock.js, sections/supplier-catalog.js |
| Отмена | sections/contracts.js, sections/design-settings.js, sections/invoice.js, sections/order-shipments.js, ui/design-board.js, ui/design-notes.js |
| Поставщик | sections/contracts.js, sections/partners.js, sections/passports.js, sections/request-step.js, sections/requests.js, sections/supplier-catalog.js |
| Заказчик | sections/orders.js, sections/partners.js, sections/passports.js, sections/requests.js, sections/salesorders.js |
| Наименование | sections/orders.js, sections/passports.js, sections/products.js, sections/requests.js, sections/stock.js |
| Показать | sections/design.js, sections/partners.js, sections/passports.js, ui/design-notes.js, ui/list.js |
| Статус | sections/design.js, sections/orders.js, sections/passports.js, sections/products.js, sections/requests.js |
| Дата | sections/contracts.js, sections/movements.js, sections/passports.js, sections/requests.js |
| Изменить | sections/design-settings.js, sections/dicts.js, ui/card.js, ui/funnel.js |
| Категория | sections/passports.js, sections/requests.js, sections/stock.js, sections/supplier-catalog.js |
| Количество | sections/orders.js, sections/request-step.js, sections/requests.js, ui/weight-count.js |
| Наша компания | sections/orders.js, sections/partners.js, sections/requests.js, sections/salesorders.js |
| Оплачено | sections/help-flow-data.js, sections/invoice.js, sections/orders.js, ui/badges.js |
| По дату | sections/history.js, sections/movements.js, sections/orders.js, sections/requests.js |
| С даты | sections/history.js, sections/movements.js, sections/orders.js, sections/requests.js |
| Состояние | sections/contracts.js, sections/products.js, sections/salesorders.js, sections/stock.js |
| Сумма | sections/orders.js, sections/partners.js, sections/requests.js, sections/salesorders.js |
| Артикул | sections/docs.js, sections/products.js, sections/requests.js |
| Выдать | sections/help-flow-data.js, sections/stock.js, sections/warehouse-mobile.js |
| Выпустить паспорт | sections/docs.js, sections/orders.js, sections/products.js |
| Заказать | sections/stock.js, ui/badges.js, ui/quick-order.js |
| Закрыт | sections/contracts.js, sections/help-flow-data.js, sections/salesorders.js |
| Закрыть | sections/dicts.js, ui/bulk.js, ui/card.js |
| изменить | sections/order-reservations.js, sections/reservations.js, sections/stock-ops-res.js |
| Кол-во | sections/movements.js, sections/orders.js, sections/requests.js |
| Контрагенты | sections/dicts.js, sections/help-flow-data.js, sections/history.js |
| Кто | sections/history.js, sections/movements.js, sections/partners.js |
| Объединить с… | sections/dicts.js, sections/partners.js, sections/passport-tree.js |
| Повторить | sections/contracts.js, sections/invoices-tab.js, ui/busy.js |
| Принять | sections/item-orders.js, sections/stock.js, sections/warehouse-mobile.js |
| Приоритет | sections/design.js, sections/requests.js, sections/salesorders.js |
| Скачать шаблон | sections/invoice.js, ui/bulk.js, ui/spec-import.js |
| Удалить | sections/dicts.js, ui/card.js, ui/design-notes.js |
| Цвет | sections/orders.js, sections/requests.js, sections/supplier-catalog.js |
| + | ui/gallery.js, ui/list.js |
| + Строка | ui/materials-spec.js, ui/rows-table.js |
| В норме | sections/stock.js, ui/badges.js |
| В работе | sections/salesorders.js, ui/badges.js |
| Взять в работу | sections/design-order.js, ui/design-board.js |
| Все | sections/design.js, sections/salesorders.js |
| выберите файл | sections/partners.js, ui/photos.js |
| Выбрать все | sections/kp.js, ui/board.js |
| Готово к отгрузке | sections/help-flow-data.js, sections/salesorders.js |
| Группа | sections/docs.js, sections/supplier-catalog.js |
| Дата отгрузки | sections/orders.js, sections/salesorders.js |
| Дата счёта | sections/request-step.js, sections/requests.js |
| Длинное название | sections/products.js, sections/stock.js |
| Добавить | sections/salesorders.js, ui/quick.js |
| Ед. | sections/stock.js, sections/supplier-catalog.js |
| Заказ | sections/orders.js, sections/requests.js |
| Изделие | sections/design.js, sections/docs.js |
| Компания | sections/orders.js, sections/salesorders.js |
| Короткое название | sections/products.js, sections/stock.js |
| На распределение | sections/design-order.js, ui/design-board.js |
| На распределение все позиции | sections/design-order.js, ui/design-board.js |
| Название | sections/design.js, sections/partners.js |
| Остаток | sections/stock.js, sections/supplier-catalog.js |
| Ответить | sections/home.js, ui/design-notes.js |
| Отгрузить | sections/order-shipments.js, sections/salesorders.js |
| Открыть | sections/history.js, ui/design-board.js |
| Отменён | sections/salesorders.js, ui/badges.js |
| Отменить | sections/movements.js, ui/toast.js |
| Отправить | sections/chat.js, ui/design-notes.js |
| Пересчёт | sections/stock.js, sections/warehouse-mobile.js |
| Показать все | sections/home.js, ui/list.js |
| Показать ещё | sections/matching-queue.js, sections/salesorders-unassigned.js |
| Получено | sections/help-flow-data.js, ui/badges.js |
| Привязать к изделию | sections/docs.js, sections/passports.js |
| Скрыть | sections/money-forecast.js, sections/money.js |
| Сопоставить | sections/matching-queue.js, sections/salesorders-unassigned.js |
| Срок | sections/design.js, sections/salesorders.js |
| Счёт | sections/help-flow-data.js, sections/requests.js |
| Убрать из проектирования | sections/design-order.js, ui/design-board.js |
| Форма оплаты | sections/orders.js, sections/salesorders.js |
| Фото | sections/requests.js, sections/stock.js |
| Цена, ₽ | sections/products.js, sections/supplier-catalog.js |
| Черновик | sections/products.js, ui/badges.js |
| Ширина панели фильтров | ui/facet-filter.js, ui/list.js |
| № договора | sections/contracts.js, sections/salesorders.js |
| № счёта | sections/request-step.js, sections/requests.js |

## 3. Один запрос к API — из нескольких файлов (кандидаты в общий модуль или в лишнюю загрузку)

| Путь | Файлов | Где |
|--|--|--|
| /stock/items | 9 | sections/invoice.js, sections/item-orders.js, sections/metal.js, sections/stock-ops-res.js, sections/stock-ops.js, sections/stock.js, sections/supplier-catalog.js, sections/warehouse-mobile.js, core/stock-list.js |
| /supply/requests | 9 | sections/home.js, sections/invoice.js, sections/item-orders.js, sections/ops.js, sections/request-step.js, sections/requests.js, sections/stock-ops.js, sections/warehouse-mobile.js, ui/quick-order.js |
| /partners | 7 | sections/contracts.js, sections/lookups.js, sections/partners.js, sections/request-fill.js, sections/request-step.js, sections/requests.js, sections/supplier-catalog.js |
| /salesorders | 7 | sections/home.js, sections/order-shipments.js, sections/orders.js, sections/salesorders.js, ui/spec-import.js, ui/target-picker.js, core/orders-lookup.js |
| /design-tasks | 6 | sections/design-order.js, sections/design.js, sections/order-design.js, ui/design-board.js, ui/design-notes.js, ui/design-stickers.js |
| /stock/batch | 6 | sections/metal.js, sections/movements.js, sections/order-issue.js, sections/reservations.js, sections/stock-ops-res.js, sections/stock-ops.js |
| /showcase | 5 | sections/composition.js, sections/docs.js, sections/orders.js, sections/products.js, sections/salesorders-matching.js |
| /stock/reservations | 5 | sections/order-reservations.js, sections/reservation-edit.js, sections/reservations.js, sections/stock-ops-res.js, sections/stock-ops.js |
| /dicts/persons | 4 | sections/design.js, sections/issue.js, sections/products.js, ui/dict-options.js |
| /passports | 4 | sections/docs-orders.js, sections/passports.js, sections/products.js, sections/salesorders.js |
| /dicts | 3 | sections/dicts.js, ui/dict-options.js, ui/materials-spec.js |
| /dicts/passportCategories | 3 | sections/dicts.js, sections/docs.js, sections/products.js |
| /incomes | 3 | sections/orders.js, sections/salesorders.js, core/orders-lookup.js |
| /materials | 3 | sections/request-fill.js, sections/request-step.js, sections/stock-passport.js |
| /photos/upload | 3 | sections/profile.js, ui/design-board.js, ui/photos.js |
| /supply/invoices | 3 | sections/contracts.js, sections/invoices-tab.js, sections/request-step.js |
| /audit-logs/record | 2 | sections/history.js, ui/card.js |
| /auth/me | 2 | sections/profile.js, main.js |
| /design-stickers | 2 | sections/design-settings.js, ui/design-stickers.js |
| /incomes/lookups | 2 | sections/orders.js, sections/request-step.js |
| /matching/bulk | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /matching/confirm | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /matching/none | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /messages/threads | 2 | sections/chat.js, ui/chat-button.js |
| /passports/queue | 2 | sections/docs-queue.js, sections/home.js |
| /photos | 2 | ui/avatars.js, ui/target-picker.js |
| /production-orders | 2 | sections/salesorders-unassigned.js, sections/salesorders.js |
| /showcase/from-passports | 2 | sections/kp.js, sections/passports.js |
| /staff | 2 | sections/staff.js, ui/responsible.js |
| /stock/movements | 2 | sections/movements.js, sections/warehouse-mobile.js |
| /stock/reservations/group | 2 | sections/reservations.js, sections/stock-ops.js |
| /stock/reservations/issue | 2 | sections/issue.js, sections/stock-ops-res.js |
| /stock/reservations/order | 2 | sections/order-issue.js, sections/order-reservations.js |
| /supply/catalog/items | 2 | sections/request-fill.js, sections/supplier-catalog.js |

## 4. По файлам: кнопки, подписи, подсказки, запросы

### sections/chat.js

- **Кнопки:** Отправить · 😊
- **Заголовки/подсказки:** Добавить фото (можно вставить Ctrl+V или перетащить) · Смайлики · Убрать фото · Открыть фото · Чат
- **API:** `/messages/threads` `/messages/users` `/messages`

### sections/composition.js

- **Заголовки/подсказки:** Убрать из состава · Состав изделия
- **API:** `/showcase`

### sections/contracts.js

- **Кнопки:** Сохранить договор · Отмена · + Договор · Повторить
- **Подписи:** Без договора · + Создать договор · Поставщик · № договора · Дата договора · Предмет · Действует до · Состояние · Действует · Закрыт · Скан договора · Дата · Счетов
- **Заголовки/подсказки:** Удалить договор · Договор · Договоры
- **API:** `/supply/contracts` `/supply/invoices` `/partners`

### sections/design-order.js

- **Кнопки:** Взять в работу · На распределение
- **Подписи:** На распределение все позиции · Убрать из проектирования
- **Заголовки/подсказки:** Открыть изделие справа · Проектирование
- **API:** `/design-tasks`

### sections/design-settings.js

- **Кнопки:** Отмена · Изменить · + Стикер
- **Заголовки/подсказки:** Убрать состояние · Показывать на карточках доски · Выше · Ниже · Настройки доски
- **API:** `/design-stickers`

### sections/design.js

- **Кнопки:** Уточнить у менеджера · Показать
- **Подписи:** Статус · Открытые · Все · Вопросы · Есть вопрос без ответа · Все исполнители · Все заказы · Код · Изделие · Срок · Приоритет · Исполнитель · Название · Причина (пауза / отмена) · Примечание
- **Заголовки/подсказки:** Проектирование
- **API:** `/dicts/persons` `/design-tasks`

### sections/dicts.js

- **Кнопки:** + Добавить · Найти в данных… · Изменить · Удалить · Закрыть · Добавить отмеченные
- **Подписи:** Поиск значения · Контрагенты · Объединить с…
- **Заголовки/подсказки:** Значения, которые уже встречаются в заявках, на складе и в Google-таблице, но ещё не в справочнике · Это значение нужно программе — удалить нельзя · Объединить « · Открыть картинку · Справочники
- **API:** `/dicts` `/dicts/passportCategories` `/dicts/productGroups`

### sections/docs-orders.js

- **Кнопки:** PDF и печать… · ← Назад · Дальше →
- **Подписи:** Готов · Не готов · Доработать
- **Заголовки/подсказки:** Статус паспорта
- **API:** `/passports` `/passports/by-order`

### sections/docs-queue.js

- **Заголовки/подсказки:** До отгрузки не больше 3 дней или срок прошёл
- **API:** `/passports/queue`

### sections/docs.js

- **Подписи:** Артикул · Изделие · Группа · Шаблон · Выпущено · Выпустить паспорт · Открыть изделие · Дописать и выпустить · Привязать к изделию
- **Заголовки/подсказки:** Паспорта · Категория определится по разделу и группе; тексты выбираются при выпуске · Черновик ещё без номера — откроется форма паспорта · Перенесён из прежней таблицы паспортов · Архив паспортов
- **API:** `/showcase` `/dicts/passportCategories`

### sections/fill.js

- **API:** `/fill-audit`

### sections/help-flow-data.js

- **Подписи:** Заказ принят · Позиции и срок · Распределить · Проектируем · Чертежи готовы · Нужен материал · Заказали · Счёт · Оплачено · Получено · Принять на склад · Бронь под заказ · Выдать · В производстве · Готово к отгрузке · Отгрузили · Закрыт · Нужен паспорт · Паспорт выпущен · Счёт к оплате · Поступление · Календарь и сводка · Продукция · Каталог поставщиков · Договоры поставщиков · Контрагенты · Сотрудники и зоны · Чат · Сегодня и уведомления · в проектирование · нужен материал · принять · в производство · нет паспорта · к отгрузке · к оплате · оплата покупателя

### sections/help.js

- **Кнопки:** 🔍 Крупнее
- **Заголовки/подсказки:** Меню: · Работа с сайтом

### sections/history.js

- **Подписи:** Заявки · Склад · Движения · Заказы · Позиции заказов · Контрагенты · Справочники · Раздел · Кто · С даты · По дату · Открыть · Когда · Что · Запись
- **Заголовки/подсказки:** История · Открыть саму запись
- **API:** `/audit-logs/record` `/audit-logs/app` `/audit-logs/app/users`

### sections/home.js

- **Кнопки:** На завтра · Показать все · Ответить
- **Заголовки/подсказки:** Вопросы ждут ответа — показать · Перенести дату поставки: · Спрятать карточку до завтра
- **API:** `/design-notes/open-questions` `/supply/requests` `/salesorders` `/today` `/passports/queue`

### sections/invoice.js

- **Кнопки:** Создать позицию · Отмена · Разобрать и найти в базе · Скачать шаблон · + Строка счёта
- **Подписи:** Заказано — ждём · Оплачено · Получено — на склад
- **Заголовки/подсказки:** Нужной позиции нет в списке — создать её в базе · Убрать позицию · Это та же позиция — взять её · Файл Excel (.xlsx) или CSV — первый лист · Пустая таблица с нужными колонками — заполнить в Excel и загрузить · Заявки из таблицы · Счёт
- **API:** `/stock/items` `/supply/requests`

### sections/invoices-tab.js

- **Кнопки:** Повторить · ‹ Назад · Далее › · Свернуть ▴
- **API:** `/supply/invoices`

### sections/issue.js

- **API:** `/dicts/persons` `/stock/reservations/issue`

### sections/item-orders.js

- **Кнопки:** Принять
- **Заголовки/подсказки:** Уже заказано
- **API:** `/stock/items` `/supply/requests`

### sections/kp.js

- **Кнопки:** ⇩ Скачать шаблон Excel · Выбрать все · Снять все · Объединить · Это разные изделия
- **Заголовки/подсказки:** Убрать · Пустая таблица с нужными колонками и примером · Каждый вариант станет отдельным изделием · Изделия из паспортов · Коммерческое предложение · Изделия из заказов · Загрузка каталога
- **API:** `/showcase/kp` `/showcase/import` `/showcase/from-orders` `/showcase/from-passports`

### sections/lookups.js

- **API:** `/supply/lookups` `/partners`

### sections/matching-queue.js

- **Кнопки:** Сопоставить · Несопоставленные · Показать ещё · Выбрать…
- **Заголовки/подсказки:** Сопоставить позиции договора с изделиями · Заказ уже в производстве
- **API:** `/matching/unmatched/count` `/matching/confirm` `/matching/none` `/matching/unmatched` `/matching/bulk`

### sections/metal.js

- **Подписи:** Сортамент / сечение · Марка стали · Толщина, мм · Длина, м · Ширина, м
- **API:** `/stock/items` `/stock/batch`

### sections/money-forecast.js

- **Кнопки:** Скрыть

### sections/money.js

- **Кнопки:** ⚙ Старт учёта · Убрать старт учёта · Скрыть · К текущему месяцу
- **Заголовки/подсказки:** Остаток денег на начало месяца (запоминается в этом браузере) · Следующий месяц · Дата, с которой ведётся учёт, и остаток на счетах наших компаний · Назад · Итог за выбранный период · Доходы не внесены — у позиций заказов нет суммы · Открыть список и заполнить · Результат того же месяца прошлого года
- **API:** `/finance/settings` `/finance/forecast` `/finance/summary` `/finance/cashflow`

### sections/movements.js

- **Подписи:** Операция · Приход · Списание · Корректировка · С даты · По дату · Позиция · Отменить · Дата · Кол-во · Кому / под что · Примечание · Кто · Отменить это движение · Отменить всю операцию · Открыть позицию
- **Заголовки/подсказки:** Движения · Провести обратное движение · Открыть позицию склада
- **API:** `/stock/movements` `/stock/batch`

### sections/ops.js

- **Кнопки:** Принять…
- **Заголовки/подсказки:** Приёмка:
- **API:** `/supply/requests`

### sections/order-design.js

- **Кнопки:** Передать выбранные
- **Заголовки/подсказки:** Открыть задачу проектирования · Доска проектирования с этим заказом
- **API:** `/design-tasks` `/design-tasks/from-order`

### sections/order-issue.js

- **API:** `/stock/reservations/order` `/stock/reservations/issue-order` `/stock/batch`

### sections/order-reservations.js

- **Кнопки:** Выдать по заказу… · изменить
- **Заголовки/подсказки:** Осталось в брони
- **API:** `/stock/reservations/order` `/stock/reservations`

### sections/order-shipments.js

- **Кнопки:** Накладная · Отгрузить · Отмена
- **Заголовки/подсказки:** Отгрузок пока нет · Событий нет · Отгружать нечего · Отгрузка
- **API:** `/salesorders` `/shipments`

### sections/orders.js

- **Кнопки:** + Платёж
- **Подписи:** Не отгружено · Ждём оплату · Частично оплачено · Без суммы · Оплачено · Отгружено · Статус · Все компании · С даты · По дату · Заказ · Заказчик · Наименование · Кол-во · Сумма · Отгрузка · Оплата · Компания · Вписать сумму · Принять платёж · Отменить оплату · Отгружено сегодня · Выпустить паспорт · № договора (если без карточки заказа) · Изделие из «Продукции» · Количество · Ед. изм. · Цена за ед., ₽ · Доход вручную, ₽ · Наша компания · Форма оплаты · Дата отгрузки · Дата оплаты · Вид · Цвет · Размер · Примечание
- **Заголовки/подсказки:** Выбрать изделие · Сумма: · Платёж: · Удалить платёж · Позиции и оплаты · Вписать цену или сумму · Принять платёж: сумма по умолчанию — весь долг · Цена за единицу или сумма строки · Цена или сумма строки · Отгрузили сегодня · Сумма, оплачено и долг по всем позициям списка — с учётом вкладки, поиска и фильтров, по всем страницам · Связать позицию с изделием из «Продукции» — для паспорта и единого названия
- **API:** `/showcase` `/incomes/lookups` `/incomes` `/salesorders`

### sections/partners.js

- **Кнопки:** Показать · выберите файл · ⇩ Скачать шаблон
- **Подписи:** Кто · Поставщики · Заказчики · Наши компании · Название · ИНН · Записей · Сумма · Последняя · Контакты · Объединить с… · Новая заявка этому поставщику · Загрузить прайс из Excel · Кто это · Поставщик · Заказчик · Наша компания · Полное наименование (в документах) · КПП · Адрес · Телефон · Почта · Сайт · Контактное лицо · Телефон контакта · Банк · БИК · Расчётный счёт · Корр. счёт · Примечание · Директор (Фамилия И. О. — в подписи талона) · Торговая марка (на титуле паспорта)
- **Заголовки/подсказки:** Объединить « · Так выглядит на талоне; клетка — прозрачные места · Перетащите файл, вставьте Ctrl+V или нажмите · Загрузить прайс от « · Контрагенты
- **API:** `/partners` `/organizations` `/supply/suppliers`

### sections/passport-texts.js

- **Кнопки:** + Пункт · Убрать пункт
- **Подписи:** Заменить для категории · Изменить для всех категорий
- **Заголовки/подсказки:** Собранный текст категории — как в паспорте (переменные — метками «не заполнено») · Разделы и тексты
- **API:** `/passports/texts` `/passports/texts/preview`

### sections/passport-tree.js

- **Кнопки:** + Вариант · Объединить с… · Убрать · + Подвариант
- **Подписи:** К каким категориям подходит текст
- **Заголовки/подсказки:** Тексты паспорта

### sections/passports.js

- **Подписи:** Статус · Черновики · Выпущенные · Аннулированные · Показать · Неполные · Без картинок · Категория · Год · Месяц · Поставщик · Заказчик · Дата · Наименование · Заказчик / объект · Талон · Заполнено · Выпустить · Новая редакция · Аннулировать… · Изменить номер… · Выбрать категорию · Привязать к изделию · Создать изделие из паспорта · Создать копию
- **Заголовки/подсказки:** Паспорта · Текст изменён вручную, не из справочника · Все паспорта по текущим фильтрам — PDF в одном архиве (до 200) · Не хватает: · Присвоить номер и талон; текст будет заморожен · Изменить выпущенный паспорт: номер тот же, редакция +1, прежняя — в истории · Номер останется занятым и повторно не выдаётся · Без категории PDF упрощённый — с категорией текст соберётся по справочникам · Изделие в «Продукции» с данными этого паспорта; паспорта той же модели привяжутся к нему · Новый паспорт на ту же модель: новые номера, дата — сегодня
- **API:** `/passports` `/passports/bulk` `/passports/bulk/restore` `/showcase/from-passports`

### sections/payroll.js

- **Кнопки:** + Выплата
- **Заголовки/подсказки:** Следующий месяц · Предыдущий месяц · Нужна для календаря: чья это зарплата · Удалить выплату
- **API:** `/payroll/payments` `/payroll/timesheet` `/payroll/people` `/payroll/summary`

### sections/products.js

- **Кнопки:** Все изделия · Весь раздел → · Все изделия списком
- **Подписи:** Взять из состава · Тип оборудования · Группа изделий · Наименование серии · Статус · Черновик · В продаже · Архив · Цена, ₽ — одна для всех · Кто проектировал · Ед. изм. · RAL · Цвета (варианты) · Размеры (варианты) · Паспорт по умолчанию: категория · Паспорт по умолчанию: срок службы, лет · Паспорт по умолчанию: гарантия, мес. · Серия · Тип · Группа · Состояние · Черновики (нет цены) · В КП · Артикул · Наименование · Цена · Изменить состав · Печать паспорта · Выпустить паспорт · Присвоить артикул группы · Клонировать · В коммерческое предложение · Заказы с этим изделием · Короткое название · Длинное название · Название в договоре · Описание · Примечание · Длина · Ширина · Высота · Ед. габаритов · Вес, кг · Цена, ₽ · Себестоимость материалов · Материалы изделия · Назначение · Монтаж · Категория паспорта · Тексты паспорта — выбор (монтаж, назначение…)
- **Заголовки/подсказки:** Строки по материалам «Состава изделия»: труба 89×3 → Труба стальная ∅89×3 · Проверено — убрать пометку · Продукция · Нет цены — изделие в черновиках · Тип · Группа изделий · Загрузка и импорт: каталог, из заказов, из паспортов · Собранное коммерческое предложение · Добавить в коммерческое предложение · Скопировать фото из паспорта в карточку изделия — станет «своим» · Последний выпущенный паспорт этого изделия: PDF и печать · Новый артикул по номеру группы изделия (например 34 → 3411) · Копия со всеми полями, фото и настройками паспорта — потом поправьте название, размеры и артикул · Варианты
- **API:** `/showcase/form-values` `/passports/phrases` `/showcase` `/dicts/persons` `/dicts/passportCategories` `/showcase/groups` `/showcase/bulk` `/showcase/bulk/restore` `/passports`

### sections/profile.js

- **Кнопки:** Загрузить своё фото
- **Заголовки/подсказки:** Мой профиль
- **API:** `/auth/me` `/photos/upload`

### sections/request-fill.js

- **API:** `/partners` `/materials` `/supply/catalog/items`

### sections/request-step.js

- **Подписи:** Поставщик · Количество · Единица измерения · № счёта · Дата счёта · Сумма счёта · Ед. изм. · Сумма счёта, ₽ · Кто платит (наша компания)
- **Заголовки/подсказки:** Подставить поставщика · Следующий шаг · Заказал у поставщика
- **API:** `/incomes/lookups` `/materials` `/partners` `/supply/requests` `/supply/invoices`

### sections/requests.js

- **Кнопки:** + Из таблицы · Счёт без заявок
- **Подписи:** Наименование · Артикул · Количество · Ед. изм. · Приоритет · Категория · Цвет · Ссылка на товар · Доставка · Фото · Примечание · Статус · Поставщик · Сумма с НДС, ₽ · Наша компания · Тип счёта · № счёта · Дата счёта · Куда (направление затрат) · Объект СМР / уточнение · Под заказ (позиция) · Заказчик · Кто подал · Дата заявки · С даты · По дату · По заказу · Дата · Кол-во · Счёт · Заказ · Сумма · Заказал у поставщика · Оприходовать на склад · Сменить статус…
- **Заголовки/подсказки:** Принять: · Сменить статус · Заявки · Скопировать строки из Excel / корзины сайта — заявки на все позиции сразу · Счёт, которого не было в заявках: внести уже оплаченный или полученный счёт со всеми позициями · Сумма всех заявок в списке — с учётом вкладки, поиска и фильтров, по всем страницам · Оприходовать на склад · Статус → « · Текущая цена в каталоге поставщика — заявка не меняется
- **API:** `/partners` `/supply/requests`

### sections/reservation-edit.js

- **Заголовки/подсказки:** Бронь
- **API:** `/stock/reservations`

### sections/reservations.js

- **Кнопки:** изменить · выдать
- **Заголовки/подсказки:** Заказ закрыт или отгружен, а материал всё ещё в брони
- **API:** `/stock/batch` `/stock/reservations/group` `/stock/reservations`

### sections/salesorders-matching.js

- **Кнопки:** Подтвердить
- **Подписи:** Подтверждено · Не изделие · Сопоставлено раньше · Подобрано, ждёт подтверждения · Не сопоставлено
- **Заголовки/подсказки:** Сопоставление
- **API:** `/showcase` `/matching/confirm` `/matching/none` `/matching/suggest` `/matching/bulk`

### sections/salesorders-unassigned.js

- **Кнопки:** Показать ещё · Сопоставить · Перейти к сопоставлению · Договоры без заказа
- **Подписи:** №
- **Заголовки/подсказки:** Сопоставить позиции договора с изделиями
- **API:** `/production-orders/unassigned` `/production-orders/assign` `/production-orders`

### sections/salesorders.js

- **Кнопки:** Отметить: готов к отгрузке · Добавить · Изменить договор · Отгрузить · Спецификация · + Заявка под этот заказ · + Заказ
- **Подписи:** Проектирование · Производство · Готово к отгрузке · Частично отгружен · Отгружена · Закрыт · Отменён · Состояние · Новые · В работе · Выполненные · Все · № заказа · Договоры · Заказчик · Компания · Поз. · Срок · Сумма · Приоритет · Этап · + Добавить договор · + Договор в этот заказ · Отменить договор · Связать с каталогом · + Позиция · № договора · Предмет заказа · Наша компания · Форма оплаты · Срок изготовления · Дата отгрузки · Окончание поставки · № госконтракта · Дата контракта · Примечание · Заказ (выполнен или удалён)
- **Заголовки/подсказки:** Связать с каталогом · Выдано минус возвращено · Изменить договор: № договора, заказчик, этап, срок, примечание · Файл Excel → брони под позиции этого договора · Удалить договор в корзину (нужен ваш пароль) · Открыть позицию: фото, сумма, отгрузка, оплата (назад — к заказу) · Открыть фото · Сопоставить позиции договора с изделиями · Новая заявка: заказ и заказчик подставятся сами · Все проверки пройдены — можно отметить «Готово к отгрузке» · У договоров заказа разные этапы — показан самый отстающий · Заказы · Новый заказ (договор): № заказа можно взять существующий — договоры объединятся в один заказ · Выбрать договоры без заказа и добавить их в этот заказ · Новый договор с этим № заказа · Договор · Связать позиции заказчика с нашими изделиями — для паспорта и производства. Договор не меняется.
- **API:** `/salesorders` `/salesorders/next-production-no` `/production-orders` `/incomes` `/passports`

### sections/staff.js

- **Кнопки:** Назначить:
- **Заголовки/подсказки:** Сотрудник · Зона
- **API:** `/staff` `/staff/from-login` `/zones` `/staff/logins`

### sections/stock-ops-res.js

- **Кнопки:** изменить
- **API:** `/stock/reservations` `/stock/items` `/stock/reservations/issue` `/stock/batch`

### sections/stock-ops.js

- **Кнопки:** + Принять без счёта
- **Заголовки/подсказки:** Принять на склад · Выдать со склада · Забронировать · Списать · Выдать из брони · Снять бронь · Пересчитать · Убрать из списка · Берёт все позиции, которые сейчас видны в списке с учётом поиска и фильтров · Склад
- **API:** `/stock/reservations` `/stock/items` `/dicts/writeOffReasons` `/stock/reserve-list` `/stock/reservations/group` `/supply/requests` `/stock/batch`

### sections/stock-passport.js

- **API:** `/materials` `/dicts/passportMaterials`

### sections/stock.js

- **Кнопки:** Принять · Выдать · Забронировать
- **Подписи:** Состояние · Требуют внимания · Ниже минимума · Нет на складе · Ждут поставку · В брони · В норме · Категория · Заказать · Принять · + Приход · − Выдать · Из брони · Наименование · Остаток · Ед. · Свободно · Мин. · Пересчёт · Выдать из брони · Списать (брак, потеря) · Забронировать под заказ · Снять бронь · Пересчитать (сколько лежит) · Отложить обрезок… · Заказать (новая заявка) · Короткое название · Длинное название · Название в счёте · Артикул (поставщика) · Ед. изм. · Сколько лежит · Вес 1 шт., г · Фото · Примечание · Минимальный остаток
- **Заголовки/подсказки:** Журнал движений позиции — там можно отменить ошибочное · Журнал всех приходов, списаний и корректировок · Склад · Создать заявку на эту позицию · Приехала поставка: принять на склад и закрыть заявку · Поступление на склад · Выдача / расход: кому и под что — в правой панели · Выдать забронированное: количество и объект — из брони · Категории · Открытые заявки на позицию · Отложено под заказы — «Из брони» в строке · Количество и объект — из брони · Кому и под что выдано — в правой панели · Причина из списка
- **API:** `/stock/items` `/stock/categories`

### sections/supplier-catalog.js

- **Кнопки:** Сбросить · Все списком · ← Все категории · Связать
- **Подписи:** Категория · Подкатегория · Поставщик · Без категории · Скачать шаблон Excel · Загрузить Excel… · Выгрузить в Excel · Артикул поставщика · Название у поставщика · Наш материал · Ед. · Цена, ₽ · Дата цены · Остаток · Цвет · Ед. изм. · Группа · Примечание
- **Заголовки/подсказки:** Категория · Шаблон, загрузка и выгрузка Excel · Загрузить прайс из Excel · Каталог поставщиков · Не связана с позицией склада · Цене больше 6 месяцев
- **API:** `/supply/catalog/counts` `/partners` `/supply/catalog/items` `/supply/catalog/import` `/stock/items`

### sections/warehouse-mobile.js

- **Подписи:** Принять · Выдать · Списать · Пересчёт
- **API:** `/supply/requests` `/stock/items` `/stock/movements`

### ui/avatars.js

- **Подписи:** Сатурн · Уран · Луна · Солнце · Земля · Марс · Юпитер · Нептун · Комета · Галактика
- **API:** `/photos`

### ui/badges.js

- **Подписи:** Ожидает · Заказать · В работе · Оплачено · Получено · Отменено · Черновик · Выставлен · Оплачен · Отменён · В норме · К закупке · Нет · Срочно · Обычный · Низко · На распределении · Завершены · Приостановлены · Отменены · Высокий · Низкий

### ui/bell.js

- **Кнопки:** Прочитать все · Очистить
- **API:** `/notifications/unread` `/notifications` `/notifications/read-all`

### ui/board.js

- **Кнопки:** Выбрать все
- **Заголовки/подсказки:** Отметить все карточки колонки · Выбрать

### ui/bulk.js

- **Кнопки:** Разобрать и найти · Скачать шаблон · Закрыть · ⇩ · пропустить
- **Заголовки/подсказки:** Файл Excel (.xlsx) или CSV — первый лист · Пустая таблица с нужными колонками — заполнить в Excel и загрузить · Много позиций сразу: вставить строки из таблицы · Это та же позиция — взять

### ui/busy.js

- **Кнопки:** Повторить
- **Подписи:** Повторить

### ui/card.js

- **Кнопки:** Убрать фото · Изменить · Дублировать · Удалить · Закрыть
- **Подписи:** Ширина правой панели
- **Заголовки/подсказки:** Убрать это фото из карточки · Закрыть · Ещё · Открыть корзину: там запись можно вернуть · Открыть правку с прежними значениями этих полей — проверьте и сохраните
- **API:** `/audit-logs/record`

### ui/chat-button.js

- **Заголовки/подсказки:** Сообщения
- **API:** `/messages/threads`

### ui/chat-window.js

- **Подписи:** Ширина чата
- **Заголовки/подсказки:** Закрыть (Esc)

### ui/composition-suggest.js

- **Подписи:** Посмотреть · Не сейчас
- **Заголовки/подсказки:** Состав изделия по тому, что выдали со склада под эту позицию · Состав
- **API:** `/stock/composition-suggest` `/stock/composition-suggest/accept`

### ui/design-board.js

- **Кнопки:** Отмена · + Добавить заказ · Добавить и на распределение · Только добавить
- **Подписи:** Изменить срок и приоритет… · Задать вопрос менеджеру… · Добавить фото… · Открыть заказ · Открыть в «Заказах» · Копировать ссылку · Перенести в… · Удалить в корзину · Взять в работу · На распределение · Открыть · На распределение все позиции · Убрать из проектирования
- **Заголовки/подсказки:** Кто проектирует? · Какие стикеры показывать на карточках · Срок и приоритет · Вопрос менеджеру · Изделия, которые ещё не взяты в проектирование · Открыть заказ справа · Заказы, где всё спроектировано или задачи не поставлены
- **API:** `/design-board` `/design-tasks` `/photos/upload`

### ui/design-notes.js

- **Кнопки:** Отправить · Отмена · Удалить · Ответить · Показать
- **Заголовки/подсказки:** Ещё · Открыть фото · Без ответа:
- **API:** `/design-notes` `/design-tasks`

### ui/design-stickers.js

- **Заголовки/подсказки:** Открыть фото · Убрать фото
- **API:** `/design-stickers` `/design-tasks`

### ui/dict-options.js

- **API:** `/dicts` `/dicts/persons`

### ui/facet-filter.js

- **Кнопки:** Сбросить признаки · Готово
- **Подписи:** Ширина панели фильтров
- **Заголовки/подсказки:** Убрать:

### ui/form.js

- **Кнопки:** × вручную
- **Заголовки/подсказки:** Не из базы — ввести вручную

### ui/funnel.js

- **Кнопки:** Развернуть · Изменить
- **Заголовки/подсказки:** Откроется в новой вкладке — паспорт здесь останется как есть
- **API:** `/passports/funnel`

### ui/gallery.js

- **Кнопки:** + · + Фото
- **Заголовки/подсказки:** Открыть крупно

### ui/list.js

- **Кнопки:** Выбрать · + · Фильтры · Показать · Показать все · Сбросить всё
- **Подписи:** Ширина панели фильтров
- **Заголовки/подсказки:** Скачать весь список с текущими фильтрами в Excel · Отметить несколько строк и изменить их разом (на ПК — Ctrl+клик, на телефоне — долгое нажатие) · Клавиша N · Сбросить выбор · Отметить

### ui/materials-spec.js

- **Кнопки:** Сохранить в справочник · Не надо · + Строка
- **Подписи:** Размеры · Из чего · Покрытие
- **Заголовки/подсказки:** Убрать строку · Оставить только в этой строке
- **API:** `/dicts` `/dicts/passportSortament` `/dicts/passportParts` `/showcase/materials-text`

### ui/photos.js

- **Кнопки:** выберите файл
- **Заголовки/подсказки:** Можно вставить скриншот: Ctrl+V · Открыть PDF · Открыть фото · Убрать фото
- **API:** `/photos/upload`

### ui/phrases.js

- **Кнопки:** ▾

### ui/quick-order.js

- **Кнопки:** Заказать · Новая позиция…
- **Заголовки/подсказки:** Нет в списке — полная форма заявки справа
- **API:** `/supply/requests`

### ui/quick.js

- **Кнопки:** Добавить

### ui/responsible.js

- **Подписи:** Ответственный
- **API:** `/staff` `/handoffs`

### ui/rows-table.js

- **Кнопки:** + Строка · ⇩ Шаблон Excel · ⇧ Загрузить Excel
- **Заголовки/подсказки:** Убрать строку · Пустая таблица с нужными колонками — заполнить в Excel и загрузить · Заполненный шаблон (.xlsx или .csv) — строки заменятся

### ui/spec-import.js

- **Кнопки:** Скачать шаблон · Забронировать сколько свободно · Скачать отчёт (Excel)
- **Заголовки/подсказки:** Заказ выбран выше — «Заказ» и «Позиция» в файле нужны, только если позиции разные. Новые позиции склада не создаются. · Спецификация
- **API:** `/salesorders` `/stock/spec/preview` `/stock/spec/apply`

### ui/target-picker.js

- **Кнопки:** Сменить заказ · Сменить
- **API:** `/salesorders` `/photos`

### ui/toast.js

- **Подписи:** Отменить

### ui/weight-count.js

- **Кнопки:** Штуками · По весу · + партия
- **Подписи:** Количество

### core/bulk-match.js

- **API:** `/supply/aliases/match` `/supply/aliases`

### core/dom.js

- **Кнопки:** Текст

### core/orders-lookup.js

- **API:** `/salesorders/lookup` `/salesorders` `/incomes`

### core/prefs.js

- **API:** `/auth/me/prefs`

### core/stock-list.js

- **API:** `/stock/items` `/stock/lookup`

### main.js

- **Кнопки:** Войти
- **Подписи:** Установить на телефон · Поиск по всему · Ширина меню · Администрирование · CRM · Выйти · Мой профиль · Тема:
- **Заголовки/подсказки:** Установить на телефон · Работа с сайтом: с чего начать · Настройки · Данные · Система · Приложение · История
- **API:** `/auth/me`
