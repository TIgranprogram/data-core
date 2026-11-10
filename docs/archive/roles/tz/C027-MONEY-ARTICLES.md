# ТЗ C027 — «Деньги по статьям», как в таблице директора

**Зачем (словами пользователя):** «Директору не понравился наш вид. Нужна таблица: при клике на категорию расходов раскрывается список именно этой категории». Плюс «специальная страница для быстрого добавления расходов — прикрепить счёт файлом, вписать сумму и название». Только факт.

**Класс:** XL · **Max agents:** 5 (совет opus ✅, backend, frontend, data-steward, designer) · **Reviewers:** designer ☑ (qa — проверки делает координатор `dc check`) · **Max review loops:** 2 · **Проверки:** full перед выкладкой
**Язык менеджера:** да — ни одного английского слова и кода на экране · **Приёмка:** «Деньги → По статьям», раскрытие статьи, клик по ячейке, «Прочие расходы → Добавить», выбор статьи в заявке.

Анализ и ответы пользователя — `docs/crew/C027-money-by-articles/ANALYSIS.md`. Стартовый список статей — `docs/crew/C027-money-by-articles/articles-seed.json` (14 статей, 162 подстатьи).

## Shared pack (общее для всех ролей)

**Решения координатора (по совету opus):**
1. Своя коллекция **`expensearticles`** (только data-core, CRM её не знает): `{ name, parentId: ObjectId|null, sortOrder, code?: string, categoryIds: ObjectId[], deletedAt, createdAt, updatedAt }`. Ровно 2 уровня: статья (`parentId:null`) → подстатья. Коллекцию `categories` не трогаем.
2. Системные подстатьи (`code`, удалять нельзя, переименовывать можно): `payroll` — «З/п сотрудников (ФОТ)» в статье «Организационные расходы и ФОТ (начислено)»; `none` не хранится — это вычисляемая строка «Без статьи».
3. Статья расхода заявки: `supplyrequests.articleId?` (необязательное, только id подстатьи). Порядок определения: `articleId` заявки → подстатья, у которой `categoryIds` содержит `categoryId` заявки → «Без статьи». Строки снимка оплаченного счёта (`paymentSnapshot.lines`) — статья по `line.requestId` из заявки, запасной путь — `line.categoryId`. ФОТ → `code:'payroll'`.
4. Своя коллекция **`expenses`** («Прочие расходы», только факт): `{ date: Date, amount: number>0, companyId: ObjectId (наша фирма), articleId: ObjectId (подстатья, обязательно), salesOrderId?: ObjectId, title: string, counterpartyName?: string, docNo?: string, fileIds: ObjectId[], comment?: string, createdBy, deletedAt, createdAt, updatedAt }`. Индекс `{ companyId:1, date:1, deletedAt:1 }`.
5. **Объект** = заказ заказчика (`salesorders`, `salesOrderId`). Доходы объекта — `incomes` с тем же `orderNo`, что у заказа. **Цена контракта** = сумма `incomes.amount` позиций заказа (не отменённых).
6. `Op` (`finance/cashflow.ts:6`) получает необязательные поля: `articleId?: string`, `salesOrderId?: string`, `source?: 'request'|'invoice'|'payroll'|'expense'|'income'`. Прочие расходы — 4-й источник в `finance.service.ts:89`; календарь, сводка, прогноз получают их сами.

**Контракт backend ↔ frontend:**

`GET /api/expense-articles` → `{ items: [{ id, name, code?, sortOrder, children: [{ id, name, code?, sortOrder, categoryIds: [] }] }], total }` (дерево, без пагинации; удалённые скрыты).
Правка справочника — через общий механизм «Справочники» (`dicts.defs.ts`, ключ `expenseArticles`, группа «Деньги»): поля `name`, `parentId` (select «Статья», пусто = статья верхнего уровня), `categoryIds` (мультивыбор категорий, только у подстатьи). Удаление подстатьи с расходами — только через «Заменить на…» (reassign: `supplyrequests.articleId`, `expenses.articleId`).

`GET /api/expenses?from&to&companyId&articleId&salesOrderId&page&limit` → `{ items, total, page, limit }`; в item: все поля + `id`, `articleName`, `parentArticleName`, `companyName`, `salesOrderNo?`, `files: [{ id, name, url }]`.
`POST /api/expenses` · `PATCH /api/expenses/:id` · `DELETE /api/expenses/:id` (мягкое). Тело: `{ date:'ГГГГ-ММ-ДД', amount, companyId, articleId, title, salesOrderId?, counterpartyName?, docNo?, fileIds?: string[], comment? }`. Ошибки — по-русски («Выберите статью», «Сумма больше нуля»). Права: те же роли, что у `/api/finance` (деньги).

`PATCH /api/supply/requests/:id` принимает `articleId` (id подстатьи или `null`). Ответ заявки содержит `articleId`, `articleName`.

