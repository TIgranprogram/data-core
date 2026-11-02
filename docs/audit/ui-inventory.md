# Перечень приложения «Рабочее место» (собран скриптом)

Создан: `node backend/scripts/ui-inventory.mjs`. Файлов: 154, всего 1657.2 КБ JS (без CSS).

Как читать: каждая строка — пункт проверки аудита. Ничего не отмечено «проверено» здесь: отметки — в `docs/audit/AUDIT-PLAN.md`.

## 1. Файлы: размер и способы открытия

| Файл | КБ | Строк | Правая панель | Окно (modal) | Подтверждение | Переход go() | Импортов |
|--|--|--|--|--|--|--|--|
| sections/salesorders.js | 61.6 | 692 | 13 | 2 | 3 | 1 | 30 |
| sections/products.js | 54.4 | 541 | 6 | 0 | 2 | 5 | 22 |
| ui/design-board.js | 50.1 | 594 | 0 | 4 | 2 | 6 | 14 |
| main.js | 49.8 | 584 | 2 | 1 | 1 | 5 | 67 |
| ui/list.js | 48.5 | 625 | 0 | 0 | 0 | 0 | 15 |
| sections/requests.js | 39.3 | 478 | 2 | 1 | 0 | 1 | 22 |
| sections/dicts.js | 34.8 | 382 | 5 | 1 | 2 | 3 | 16 |
| sections/money.js | 32.4 | 361 | 0 | 0 | 0 | 4 | 11 |
| sections/home.js | 32.3 | 479 | 5 | 1 | 0 | 12 | 11 |
| sections/supplier-catalog.js | 31.6 | 436 | 0 | 0 | 0 | 0 | 15 |
| ui/materials-spec.js | 30.6 | 384 | 0 | 0 | 0 | 0 | 6 |
| sections/stock-ops.js | 29.4 | 350 | 1 | 0 | 4 | 0 | 22 |
| sections/orders.js | 28.2 | 335 | 0 | 1 | 0 | 3 | 16 |
| ui/card.js | 27.6 | 319 | 1 | 0 | 5 | 1 | 14 |
| ui/form.js | 26.8 | 355 | 0 | 0 | 0 | 0 | 8 |
| sections/design.js | 25.5 | 330 | 0 | 0 | 0 | 2 | 14 |
| sections/invoice.js | 24.6 | 267 | 0 | 0 | 0 | 0 | 15 |
| sections/stock.js | 24.6 | 285 | 0 | 0 | 0 | 1 | 22 |
| sections/passport-texts.js | 23.6 | 308 | 5 | 0 | 1 | 0 | 6 |
| sections/request-step.js | 23.3 | 276 | 2 | 1 | 0 | 0 | 11 |
| sections/kp.js | 23.0 | 243 | 0 | 0 | 0 | 1 | 13 |
| sections/partners.js | 22.4 | 270 | 1 | 1 | 0 | 2 | 10 |
| sections/work.js | 22.1 | 284 | 0 | 0 | 0 | 1 | 11 |
| ui/gantt.js | 21.1 | 310 | 0 | 0 | 0 | 0 | 5 |
| core/api.js | 20.4 | 292 | 0 | 0 | 0 | 0 | 1 |
| ui/spec-import.js | 19.5 | 233 | 0 | 0 | 0 | 0 | 10 |
| sections/staff.js | 18.4 | 233 | 0 | 0 | 1 | 3 | 7 |
| sections/contracts.js | 18.4 | 244 | 2 | 0 | 1 | 0 | 9 |
| ui/target-picker.js | 18.2 | 234 | 0 | 0 | 0 | 0 | 9 |
| sections/passports.js | 17.8 | 193 | 0 | 0 | 1 | 2 | 18 |
| sections/offers.js | 17.6 | 257 | 0 | 0 | 1 | 1 | 8 |
| ui/board.js | 17.1 | 230 | 0 | 0 | 0 | 0 | 8 |
| sections/passport-tree.js | 17.0 | 204 | 6 | 1 | 1 | 0 | 10 |
| sections/chat.js | 17.0 | 228 | 0 | 0 | 0 | 3 | 11 |
| sections/invoices-tab.js | 14.3 | 209 | 2 | 0 | 0 | 0 | 10 |
| ui/facet-filter.js | 14.2 | 166 | 0 | 0 | 0 | 0 | 7 |
| sections/payroll.js | 14.1 | 164 | 0 | 0 | 1 | 0 | 8 |
| sections/help.js | 14.0 | 222 | 0 | 0 | 0 | 0 | 2 |
| sections/matching-queue.js | 13.9 | 181 | 0 | 0 | 0 | 1 | 11 |
| sections/help-flow-data.js | 13.8 | 98 | 0 | 0 | 0 | 0 | 0 |
| sections/design-requests.js | 13.6 | 191 | 2 | 1 | 0 | 2 | 8 |
| sections/composition.js | 13.3 | 149 | 0 | 0 | 0 | 0 | 5 |
| sections/docs.js | 13.0 | 177 | 1 | 0 | 0 | 4 | 13 |
| sections/order-shipments.js | 12.3 | 148 | 1 | 0 | 1 | 0 | 9 |
| sections/salesorders-unassigned.js | 12.3 | 174 | 0 | 2 | 0 | 1 | 10 |
| sections/pipe-grid.js | 11.7 | 155 | 0 | 0 | 0 | 1 | 6 |
| sections/docs-orders.js | 10.0 | 143 | 0 | 1 | 0 | 1 | 8 |
| sections/movements.js | 9.8 | 125 | 0 | 1 | 1 | 2 | 7 |
| sections/order-lines.js | 9.5 | 140 | 1 | 1 | 0 | 0 | 6 |
| ui/funnel.js | 9.5 | 159 | 0 | 0 | 0 | 0 | 4 |
| ui/cat-rain.js | 9.4 | 203 | 0 | 0 | 0 | 0 | 0 |
| sections/salesorders-matching.js | 9.4 | 132 | 2 | 0 | 0 | 0 | 8 |
| core/prefs.js | 9.3 | 174 | 0 | 0 | 0 | 0 | 1 |
| ui/combo.js | 9.3 | 112 | 0 | 0 | 0 | 0 | 3 |
| ui/cat-art.js | 9.2 | 78 | 0 | 0 | 0 | 0 | 0 |
| ui/design-notes.js | 9.0 | 145 | 0 | 0 | 1 | 0 | 5 |
| sections/stock-ops-res.js | 9.0 | 112 | 0 | 0 | 1 | 0 | 8 |
| ui/weight-count.js | 8.9 | 123 | 0 | 0 | 0 | 0 | 2 |
| sections/fill.js | 8.7 | 106 | 1 | 0 | 0 | 1 | 7 |
| sections/order-line-actions.js | 8.5 | 121 | 0 | 6 | 0 | 0 | 5 |
| sections/design-settings.js | 8.4 | 111 | 0 | 0 | 1 | 0 | 5 |
| ui/design-stickers.js | 8.3 | 136 | 0 | 0 | 1 | 0 | 7 |
| sections/work-route.js | 8.2 | 99 | 0 | 0 | 0 | 0 | 5 |
| ui/avatars.js | 8.1 | 88 | 0 | 0 | 0 | 0 | 2 |
| core/errors.js | 7.8 | 116 | 0 | 0 | 0 | 0 | 3 |
| sections/item-orders.js | 7.7 | 107 | 1 | 2 | 0 | 0 | 9 |
| sections/sheet-grid.js | 7.5 | 106 | 0 | 0 | 0 | 1 | 6 |
| ui/drag.js | 7.5 | 126 | 0 | 0 | 0 | 0 | 0 |
| ui/photos.js | 7.5 | 100 | 0 | 0 | 0 | 0 | 3 |
| sections/reservations.js | 7.1 | 81 | 1 | 0 | 0 | 0 | 7 |
| sections/order-work.js | 7.0 | 88 | 0 | 0 | 0 | 0 | 4 |
| sections/request-fill.js | 7.0 | 114 | 0 | 0 | 0 | 0 | 4 |
| sections/design-order.js | 6.9 | 95 | 0 | 0 | 0 | 0 | 9 |
| core/facets.js | 6.9 | 91 | 0 | 0 | 0 | 0 | 0 |
| sections/metal.js | 6.9 | 84 | 0 | 1 | 0 | 0 | 6 |
| sections/issue.js | 6.8 | 98 | 0 | 1 | 0 | 0 | 7 |
| sections/warehouse-mobile.js | 6.7 | 131 | 0 | 0 | 0 | 0 | 7 |
| ui/composition-suggest.js | 6.6 | 78 | 1 | 0 | 0 | 0 | 6 |
| sections/bulk-edit.js | 6.5 | 87 | 1 | 0 | 1 | 0 | 6 |
| ui/bell.js | 6.5 | 109 | 0 | 0 | 0 | 0 | 6 |
| core/xlsx-write.js | 6.4 | 59 | 0 | 0 | 0 | 0 | 0 |
| sections/order-issue.js | 6.3 | 101 | 0 | 0 | 0 | 0 | 7 |
| sections/stock-passport.js | 6.2 | 77 | 0 | 0 | 0 | 0 | 4 |
| core/update-check.js | 6.2 | 88 | 0 | 0 | 0 | 0 | 2 |
| sections/money-forecast.js | 6.0 | 57 | 0 | 0 | 0 | 0 | 4 |
| ui/rows-table.js | 5.9 | 88 | 0 | 0 | 0 | 0 | 4 |
| sections/history.js | 5.7 | 91 | 0 | 0 | 0 | 1 | 7 |
| core/paste-parse.js | 5.7 | 83 | 0 | 0 | 0 | 0 | 0 |
| sections/docs-queue.js | 5.5 | 65 | 0 | 0 | 0 | 1 | 9 |
| ui/history.js | 5.5 | 63 | 0 | 0 | 0 | 0 | 2 |
| sections/profile.js | 5.4 | 77 | 0 | 0 | 0 | 0 | 5 |
| ui/phrases.js | 5.4 | 70 | 0 | 0 | 0 | 0 | 3 |
| ui/cat-chips.js | 5.4 | 72 | 0 | 0 | 0 | 0 | 1 |
| core/xlsx-read.js | 5.2 | 78 | 0 | 0 | 0 | 0 | 0 |
| sections/order-design.js | 5.2 | 61 | 0 | 0 | 0 | 0 | 6 |
| sections/reservation-edit.js | 5.0 | 64 | 1 | 0 | 1 | 0 | 9 |
| sections/order-reservations.js | 5.0 | 55 | 1 | 0 | 1 | 0 | 9 |
| ui/icons.js | 4.7 | 49 | 0 | 0 | 0 | 0 | 0 |
| ui/gallery.js | 4.7 | 60 | 0 | 0 | 0 | 0 | 2 |
| core/router.js | 4.7 | 81 | 0 | 0 | 0 | 0 | 1 |
| sections/tech-sheet.js | 4.7 | 68 | 0 | 1 | 0 | 0 | 5 |
| ui/pop-menu.js | 4.6 | 84 | 0 | 0 | 0 | 0 | 2 |
| ui/popup.js | 4.5 | 71 | 0 | 0 | 0 | 0 | 1 |
| sections/trash.js | 4.4 | 66 | 0 | 0 | 0 | 0 | 16 |
| sections/ops.js | 4.2 | 65 | 0 | 1 | 0 | 0 | 5 |
| sections/order-passports.js | 4.1 | 52 | 0 | 0 | 1 | 0 | 6 |
| sections/search.js | 4.0 | 58 | 0 | 0 | 0 | 0 | 11 |
| ui/errors.js | 3.9 | 58 | 0 | 0 | 0 | 0 | 0 |
| ui/step-funnel.js | 3.9 | 50 | 0 | 0 | 0 | 0 | 3 |
| core/passport-kinds.js | 3.8 | 29 | 0 | 0 | 0 | 0 | 0 |
| ui/resizer.js | 3.7 | 67 | 0 | 0 | 0 | 0 | 2 |
| ui/suggest.js | 3.7 | 52 | 0 | 0 | 0 | 0 | 3 |
| sections/salesorders-next.js | 3.6 | 44 | 0 | 0 | 0 | 0 | 0 |
| ui/tag-pick.js | 3.6 | 49 | 0 | 0 | 0 | 0 | 1 |
| core/bulk-match.js | 3.5 | 51 | 0 | 0 | 0 | 0 | 2 |
| ui/busy.js | 3.5 | 53 | 0 | 0 | 0 | 0 | 5 |
| ui/dict-options.js | 3.5 | 43 | 0 | 0 | 0 | 0 | 1 |
| core/dom.js | 3.4 | 76 | 0 | 0 | 0 | 0 | 0 |
| ui/select.js | 3.2 | 40 | 0 | 0 | 0 | 0 | 2 |
| ui/toast.js | 3.2 | 45 | 0 | 0 | 0 | 0 | 4 |
| ui/notices.js | 3.1 | 48 | 0 | 0 | 0 | 0 | 0 |
| ui/badges.js | 2.8 | 44 | 0 | 0 | 0 | 0 | 1 |
| core/write-retry.js | 2.7 | 44 | 0 | 0 | 0 | 0 | 0 |
| ui/searchbox.js | 2.7 | 39 | 0 | 0 | 0 | 0 | 2 |
| core/nav-stack.js | 2.6 | 34 | 0 | 0 | 0 | 0 | 0 |
| ui/side-form.js | 2.5 | 53 | 2 | 0 | 0 | 0 | 2 |
| ui/notice-card.js | 2.5 | 42 | 0 | 0 | 0 | 0 | 2 |
| core/stock-list.js | 2.4 | 42 | 0 | 0 | 0 | 0 | 1 |
| ui/chat-window.js | 2.3 | 43 | 0 | 0 | 0 | 0 | 3 |
| sections/lookups.js | 2.3 | 36 | 0 | 0 | 0 | 0 | 4 |
| ui/quality.js | 2.2 | 30 | 0 | 0 | 0 | 0 | 1 |
| ui/list-export.js | 2.2 | 36 | 0 | 0 | 0 | 0 | 3 |
| core/format.js | 2.1 | 57 | 0 | 0 | 0 | 0 | 0 |
| ui/stage-bar.js | 2.1 | 30 | 0 | 0 | 0 | 0 | 2 |
| core/live-sync.js | 2.1 | 42 | 0 | 0 | 0 | 0 | 1 |
| ui/chat-button.js | 2.1 | 34 | 0 | 0 | 0 | 0 | 5 |
| ui/quick.js | 2.1 | 35 | 0 | 0 | 0 | 0 | 3 |
| core/passport-images.js | 2.1 | 39 | 0 | 0 | 0 | 0 | 0 |
| sections/ops-weight.js | 2.0 | 32 | 0 | 1 | 0 | 0 | 4 |
| ui/responsible.js | 1.9 | 31 | 0 | 0 | 0 | 0 | 3 |
| ui/dialog.js | 1.9 | 32 | 0 | 2 | 1 | 0 | 1 |
| ui/crumbs.js | 1.8 | 27 | 0 | 0 | 0 | 0 | 1 |
| sections/requests-tabs.js | 1.7 | 39 | 0 | 0 | 0 | 1 | 3 |
| core/order-color.js | 1.6 | 31 | 0 | 0 | 0 | 0 | 0 |
| ui/search-logic.js | 1.5 | 28 | 0 | 0 | 0 | 0 | 0 |
| ui/confirm-password.js | 1.5 | 25 | 0 | 1 | 0 | 0 | 3 |
| ui/pos-pic.js | 1.5 | 20 | 0 | 0 | 0 | 0 | 3 |
| ui/op-row.js | 1.4 | 16 | 1 | 0 | 0 | 0 | 4 |
| core/orders-lookup.js | 1.4 | 26 | 0 | 0 | 0 | 0 | 1 |
| ui/pager.js | 1.3 | 26 | 0 | 0 | 0 | 0 | 1 |
| sections/order-stage.js | 1.2 | 26 | 0 | 0 | 0 | 0 | 2 |
| ui/app-badge.js | 0.8 | 14 | 0 | 0 | 0 | 0 | 0 |
| ui/empty.js | 0.6 | 10 | 0 | 0 | 0 | 0 | 1 |
| ui/links.js | 0.5 | 7 | 0 | 0 | 0 | 0 | 1 |

