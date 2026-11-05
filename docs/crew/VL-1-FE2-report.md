# ВЛ-1 FE-2 — отчёт frontend (2026-11-05)

Статус: готово, не закоммичено.
1. Окно «Скачать вложения заказа» ✅ — `pwa/sections/order-attachments-zip.js` (новый, ~90 строк): kit modal + kit empty + `tagPick` (kit/pick.js, метки вместо галочек: в kit нет фабрики checkbox, сырой input ловит L2); виды из `/dicts/attachmentTypes`; строка «N файлов, X МБ» из summary; «Скачать» → zip-ticket → ссылка `PREFIX+url`. Ошибки 413/429/403/нет связи — по-русски.
2. Кнопка в карточке заказа ✅ — `salesorders.js` card.actions: «Скачать вложения заказа» (видна и при завершённом заказе/ролях только на просмотр).
3. «Состояние» админки ✅ — `admin/admin.js` loadServer: строка «Вложения» (размер · файлов) и `attachmentsWarning` (srv-pct warn/danger).
Допущение: API работает по договору (`/salesorders/:id`), карточка — заказ с несколькими договорами; делается summary по каждому, итог суммируется, архивов столько же, сколько договоров с файлами (в окне это подписано). Браузер может спросить разрешение на несколько загрузок.
Проверки: `--input-type=module --check` 3 файла ok; pwa-import-check 0 ошибок; preload 78 модулей; design-lint — по моим файлам 0 новых (salesorders.js L8 >400 строк прежний); jest pwa-guards: 1 падение — design-lint по чужим файлам (stock-issue*.js, design-requests.js), не мои.
Риски: в живом браузере не проверено (глазами — не проверено); нужен `datacore-designer` перед выкладкой.