`GET /api/finance/by-articles?year=2026&org=all|<название фирмы>&mode=company|object&salesOrderId=<id>`:
```
{ year, months: ['2026-01', … '2026-12'],
  scope: { mode, salesOrderId?, orderNo?, title?, contractPrice? },
  head: { income: [12], expense: [12], profit: [12], totals: { income, expense, profit } },
  rows: [ { id, code?, name, level: 1, values: [12], total, pct,
            children: [ { id, code?, name, level: 2, values: [12], total, pct,
                          children?: [ { name /* контрагент */, level: 3, values: [12], total } ] } ] } ],
  unassigned: { values: [12], total, count },          // «Без статьи — заполнить →»
  unallocated?: { values: [12], total },               // только mode=object: ФОТ без объекта
  result: { values: [12], cumulative: [12], ratio: [12|null] } }
```
`pct`: mode=object и есть `contractPrice` — доля от цены контракта; иначе — доля от всех расходов года (0–100, одна цифра после запятой). Статьи и подстатьи с нулём за год — не отдаются. Третий уровень — только у статьи «Субподрядные работы» (по `counterparty`). Будущие месяцы — нули (только факт, по сегодня).
Клик по ячейке — операции: `GET /api/finance/by-articles/ops?year&org&mode&salesOrderId&articleId=<id|none>&month=ГГГГ-ММ` → `{ items: Op[], total }`.

## Что сделать — роли

### A. datacore-backend (backend/src, backend/test)
1. Модуль `expense-articles`: схема, сервис (дерево, кэш), контроллер `GET /api/expense-articles`; запись справочника `expenseArticles` в `dicts.defs.ts` по образцу `categories` (стр. 368-420) с `usage/related/reassign`. Сид при старте: если коллекция пуста — загрузить `docs/crew/C027-money-by-articles/articles-seed.json` (скопировать в `backend/src/modules/expense-articles/articles-seed.json`) + системная подстатья `payroll`. Сид идемпотентен.
2. `supplyrequests.articleId` — необязательное поле в `supply/supply-request.schema.ts` и DTO правки заявки; в ответе заявки `articleName`. Проверить загрузку из Google-таблицы: не затирает ли она `articleId` (если затирает — сохранять поле, как `editedInApp`). Копию схемы в kppdf не правим (CRM лишние поля игнорирует) — отметить в отчёте.
3. Модуль `expenses`: схема, DTO (`class-validator`, все поля — см. контракт), сервис, контроллер, права денег, мягкое удаление, аудит как у соседних модулей, файлы — через имеющуюся загрузку (как `fileIds` у `supplyinvoices`, `supply-invoice.service.ts:267`). Регистрация в `app.module.ts`, реестр коллекций.
4. `finance`: поля `Op` (п. 6 Shared pack); 4-й источник `expenses`; статья у заявок и строк снимка — в той же ветке, где снят дубль (`finance.service.ts:123-132`); ФОТ — `payroll`. Чистая функция `buildByArticles(ops, tree, year, today, opts)` рядом с `buildSummary` (`cashflow.ts:130`) + маршруты `by-articles` и `by-articles/ops` в `finance.controller.ts`. Считать в JS (Mongo 4.4).
5. «Требуют заполнения» (`finance.service.ts:146 needsFill`): новая группа «Оплачено без статьи» (оплаченные заявки, статья не определилась).
6. Юнит-тесты: `buildByArticles` (раскрытие, проценты, нулевые скрыты, «Без статьи», режим объекта, 3-й уровень субподряда, нет двойного учёта заявка+снимок), сервис `expenses` (валидация), сид идемпотентен.
7. `docs/openapi.json` перегенерировать, `docs/MAP.md` — новые модули и маршруты.

### B. datacore-frontend (backend/pwa)
1. «Деньги»: новая **первая** вкладка «По статьям» (`money.js:127`, адрес `#money?tab=articles`; календарь остаётся). Над таблицей: год ‹ › · фирма (как сейчас) · переключатель «Вся фирма / По объекту» + выбор заказа (поиск по номеру/названию) в режиме объекта.
2. Таблица: строки сверху — Доходы, Расходы, Прибыль; затем статьи (жирная строка-итог, ▸/▾), под ними подстатьи, у «Субподрядных работ» — подрядчики; внизу — «Без статьи — заполнить →» (ссылка `#fill`), в режиме объекта — «Не распределено по объекту», затем Финансовый результат · нарастающим итогом · Доходы ÷ расходы. Колонки: Статья · Янв…Дек · Итого · %. Первая колонка закреплена при прокрутке. Кнопки «Раскрыть всё / Свернуть всё». Клик по сумме — список операций в правой панели (как `showOps`, `money.js:191`), из операции «Прочий расход» — открыть его форму.
3. Новый раздел **«Прочие расходы»** в группе «Деньги» (`main.js:82,122,133,241`): список (дата, название, статья, фирма, сумма, файл) с фильтром месяц/фирма/статья; кнопка «Добавить расход» → правая панель (`sideForm`): Дата (сегодня), Сумма, Фирма, Статья (выбор «Статья → Подстатья», поиск), Название, Объект (необязательно), Контрагент, № документа, Файл счёта (перетащить/выбрать; виджет файлов как `invoice-workspace-forms.js:35` `photoField(..., { pdf:true })`), Комментарий. После сохранения — «Сохранить и добавить ещё».
4. Форма заявки: поле «Статья расхода» (тот же выбор), подставляется по категории из дерева (`categoryIds`), можно сменить. Найти форму: `grep -n "categoryId" backend/pwa/sections/requests*.js`.
5. Помощь «?»: обновить `help-flow-data.js` (новая вкладка и раздел).
6. Пока сервер не готов — работать по контракту выше (заглушка ответа в коде не оставлять).

