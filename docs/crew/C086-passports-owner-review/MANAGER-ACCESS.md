# C086 — доступ менеджера, 12.11.2026

Рабочие операции выделены в WORK (admin/director/manager); EDIT не расширен. Менеджеру доступны create/update/copy/issue, check/preview/pdf, план/выпуск/PDF заказа, draft-all, индивидуальный снимок текста и его пересборка, готовый PDF и файл печати, массовая правка экземпляров. Удаление, восстановление и аннулирование не расширены. Для менеджера getter remove возвращает null: «Удалить» скрыто; корзина проверяет наличие remove.restore и скрывает «Восстановить». Рабочее редактирование остаётся доступным.

PUT showcase/:id/passport-defaults теперь доступен manager. Именно здесь ownTexts сохраняет textOverrides через putDefaults; глобальный PUT passports/texts не вызывается. Размеры используют ранее разрешённый PATCH showcase/:id, рисунки — существующий product-photo API.

Общие template/texts, next-number, promoteSnapshotItem остались EDIT. Ранее выданные manager права оформления компании (look, подписи) сохранены по указанию координатора — новых прав там нет. Справочники не менялись.

PWA: отдельный canWorkPassport; common.canEdit не расширен. Обновлены gates fill, docs, docs-orders, docs-queue, order-passports, order-passport-plan, passports и wizard. В fill ссылка на редактирование общего текста проверяет прежний canEdit, индивидуальные тексты — рабочее право. AppSection на контроллерах сохранён.

Проверки:
- tsc --noEmit: PASS.
- passport-manager-access.spec.ts: 30/30 PASS — менеджер, отрицательный user, запреты общих настроек, закрытые разделы.
- showcase + product-passport + pwa-guards: 65 suites/893 tests PASS, один FAIL modulepreload (нет fill/model.js и traits.js после параллельных UI-правок); координатор уведомлён о генерации preload.
- pwa-import-check: 285 файлов, 0 ошибок.
- ESLint двух контроллеров и нового теста: PASS.

PARTIAL: HTTP e2e и сценарий менеджера в браузере в этой подзадаче не выполнялись; проверка guards использует реальные metadata контроллеров и реальные RolesGuard/AppSectionGuard. Новых путей и DTO нет. Коммит/выкладка не выполнялись.

Доводка: скрыты delete/restore для менеджера (passports.js getter remove, trash.js проверяет remove.restore). Штатный pwa-preload.mjs обновил backend/pwa/index.html: 151 модуль. Повтор только pwa-guards: 1 suite / 281 test PASS; pwa-import-check: 285 файлов, 0 ошибок. Остальные 893 теста повторно не запускались.
