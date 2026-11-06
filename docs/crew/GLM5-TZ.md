# ТЗ для GLM-5 — перевод экранов на эталоны (часть Б из двух)

Дата: 2026-11-06. Заказчик: координатор (Claude). Класс: L. Язык: русский (комментарии, отчёт).
Пользователь — не разработчик. Цель всего проекта: «слово беспорядок не относится к проекту». Единый вид, только эталоны kit.

## Промпт (вставить как первое сообщение GLM-5)

```
Ты — исполнитель проекта D:\data-core («Рабочее место», чистый JS без сборки, backend/pwa).
Сначала прочитай по порядку, ничего лишнего не читай:
1) AGENTS.md (раздел «Жёсткие правила» и «Известные ловушки»)
2) docs/crew/GLM5-TZ.md — твоё задание, делай ТОЛЬКО его
3) docs/CANON.md §2 (устройство экранов) и docs/DESIGN.md §4 (каталог kit)
4) docs/crew/ORDER-MASTER-PLAN.md §1–2 (что считается беспорядком)
5) docs/crew/STYLE-DECISION.md и DS-1-cards.md (утверждённый стиль: карточка «бумага», таблица «линии», связи «сетка»)
Работай автономно, вопросов пользователю не задавай: сомнение — допущение, записать в отчёт.
Закончив, напиши отчёт в docs/crew/GLM5-report.md и сообщи «готово».
```

## Разделение работы (чтобы не мешать друг другу)

Работаем в одной папке одновременно. Файлы не пересекаются.

**GLM-5 владеет (только эти пути):**
`backend/pwa/sections/`: `home.js`, `staff*.js`, `docs*.js`, `money*.js`, `payroll*.js`, `invoice*.js`, `invoices-tab.js`, `invoice-workspace*.js`, `requests*.js`, `request-*.js`, `design*.js` (включая `design-requests.js`, `design-order.js`, `design-side.js`, `design-menu.js`, `design-data.js`, `design-settings.js`), `partners.js`, `offers.js`, `contracts.js`, `kp.js`, `dicts.js`, `profile.js`, `help.js`, `chat.js`, `history.js`, `search.js`.
Парные стили этих экранов в `backend/pwa/ui/screens.css` — **не трогать** (см. ниже), только удалять в самом конце, если Claude разрешит в отчёте.

**Claude владеет (GLM не открывает на запись):**
`backend/pwa/ui/kit/**`, `ui/screens.css`, `ui/base.css`, `ui/tokens.css`, `core/**`, `main.js`, склад (`stock*`, `movements`, `reservations`, `issue`, `order-issue`, `warehouse*`), заказы (`orders*`, `order-*`, `salesorders*`, `item-orders`), `products*`, `passports*`, `backend/src/**`, `backend/test/**`, `backend/admin/**`, `deploy/**`, `tools/**`, `docs/TASKS.md`, `docs/TEST-LOG.md`.

Нужен новый вариант/параметр в kit, которого нет → не изобретай своё. Запиши строку в `docs/crew/GLM5-requests.md` (что, зачем, файл:строка), на этом экране оставь как есть и иди дальше. Claude сделает в kit, потом это можно закончить второй итерацией.

## Задачи (по порядку; каждая — отдельная законченная порция)

**Г1. «Сегодня» (`home.js`) и `.td-*`.**
Заменить самодельные кнопки (`button.td-day`, `button.td-chip`, `btn btn-ghost btn-sm`, `btn btn-sm btn-primary`) на фабрики kit (`button()`, `tabs()`/`segmented`, `filter`). Карточки — через `card()`. Пустые состояния — `empty()`. Цель аудита `s` на экране «home» = 0.

**Г2. Сотрудники (`staff*.js`).**
`button.st-row` (14–17 шт.) → строка списка kit (`row` или `table list`), `select` ×5 → kit-`pick`/`field`, `btn btn-sm` → `button()`. Цель `s` на «staff» и «staff [new]» = 0.

**Г3. Документы, деньги, зарплата.**
`docs*.js` (кнопки, input, button.active → `tabs()`), `money*.js` (3 кнопки, 2 icon-кнопки, active → `iconButton()`/`tabs()`; таблицу `table.cal` НЕ трогать — это закрытое исключение), `payroll*.js` (icon-кнопки, primary, `a.btn` → `link()`/`button()`). Цель `s` = 0.