## 2. Одна подпись — в нескольких файлах (кандидаты в дубли или в «одни слова»)

| Подпись (label / кнопка) | Где |
|--|--|
| Примечание | sections/design.js, sections/movements.js, sections/offers.js, sections/orders.js, sections/partners.js, sections/products.js, sections/requests.js, sections/salesorders.js, sections/stock.js, sections/supplier-catalog.js |
| Статус | sections/contracts.js, sections/design.js, sections/offers.js, sections/orders.js, sections/passports.js, sections/products.js, sections/requests.js, sections/salesorders.js, sections/work.js |
| Название | sections/design-requests.js, sections/design.js, sections/orders.js, sections/partners.js, sections/passports.js, sections/products.js, sections/requests.js, sections/stock.js |
| Дата | sections/contracts.js, sections/movements.js, sections/offers.js, sections/orders.js, sections/passports.js, sections/payroll.js, sections/requests.js |
| Изменить | sections/design-settings.js, sections/dicts.js, sections/order-reservations.js, sections/reservations.js, sections/stock-ops-res.js, ui/card.js, ui/funnel.js |
| Ед. изм. | sections/orders.js, sections/products.js, sections/request-step.js, sections/requests.js, sections/stock.js, sections/supplier-catalog.js |
| Заказчик | sections/offers.js, sections/orders.js, sections/partners.js, sections/passports.js, sections/requests.js, sections/salesorders.js |
| Наша компания | sections/offers.js, sections/orders.js, sections/partners.js, sections/request-step.js, sections/requests.js, sections/salesorders.js |
| Отмена | sections/contracts.js, sections/design-settings.js, sections/invoice.js, sections/order-shipments.js, ui/design-board.js, ui/design-notes.js |
| Поставщик | sections/contracts.js, sections/partners.js, sections/passports.js, sections/request-step.js, sections/requests.js, sections/supplier-catalog.js |
| Количество | sections/orders.js, sections/request-step.js, sections/requests.js, sections/stock.js, ui/weight-count.js |
| Оплачено | sections/help-flow-data.js, sections/invoice.js, sections/offers.js, sections/orders.js, ui/badges.js |
| Принять на склад | sections/help-flow-data.js, sections/item-orders.js, sections/requests.js, sections/stock.js, sections/warehouse-mobile.js |
| Сумма | sections/offers.js, sections/orders.js, sections/partners.js, sections/requests.js, sections/salesorders.js |
| ⇩ Шаблон Excel | sections/invoice.js, sections/kp.js, sections/supplier-catalog.js, ui/rows-table.js |
| Артикул | sections/design-requests.js, sections/docs.js, sections/products.js, sections/requests.js |
| Выдать | sections/help-flow-data.js, sections/reservations.js, sections/stock.js, sections/warehouse-mobile.js |
| Категория | sections/passports.js, sections/requests.js, sections/stock.js, sections/supplier-catalog.js |
| По дату | sections/history.js, sections/movements.js, sections/orders.js, sections/requests.js |
| Повторить | sections/contracts.js, sections/design-requests.js, sections/invoices-tab.js, ui/busy.js |
| С даты | sections/history.js, sections/movements.js, sections/orders.js, sections/requests.js |
| В работе | sections/salesorders.js, sections/work.js, ui/badges.js |
| Взять в работу | sections/design-order.js, sections/work.js, ui/design-board.js |
| Группа | sections/docs.js, sections/products.js, sections/supplier-catalog.js |
| Закрыт | sections/contracts.js, sections/help-flow-data.js, sections/order-stage.js |
| Изделие | sections/design.js, sections/docs.js, sections/work.js |
| Кол-во | sections/movements.js, sections/orders.js, sections/requests.js |
| Контрагенты | sections/dicts.js, sections/help-flow-data.js, sections/history.js |
| Кто | sections/history.js, sections/movements.js, sections/partners.js |
| Объединить с… | sections/dicts.js, sections/partners.js, sections/passport-tree.js |
| Отгрузить | sections/help-flow-data.js, sections/orders.js, sections/salesorders.js |
| Открыть | sections/fill.js, sections/history.js, ui/design-board.js |
| Приоритет | sections/design.js, sections/requests.js, sections/salesorders.js |
| Срок | sections/design.js, sections/salesorders.js, sections/work.js |
| Удалить | sections/dicts.js, ui/card.js, ui/design-notes.js |
| Цвет | sections/orders.js, sections/requests.js, sections/supplier-catalog.js |
| Черновик | sections/offers.js, sections/products.js, ui/badges.js |
| ← Назад | sections/design-requests.js, sections/docs-orders.js |
| ⇩ PDF пакетом | sections/order-passports.js, sections/passports.js |
| + | ui/gallery.js, ui/list.js |
| + Договор | sections/contracts.js, sections/salesorders.js |
| + Строка | ui/materials-spec.js, ui/rows-table.js |
| В норме | sections/stock.js, ui/badges.js |
| Вид | sections/orders.js, sections/payroll.js |
| Все | sections/salesorders.js, sections/work.js |
| Все заказы | sections/design.js, sections/work.js |
| Все исполнители | sections/design.js, sections/work.js |
| Выбрать все | sections/kp.js, ui/board.js |
| Готово | sections/work.js, ui/facet-filter.js |
| Готово к отгрузке | sections/help-flow-data.js, sections/order-stage.js |
| Группа изделий | sections/design-requests.js, sections/products.js |
| Дальше → | sections/design-requests.js, sections/docs-orders.js |
| Дата отгрузки | sections/orders.js, sections/salesorders.js |
| Дата счёта | sections/request-step.js, sections/requests.js |
| Движения | sections/history.js, sections/stock.js |
| Журнал движений | sections/pipe-grid.js, sections/sheet-grid.js |
| Заказ | sections/orders.js, sections/requests.js |
| Закрыть | sections/dicts.js, ui/card.js |
| Заявки | sections/history.js, sections/salesorders-next.js |
| Изделие из «Продукции» | sections/order-lines.js, sections/orders.js |
| Исполнитель | sections/design.js, sections/work.js |
| Код | sections/design.js, sections/work.js |
| Короткое название | sections/products.js, sections/stock.js |
| Месяц | sections/passports.js, ui/gantt.js |
| На распределение | sections/design-order.js, ui/design-board.js |
| На распределение все позиции | sections/design-order.js, ui/design-board.js |
| Нет | sections/products.js, ui/badges.js |
| Обычный | sections/profile.js, ui/badges.js |
| Описание | sections/design-requests.js, sections/products.js |
| Остаток | sections/stock.js, sections/supplier-catalog.js |
| Ответить | sections/home.js, ui/design-notes.js |
| Отгружен | sections/order-stage.js, sections/orders.js |
| Отгрузка | sections/orders.js, sections/salesorders-next.js |
| Открытые | sections/design.js, sections/work.js |
| Открыть заказ | sections/salesorders-next.js, ui/design-board.js |
| Отменён | sections/order-stage.js, ui/badges.js |
| Отменено | sections/offers.js, ui/badges.js |
| Отменить | sections/movements.js, ui/toast.js |
| Отправить | sections/chat.js, ui/design-notes.js |
| Паспорт → | sections/orders.js, sections/products.js |
| Пересчёт | sections/stock.js, sections/warehouse-mobile.js |
| Показать | sections/partners.js, ui/list.js |
| Показать все | sections/home.js, ui/list.js |
| Показать ещё | sections/matching-queue.js, sections/salesorders-unassigned.js |
| Получено | sections/help-flow-data.js, ui/badges.js |
| Привязать к изделию | sections/docs.js, sections/passports.js |
| Раздел | sections/history.js, sections/products.js |
| Распределить | sections/help-flow-data.js, sections/salesorders-next.js |
| Скрыть | sections/money-forecast.js, sections/money.js |
| Сопоставить | sections/matching-queue.js, sections/salesorders-unassigned.js |
| Сохранить | sections/fill.js, sections/work-route.js |
| Счёт | sections/help-flow-data.js, sections/requests.js |
| Тип оборудования | sections/design-requests.js, sections/products.js |
| Убрать из проектирования | sections/design-order.js, ui/design-board.js |
| Форма оплаты | sections/orders.js, sections/salesorders.js |
| Фото | sections/requests.js, sections/stock.js |
| Цена | sections/design-requests.js, sections/products.js |
| Цена, ₽ | sections/products.js, sections/supplier-catalog.js |
| Ширина панели фильтров | ui/facet-filter.js, ui/list.js |
| № договора | sections/contracts.js, sections/salesorders.js |
| № счёта | sections/request-step.js, sections/requests.js |