### C. datacore-data-steward (backend/scripts, docs/crew/C027-…)
1. `backend/scripts/map-articles.js` (node, Mongo по `MONGO_URI`, как соседние скрипты в `backend/scripts/`): без флагов — **только план** в `tools/logs/map-articles-<дата>.md` и `.csv`: заявка (№, название, категория, поставщик, сумма) → подстатья, правило, уверенность (высокая/средняя/нет). Плюс предложение `categoryIds` для каждой подстатьи (категория → подстатья).
2. Правила — файл `backend/scripts/map-articles.rules.json`: «слово в названии / категория / поставщик → подстатья» (по названиям из `articles-seed.json`). Порядок: ручные правила → карта категорий → без статьи.
3. `--apply`: бэкап `{_id, articleId}` в `tools/logs/`, запись только при `{_id:{$in}, articleId:{$exists:false}}`, ничего не перезаписывает; заполняет `expensearticles.categoryIds` (добавлением). На проде запускает пользователь после «да».
4. Прогнать план на локальном стенде (если Mongo доступен) и положить итог в `docs/crew/C027-money-by-articles/mapping-plan.md` (≤ 40 строк: сколько сопоставлено, сколько нет, топ несопоставленных).

### D. datacore-designer — после A и B: просмотр «По статьям», «Прочие расходы», формы заявки; находки — координатору.

## Вид
- Эталоны kit: таблица `.cal`/`table()` из `money.js`, `kitTabs`, `sideForm`, `button`, `link`. Строки раскрытия — существующий паттерн раскрытия строк в kit (если нет — сказать координатору, не изобретать класс).
- Свои классы — только раскладка в `ui/screens.css` (раздел «Деньги»).
- Числа — `money()`/`cell()` как в `money.js`; ноль — «—» серым.

## Файлы
- **Чужое незакоммиченное (не трогать):** `backend/src/modules/offers/**`, `backend/src/common/offers-only.ts`, `backend/src/common/print/print-documents.spec.ts`, `backend/src/modules/incomes/incomes.service.ts`, `backend/src/modules/payroll/payroll.service.spec.ts`, `backend/src/modules/salesorders/salesorders.service.spec.ts`, `docs/MAP.md` и `docs/openapi.json` (там чужие правки — дописывать только свои строки, не откатывать), `docs/roles/maps/backend.md`, `tests_ai_tiit/`.
- A меняет: `backend/src/modules/expense-articles/**`, `backend/src/modules/expenses/**`, `backend/src/modules/finance/**`, `backend/src/modules/supply/supply-request.schema.ts` + DTO заявки, `backend/src/modules/dicts/dicts.defs.ts`, `backend/src/app.module.ts`, реестр коллекций, `docs/MAP.md`, `docs/openapi.json`.
- B меняет: `backend/pwa/**` (кроме чужого).
- C меняет: `backend/scripts/map-articles.*`, `docs/crew/C027-money-by-articles/mapping-plan.md`.
- Читать запрещено: DESIGN/CANON/HISTORY/TASKS целиком, `docs/openapi.json` целиком.

## Критерии приёмки
- [ ] Справочник «Статьи расходов» в «Справочниках»: 14 статей, подстатьи, правка, «Заменить на…».
- [ ] `GET /api/finance/by-articles` отдаёт форму из контракта; сумма `rows[].total` + `unassigned.total` (+ `unallocated`) = `head.totals.expense`.
- [ ] Прочий расход появляется в «По статьям», в календаре (день оплаты) и в сводке; не задваивается.
- [ ] Заявка + строка снимка счёта не считаются дважды.
- [ ] Режим объекта: доходы — позиции заказа, % — от цены контракта.
- [ ] «Без статьи — заполнить →» ведёт в «Требуют заполнения», группа «Оплачено без статьи».
- [ ] Новая заявка: статья подставилась по категории.
- [ ] На экране нет английских слов и кодов.
- [ ] `dc check` зелёный; `node --input-type=module --check` по изменённым pwa-файлам; full + строка TEST-LOG перед выкладкой.

## Нельзя
- Данные прода (скрипт `--apply` на проде — только пользователь). Схемы `categories`, `supplyinvoices` не менять. `supplyrequests` — только необязательное поле. Контракт API существующих маршрутов не ломать.
- Не коммитить и не выкладывать (это координатор).

## Отчёт роли (≤ 12 строк в чат; полный — `docs/crew/C027-money-by-articles/<роль>-report.md`)
`статус | сделано ✅/❌/➖ | файлы | проверки → итог | риски / нужно от других`
