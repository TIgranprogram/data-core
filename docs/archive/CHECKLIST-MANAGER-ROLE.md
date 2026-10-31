# Чек-лист: роль «Менеджер» и деньги

Решение: вариант (а) — менеджер видит и пишет суммы снабжения и заказов; ФОТ и «Старт учёта» закрыты.

## Backend
- [ ] common/roles-hierarchy.ts:75 — добавить 'manager' в MONEY_ROLES (снимает маску MoneyMask и открывает суммы/оплаты в ответах и запросах). Поправить комментарии :5, :90 и roles-hierarchy.spec.ts.
- [ ] supply/supply.controller.ts:76 — `/invoices/:id/pay`: добавить 'manager'.
- [ ] finance/finance.controller.ts:17,27,35,59 — cashflow, summary, forecast, needs-fill: добавить 'manager'. :45 (settings) оставить.
- [ ] payroll/payroll.controller.ts (@Roles admin, accountant) и dicts/dicts.controller.ts:12-13 — ФОТ и salaryRate: отдельная проверка `canSeePayroll` (admin, director, accountant, owner), а не «раздел открыт». Иначе менеджер с галочкой «ФОТ» увидит ставки через /dicts/persons.
- [ ] money-mask.interceptor.ts — для менеджера: salaryRate по-прежнему удалять.
- [ ] Тесты: money-mask.interceptor.spec.ts, roles-hierarchy.spec.ts, e2e app-sections.

## PWA
- [ ] pwa/core/api.js:22 — canMoney: добавить 'manager'; новый геттер canPayroll (без manager).
- [ ] pwa/main.js:360, pwa/sections/payroll.js:23 — canMoney → canPayroll. main.js:198 группа «Деньги» остаётся по canMoney; пункт ФОТ — по canPayroll.
- [ ] pwa/sections/dicts.js:102 (salaryRate) — canPayroll.
- [ ] pwa/sections/request-step.js:130,160,242 и invoice.js — кнопка «Оплачен» доступна менеджеру (после правки сервера).
- [ ] pwa/sections/products.js:135,361,463 — себестоимость: решить, показывать ли менеджеру.

## Admin
- [ ] admin/admin.js:82 — подпись: «Менеджер — заявки, счета, склад, заказы и деньги снабжения; ФОТ закрыт».
- [ ] admin/admin.js:83 — бухгалтер: «всё, что у менеджера, плюс ФОТ и управление финансами».
- [ ] Галочка «ФОТ» у менеджера — снять.

## Проверка после правок
- [ ] Менеджер: создать заявку с суммой, исправить сумму; счёт: №, дата, сумма, «выставлен», «оплачен»; поставщик и каталог; позиции заказа: сумма и оплата; календарь открывается.
- [ ] Менеджер: ФОТ — нет пункта, /api/payroll = 403, ставка в справочнике «Сотрудники» не видна.
- [ ] Наблюдатель: суммы по-прежнему скрыты.
- [ ] tsc, jest, e2e; обновить docs/MAP.md и docs/openapi.json (@Roles).