## 3. Один запрос к API — из нескольких файлов (кандидаты в общий модуль или в лишнюю загрузку)

| Путь | Файлов | Где |
|--|--|--|
| /stock/items | 11 | sections/invoice.js, sections/item-orders.js, sections/metal.js, sections/pipe-grid.js, sections/sheet-grid.js, sections/stock-ops-res.js, sections/stock-ops.js, sections/stock.js, sections/supplier-catalog.js, sections/warehouse-mobile.js, core/stock-list.js |
| /salesorders | 8 | sections/home.js, sections/order-line-actions.js, sections/order-passports.js, sections/order-shipments.js, sections/orders.js, sections/salesorders.js, ui/spec-import.js, ui/target-picker.js |
| /showcase | 8 | sections/composition.js, sections/design-requests.js, sections/docs.js, sections/kp.js, sections/orders.js, sections/products.js, sections/salesorders-matching.js, ui/materials-spec.js |
| /stock/batch | 8 | sections/metal.js, sections/movements.js, sections/order-issue.js, sections/pipe-grid.js, sections/reservations.js, sections/sheet-grid.js, sections/stock-ops-res.js, sections/stock-ops.js |
| /supply/requests | 8 | sections/home.js, sections/invoice.js, sections/item-orders.js, sections/ops.js, sections/request-step.js, sections/requests.js, sections/stock-ops.js, sections/warehouse-mobile.js |
| /partners | 7 | sections/contracts.js, sections/lookups.js, sections/partners.js, sections/request-fill.js, sections/request-step.js, sections/requests.js, sections/supplier-catalog.js |
| /stock/reservations | 7 | sections/order-reservations.js, sections/pipe-grid.js, sections/reservation-edit.js, sections/reservations.js, sections/sheet-grid.js, sections/stock-ops-res.js, sections/stock-ops.js |
| /design-tasks | 6 | sections/design-order.js, sections/design.js, sections/order-design.js, ui/design-board.js, ui/design-notes.js, ui/design-stickers.js |
| /passports | 4 | sections/docs-orders.js, sections/passports.js, sections/products.js, sections/salesorders.js |
| /dicts | 3 | sections/dicts.js, ui/dict-options.js, ui/materials-spec.js |
| /dicts/passportCategories | 3 | sections/dicts.js, sections/docs.js, sections/products.js |
| /dicts/persons | 3 | sections/design.js, sections/issue.js, sections/products.js |
| /incomes | 3 | sections/order-line-actions.js, sections/order-lines.js, sections/orders.js |
| /materials | 3 | sections/request-fill.js, sections/request-step.js, sections/stock-passport.js |
| /photos/upload | 3 | sections/profile.js, ui/design-board.js, ui/photos.js |
| /production-orders | 3 | sections/order-line-actions.js, sections/salesorders-unassigned.js, sections/salesorders.js |
| /supply/invoices | 3 | sections/contracts.js, sections/invoices-tab.js, sections/request-step.js |
| /audit-logs/record | 2 | sections/history.js, ui/card.js |
| /auth/me | 2 | sections/profile.js, main.js |
| /design-stickers | 2 | sections/design-settings.js, ui/design-stickers.js |
| /dicts/worktypes | 2 | sections/order-lines.js, sections/work-route.js |
| /incomes/lookups | 2 | sections/orders.js, sections/request-step.js |
| /matching/bulk | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /matching/confirm | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /matching/none | 2 | sections/matching-queue.js, sections/salesorders-matching.js |
| /messages/threads | 2 | sections/chat.js, ui/chat-button.js |
| /passports/queue | 2 | sections/docs-queue.js, sections/home.js |
| /photos | 2 | ui/avatars.js, ui/target-picker.js |
| /product-requests | 2 | sections/design-requests.js, sections/order-lines.js |
| /production-orders/unassigned | 2 | sections/matching-queue.js, sections/salesorders-unassigned.js |
| /salesorders/lookup | 2 | sections/order-line-actions.js, core/orders-lookup.js |
| /showcase/form-values | 2 | sections/design-requests.js, sections/products.js |
| /showcase/from-passports | 2 | sections/kp.js, sections/passports.js |
| /staff | 2 | sections/staff.js, ui/responsible.js |
| /stock/categories | 2 | sections/stock-ops.js, sections/stock.js |
| /stock/movements | 2 | sections/movements.js, sections/warehouse-mobile.js |
| /stock/reservations/group | 2 | sections/reservations.js, sections/stock-ops.js |
| /stock/reservations/issue | 2 | sections/issue.js, sections/stock-ops-res.js |
| /stock/reservations/order | 2 | sections/order-issue.js, sections/order-reservations.js |
| /supply/catalog/items | 2 | sections/request-fill.js, sections/supplier-catalog.js |
| /supply/contracts | 2 | sections/contracts.js, sections/home.js |
| /work-tasks | 2 | sections/order-work.js, sections/work.js |

