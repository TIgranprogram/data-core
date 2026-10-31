# Аудит ролей и разделов «Рабочего места» — 2026-10-29 (только чтение кода, прод недоступен)

## Как устроено
- Роли: встроенные admin ⊃ director ⊃ accountant ⊃ manager ⊃ user (`common/roles-hierarchy.ts:13`); своя роль `r-…` = её `baseRole` (необязательное поле, `create-role.dto.ts:52`).
- Видимость меню: клиент `session.sees(id)` (`pwa/core/api.js:26`) по `user.sections`; `null` = всё видно. Дополнительно `main.js:193,196`: «Документация» только `canEdit`, группа «Деньги» только `canMoney`.
- Сервер: `RolesGuard` (иерархия) → `AppSectionGuard` (`common/guards/app-section.guard.ts:16`): роль с отмеченными разделами проходит, только если id маршрута есть в её списке. Алиасов нет.
- Фронт и сервер сверяются по `/auth/me` при старте (`main.js:443`) — устаревания меню нет.

## Таблица (R = встроенная роль без галочек разделов; S = своя роль с галочками)
| Раздел | R: admin/director/accountant/manager | R: user (наблюдатель) | S: роль с галочками |
|--|--|--|--|
| home | OK | OK | **403 главного**: `/today` помечен `@AppSection('home')` (`today.controller.ts:10`), а клиент считает «Сегодня» всегда видимым (`api.js:29`, галочка `home` есть в `app-sections.ts:8`). Не отмечено «Сегодня» → стартовый экран с ошибкой |
| requests | OK | OK (кнопок записи нет) | 403 вспом.: `GET /partners` (поставщики) только у `partners` (`partners.controller.ts:15,20`), зовут `request-fill.js:17` (catch→[] пустой выпадающий), `request-step.js:88` (без catch → ломает шаг «заказал у поставщика»), `lookups.js:20`. `/materials/:id/price-default|prices` только `stock` (`material.controller.ts` класс) → `request-fill.js:43-44`, `request-step.js:77,106` (catch→null, подсказки цен пропали молча) |
| suppliercatalog | OK; **лишняя/недостающая кнопка**: `canWrite` = только admin/manager (`supplier-catalog.js:22`), директору и бухгалтеру кнопки скрыты, хотя сервер пускает (иерархия) | OK (чтение) | пусто: `/partners` 403 → `supplier-catalog.js:40` catch→`{items:[]}` и результат кэшируется в `suppliersCache` на всю сессию — фильтр поставщиков пуст. `/stock/items` для привязки (`:244`) 403→ пусто молча |
| stock | OK | OK (записи нет) | OK; `/stock/items/:id/ordered` открыт для requests |
| salesorders | OK | OK | 403 вспом.: `/passports?salesOrderId` (`salesorders.js:167`, раздел `passports`) → в карточке «не удалось загрузить»; `/design-tasks` (`order-design.js:19`) → блок с ошибкой, но он скрыт при `!sees('design')` — OK. `POST /stock/reservations/issue-order` только `stock` |
| partners (в «Справочниках») | OK | OK | OK |
| products | OK | `/passports/phrases` и `/passports/:id` — только VIEW=admin/director/manager (`product-passport.controller.ts:14`) → 403, у `phrases` catch→{} (`products.js:39`) | `/passports*` нужен `passports`; `/materials/:id/composition` — `stock` |
| docs (паспорта) | OK: просмотр admin/director/manager; запись admin/director (`:15`), UI совпадает (`passports/common.js:46`) | пункт скрыт (`main.js:193`); `home.js:272` зовёт `/passports/queue` → 403, catch→pq, безвредно | **403 главного**: серверный раздел называется `passports`, клиентский `docs`; галочка только «Документация» (`docs`) → `/passports*` и `/showcase` (`docs.js:37`, раздел `products,passports,orders,salesorders`) дают 403. В обратную сторону (старая галочка `passports`) работает (`api.js:29`) |
| orders («Позиции и оплаты») | OK (admin/director/accountant: меню); manager не видит группу «Деньги», но `/incomes` открыт, суммы маскируются | то же | `/incomes/lookups` свободен — OK |
| money | admin/director/accountant OK; manager/user: меню нет; по ссылке `#money` — 403 на `/finance/*`, часть через catch→null (пусто) (`money.js:281,299`) | то же | OK |
| payroll | admin/director/accountant OK (`FEATURES.payroll`) | меню нет | OK |
| design | OK | OK | `/dicts/persons` свободен — OK |
| trash/search | OK | trash: пусто без кнопок; search: 403 по `/passports` молча убирает панель (`search.js:54`) | OK (источники фильтруются по `sees`) |
| fill / history | fill: `R:user`, OK; history кнопка только admin/director — совпадает с `/audit-logs/app` | — | — |

## Тихие 403 (пустые страницы)
- `supplier-catalog.js:40` + кэш пустого ответа (`:41`) — самое вредное.
- `requests.js:117` (`pastItems`: `/supply/requests` limit 2000 + catch→[] — подсказки новой заявки пустые при 403; ещё и тяжёлый запрос).
- `request-fill.js:17,43,44,78`, `request-step.js:77,106`, `money.js:281,299`, `home.js:272`, `search.js:54`.
- `core/stock-list.js:14` — запасной вариант `/stock/items?limit=10000` при 404 lookup (тяжело, правило скорости).

## Чек-лист исправлений
**S (backend)**
1. `today.controller.ts:10` — убрать `@AppSection('home')` (или `@AppSectionFree()`): «Сегодня» всегда доступно, сервис уже сам фильтрует разделы (`today.service.ts:35`).
2. `app-sections.ts` / `app-section.guard.ts` — `docs` ≡ `passports`: в `openSectionsFor`/`setRoleSections` добавлять `passports`, если отмечена `docs` (и наоборот). Один файл, тест в `app-section.guard.spec.ts`.
3. `partners.controller.ts:20,39` — `@AppSection('partners','requests','suppliercatalog','salesorders','passports','stock')` на `GET /partners` (поставщики нужны экранам заявок, каталога, паспортов).
4. `material.controller.ts` (`prices`, `price-default`, `where-used`) — `@AppSection('stock','requests')`.
**S (frontend)**
5. `supplier-catalog.js:22` — `canWrite` через `session.canEdit` (иерархия совпадает с сервером).
6. `supplier-catalog.js:40-41` — не кэшировать пустой ответ при ошибке.
7. `main.js:275` — не звать `/incomes` для ролей без `canMoney` (счётчик им некуда ставить).
**M**
8. Тихие catch (список выше): показывать «нет доступа к справочнику поставщиков» через `failBlock`/`toast`, а не пусто (frontend).
9. Админка ролей (`admin.js:707`): подсказка «Сегодня — всегда включено / Документация включает паспорта»; своя роль без `baseRole` не имеет прав на API — сделать `baseRole` обязательным (backend DTO + admin.js).
10. `salesorders.js:167` — карточку паспортов в заказе скрывать, если нет `docs`/`passports` (frontend); `products.js:39,352` — тоже для `user`.
11. Спека: тест «роль с галочками [stock] может: /today, /partners?type=supplier» (backend, jest).

## Не проверено
Живые роли и их галочки на проде (вход не проходит); `product-module`, `organization` подробно; точная сводка `@Roles` по `stock/reservations` (разбор декораторов автоматический, возможна ошибка в 1–2 строках); e2e не запускались.
