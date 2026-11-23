# C240 — целевой локальный прогон frontend

Среда: изолированные fake HTTP origins `c240.test` и DOM формы роли, реальные модули PWA/admin и заполненные обезличенные позиции. Производственные API не вызываются.

| Вход | Действие | Ожидается |
|---|---|---|
| director + stock, без stockViews | Открыть pipe и sheet из меню/URL | Оба grid readOnly; количество, бронь и примечание видны |
| director + stockViews=[] или без stock | Проверить меню, URL и canFollow | Доступ не расширяется |
| readOnly grid | Программные input/change/focus/blur и Enter/Tab/ArrowDown | Нет write handlers на полях и нет POST/PATCH |
| readOnly view + stockop/new/open/bulkedit/profile+open | Прямая ссылка | Панели изменения закрыты; обычный profile без open/new разрешён |
| native pipe/sheet, owner/admin | Количество/примечание/пустая ячейка | Старые count/create/note сохраняются |
| Роль inherit/custom/[] и create/update | Получить реальный roleBody | create inherit omit; update inherit reset:true без stockViews; custom точный массив |
| View-as admin→director | Применить роль и обновить [] | Настройка admin не протекает, [] не превращается в inheritance |

Команды: `node --test backend/pwa/core/c240-stock-views.test.mjs backend/pwa/core/c189-route-access.test.mjs backend/admin/c240-role-stock-views.test.mjs backend/pwa/sections/c240-stock-grids.test.mjs backend/pwa/sections/wood-grid.test.mjs`.
Для снимков: переменная `C240_PROOF_DIR=docs/crew/C240-director-stock-screens/evidence/fixture`; два browser-файла сохраняют заполненные состояния.
Остановка: любая неожиданная mutation, пропуск native/edit/admin сценария, ошибка страницы, расхождение формы/route matrix. Лог/снимки — C240; отсутствие реальной stand-проверки не объявлять PASS её сценариев.