## 4. По файлам: кнопки, подписи, подсказки, запросы

### sections/chat.js

- **Кнопки:** Отправить · 😊
- **Заголовки/подсказки:** Enter — отправить, Shift+Enter — новая строка · Добавить фото (можно вставить Ctrl+V или перетащить) · Смайлики · Убрать фото · Открыть фото · Чат
- **API:** `/messages/threads` `/messages/users` `/messages`

### sections/composition.js

- **Заголовки/подсказки:** Убрать из состава · Состав изделия
- **API:** `/showcase`

### sections/contracts.js

- **Кнопки:** Сохранить договор · Отмена · + Договор · Повторить
- **Подписи:** Без договора · + Договор поставщика · Поставщик · № договора · Дата договора · Предмет · Действует до · Статус · Действует · Закрыт · Скан договора · Дата · Счетов
- **Заголовки/подсказки:** Удалить договор · Договор поставщика · Договоры
- **API:** `/supply/contracts` `/supply/invoices` `/partners`

### sections/design-order.js

- **Кнопки:** Взять в работу · На распределение
- **Подписи:** На распределение все позиции · Убрать из проектирования
- **Заголовки/подсказки:** Открыть изделие справа · Проектирование
- **API:** `/design-tasks`

### sections/design-requests.js

- **Кнопки:** ← Назад · Дальше → · Повторить · Задачи
- **Подписи:** Создать изделие · Это дубль существующего · Название · Тип оборудования · Группа изделий · Артикул · Цена · Описание
- **Заголовки/подсказки:** Это дубль существующего · Заявка на создание изделия · Откроется форма изделия: название, описание и фото уже подставлены · Изделие уже есть — привязать позиции к нему
- **API:** `/product-requests/count` `/product-requests` `/showcase/form-values` `/showcase`

