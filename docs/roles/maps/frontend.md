# Карта роли frontend

коммит: 1cab104 (+ незакоммиченная работа «Паспорт воронкой», 2026-10-25)
- 2026-10-27 Продукция: `ui/list.js` — `L.defaults` (начало mountList), явный `view` в кнопках видов (~70), `gallery.card().price`; `products.js catLanding` (.sec-tile), CSS конец `ui/screens.css`. Не закоммичено.

Правила: вид — skill `datacore-design` → `docs/DESIGN.md` (§4 каталог, §5 ввод только в правой панели, §8 журнал). Новый JS-модуль → `node backend/scripts/pwa-preload.mjs`. Проверка: `node --input-type=module --check < файл`, `cd backend && npx jest src/pwa-guards --silent`. Переводы строк в pwa смешаны (CRLF/LF) — править через Edit или скрипт с определением (урок 2026-10-25).

## Паспорта (backend/pwa/sections/passports/*)
- `form.js` — форма паспорта: `passportForm.fields(r)` (блоки по порядку: `_need` → «Изделие» → «Паспорт: категория и тексты» [passportCategory, `textChoices` = funnelBox, `_std`] → «Данные изделия — править в изделии» (свёрнут) → «Состав и материалы» → «Ограничения» (`sumOf` «заполнено N из M») → «Сертификат» → «Запомнить» → «Выпуск» → «Свой текст вместо выбранного» (`_manualText`, installationMethod/purpose — уходят в body только при «yes») → «Описание» → Картинки → Комплектность → «после печати»). `v2Initial/v2Body` (textChoices), `toBody`, `create/update`, `saveDefaults`.
- `wire-form.js` — `wireForm(api,{r,w,catBy,stdName,inst})`: связи категории (`w.funnel.setCategory`), `check()` → POST /passports/check → липкая плашка `w.need` (`.pp-need-sticky`, переносится первым в api.root), `goTo(key)` (в т.ч. `choice:<rootId>` → шаг воронки), «Запомнить», `lockIssued`.
- `product-block.js` — выбор изделия, сводка `.pp-fromprod`, `applyProduct` (поля изделия → форма; `passportDefaults.textChoices` → поле textChoices; purpose/installation изделия в паспорт больше не идут).
- `models.js` — модели прошлых паспортов, `issuePassport`, `DEFAULT_KEYS` (+textChoices). `common.js` — V2_CATS/V2_NUMS, dictRows, canEdit, dims, st.

## Воронка и общие кусочки (backend/pwa/ui/*)
- `funnel.js` — `funnelBox({value,category,canEditText})` → {el, value(JSON {rootId:leafId}), setCategory, refresh, stepEl}; `loadFunnel(cat)` = GET /passports/funnel?category (кэш 60 с). Единственный/«по умолчанию» вариант — отображается как «подставлено», в value не пишется. «Править текст» — ссылка в новой вкладке на `#dicts?d=passportPhrases&of=ptnode&open=<leafId>`.
- `cat-chips.js` — `catChips({options,value,all})` (галочки категорий, «Для всех» первым), `catChipsField` (виджет формы, value = JSON-строка кодов).
- `quality.js` — `normKey`, `dupeCounts`, `qualityBadges({empty,dupe})`, `qualityFilter` («Все · Пустые · Дубли»).
- `form.js` — секция формы принимает `sumOf(get)` (своя сводка свёрнутого блока).

## Справочники
- `sections/passport-tree.js` — дерево «Тексты паспорта» (`mountTree`, d=passportPhrases) + панель `ptnode` (`of=ptnode&open=<id>|new.<parentId>`; форма: название, текст, catChips, порядок, по умолчанию/обязательный; «Объединить с…» POST /dicts/passportPhrases/:id/merge {intoId}; «Убрать» DELETE + restore; «+ Подвариант»). Данные — GET /dicts/passportPhrases (узлы: parentId, text, categories, allCategories, order, required, isDefault).
- `sections/dicts.js` (DICT, не закоммичено): `menuGroups/renderNav` (группы GROUP_NAME, select `.dict-sel`), `renderTable` (`ul.dict-list`), `removeItem` (usage → confirmDlg | modal замены, админ `isAdmin()`), форма: `_usage` widget + `warn` имени (`dict.form.fields`), `startEdit`. Контракт: /usage, merge, `dict.sections/locked`. Ниже — прежнее: `reloadTree()` для TREE_KEY; общая таблица: метки «дубль · N» + фильтр; поле `categories` формы справочника — catChipsField. Старый редактор шаблона разделов (`passport-texts.js`, d=ptexts) переименован «Общие разделы (шаблон)»; `VARS` экспортируется.
- `sections/products.js` — блок «Паспорт» в форме изделия (pdCategory + pdChoices; сохранение: `savePd` → PUT /showcase/:id/passport-defaults с whitelist `PD_KEYS` + textChoices), действие «Клонировать» (POST /showcase/:id/clone → patch open).
- `main.js` — SECTIONS/OWNER: ptext, ptextview, ptnode.