**Г4. Заявки и счета (`requests*.js`, `request-*.js`, `invoice*`).**
Карточки счетов (`article.db-order`, класс `k-gfold`) — карточка kit с `k-hover`. Сам `k-gfold` лежит в `ui/kit` — его хождение (наведение) чинит Claude; ты проверь, что в твоих файлах все кликабельные карточки созданы через `card({ clickable:true … })` или эквивалент kit, и больше нигде нет самодельных `.db-order`. Заменить `h('button'`, ручные `.chips`, ручные `'field'`/`form-grid` на `button()`, `tabs()`, `field()`. Пустые тексты («Пусто», «Ничего не найдено», «Нет данных») → `empty()`.

**Г5. Конструкторские задачи (`design*.js`).**
То же, что Г4: карточки `db-order` в `design-requests.js`/`design-order.js`, ручные кнопки и вкладки, `window.prompt/confirm/alert` (например `design-menu.js:10`) → `dialog`/`confirm` kit. `toast(e.message…)` → `toastError(e)`.

**Г6. Остальные разделы из списка владения** (`partners`, `offers`, `contracts`, `kp` — печать КП НЕ трогать, `dicts`, `profile`, `help`, `chat`, `history`, `search`): заменить `h('button'`, `h('table'`, `h('select'`, ручные `.chips`, ручные пустые тексты на kit. Файлы длиннее 400 строк в твоём списке — не раздувать; разрезать только если правка и так их трогает.

Правила для всех задач:
- Поведение, тексты на экране и права не менять. Меняется только способ построения. «Язык менеджера» (CANON): никаких служебных кодов на экране.
- Новых CSS-классов не заводить. Удаление старых классов из `screens.css` — не твоё (Claude делает в конце).
- Ввод данных — только правая панель (не модальное окно по центру).
- Не добавлять inline `style`, не ставить цвета/радиусы/шрифты числами; только токены (`--radius`, `--card-pad`, `--card-gap`…).
- Если `help-flow-data.js` описывает путь/слова, которые ты поменял, — обнови его (правило «синхронизировать помощь»).
- Каждый изменённый файл проверять: `node --input-type=module --check < файл` (только так: `node --check` пропускает ошибки модулей).
- Не расширять API и не менять `backend/src`. Контракт API не трогать.

## Проверки (только эти; docker, e2e, `dc full/audit/stand`, браузер — НЕ запускать, это делает Claude)

После каждой порции:
```bash
node --input-type=module --check < backend/pwa/sections/<файл>.js     # на каждый изменённый
node backend/scripts/design-lint.mjs                                   # итог не должен вырасти; допускается только уменьшение
tools/dc.cmd check                                                     # tsc, юнит, импорты — зелёные
node --test backend/pwa/sections/*.test.mjs                            # если трогал файлы с рядом лежащим *.test.mjs
```
`design-lint --accept` и правка `design-allow.json` / baseline запрещены.

## Запреты (нарушение = откат всей работы)

- Не делать `git commit`, `git push`, `git add -A`, `git stash`, `git reset`, `git checkout -- .`. Коммитит только Claude. Не создавать ветки.
- Не читать и не выводить `.env`, `deploy/synology/config.env`, `CREDENTIALS.md`, ключи. Не ходить на прод и стенд. Не запускать `docker`, `release.sh`, `api.sh`.
- Не трогать чужие пути из списка Claude. Не править `docs/TASKS.md`, `docs/TEST-LOG.md`, `CLAUDE.md`, `AGENTS.md`.
- Не удалять файлы, кроме пустых заготовок, созданных тобой.

## Отчёт (docs/crew/GLM5-report.md, ≤ 60 строк, без пересказа кода)

1. По каждой Г1–Г6: готово / частично / не сделано; список изменённых файлов.
2. Числа до/после: `design-lint` итог; число `h('button'`, `h('table'`, `h('select'` в твоих файлах (`grep -c`).
3. Что не смог без kit — копия строк из `GLM5-requests.md`.
4. Допущения (вместо вопросов пользователю).
5. Результат проверок (3–4 строки: что запускал, код выхода).

## Приёмка (делает Claude после твоего «готово»)

`dc check` → `dc audit` (счётчики `s` и `r` вниз, новых находок нет) → осмотр экранов 390/1024/1600 → мелкие правки → `dc full` → дизайнер → коммит по путям (kit и sections — раздельными коммитами) → `release.sh` → `git push`.
