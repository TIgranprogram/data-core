# C240 — проверка backend freeze

Вердикт: **PASS для backend-дельты**, frontend/итоговая приёмка отдельно. Код и прод не менялись.

Проверены `common/stock-views.ts`, role schema/CreateRoleDto/UpdateRoleDto/RoleService.update, auth service/payload и четыре адресных spec. В дельте нет изменений stock-guards, permissions/иерархии/owner-only маршрутов или области склада.

- Optional stockViews без default различает наследование и []; resolver default только baseRole director→pipe/sheet, повреждённая настройка fail-closed. Новых БД-запросов/кэша нет; auth получает свежую role из прежнего resolveForAuth.
- Create/PATCH strict validation отклоняет null/неизвестные/дубли/>2; UpdateDTO исключил поле из PartialType, чтобы его IsOptional не пропускал null. Additive поле auth не заменяет sections/baseRole/permissions/money/isOwner/warehouse/category scope.
- Reset только true в UpdateDTO, взаимное исключение со stockViews проверяется DTO и сервисом; команда удаляется из assignment, Mongooseundefined→$unset. Omit сохраняет explicit[]. Create-reset отвергается whitelist. Остальные поля роли не меняются reset-операцией.
- Независимо выполнено `npx jest src/common/stock-views.spec.ts src/modules/auth/stock-views.spec.ts src/modules/role/stock-views.dto.spec.ts src/modules/role/stock-views.reset.spec.ts --runInBand --silent`: **4 suites / 37 tests PASS**, exit0,3,445с. Более широкий177тестовый прогон — доказательство BACKEND-REPORT, не мой повтор.
- Общий контракт остаётся информационной настройкой UI. Директор сохраняет прежние серверные manager-права; readonly новых экранов обеспечивает frontend, серверный запрет записи этим кодом не заявляется.

До итогового PASS: принять frontend directURL-panel guard, classic role-stock-views module/index подключение и view-as/reset форму; адресная QA/e2e/визуальная приёмка и OpenAPI/docs verify по координатору. Одобрение этих двух frontend-стыков внесено в ARCH-PLAN.