## CSS
`ui/base.css` в конце: блок «Паспорт воронкой» (.pp-funnel/.pp-step/.pp-opts/.pp-ftext/.pp-need-sticky/.pp-fromprod/.q-filter/.pt-name/.pt-cats/.pt-check/.tag.dim).

## Где что менять
- Новый шаг/вид воронки — `ui/funnel.js` (step/optRow); данные — контракт GET /passports/funnel.
- Новое поле паспорта — `passportForm.fields` + `v2Initial/v2Body` + wire-form KEYS.
- Метки качества в другом справочнике — `ui/quality.js` + renderTable в `dicts.js`.

## Известные хвосты
- `/passports/phrases` (старый, по тексту паспортов) ещё зовут: `models.js phrases()` (материалы в форме) и `products.js phrases()` (Назначение/Монтаж изделия) — заменить, когда сервер уберёт.
коммит: 61b18c6 (+ правки ПРЖ-5 не закоммичены)

- `backend/pwa/ui/board.js` — доска: поля `board.default/cls/headCount/add`, колонки `compact/portion/per`, карточка `{ body }`; `ui/list.js` — `board.default`, `onTotal`.
- `backend/pwa/sections/design.js` — «Проектирование» (доска + таблица, форма в правой панели, `moveTask`); `sections/order-design.js` — блок в карточке заказа (from-order).
- `ui/badges.js` — `DESIGN_STATUS`, `ORDER_PRIORITY`; `sections/salesorders.js` — приоритет заказа (форма, список, доска), `orderDesign`.
- Регистрация нового раздела: `main.js` (SECTIONS, NAV, group, refreshCounts, `clear` в syncCard) + `node backend/scripts/pwa-preload.mjs`. Jest в worktree не стоит (нет node_modules).
- Правка CRLF-файлов: скриптом node (replace \r\n → \n → правка → обратно); python нет.

## Уведомления (2026-10-25, не закоммичено)
- `ui/notice-card.js` — `noticeCard`, `noticeTime`, `splitReason`; `ui/toast.js` (tone/sub/notice, пишет в историю), `ui/notices.js` (история, read, clear, once), `ui/busy.js failBlock`. CSS — блок «Уведомление» в конце base.css (.ntf*, .bell-head).

## Левая панель фильтров (NAV F1–F3, 2026-10-25, не закоммичено)
- `ui/list.js` — опция `L.sidebar` (`side`, `sideParts`, `put`, `optBtn`, `selCount`, `openSheet/closeSheet`; поиск/tiles/chips/select/extra/reset собираются в `.ls-body`); `tiles.title`, `x.head`. CSS — блок «Левая панель фильтров» в конце `ui/base.css` (`.ls-*`).
- `ui/facet-filter.js` — `facetFilter({inline:true})` → `inlineFilter()` (тело групп без кнопки/шторки). `sections/stock.js` и `sections/products.js` (list: sidebar, filters series/status, query, tiles) — потребители. `core/prefs.js` filterW std 280.
- Серия в «Продукции» — словами поиска (сервер `series` в query не знает).
коммит: (после коммита координатора)

