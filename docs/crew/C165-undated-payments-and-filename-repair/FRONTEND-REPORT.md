# C165 — frontend
Статус: READY к адресной повторной UI-приёмке шапки; первый functional PASS, единственный designer P2 исправлен в HEADER-FIX.md; финальный PASS ещё не заявлен.
- ТЗ §3 ✅: общая правая форма подтверждения без даты и отдельного отзыва с основанием, вложениями, стабильным UID/телом и CAS409 без replay.
- ТЗ §2/3 ✅: дата при pending пустая, amount/payer зафиксированы из API, обычный POST /payments с date; правки финансов/unpay скрыты, приёмка доступна независимо.
- ТЗ §3 ✅: warning/сумма/основание и безопасные ссылки evidence.files в счёте (ARCH P2); invoices filter needsPaymentDate=1; board flags; отдельная группа invoicePaymentDate в #fill и очереди «Сегодня», открывается по invoiceId.
- Файлы: invoice-workspace{,-state,-forms,-api,.test}.js/mjs, invoices-tab.js, request-invoice-actions.js, request-step.js, requests.js, fill.js, atlas-data.js, help-guide-data.js, index.html (только preload).
- Проверки ✅: 57/57 invoice-workspace node runtime (+10 C165); 357/357 PWA guards; import-check 362 файлов/0 ошибок; module syntax 11 изменённых JS; design-lint новых 0 (общий legacy baseline 5986).
- Компоненты: существующие screenCard/section/buildForm/photoField/badge/table/enhanceSelect; новых CSS, kit-вариантов, маршрутов и зависимостей нет.
- Запросы: #fill/домашняя очередь для денежной роли теперь два GET параллельно вместо одного; карточка/факт сохраняет один POST + fresh GET. Actual сценарий: tools/logs/c165-ui-acceptance.mjs, root reviewed; UI-RUN-CHECKLIST.md, запуск только access после freeze.
- Нужно от coordinator/access/designer: UI-REVIEW.md, обе desktop темы, №24334 50076 ₽/СИЮ/Геленджик, пустая дата → reopen → один факт, фильтр/fill/board, 409 и scope; backend READY получен.
- Filename repair без нового UI (ТЗ §4); новый общий full QA после включения C163 выполняет координатор. Не коммитил и не выкладывал.
Карта обновлена: docs/roles/maps/frontend.md; урок: docs/roles/frontend.md.
