# Карта роли frontend

коммит: 1cab104 (+ незакоммиченная работа «Паспорт воронкой», 2026-10-25)

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
- `sections/dicts.js` — `reloadTree()` для TREE_KEY; общая таблица: метки «дубль · N» + фильтр; поле `categories` формы справочника — catChipsField. Старый редактор шаблона разделов (`passport-texts.js`, d=ptexts) переименован «Общие разделы (шаблон)»; `VARS` экспортируется.
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