### sections/design-settings.js

- **Кнопки:** Отмена · Изменить · + Стикер
- **Заголовки/подсказки:** Убрать состояние · Показывать на карточках доски · Выше · Ниже · Настройки доски
- **API:** `/design-stickers`

### sections/design.js

- **Кнопки:** Уточнить у менеджера · Показать полностью
- **Подписи:** Статус · Открытые · Без отменённых · Вопросы · Есть вопрос без ответа · Все исполнители · Все заказы · Код · Изделие · Срок · Приоритет · Исполнитель · Название · Причина (пауза / отмена) · Примечание
- **Заголовки/подсказки:** Проектирование
- **API:** `/dicts/persons` `/design-tasks`

### sections/dicts.js

- **Кнопки:** + Добавить · Найти в данных… · Изменить · Удалить · Закрыть · Добавить отмеченные
- **Подписи:** Поиск значения · Контрагенты · Объединить с… · Виды работ
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

- **Кнопки:** Сохранить · Открыть
- **API:** `/fill-audit`

### sections/help-flow-data.js

- **Подписи:** Заказ принят · Позиции и срок · Распределить · Проектируем · Чертежи готовы · Нужен материал · Заказали · Счёт · Оплачено · Получено · Принять на склад · Бронь под заказ · Выдать · В работе: по видам работ · В производстве · Готово к отгрузке · Отгрузить · Закрыт · Сроки заданий на диаграмме · Нужен паспорт · Паспорт выпущен · Счёт к оплате · Поступление · Календарь и сводка · Продукция · Каталог поставщиков · Договоры поставщиков · Контрагенты · Сотрудники и зоны · Чат · Сегодня: дела по роли · Коммерческое предложение (КП) · в проектирование · нужен материал · принять · запустить в работу · нет паспорта · к отгрузке · к оплате · оплата покупателя

### sections/help.js

- **Кнопки:** 🔍 Крупнее
- **Заголовки/подсказки:** Меню: · Работа с сайтом

### sections/history.js

- **Подписи:** Заявки · Склад · Движения · Заказы · Позиции заказов · Контрагенты · Справочники · Раздел · Кто · С даты · По дату · Открыть · Когда · Что · Запись
- **Заголовки/подсказки:** История · Открыть саму запись
- **API:** `/audit-logs/record` `/audit-logs/app` `/audit-logs/app/users`

### sections/home.js

- **Кнопки:** На завтра · Ответить · Показать все
- **Заголовки/подсказки:** Перенести дату поставки: · Спрятать карточку до завтра
- **API:** `/design-notes/open-questions` `/supply/requests` `/salesorders` `/today` `/passports/queue` `/supply/contracts`

### sections/invoice.js

- **Кнопки:** Создать позицию · Отмена · Разобрать и найти в базе · ⇩ Шаблон Excel · + Строка счёта
- **Подписи:** Заказано — ждём · Оплачено · Получено — на склад
- **Заголовки/подсказки:** Нужной позиции нет в списке — создать её в базе · Убрать позицию · Это та же позиция — взять её · Файл Excel (.xlsx) или CSV — первый лист · Пустая таблица с нужными колонками — заполнить в Excel и загрузить · Заявки из таблицы · Счёт
- **API:** `/stock/items` `/supply/requests`

### sections/invoices-tab.js

- **Кнопки:** Повторить · ‹ Назад · Далее › · Свернуть ▴
- **API:** `/supply/invoices`

### sections/issue.js

- **API:** `/dicts/persons` `/stock/reservations/issue`

### sections/item-orders.js

- **Кнопки:** Принять на склад
- **Заголовки/подсказки:** Уже заказано
- **API:** `/stock/items` `/supply/requests`

### sections/kp.js

- **Кнопки:** ⇩ Шаблон Excel · Выбрать все · Снять все · Объединить · Это разные изделия
- **Заголовки/подсказки:** Убрать · Пустая таблица с нужными колонками и примером · Каждый вариант станет отдельным изделием · Изделия из паспортов · Коммерческое предложение · Изделия из заказов · Загрузка каталога
- **API:** `/showcase` `/showcase/kp` `/showcase/import` `/showcase/from-orders` `/showcase/from-passports`

### sections/lookups.js

- **API:** `/supply/lookups` `/partners`

### sections/matching-queue.js

- **Кнопки:** Сопоставить · Несопоставленные · Показать ещё · Выбрать…
- **Заголовки/подсказки:** Сопоставить позиции договора с изделиями
- **API:** `/matching/unmatched/count` `/matching/confirm` `/matching/none` `/matching/unmatched` `/matching/bulk` `/production-orders/unassigned`

### sections/metal.js

- **Подписи:** Сортамент / сечение · Марка стали · Толщина, мм · Длина, м · Мойка трубы · Мытая · Не мытая · Ширина, м
- **API:** `/stock/items` `/stock/batch`

### sections/money-forecast.js

- **Кнопки:** Скрыть

### sections/money.js

- **Кнопки:** ⚙ Старт учёта · Скрыть · К текущему месяцу
- **Подписи:** Дата старта · Остаток на начало дня —
- **Заголовки/подсказки:** Старт учёта · Остаток денег на начало месяца (запоминается в этом браузере) · Следующий месяц · Дата, с которой ведётся учёт, и остаток на счетах наших компаний · Назад · Итог за выбранный период · Доходы не внесены — у позиций заказов нет суммы · Открыть список и заполнить · Результат того же месяца прошлого года
- **API:** `/finance/settings` `/finance/forecast` `/finance/summary` `/finance/cashflow`

### sections/movements.js

- **Подписи:** Операция · Приход · Списание · Корректировка · С даты · По дату · Позиция · Исправить · Отменить · Дата · Кол-во · Кому / под что · Примечание · Кто · Исправить списание · Отменить движение · Отменить всю операцию · Открыть позицию
- **Заголовки/подсказки:** Исправить списание · Движения · Указать верное количество · Провести обратное движение · Открыть позицию склада
- **API:** `/stock/movements` `/stock/batch`

### sections/offers.js

- **Кнопки:** + Загрузить бланк
- **Подписи:** Черновик · Отправлено · Принято · Оплачено · Отклонено · Отменено · Наша компания · Заказчик · Дата · Действительно до · Тема · Строки · Предоплата, % · Срок изготовления, дн. · Срок доставки, дн. · Условия · Примечание · Бланк 1-й страницы · Бланк 2-й и следующих · ⇩ Скачать PDF · Отменить КП · Статус · № КП · Сумма
- **Заголовки/подсказки:** PNG или JPG до 5 МБ, размер страницы А4 · Убрать строку · КП
- **API:** `/offers/backgrounds` `/offers`

