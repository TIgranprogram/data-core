# C246 — можно ли вынуть один модуль

**Вердикт: 2/5 (~40%).** Экран-лист выключается, домен рабочего места — нет. «Убрал модуль — система жива» для ядра не выполнено.

**Картина.** 72 модуля в `modules/`. Общее после АБЗ-1 лежит в `common/` (catalog, text). Публичных `index.ts` — 0. PWA и admin ходят по HTTP и Nest не импортируют; рушится граф `backend/src`. `node backend/scripts/audit-cycles.js -v`: **1** пара, не 0. `order-line-plan` ↔ `work`: тип в `task-bars.ts:45` (`work-task.schema`); обратно `work.module.ts:5`, `work.service.ts:11`.

**Тест.** Вынуть модуль и не чинить соседей. Чужая запись = `.collection().update/insert/delete` вне папки владельца.

| Домен | Импорт кода | Чужие записи | Если вынуть |
|---|---|---|---|
| stock | 5: supply, отмена income, today, fill-audit, seed | остатки, движения, брони, склады — 0 | supply и отмена позиции не соберутся |
| supply | 1: finance, приватные файлы `finance.service.ts:9–19` | `partners.service.ts:363–367` (4 коллекции), dicts — заявки | календарь не соберётся |
| finance | 1: today (сам лист, fan-in 0) | своей коллекции нет | гаснут календарь и «Сегодня», заказы живы |
| incomes | 7 модулей | 9 мест: partners, dicts, matching, passport, showcase, product-requests, order-archive | заказы, КП, снабжение, деньги не соберутся |
| salesorders | 3: design, offers, supply | 4: `partners.service.ts:390`, `dicts.defs.ts:305`, shipments, order-archive | то же ядро |
| passports | 6; печать тащит `fontDir` | dicts и showcase пишут `productpassports` | PDF заказов, КП, QR, отгрузок |
| product | **0** | **28** записей `products`, 11 в `showcase.service.ts` | HTTP гаснет, каталог остаётся у витрины |
| auth | guard + `user` (fan-in 7) | вход — ядро | гаснет каждый запрос; так и должно быть |

**Легко (ядро живо):** finance+today, offers, messages, my-tasks, devlog, material-requests, meta — fan-in 0. Больше трёх.
**Больно:** stock (фасад есть, `stock.service.ts` 129 строк, supply на нём сидит), supply, salesorders.
**Нельзя сейчас:** incomes (`ourCompanies` в `incomes.service.ts:47` тянут finance, expenses, payroll, supply, salesorders); паспорта (`product-passport.service.ts` 1859 строк); каталог (модуль снаружи пуст, данные пишет витрина, `showcase.service.ts:263`); auth.

**CRM.** `materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests` пишет ещё kppdf напрямую (ARCHITECTURE «Единая база»). Фасад в data-core это не останавливает. Внутри нашего кода склад — самый закрытый из семи. `materials` дополнительно правят dicts (5 update в `dicts.defs.ts`).

**АБЗ.** 1 сделан, одна пара вернулась. 2 сделан. 3 открыт — это ответ владельцу. 4 устарел (sheets-sync нет), фасадов нет. 5 склад разрезан; километр переехал: `supply.service.ts` 980, `supply-invoice.service.ts` 1038, паспорт 1859. 6 и 7 открыты. 7 рано, пока нет фасада. 8 не делать.

**Что делать.**
1. АБЗ-3 на `incomes`, `salesorders`, `products`: чужая запись только через сервис владельца. Склад не первый.
2. Вынести `ourCompanies`, `fontDir` и суммы счетов из частных файлов. finance не импортирует `supply/*.ts`.
3. Тип `ModuleWork` в `common`, цикл снять. Связь work → plan оставить односторонней.
4. АБЗ-7 после шагов 1–2. Папки не двигать. kppdf клиентом API — отдельное решение, не этот заход.

**Не проверено.** kppdf не открывался. Чтения шире записей (incomes 85, products 127, salesorders 77). `review-scope --done` не ставился: это аудит графа, не дельта кода. Код и прод не тронуты. Допущение: «замена» = модуль исчез, соседей не правят, остальной `tsc` жив.
