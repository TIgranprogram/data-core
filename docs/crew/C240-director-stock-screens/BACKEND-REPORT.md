# C240 — backend

PASS: ✅ roles.stockViews optional pipe/sheet без default; нет поля → director наследует оба, [] → дополнительные экраны отключены.
✅ Create/PATCH отклоняют null, неизвестное, дубли и >2 значений; старые DTO-поля/guards/права не менялись.
✅ Только PATCH resetStockViews:true удаляет override через save/$unset; команда не хранится, false/null/create/reset+list →400, omit сохраняет override.
✅ login.user и /auth/me получают вычисленный список из свежей роли; sections/baseRole/money/permissions/owner/warehouse/category scope сохраняются. Новых БД-запросов/кэша:0.
Файлы: common/stock-views.ts; role schema/DTO/service; auth service/payload; четыре новых spec; MAP/data-model и карта backend.
Проверки: `npx jest src/common/stock-views.spec.ts src/modules/auth src/modules/role --runInBand --silent` — 12 наборов/177 тестов PASS, 6,679с.
`npx tsc --noEmit` exit0; ESLint common stock-views, role и изменённых auth файлов exit0.
Регрессии: builtin/custom director, [], pipe/sheet, повреждённый fallback; strict real ValidationPipe create/update; Mongoose hydrate/getChanges подтверждает $unset, неизменность остальных полей; login+/me и обновление настроек.
➖ OpenAPI-регенерация, full/e2e и браузерная проверка readonly — координатор/QA. Прод-учётки не менялись, коммит/деплой не выполнялись.
Якоря: common/stock-views.ts:6, auth.service.ts:349, role.service.ts:148/169, stock-views.reset.spec.ts:22; карта обновлена, коммит:36bdd4dc.