### sections/ops.js

- **Кнопки:** Принять…
- **API:** `/supply/requests`

### sections/order-design.js

- **Кнопки:** Передать выбранные
- **Заголовки/подсказки:** Открыть задачу проектирования · Доска проектирования с этим заказом
- **API:** `/design-tasks` `/design-tasks/from-order`

### sections/order-issue.js

- **API:** `/stock/reservations/order` `/stock/reservations/issue-order` `/stock/batch`

### sections/order-line-actions.js

- **Заголовки/подсказки:** Позицию нельзя отменить · Отменить позицию · Позицию нельзя перенести · Перенести в другой договор · Перенести в другой заказ · Вернуть на прежний этап
- **API:** `/salesorders` `/incomes` `/salesorders/lookup` `/production-orders`

### sections/order-lines.js

- **Кнопки:** Подобрать изделие · Новое изделие · Это услуга
- **Подписи:** Изделие из «Продукции» · Новое изделие (нет в «Продукции») · Услуга (доставка, монтаж) · Что добавляем · Услуга
- **Заголовки/подсказки:** Услуга: в производство не идёт · Заявка ушла проектировщику. Пока изделие не подтверждено, «В производство» недоступно. · Позиция не связана с изделием и не услуга: распределите её ниже. · Позиции без изделия и не услуги. Пока они есть, «В производство» недоступно. · Это услуга · Найти изделие в «Продукции» и связать с позицией · Изделия ещё нет: проектировщик получит заявку · Доставка или монтаж — изделие не нужно
- **API:** `/dicts/worktypes` `/incomes` `/product-requests`

### sections/order-passports.js

- **Кнопки:** + Паспорта на весь заказ · ⇩ PDF пакетом
- **Заголовки/подсказки:** Черновики по всем позициям заказа, где выбрано изделие · Все выпущенные паспорта этого заказа — PDF в одном архиве
- **API:** `/salesorders`

### sections/order-reservations.js

- **Кнопки:** Выдать по заказу… · Изменить
- **Заголовки/подсказки:** Осталось в брони
- **API:** `/stock/reservations/order` `/stock/reservations`

### sections/order-shipments.js

- **Кнопки:** Накладная · Отмена
- **Заголовки/подсказки:** Отгрузок пока нет · Событий нет · Отгружать нечего · Отгружать пока нечего · Отгрузка
- **API:** `/salesorders` `/shipments`

### sections/order-stage.js

- **Подписи:** Проектирование · Производство · Готово к отгрузке · Частично отгружен · Отгружен · Закрыт · Отменён

### sections/order-work.js

- **Кнопки:** Запустить выбранные
- **Заголовки/подсказки:** Открыть карточку в работе · Доска «В работе» с этим заказом
- **API:** `/work-tasks` `/work-tasks/launch`

### sections/orders.js

- **Кнопки:** + Оплата
- **Подписи:** Не отгружено · Ждём оплату · Частично оплачено · Без суммы · Оплачено · Отгружен · Цена за единицу, ₽ · или сумма целиком, ₽ · Дата · Сумма, ₽ · Способ · Статус · Все компании · С даты · По дату · Заказ · Заказчик · Название · Кол-во · Сумма · Отгрузка · Оплата · Наша компания · Вписать сумму · Отгрузить · Принять оплату · Отменить оплату · Отгрузить сегодня · Паспорт → · № договора (если без карточки заказа) · Изделие из «Продукции» · Количество · Ед. изм. · Цена за ед., ₽ · Доход вручную, ₽ · Форма оплаты · Дата отгрузки · Дата оплаты · Вид · Цвет · Размер · Примечание
- **Заголовки/подсказки:** Выбрать изделие · Вписать сумму · Принять оплату · Удалить платёж · Позиции заказов · Вписать цену или сумму · Принять оплату: сумма по умолчанию — весь долг · Цена за единицу или сумма строки · Цена или сумма строки · Отгрузили сегодня · Сумма, оплачено и долг по всем позициям списка — с учётом вкладки, поиска и фильтров, по всем страницам · Связать позицию с изделием из «Продукции» — для паспорта и единого названия · Паспорта по заказу · Долги
- **API:** `/showcase` `/incomes/lookups` `/incomes` `/salesorders`

### sections/partners.js

- **Кнопки:** Показать · выберите файл
- **Подписи:** Кто · Поставщики · Заказчики · Наши компании · Название · ИНН · Записей · Сумма · Последняя · Контакты · Объединить с… · Новая заявка этому поставщику · Загрузить прайс из Excel · Тип контрагента · Поставщик · Заказчик · Наша компания · Полное наименование (в документах) · КПП · Адрес · Телефон · Почта · Сайт · Контактное лицо · Телефон контакта · Банк · БИК · Расчётный счёт · Корр. счёт · Примечание · Директор (Фамилия И. О. — в подписи талона) · Торговая марка (на титуле паспорта)
- **Заголовки/подсказки:** Объединить « · Так выглядит на талоне; клетка — прозрачные места · Перетащите файл, вставьте Ctrl+V или нажмите · Контрагенты
- **API:** `/partners` `/organizations`

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

- **Подписи:** Статус · Черновики · Выпущенные · Аннулированные · Фильтр · Неполные · Без картинок · Категория · Год · Месяц · Поставщик · Заказчик · ⇩ PDF пакетом · Дата · Название · Талон · Заполнено · Выпустить · ⇩ PDF — нет категории · Новая редакция · Аннулировать… · Изменить номер… · Выбрать категорию · Привязать к изделию · Создать изделие из паспорта · Создать копию
- **Заголовки/подсказки:** Паспорта · Категория паспорта не совпадает с категорией изделия · Текст изменён вручную, не из справочника · Все паспорта по текущим фильтрам — PDF в одном архиве (до 200) · Не хватает: · Присвоить номер и талон; текст будет заморожен · Изменить выпущенный паспорт: номер тот же, редакция +1, прежняя — в истории · Номер останется занятым и повторно не выдаётся · Без категории PDF упрощённый — с категорией текст соберётся по справочникам · Изделие в «Продукции» с данными этого паспорта; паспорта той же модели привяжутся к нему · Новый паспорт на ту же модель: новые номера, дата — сегодня
- **API:** `/passports` `/passports/bulk` `/passports/bulk/restore` `/showcase/from-passports`

### sections/payroll.js

- **Кнопки:** + Выплата
- **Подписи:** Сотрудник · Наша компания (платит) · Вид · Дата · Сумма, ₽ на руки
- **Заголовки/подсказки:** Выплата сотруднику · Следующий месяц · Предыдущий месяц · Нужна для календаря: чья это зарплата · Удалить выплату
- **API:** `/payroll/summary` `/payroll/payments` `/payroll/timesheet` `/payroll/people`

### sections/pipe-grid.js

- **Кнопки:** Журнал движений
- **Заголовки/подсказки:** Отложено под бронь
- **API:** `/stock/items` `/stock/batch` `/stock/reservations`

### sections/products.js

