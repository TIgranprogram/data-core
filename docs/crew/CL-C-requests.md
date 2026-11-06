# CL-C-requests (список B)
- button/tile-вариант «плитка-кнопка» (cat-tile, sec-tile, go-tile, td-pass, ls-opt, m-fg-h, fill-head, m-cart-x): supplier-catalog.js:92,123; stock.js:114,129; home.js:256,267,328,431; fill.js:49; stock-mobile.js:314,399 — в kit нет кликабельной плитки-button.
- tabs()-вариант с «нулевым» тоном (td-chip.zero) и aria-pressed: home.js:306.
- iconButton({disabled}): сейчас disabled ставится после создания (work-route.js).
- select({disabled-option, name}): опции с disabled и атрибут name для FormData — invoice-workspace.js:174,175; staff.js:119. Динамически наполняемые фильтры (mq-f): matching-queue.js:53; work.js:158 (fill() пересобирает options).
- fileButton с доступом к file.files[0] / onchange без сброса (предпросмотр прайса): supplier-catalog.js:219.
- «тег-кнопка» .tag (chip-подсказка): composition.js:128.
- invoice-workspace.js:34 — инлайн-кнопка правки числа (.iw-inline-btn) — нет эталона «значение-кнопка».

## Список A (agent CL-C-A)
- dicts.js:93 — кнопка-заголовок сворачиваемой группы навигации (`dict-group-toggle`, aria-expanded): нужен вариант «section/toggle» или link-вариант без .link-btn вида.
- chat.js:42 — строка диалога `button.cv-row` (заголовок, последнее, время, бейдж): нужен `row({tag:'button'})` со slot для времени/бейджа.
- chat.js:93 — `pf-del` (×-значок поверх фото): нужен вариант iconButton «на фото».
- chat.js:125 — `button.chat-photo` (миниатюра-кнопка): нужна фабрика «миниатюра-кнопка».
- chat.js:69 — множественный выбор файлов (`multiple`) скрытого input: нужен `fileButton({multiple})` и вариант iconButton-подпись.
- profile.js:53 — радио-кнопки выбора аватара (`pf-av`, role=radio): нужен вариант `segmented`/radio-плитка.
- kp.js:90 — пункт выпадающего поиска `button.kp-search-item`: нужен эталон пункта подсказки (suggest-item).
- partners.js/kp.js «выберите файл» в зоне `photo-drop`: fileButton даёт .btn (не ghost); нужен `fileButton({kind:'ghost'})`.
