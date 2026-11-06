# C027 — отчёт backend

Статус: готово, не закоммичено. Проверки: `tsc` 0, eslint (модули) 0, jest целиком 2546/2547 (упал `pwa-guards.spec.ts:58` — зона frontend), `audit-cycles`: 1 пара `incomes <-> product-requests` (старая, не из C027). e2e не писались и не гонялись.

## Сделано (пункты A)
1. `modules/expense-articles/` — `articles-tree.ts` (дерево, `articleOfCategory`, `seedDocs`), сервис (сид при старте в пустую коллекцию + дозасев `payroll`; дерево через `DataVersionService.cached`), `GET /api/expense-articles` (`@Roles('user')`), `articles-seed.json` (с правкой «Аренда спецтехники»). Справочник `expenseArticles` (группа «Деньги»): `dicts.expense-articles.ts`, подключён в `dicts.defs.ts`, `dicts.meta.ts` (встроенная подстатья с `code` не удаляется), `DICT_UI`. usage/related/reassign по `supplyrequests`+`expenses`; статья с подстатьями не удаляется; «Заменить на…» — подстатья на подстатью, статья на статью.
2. `supplyrequests.articleId` (схема, `SupplyRequestDto`, `SupplyInput`, `toFields` с проверкой «только подстатья»); в ответе заявки `articleId`, `articleName`. Загрузка из Google-таблицы в этом репо отсутствует (`editedInApp` ставит каждая правка) — затирания нет. Копию схемы в kppdf не правил.
3. `modules/expenses/` — схема, DTO (русские сообщения), сервис, контроллер (`MoneyAccessGuard`, `@AppSection('money')`, роли admin/accountant/manager, аудит), мягкое удаление. `GET /expenses` отдаёт ещё `sum` по всему фильтру; `GET /:id` — тот же вид, что в списке. Индекс — в `scripts/ensure-indexes.js` (MODELS). Регистрация в `app.module.ts`.
4. `finance`: поля `Op` (`articleId`, `salesOrderId`, `source`); 4-й источник — прочие расходы; статья заявки = `articleId` → подстатья по `categoryIds` категории; строки снимка — по заявке, запасной путь `line.categoryId`; ФОТ → `payroll`; доходы — `orderId`, нет — по `orderNo`. `by-articles.ts` (`buildByArticles`, `opsOfCell`), маршруты `GET /finance/by-articles` и `/by-articles/ops`.
5. `needsFill` → новое поле `noArticle: { total, items[] }` (оплачено без статьи). Не входит в `total` (frontend показывает отдельной группой).
6. Spec: `by-articles.spec.ts`, `expense-articles.service.spec.ts`, `expenses.service.spec.ts`.
7. `docs/openapi.json` (пути правлены скриптом, не регенерировались), `docs/MAP.md`.

## Договорённости для frontend
- `by-articles/ops`: `articleId` = id подстатьи | id статьи (все подстатьи) | `none` | `income` | `expense` | `unallocated`; `month` необязателен.
- Справочники: в полях добавлены `refMatch` (фильтр списка выбора) и `multi` (множественный select по id: `categoryIds`, список вариантов в `dictInfo.refs.categories`, в строке — массив id и `categoryNames`). Универсального виджета в `pwa/sections/dicts.js` под `multi` нет — нужно от frontend (иначе поле категорий в справочнике не отобразится).
- Объект с несколькими годами: таблица всегда за один год.

## Риски
- Один `ops()` на год × фирма: считает на лету, без кэша (как календарь).
- Сид пишет в прод-БД при первом старте (только в пустую коллекцию `expensearticles`).