- **Кнопки:** Все изделия · Весь раздел → · Все изделия списком
- **Подписи:** Взять из состава · Тип оборудования · Группа изделий · Название серии · Открыть справочник серий · Статус · Черновик · В продаже · Архив · Цена, ₽ — одна для всех · Кто проектировал · Ед. изм. · RAL · Цвета (варианты) · Размеры (варианты) · Паспорт по умолчанию: категория · Паспорт по умолчанию: срок службы, лет · Паспорт по умолчанию: гарантия, мес. · Раздел · Группа · Подгруппа · Серия · В КП · Черновики (нет цены) · Загрузить каталог… · Из заказов… · Из паспортов… · Артикул · Название · Тип · Группа · Цена · Изменить состав · Заказы с этим изделием · Печать паспорта · Техническое описание · Паспорт → · Присвоить артикул группы · Клонировать · Фото изделия · Короткое название · Цена, ₽ · Себестоимость материалов · Категория паспорта · Тексты паспорта — выбор (монтаж, назначение…) · Гарантия, мес. · Срок службы, лет · Способ установки · Функциональные элементы · Поставляется разобранным · Нет · Да — нужна схема сборки · Длина · Ширина · Высота · Ед. изм. габаритов · Вес, кг · Материалы изделия · Назначение · Монтаж · Описание · Название в договоре · Примечание
- **Заголовки/подсказки:** Строки по материалам «Состава изделия»: труба 89×3 → Труба стальная ∅89×3 · Проверено — убрать пометку · Раздел → серия · Продукция · Нет цены — изделие в черновиках · Собранное коммерческое предложение · Импорт · Добавить в коммерческое предложение · Скопировать фото из паспорта в карточку изделия — станет «своим» · Последний выпущенный паспорт этого изделия: PDF и печать · PDF для заказчика: фото, части, материалы и допуски · Список паспортов этого изделия · Новый артикул по номеру группы изделия (например 34 → 3411) · Копия со всеми полями, фото и настройками паспорта — потом поправьте название, размеры и артикул · Варианты
- **API:** `/showcase/form-values` `/passports/phrases` `/showcase` `/dicts/persons` `/dicts/passportCategories` `/showcase/groups` `/showcase/bulk` `/showcase/bulk/restore` `/passports`

### sections/profile.js

- **Кнопки:** Загрузить своё фото
- **Подписи:** Обычный · Крупный
- **Заголовки/подсказки:** Мой профиль
- **API:** `/auth/me` `/photos/upload`

### sections/request-fill.js

- **API:** `/partners` `/materials` `/supply/catalog/items`

### sections/request-step.js

- **Подписи:** Поставщик · Количество · Ед. изм. · № счёта · Дата счёта · Сумма счёта · Сумма счёта, ₽ · Наша компания
- **Заголовки/подсказки:** Подставить поставщика · Следующий шаг · Заказал у поставщика
- **API:** `/incomes/lookups` `/materials` `/partners` `/supply/requests` `/supply/invoices`

### sections/requests.js

- **Подписи:** Куда пошло · Объект СМР · Поставить на склад? · Да, на склад · Нет, сразу в работу · Название · Артикул · Количество · Ед. изм. · Приоритет · Категория · Цвет · Ссылка на товар · Доставка · Фото · Примечание · Статус · Поставщик · Сумма с НДС, ₽ · Наша компания · Тип счёта · № счёта · Дата счёта · Куда (направление затрат) · Объект СМР / уточнение · Под заказ (позиция) · Заказчик · Кто подал · Дата заявки · Заявки из таблицы · Счёт без заявок · С даты · По дату · По заказу · Дата · Кол-во · Счёт · Заказ · Сумма · Заказал у поставщика · Принять на склад · Сменить статус…
- **Заголовки/подсказки:** Принять заявку · Сменить статус · Заявки · Скопировать строки из Excel / корзины сайта — заявки на все позиции сразу · Счёт, которого не было в заявках: внести уже оплаченный или полученный счёт со всеми позициями · Сумма всех заявок в списке — с учётом вкладки, поиска и фильтров, по всем страницам · Принять на склад · Статус → « · Текущая цена в каталоге поставщика — заявка не меняется
- **API:** `/partners` `/supply/requests` `/supply/requests/lookup`

### sections/reservation-edit.js

- **Заголовки/подсказки:** Бронь
- **API:** `/stock/reservations`

### sections/reservations.js

- **Кнопки:** Изменить · Выдать
- **Заголовки/подсказки:** Заказ закрыт или отгружен, а материал всё ещё в брони
- **API:** `/stock/batch` `/stock/reservations/group` `/stock/reservations`

### sections/salesorders-matching.js

- **Кнопки:** Подтвердить · Выбрать другое изделие · Весь договор
- **Подписи:** Подтверждено · Не изделие · Сопоставлено раньше · Подобрано, ждёт подтверждения · Не сопоставлено
- **Заголовки/подсказки:** Сопоставление
- **API:** `/showcase` `/matching/confirm` `/matching/none` `/matching/suggest` `/matching/bulk`

### sections/salesorders-next.js

- **Подписи:** Открыть заказ · Распределить · В проектирование · В производство · Заявки · Работа · Готов к отгрузке · Отгрузка · Завершить заказ

### sections/salesorders-unassigned.js

- **Кнопки:** Выбрать всех этого заказчика · Показать ещё · Сопоставить · Перейти к сопоставлению · Договоры без заказа
- **Подписи:** №
- **Заголовки/подсказки:** Сопоставить позиции договора с изделиями
- **API:** `/production-orders/unassigned` `/production-orders/assign` `/production-orders`

### sections/salesorders.js

- **Кнопки:** Отметить: готов к отгрузке · Изменить договор · + Позиция · + Заявка под этот заказ · + Договор · + Заказ
- **Подписи:** Отгрузить · Загрузить спецификацию из Excel · Перенести в другой заказ · Вернуть на прежний этап… · Удалить договор · Вернуть позицию · Отменить позицию · Перенести в другой договор · Выбрать из договоров без заказа · Создать новый · Статус · Новые · В работе · Отгруженные · Завершённые · Все · Срок · Просрочено · № заказа · Договоры · Заказчик · Наша компания · Поз. · Сумма · Приоритет · Этап · Изменить заказ · Срок (дата отгрузки) · Отменить договор с заказчиком · Связать с каталогом · № договора · Предмет заказа · Форма оплаты · Срок изготовления · Дата отгрузки · Окончание поставки · № госконтракта · Дата контракта · Примечание · Заказ (выполнен или удалён)
- **Заголовки/подсказки:** Связать с каталогом · Выдано минус возвращено · Позиция отменена: · Ещё: · Изменить договор: № договора, заказчик, срок, примечание · Отменить или перенести позицию · Принять оплату по этой позиции · Открыть позицию: фото, сумма, отгрузка, оплата (назад — к заказу) · Сопоставить позиции договора с изделиями · Новая позиция: все поля — в правой панели · Новая заявка: заказ и заказчик подставятся сами · Добавить договор в этот заказ · Все проверки пройдены, изготовленное готово — можно отметить «Готово к отгрузке» · У договоров заказа разные этапы — показан самый отстающий · Заказы · Новый заказ (договор): № заказа можно взять существующий — договоры объединятся в один заказ · № заказа, срок и приоритет — сразу у всех договоров заказа · Изменить заказ · Договор с заказчиком · Связать позиции заказчика с нашими изделиями — для паспорта и производства. Договор не меняется.
- **API:** `/salesorders` `/salesorders/next-production-no` `/production-orders` `/passports`

### sections/sheet-grid.js

- **Кнопки:** Журнал движений
- **API:** `/stock/batch` `/stock/items` `/stock/reservations`

### sections/staff.js

- **Кнопки:** Назначить:
- **Заголовки/подсказки:** Сотрудник · Зона
- **API:** `/staff` `/staff/from-login` `/zones` `/staff/logins`

### sections/stock-ops-res.js

- **Кнопки:** Изменить
- **API:** `/stock/reservations` `/stock/items` `/stock/reservations/issue` `/stock/batch`

