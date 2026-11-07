# C044 / T4 (C041 Э3) — факт, нормы, сроки и себестоимость — отчёт исполнителя

Статус: сделано по коду и проверено (не закоммичено; приёмка qa/дизайнера, TEST-LOG и выкладка — координатор). ТЗ: `docs/crew/C041-work-composition/TZ-E2-E3.md` («Чек-лист Э3»), решения — `DECISIONS.md` (Q4), модель — `ADVICE.md`.

**Сделано (backend)**
- Ф1 факт шага: `common/work-schedule.ts:104-119` — `factSpan` (один день — реальная разница 0,25…8 ч, несколько — 8 ч/день); новая коллекция `workhours` `{planId,incomeId,stepId,personId?,date,hours,source:'mark'}` пишется при «закончил» (`work-facts.service.ts:44-60` `recordStep`, идемпотентно; `factBySteps:63-74`); `work-schedule.service.ts:124-146` `mark` — проверка «конец раньше начала» 400 + запись факта; план отдаёт `steps[].startedAt/finishedAt/factHours` и `fact{hours,perUnit}` (`order-line-plan.service.ts:106-127`). Табель не тронут (зарплата — отдельно).
- Ф2 нормы: `GET /work-facts/product/:productId` — медиана факта последних 5 заказов по шагам (ключ «вид работ × имя части») и всего, `used[]` (`work-facts.service.ts:132-183`); `POST …/apply` пишет медианы в `products.workTypes[].hours`, аудит `workfact.applied` (`:185-205`); новые планы берут норму изделия через `rowsFromProduct` (проверено e2e).
- Ф3 срок: `common/work-schedule.ts:121-127` `leadDays`; срок позиции — в плане (`order-line-plan.service.ts:128`), заказа — `leadDays` в `GET /salesorders/:id` (`salesorders.service.ts:214,218-232`) и `GET /production-orders/:key` (максимум по договорам).
- Ф4 себестоимость: `GET /work-facts/cost?incomeId=|?productId=` — материалы (состав × последняя закупка, `showcase.service.ts:76-83` `compositionCost`) + работы (часы × ставка: почасовой сотрудник → своя, иначе `worktypes.hourlyRate`, иначе «нет ставки», Q4); факт важнее нормы; без права «Деньги» — `{hidden:true}` (`work-facts.service.ts:207-290`, `work-facts.controller.ts`). В «Справочниках → Виды работ» поле «Ставка, ₽/ч» (`dicts.defs.ts:644-650`), индексы `workhours` — `scripts/ensure-indexes.js:29-31`.

**Сделано (frontend)**: новый `sections/work-facts.js` (API, блоки «Себестоимость» и «Работы: фактически» с «Принять как норму», только kit-эталоны); `sections/work-composition.js` — отметки шага «▶ начал / ■ закончил» (неактивны после отметки и при несохранённых правках), «факт N ч», «Факт: N ч» и «Срок: M дн.» в итоге, `costBlock` в панели позиции, `factsBlock`+`costBlock` в карточке изделия; `sections/salesorders.js:509` — «Срок изготовления, дн.»; DESIGN §4/§8; `index.html` пересобран (142 модуля).

**Проверки (факт)**: `npx tsc --noEmit` → 0 · `npx jest --silent` → 282/282 suites, 3151/3151 tests · e2e: новый `work-facts` 7/7, затронутые `order-line-plan, production-orders, salesorders, work, showcase` + новый — 6 suites, 35/35 · design-lint новых 0 (6435) · `--input-type=module --check` 3/3 · `pwa-import-check` 252 файла / 0 ошибок · `node --test backend/pwa` 100/100 · `tools/dc.cmd check` → exit 0 · openapi перегенерирован (476 путей, +3 `/work-facts`).

**Допущения**
1. Часы факта: дней без почасового табеля — один день = разница отметок (0,25…8 ч), несколько дней = 8 ч за день; месячный табель часов по дням не хранит, `workhours` считаются из отметок и на зарплату не влияют.
2. Ставка (Q4): почасовой сотрудник → своя; иначе `worktypes.hourlyRate`; иначе «нет ставки» (в сумму не входит). Окладники (salaryKind='month') почасовой ставки не получают — это допущение.
3. «Фактически» и нормы сопоставляются по паре «вид работ × название части» (id частей в плане могут отличаться), медиана — по заказам с фактом шага (не больше 5).

**Не сделано**: браузер/стенд и дизайнер (нужны стенд и снимки), полный e2e всего набора и строка TEST-LOG, выкладка — за координатором. Посторонние правки в дереве (T2/T3, `.claude/review/designer.json`, `docs/QUESTIONS.md`, `docs/roles/maps/*`) не трогал.

## designer (по коду, снимков нет)
Вердикт: принято с 3 замечаниями (T2, T3, T4).
- Эталоны: work-facts.js и правки T2 собраны из kit (section, table, readonlyGroup, hint, button, textInput), своих классов нет; design-lint по изменённым 0 (единственная находка — control-switch.js, чужая задача). textInput — в витрине #kit, DESIGN §4.
- Деньги: costBlock не строится без canMoney, плюс {hidden:true} с сервера скрывает секцию. Срок и часы — не деньги, видны всем: верно.
- Хвосты T2 закрыты: подписи ellipsis + числа под столбиками, textInput вместо searchBox, k-table-stack на 390 (кнопки min-height --tap), воронка разбита на функции.
- 🟡 «Принять как норму» перезаписывает нормы изделия без вопроса — добавить подтверждение (modal, одна строка «Записать фактические часы в нормы изделия «…»?»).
- 🟡 Помощь «?» не описывает новое T4: отметки «▶ начал / ■ закончил», «Работы: фактически» → «Принять как норму», «Себестоимость» (help-guide-data.js, блок производства). Остальные подписи T3 совпадают с экранами.
- 🟡 Пустой факт говорит «в «Составе позиции»», а панель называется «Позиция заказа» — выровнять слово (work-facts.js:113).
- Нужен снимок: изделие с фактом и позиция с отметками на 390 px (таблица со «▶ ■» и «факт N ч»).
