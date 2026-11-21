Статус: новый код после releasea96e708d; source freeze для адресного QA, ещё НЕ выложен.
✅ bindPresentation больше не возвращает name из income.title: manualname сохраняется через bound GET/issue/PATCH.
✅ Автоматические createDraftsForOrder/orderIssue/orderHost не передают line.title как dto.name; productPatch.name остаётся источником.
✅ createPresentation не объявляет автоматическое имя позиции ручным. Legacy явный dto.name и standalone без productId сохранены.
✅ Issued при чтении не обновляется, миграций/продовых записей нет. C170 selection/attachment/epoch guards не менялись.
Файлы runtime: passport-bind.ts; passport-order.ts; product-passport.service.ts (узкие create/order-host ветви).
Unit: passport-presentation.spec.ts (binding не содержит name), passport-order.spec.ts и passport-draft-all.spec.ts (auto title не передаётся).
RealMongo: test/e2e/c178-passport-name-source.e2e-spec.ts —6кейсов: short/full источник/rename/issue/PDF/freeze; manualname+actor/user403/history/oldPDF; обе orderbatch ветви; standalone.
Проверки: tsc/eslint0; moduleunit79/818 PASS; targeted12 у QA ожидается; отдельный полный прогон обязателен перед новым release.
Риски: старые manualname автоматически не мигрируются; адресная печать20-26 готовится access по отдельному разрешению.
Якоря: passport-bind.ts:65; passport-order.ts:240; product-passport.service.ts:426/468/487; коммит: не выполнялся; карта обновлена.
