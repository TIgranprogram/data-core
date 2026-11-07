# ТЗ ROLES-FIX — починка доступов ролей (C020)

> Источник: `docs/crew/C020-roles-access-audit/FINDINGS.md`, цель — `TARGET-ROLES.md`.

**Зачем:** убрать лишние деньги/меню/запись у ролей; директору и наблюдателю — разумные разделы. Точечно, без перелогина под каждой ролью.

**Класс:** L · **Max agents:** 3 (backend, access на прод, qa) · **Reviewers:** qa ☑ · designer ☐ · **Max review loops:** 2 · **Проверки:** smoke; full перед выкладкой кода  
**Приёмка:** глазами после выкладки / VIEW-AS позже — чек-лист C020

## Shared pack — допущения (не спрашивать)
1. Проектировщик: только проектирование + продукция + документация; **money: false**.
2. Трубарез / Лазер: **money: false**; разделы без изменений (stock).
3. Директор: добавить **work**, **offers**, **docs** (passports уже был).
4. Бухгалтер: убрать stock, products, passports из меню.
5. Менеджер: убрать **payroll** из appSections.
6. Наблюдатель: явные home, salesorders, products, partners.
7. Подписи: admin→Администратор, user→Наблюдатель; label кладовщику плит.
8. Код: `stock-mobile` **не** открывает запись всех заявок; GET списка + POST receive — да; `sees()` не показывает «Склад (телефон)» только из галочки «Остатки».

## Параллельные работы — не трогать
- `pult/**` (чужой чат)
- `docs/roles/tz/VIEW-AS.md`, `docs/crew/C019-*` (другой чат)
- `backend/src/modules/incomes/**` если снова в работе
- Никогда `git add -A`

## Волна A — данные прода (`datacore-access`, запись разрешена координатором)
1. `GET /api/roles` → id каждой роли.
2. `PATCH /api/roles/:id` по `TARGET-ROLES.md` (label, money, appSections). warehouseIds/baseRole не слать.
3. Снова `GET /api/roles` → обновить `ROLES-PROD.md` + `APPLY-LOG.md` (что сменили).
4. Опционально: `GET /api/stock/zones` — имена складов ролей в `WAREHOUSES.md` (только отчёт).

## Волна B — код (`datacore-backend` + тонкий frontend)
1. `app-sections.ts` `sectionOpen`: при `stock-mobile` открывать **только** `stock`, **не** `requests`. Тест в `app-sections.spec.ts` обновить.
2. `supply.controller.ts`: на методы, нужные телефону — `@AppSection('requests', 'stock-mobile')`:  
   - GET список заявок (тот, что дергает stock-mobile),  
   - `POST requests/:id/receive`.  
   Остальное создание/правка заявок и счетов — только `requests` (класс). Уточнить по `stock-mobile.js` (receive + list ordered/paid/received).
3. `pwa/core/api.js` `sees()`: убрать авто `(id === 'stock-mobile' && s.includes('stock'))`. Телефонный склад — только если явно в sections (или onlyStockMobile как сейчас через length===1).
4. Юнит/spec затронутого; `node --input-type=module --check` на api.js.

## Волна C — проверка и выкладка
1. qa: критерии ниже + smoke.
2. Координатор: коммит по просьбе; `release.sh` по просьбе; после выкладки — doctor + глазами 2–3 роли.

## Файлы волны B
- Читать: `app-sections.ts` §sectionOpen, `app-sections.spec.ts`, `supply.controller.ts` (receive ~409, list requests), `stock-mobile.js` вызовы api, `pwa/core/api.js` sees ~40–47, `roles-hierarchy.ts` canSeeMoney.
- Менять: `backend/src/common/app-sections.ts`, `app-sections.spec.ts`, `modules/supply/supply.controller.ts` (+ spec если есть), `backend/pwa/core/api.js`.
- Не менять: role schema, JWT, VIEW-AS.

## Критерии приёмки
- [ ] Проектировщик/трубарез/лазер: `money: false` на проде; в UI нет сумм (после перелогина или /auth/me).
- [ ] Проектировщик: в меню нет склада/заявок/заказов; есть design/products/docs.
- [ ] Кладовщик телефона: receive и выдача работают; создать/править заявку через API → 403 раздел.
- [ ] Трубарез: нет пункта «Склад (телефон)» в меню (только Остатки).
- [ ] Директор: видит «В работе» и КП; бухгалтер без склада в меню; менеджер без ФОТ в меню; наблюдатель — короткий список.
- [ ] Подписи ролей по-русски.
- [ ] Smoke кода; перед выкладкой full + TEST-LOG.

## Нельзя
- Менять warehouseIds без сверки с пользователем.
- Ломать POST receive у кладовщика.
- Писать в прод мимо access / без лога APPLY-LOG.

## Отчёт
Полный → `docs/crew/C020-roles-access-audit/` · в чат ≤12 строк.
