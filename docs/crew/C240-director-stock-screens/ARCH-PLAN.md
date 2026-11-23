# C240 — доступные экраны склада без совмещения базовых ролей

Вердикт: **можно**, небольшой сквозной класс L (backend projection + frontend), без новых сущностей, серверной ACL-модели или массива базовых ролей. Одна основная роль сохраняется; существующий union permissions не переписывать.

## Принятое значение просмотра

Дополнительные экраны открываются **только для чтения в интерфейсе**. Директор уже наследует manager (`roles-hierarchy.ts:15`), а мутации stock защищены `@Roles(admin,manager)`; прежние права API директора не отзываются и не расширяются. Запрет записи по прямому API этим изменением **не обещается**. Настройка экранов не выдаёт приёмку, пересчёт, списание или CRUD ролей. Это уточнение подтверждено координатором.

## Контракт

1. В `Role` добавить optional `stockViews?: ('pipe'|'sheet')[]`, без default. Это список **дополнительных экранов**, информационная настройка вида. Новый permission key и изменение PERMISSIONS/PermissionsGuard не нужны.
2. Отсутствующее поле — наследовать: baseRole director → pipe+sheet; остальные → без дополнительных экранов. `[]` — явно отключить дополнительные экраны. Владелец/admin сохраняют прежний доступ ко всем экранам, включая wood; существующие рабочие roleLabel сохраняют собственный экран независимо от дополнительного списка.
3. В `/auth/me` и login.user добавить optional `stockViews?: string[]` с вычисленным эффективным списком; старые клиенты игнорируют добавление. Наличие конфигурации не меняет sections/baseRole/permissions/canMoney/isOwner. При старом профиле без поля frontend применяет тот же безопасный fallback по baseRole.
4. Дополнительный экран доступен только при уже доступном разделе stock. Рабочие roleLabel-ограничения собственного экрана имеют приоритет: дополнительный список не позволяет рабочему выйти из прежнего рабочего контура/warehouseIds/stockCategoryIds. Не давать director shortcut мимо `canOpen(stock)`.
5. Режим редактирования: admin/owner — прежний; рабочая роль на своём native экране — прежний; любой дополнительный pipe/sheet для остальных — readOnly. Не использовать session.canEdit как разрешение записи в таком экране.

## Точные зоны исполнения

**Backend scope:** `modules/role/role.schema.ts`, `dto/create-role.dto.ts` (update наследует PartialType); `modules/auth/dto/auth-response.dto.ts`, `auth.service.ts`; при необходимости маленький чистый resolver в `common/stock-views.ts`, без нового cache/guard. RoleService уже сохраняет DTO через присваивание: менять только если точный diff докажет необходимость. Свои schema/DTO/auth/resolver tests рядом. API ответа дополнить совместимо, обновить затронутые MAP/data-model/openapi по навыку verify/docs-sync.

DTO допускает только pipe/sheet, unique, максимум2; unknown/null не превращать в выдачу всех экранов. Сохранение роли с изменением одного stockViews не должно менять money/permissions/baseRole/sections/складские ограничения. Редактирование настроек — существующим маршрутом роли с его прежними guards; owner-only `/admin/roles` и `/admin/permissions` не менять и не обходить.

**Frontend scope:** `core/route-access.js`, `main.js`, `sections/pipe-grid.js`, `sheet-grid.js`, существующая форма роли `admin/admin.js:1042–1135`, адресные route/grid tests. Один helper вычисляет доступность view и режим readOnly; его используют меню, direct URL, canFollow и выбор mount. Учесть `main.js:159,258,482–483`: изменения только canViewStock недостаточно, adminSees иначе не монтирует нужный grid.

ReadOnly передавать в mount явно. Для остатков/количества/примечаний отображать текст либо readonly controls **без write/blur/keyboard handlers**; не создавать пустые позиции, не инициировать POST count/items/PATCH notes даже синтетическим событием. Поиск/фильтры/журнал чтения остаются. Нативные рабочие grid/edit/admin сценарии сохраняются. Форма роли объясняет «По умолчанию» против явного списка/пустого списка; это не редактор дополнительных API-прав.

## Приёмка и регрессия

- Auth/DTO: builtin director, custom baseRole director, explicit [], pipe-only/sheet-only, user/manager defaults, unknown/duplicate/null; поле sections=без stock блокирует view, обновление /me применяет изменение.
- Frontend матрица меню/directURL/canFollow/mount едина; директор видит оба вида readonly, пользователь без view не видит/не открывает; worker pipe/sheet/wood и mobile-only не приобретают чужие экраны. Admin/owner сохраняют прежнее.
- Browser на данных: директор открывает оба grid; ввод/blur/Enter/Tab/синтетическое событие не порождают мутации. Readonly имя/qty/примечание видны. Рабочий на своей копии сохраняет прежнее редактирование; snapshot/screenshot доказательства в C240.
- Backend guard/scope регрессии: без новых grants, старые warehouse/category границы и owner-only403 сохраняются; прямое изменение API директором проверяется как **прежнее поведение**, не ошибочно ожидаемый deny. Проверить role update не расширяет область данных.
- После реализации backend — адресные auth/role/stock-scope/RBAC проверки и unit по правилам verify; релевантные e2e отделить от прежнего неизменённого C237 baseline109/884. Архитектор принимает точную дельту, QA — сценарии; вид — дизайнер.

Не выполнялись: код, новые тесты и любые записи на прод. Источники: C240/TZ, роль/DTO/auth projection, route-access/main/grid, stock controller/scope и существующий guards-контракт.
