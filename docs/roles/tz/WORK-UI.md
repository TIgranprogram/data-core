# ТЗ WORK-UI — экран «В работе» (производство), фронт

**Зачем (словами пользователя):** «раздел "В работе": виды работ, сотрудники, маршрут изделия, карточки, которые двигаются по доске». Сайт — «воронка» слева направо: Заказ → Проектирование → Снабжение/склад → **В работе** → Отгрузка → Деньги.

**Класс:** L · **Max agents:** 1 исполнитель + designer · **Проверки:** smoke (`node --input-type=module --check < файл` для каждого изменённого .js)
**Язык менеджера:** да — без кодов на экране, кроме «W-N» (номер карточки, как «D-N» в «Проектировании»); пустые состояния с подсказкой «что сделать».

## Shared pack
- Сервер готов (модуль `backend/src/modules/work/`, коммит 7eb299b). Сервер **не менять**.
- Образец экрана — «Проектирование»: `backend/pwa/sections/design.js` (список + вид «Доска» через `ui/list.js` + `ui/board.js`). Делай так же: те же компоненты, те же классы, одна доска (`ui/board.js` на `ui/drag.js`).
- Ввод данных — только правая панель (`ui/side-form.js`, `ui/card.js`), без модальных окон.

### Контракт API (точно)
- `GET /api/work-tasks?status=&workTypeId=&orderId=&assigneeId=&search=&doneDays=&page=&limit=` → `{ items, total, page, limit, counts:{waiting,work,done,all}, columns:[{key,title,workTypeId,count}] }`. Колонки: первая `waiting` «Ждёт запуска», затем виды работ (key = id вида работ или `generic` «Изготовление»), последняя `done` «Готово». Карточка: `{ id, code:'W-N', status:'waiting|work|done|cancelled', title, photo, stepIndex, stepKey, currentStep, route:[{index,workTypeId,name,state:'done|current|next',note}], orderId, productionNo, customer, incomeId, qty, unit, productId, sku, productName, deadline, priority, assigneeId, assignee:{name…}, note, startedAt, completedAt }`. Колонка карточки на доске: `status==='waiting'` → `waiting`; `done` → `done`; иначе → `stepKey`.
- `GET /api/work-tasks/people?workTypeId=` → кого назначить (сотрудники с этим видом работ).
- `POST /api/work-tasks/launch {orderId?, lineIds?}` → ответ содержит запущенные, `refused:[{…, reason}]`, `warnings:[…]` — показать оба списка словами (тост + список в панели), не молча.
- `POST /api/work-tasks/:id/move {stepIndex}` или `{to:'next'|'waiting'}` — перетаскивание на колонку = move на индекс шага этого вида работ в `route` карточки; на «Готово» = `POST /:id/done`; на «Ждёт запуска» = `{to:'waiting'}`. Колонки, которых нет в маршруте карточки, — `canDrop` = false.
- `POST /:id/cancel {reason}`, `PATCH /:id {assigneeId|null, note}`, `DELETE /:id`, `POST /:id/restore`.
- Права: двигать/запускать/назначать — `admin`, `manager`; остальным — только смотреть (кнопки не показывать).
- `GET /api/work-routes/:productId` → маршрут изделия, части состава для выбора, подсказка, если маршрута нет. `PUT /api/work-routes/:productId {steps:[{workTypeId, lineId?, note?}]}` — записать целиком (порядок = порядок работ; пустой — убрать).
- Сотрудник: `PATCH /api/dicts/persons/:id {workTypeIds:[…]}` — несколько видов работ.
- Справочник видов работ — `GET /api/dicts/worktypes` (проверь точный путь в `pwa/sections/dicts.js` / `lookups.js`).