## Документация / меню (NAV F4–F5, 2026-10-25, не закоммичено)
- `sections/docs.js` — `mountDocs(params)` (вкладки `.seg`, `?tab=archive`), секции `doctpl` (шаблон паспорта изделия: список /showcase, форма `build` = категория + `funnelBox`, `savePd` из products.js) и `passarchive` (копия `passports` без form/remove/bulk, действия `archiveActions`: печать, «Дописать и выпустить» → `of=passports`, «Привязать»). Внутренний список получает params без `tab/of` (`listParams`).
- `main.js` — NAV: docs вместо passports, группа «Продажи и выпуск»; `OWNER.passports/passarchive/doctpl/ptext*='docs'`; `#passports` → редирект в `#docs?tab=archive&of=passarchive&open=`; `core/api.js session.sees('docs')` = docs или passports, `session.seesDocs()`.
- `products.js` — `PD_KEYS`/`savePd` экспортируются; «Печать паспорта» (последний из `r.passports.items[0]`) + «Выпустить паспорт» по `seesDocs()`.

## Доска заказов «Проектирование» (2026-10-25, не закоммичено)
коммит: (после коммита координатора)
- `ui/design-board.js` — `mountDesignBoard` (state S, `load/paintLeft/paintRight`, `moveItem/createTask`, `statusSheet`, `addPicker`), `askAssignee/askReason`, `normBoard/normLine/normTask`, `distributeOrder/dropOrder`, `fetchBoardOrder/loadLines`. Подключено: `sections/design.js` `list.board.mount/alt/env` → `ui/list.js` (`L.board.mount`, `board.alt` = ?view=flat).
- `ui/drag.js` (`draggable`, `dragStep`, `afterDrag`), `core/order-color.js` (`orderColorIndex`, `paintOrder`); тесты `*.test.mjs` рядом.
- `sections/design-order.js` — панель заказа `of=designorder&open=<orderId>` (регистрация в `main.js` SECTIONS/OWNER). Токены `--oc-N` — `ui/tokens.css`; стили `.db*` — конец `ui/base.css`.
- Правка CRLF-файлов (design.js, list.js, main.js, tokens.css, order-design.js) — скриптом node. Heredoc с апострофами в bash-инструменте падает — файлы писать через Write.
- Вид доски (2026-10-27): CSS-only в ui/panels.css строки 62-165 (clamp 2 строки, .db-colempty пунктир, @media min-width:1600px).

## Стикеры и фото задач проектирования (2026-10-27, не закоммичено)
коммит: (после коммита координатора)
- `ui/design-stickers.js` — `stickerNode/stickerRow`, кэш `setStickers/visibleStickers/allStickers`, `photosBlock`, `stickersBlock` (PATCH /design-tasks/:id/stickers; фото — POST/DELETE /photos). Карточка — `design-board.js taskEl` (`S.stickers`, кнопка «Настройки доски» только admin); панель задачи — `sections/design.js card.extra`; `sections/design-settings.js` (`of=designsettings&open=board`, main.js SECTIONS/OWNER). CSS — конец `ui/panels.css`.

## Карточка задачи D-N (2026-10-27, не закоммичено)
- `ui/card.js` — новые опции `card.top(row,ctx)` (блок до галереи), действие `more:true` уходит в «⋯» (`.act-more`), история — `details` при `card.top`. `sections/design.js` — `topBlock/noteBlock/openPhoto`, `card.extra`. `ui/design-notes.js` — мессенджер (`item/paint/tidy/dayLabel`). CSS — конец `ui/panels.css` (`.dc-*`, `.dn-*`). Сервер: `design-present.ts` отдаёт `productionNo`.

## «Сегодня» (СГД-1 этап 1, 2026-10-28, не закоммичено)
коммит: (после коммита координатора)
- `sections/home.js` переписан: `load` (GET /today?days=7), `cardEl/RUN` (действия open/receive/shipped/move/answer), `snooze` (localStorage `dc-today-snooze`), `paintFeed/paintWeek/paintCharts` (funnel/bars/donut/moneyLine, SVG), колокольчик `paintBell`. CSS — конец `ui/screens.css` (`.td-*`). Старые очереди `.q-*/.lane*/.summary` в CSS остались (их используют fill/money/payroll).