### sections/stock-ops.js

- **Кнопки:** + Принять без счёта
- **Заголовки/подсказки:** Принять на склад · Выдать со склада · Забронировать · Списать · Выдать из брони · Снять бронь · Пересчитать · Убрать из списка · Берёт все позиции, которые сейчас видны в списке с учётом поиска и фильтров · Склад
- **API:** `/stock/reservations` `/stock/categories` `/stock/items` `/dicts/writeOffReasons` `/stock/reserve-list` `/stock/reservations/group` `/supply/requests` `/stock/batch`

### sections/stock-passport.js

- **API:** `/materials` `/dicts/passportMaterials`

### sections/stock.js

- **Кнопки:** Принять на склад
- **Подписи:** Бронь по списку · Пересчёт · Движения · Состояние · В наличии · Нет на складе · Требуют внимания · Ниже минимума · Ждут поставку · В брони · В норме · Категория · + Принять · Выдать · Забронировать · Название · Остаток · Ед. изм. · Свободно · Мин. · Выдать из брони · − Выдать · Списать (брак, потеря) · Забронировать под заказ · Снять бронь · Пересчитать (сколько лежит) · Отложить обрезок… · Заказать (новая заявка) · Короткое название · Длинное название · Название в счёте · Артикул (поставщика) · Количество · Вес 1 шт., г · Фото · Примечание · Минимальный остаток
- **Заголовки/подсказки:** Журнал движений позиции — там можно отменить ошибочное · Склад · Поступление на склад · Выдать из брони · Забронировать под заказ · Категории · Открытые заявки на позицию · Отложено под заказы. Снять — откройте позицию, кнопка «Снять бронь» · Заказ уже отгружен, закрыт или аннулирован, а материал всё ещё в брони. Откройте позицию, кнопка «Снять бронь» · Количество и объект — из брони · Кому и под что выдано — в правой панели · Причина из списка
- **API:** `/stock/items` `/stock/categories`

### sections/supplier-catalog.js

- **Кнопки:** Сбросить · Все списком · ← Все категории · ⇩ Шаблон Excel · Связать
- **Подписи:** Категория · Подкатегория · Поставщик · Без категории · ⇩ Шаблон Excel · Загрузить Excel… · Выгрузить в Excel · Поставщик (необязательно) · Файл Excel (.xlsx) · Артикул поставщика · Название у поставщика · Наш материал · Ед. изм. · Цена, ₽ · Дата цены · Остаток · Цвет · Группа · Примечание
- **Заголовки/подсказки:** Категория · Шаблон, загрузка и выгрузка Excel · Загрузить прайс из Excel · Каталог поставщиков · Не связана с позицией склада · Цене больше 6 месяцев
- **API:** `/supply/catalog/counts` `/partners` `/supply/catalog/items` `/supply/suppliers` `/supply/catalog/import` `/stock/items`

### sections/warehouse-mobile.js

- **Подписи:** Принять на склад · Выдать · Списать · Пересчёт
- **API:** `/supply/requests` `/stock/items` `/stock/movements`

### sections/work-route.js

- **Кнопки:** Сохранить
- **Заголовки/подсказки:** Выше · Ниже · Убрать шаг · Виды работ из модулей изделия
- **API:** `/dicts/worktypes` `/work-routes`

### sections/work.js

- **Кнопки:** Показать всех сотрудников
- **Подписи:** Ждёт запуска · В работе · Готово · Отменена · Статус · Открытые · Все · Все исполнители · Все заказы · Код · Изделие · Где сейчас · Срок · Исполнитель · Вернуть в работу · Взять в работу · Следующий шаг: · Вернуть в ожидание · Отменить…
- **Заголовки/подсказки:** Срок взят из заказа · В работе · Вернуть на последний шаг маршрута · Начать с первого шага маршрута · Все работы сделаны
- **API:** `/work-tasks/people` `/work-tasks`

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

### ui/busy.js

- **Кнопки:** Повторить
- **Подписи:** Повторить

### ui/card.js

- **Кнопки:** Убрать фото · Изменить · Дублировать · Удалить · Закрыть
- **Подписи:** Ширина правой панели
- **Заголовки/подсказки:** Убрать это фото из карточки · Закрыть панель · Ещё · Открыть корзину: там запись можно вернуть · Открыть правку с прежними значениями этих полей — проверьте и сохраните
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
- **Подписи:** Изменить срок и приоритет… · Задать вопрос менеджеру… · Добавить фото… · Открыть заказ · Открыть в «Заказах» · Копировать ссылку · Перенести в… · Удалить в корзину · Взять в работу · На распределение · Открыть · На распределение все позиции · Убрать из проектирования · Открыть договор · Убрать договор из проектирования
- **Заголовки/подсказки:** Кто проектирует? · Какие стикеры показывать на карточках · Срок и приоритет · Вопрос менеджеру · Изделия, которые ещё не взяты в проектирование · Открыть заказ справа · Открыть договор справа · Заказы, где всё спроектировано или задачи не поставлены
- **API:** `/design-board` `/design-tasks` `/photos/upload`

### ui/design-notes.js

- **Кнопки:** Отправить · Отмена · Удалить · Ответить · К вопросу
- **Заголовки/подсказки:** Ещё · Открыть фото · Без ответа:
- **API:** `/design-notes` `/design-tasks`

### ui/design-stickers.js

- **Заголовки/подсказки:** Открыть фото · Убрать фото
- **API:** `/design-stickers` `/design-tasks`

### ui/dict-options.js

- **API:** `/dicts`

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

### ui/gantt.js

- **Кнопки:** Сегодня
- **Подписи:** День · Неделя · Месяц · По заказам · По исполнителям
- **Заголовки/подсказки:** Показать сегодняшний день · Сегодня, · Срок:

### ui/list.js

- **Кнопки:** Ещё ▾ · Выбрать · + · Фильтры · Показать · Показать все · Сбросить всё
- **Подписи:** ⇩ Excel · Ширина панели фильтров
- **Заголовки/подсказки:** Остальные действия · Отметить несколько строк и изменить их разом (на ПК — Ctrl+клик, на телефоне — долгое нажатие) · Клавиша N · Сбросить выбор · Отметить

### ui/materials-spec.js

- **Кнопки:** Сохранить в справочник · Не надо · + Строка
- **Подписи:** Размеры · Из чего · Покрытие
- **Заголовки/подсказки:** Убрать строку · Оставить только в этой строке · Добавить строки таблицы другого изделия · Подставить строки шаблона категории изделия · Запомнить текущую таблицу как шаблон для всех изделий этой категории
- **API:** `/dicts` `/dicts/passportSortament` `/dicts/passportParts` `/showcase/materials-text` `/showcase` `/passports/template`

### ui/photos.js

- **Кнопки:** Выбрать файл
- **Заголовки/подсказки:** Можно вставить скриншот: Ctrl+V · Открыть PDF · Открыть фото · Убрать фото
- **API:** `/photos/upload`

### ui/phrases.js

- **Кнопки:** ▾

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

### core/live-sync.js

- **API:** `/me/versions`

### core/orders-lookup.js

- **API:** `/salesorders/lookup`

### core/prefs.js

- **API:** `/auth/me/prefs`

### core/stock-list.js

- **API:** `/stock/items` `/stock/lookup`

### main.js

- **Кнопки:** Войти
- **Подписи:** Установить на телефон · Поиск по всему · Ширина меню · Администрирование · CRM · Выйти · Мой профиль · Тема:
- **Заголовки/подсказки:** Установить на телефон · Работа с сайтом: с чего начать · Настройки · Данные · Система · Приложение · История
- **API:** `/me/counters` `/auth/me`