## Что сделать
1. **Новый раздел `backend/pwa/sections/work.js`** «В работе»: вид «Доска» по умолчанию (колонки из `columns`, счётчики), вид «Список»; фильтры: исполнитель, заказ, поиск; «Моё / Всё» если есть в образце. Карточка на доске: фото, `title`, заказчик, срок (просрочен — как в «Проектировании»), исполнитель, текущий шаг и прогресс маршрута (точки done/current/next).
2. **Карточка задания справа** (`ui/card.js`): маршрут шагами (сделано / сейчас / впереди), кнопки «Следующий шаг», «Готово», «Вернуть в ожидание», «Отменить» (причина — поле в панели), исполнитель — выбор из `/work-tasks/people?workTypeId=<текущий вид>`, примечание; ссылки на заказ и изделие.
3. **Меню:** пункт «В работе» в группе «Производство» после «Проектирование» (`backend/pwa/main.js`: `SECTIONS` ~стр. 44, `NAV` стр. 106, `SEC_OF`/`GROUP_OF` стр. 112–114 — секция прав `work`, группа «Производство», `group(...)` стр. 209). Значок — существующий из `ui/icons.js`.
4. **«Запустить в работу» из заказа:** в карточке заказа (`backend/pwa/sections/salesorders.js`) — кнопка «Запустить в работу» (все позиции или выбранные галочками — образец выбора — `pickContracts` там же). Ответ `refused`/`warnings` — показать словами («Позиция 2: нет изделия — сначала сопоставьте с продукцией»).
5. **«Как делается» у изделия:** в карточке изделия (`backend/pwa/sections/products.js`, найди карточку) — блок/вкладка «Как делается»: список шагов (вид работ, часть состава — необязательно, примечание), добавить / убрать / вверх-вниз, «Сохранить» → PUT. Нет маршрута — подсказка с сервера и кнопка «Взять подсказку».
6. **Виды работ у сотрудника:** в карточке сотрудника (найди: `sections/staff.js` или `dicts.js` для persons) — поле «Виды работ» (несколько, `ui/combo.js` multi, если есть; нет — галочки) → PATCH `workTypeIds`.
7. **Помощь «?»:** `backend/pwa/sections/help-flow-data.js` — добавить шаг «В работе» в карту процессов между снабжением и отгрузкой (где делать: «В работе → доска»; как: «Заказ → Запустить в работу»).

## Файлы
- Менять (frontend): `pwa/sections/work.js` (новый), `pwa/main.js`, `pwa/sections/salesorders.js`, `pwa/sections/products.js` (или файл карточки изделия), файл карточки сотрудника, `pwa/sections/help-flow-data.js`, `pwa/ui/screens.css` (только новые классы `.wk-*`).
- Параллельно координатор правит: `pwa/sections/money.js`, `pwa/sections/fill.js`, `pwa/sections/requests.js`, `backend/src/modules/finance/*`, `backend/src/modules/fill-audit/*` — **не трогать**.
- Читать: `pwa/sections/design.js` (целиком — образец), `pwa/ui/board.js`, `pwa/ui/list.js` (опции), `pwa/ui/card.js` (шапка, зоны), `pwa/ui/side-form.js`, `docs/DESIGN.md` §4 (правая панель).
- Не читать: CANON/HISTORY/TASKS целиком, `docs/openapi.json` целиком, `backend/src` (контракт выше).

## Критерии приёмки
- [ ] Раздел открывается по меню, доска показывает колонки и карточки; перетаскивание двигает (move/done/waiting), запрещённые колонки не принимают.
- [ ] Пустая доска — подсказка «Откройте заказ → «Запустить в работу»».
- [ ] Запуск из заказа показывает отказы словами.
- [ ] Маршрут изделия сохраняется и перечитывается; виды работ сотрудника сохраняются.
- [ ] `node --input-type=module --check < файл` — 0 для каждого изменённого .js.
- [ ] 390 / 1024 / 1920 — без горизонтальной прокрутки страницы (доска прокручивается внутри).

## Нельзя
- Менять сервер, данные прода, общие файлы координатора (список выше). Не коммитить.

## Отчёт роли (≤ 12 строк)
`статус | сделано (пункты ✅/❌/➖) | файлы | проверки | риски`