## Меню «Настройки» + шапка (2026-10-28, не закоммичено)
- `ui/pop-menu.js` — `openPopMenu({anchor,groups,head,side})`, `closePopMenu`, `isOpenFor`; CSS `.pm*` конец `ui/panels.css`. `main.js` — `settingsButton/historyButton/themeButton/avatarButton/installItem`; `.side-foot` = Настройки + версия.
- v3 карточки задачи (2026-10-28): `sections/design.js` `taskPics/topBlock/specBlock` (сводка `.kv-grid`, `spec` → «Изделие»); `ui/gallery.js` `carousel/zoom` (`.pgal`); `ui/design-notes.js` `photoLine/isPhotoNote` («[фото]» одной строкой, `openGallery`); CSS — конец `ui/panels.css`. коммит: —. Карта обновлена.

## Каталог поставщиков v2 (2026-10-28, не закоммичено)
- `sections/supplier-catalog.js` переписан на ui/list.js: tiles=поставщики, `sideFilters` (категории + flag unmatched/noPrice/stale), `topBlock` (крошки + шестерёнка: шаблон/импорт/выгрузка), `importDialog` (preview → apply), `materialWidget`. `list.js`: `topBox.onParams(P)`. CSS `.sc-*` конец screens.css. Карточка берёт строку из `rowCache` (GET по id на сервере нет). Карта обновлена.

## Деньги под новый сервер (2026-10-28, не закоммичено)
- `sections/orders.js`: `INCOME_STATUS.partial`, `todayMsk`, `paymentDialog` (POST /incomes/:id/payments), `paymentsBlock` (card.extra, DELETE .../payments/:i), строка «Итого» из `resp.money`, «нет суммы — вписать». `markToday` теперь только отгрузка.
- `sections/money.js`: `settings` (GET /finance/settings, `hasStart`), `startDialog` (⚙, PUT, admin), плитки `c.metrics` (`.m-tiles`), строки `pend` из `c.pending`, `beforeStart` серым (`.q-row.dim`), пустые подсказки. `money-forecast.js`: «самый низкий остаток». CSS — конец `ui/screens.css`.
- `sections/payroll.js` переписан: /payroll/summary, timesheet (inputs в строке), `payDialog`, `companyPick`, список выплат. DEMO удалён. Карта обновлена.

## Заявки — воронка, шаг 1 (2026-10-28, не закоммичено)
- `sections/request-step.js` — `GATES` (ворота: ordered — поставщик/кол-во/ед.; paid — № счёта/дата/сумма), `missingFor`, `nextStep` (глаголы), `openStep` (of=reqstep&open=id), `reqStep` (панель «Следующий шаг», только недостающие поля, «Сохранить и перевести»), `advance`, `bulkOrder`. main.js — SECTIONS/OWNER `reqstep`.
- `sections/requests.js` — `board.default`, `viewKey:'requests'`, `COLUMN_HINT/EMPTY`, `stepFoot` (чек-лист + кнопка), `stepAct`, ворота в `move`/`changeStatus`/`rowAction`.
- `ui/board.js` — `columns[].hint/money/multi`, `card().foot`, полоса `.board-bar`; `ui/list.js` — `board.default` + запомненная «Таблица» (`dc-view-*`=table). CSS — конец `ui/screens.css`.

## Заявки — шаг 3 (2026-10-28, не закоммичено)
- `request-step.js`: `advance` — заказ через POST /supply/invoices, «оплачен» всегда панель (№, дата=сегодня, сумма=priceHint|catalogCurrentPrice×qty, поставщик, плательщик для счёта); `invoiceBlock(r,ctx)` — блок «Счёт» (card.extra в requests.js); `bulkOrder` → один POST. `ui/board.js`: `pickAll` («Выбрать все» в `.col-tools`). CSS `.t-step` (gold-soft), `.t-pick`, `.inv-block` конец screens.css. Карта обновлена.

## Заявки — автозаполнение В1 (2026-10-28, не закоммичено)
- `sections/request-fill.js` — `wireFill(fapi)` (mount поля «Наименование»): З1/З2 price-default + prices по скрытому materialId, З3 каталог поставщика, З4 заказ -> заказчик/кол-во + строка «Заказ № N поз.». `requests.js`: hidden materialId/num, `fromInvoice` (З6 показ из счёта), `orderTag`, фильтр `salesOrderId`, колонка «Заказ». `salesorders.js` кнопка «+ Заявка под этот заказ»; `main.js` whitelist params salesOrderRef/qty; `ui/form.js` pick шлёт change на hidden. Карта обновлена.
