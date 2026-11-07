# C028 F1 — отчёт frontend (2026-11-07)
Статус: готово по коду, в браузере и на стенде НЕ проверено (проверки — node --check, design-lint по моим файлам = 0).
- F1.1 ✅ `pwa/sections/passports/funnel/*` (9 файлов, каждый ≤ 114 строк); старый мастер/форма не тронуты.
- F1.2 ✅ вход А: кнопка «Новый паспорт» в «Документации» (`docs.js` page-head) → панель `of=passfunnel&new=1`; шаги 1–3 = `stepFunnel`, шаг 4 = `table`+`posPic`+`searchBox`, `empty`, «+ Новое изделие».
- F1.3 ✅ вход Б: «Создать паспорт» в блоке «Документация» карточки изделия (`products/card-blocks.js`) → сразу шаг 5.
- F1.4 ✅ `gaps.js` (A3): блоки `section`, «Похоже: … — верно?», умолчания в полях, пишутся в изделие (A4 `facetValueIds`, `passport-defaults`); пусто → открывается «Выпуск».
- F1.5 ➖ `texts.js`: разделы `section` + `select`, byFacet первыми. Дерево фраз берётся из `/passports/texts` (`funnel|phrases.sections`), иначе — из прежнего `/passports/funnel?category`.
- F1.6 ✅ `issue.js`: номер/дата сами, «после печати» свёрнуто, «Выпустить PDF» → POST /passports {productId} → issue → `printDialog`. Отклонение: без confirm `issueAction` (кнопка и есть подтверждение, ≤3 нажатий).
- F1.7 ✅ строки «Категория: … ✎» (`link`), строка «Дальше: …». F1.8 ✅ `new-product.js` (название+группа, `similarBox`, assign-sku, признаки). F1.10 ✅ `help-flow-data.js`.
- F1.9 Новые варианты kit: `stepFunnel` `onChange` (локально, без адреса) + шаг `multi`, миниатюра `o.thumb`; `.ff-ico img` в kit.css; `posPic/posPicOf` перенесены в `ui/kit/pos-pic.js` (старый путь — реэкспорт); витрина `#kit` (Фильтр, «Фото в строке»); DESIGN §8 — одна строка.
Файлы: funnel/{index,open,api,pick-steps,product-list,gaps,texts,issue,new-product}.js; ui/kit/{filter,index,kit.css,pos-pic,similar}.js; sections/{docs,kit,help-flow-data}.js, products/card-blocks.js, main.js (LAZY+OWNER), index.html (preload).
Нужно от backend / координатора (договор): 1) `GET /passports/funnel` уже занят деревом фраз (`ui/funnel.js`, `?category=`) — A2 использует тот же путь: нужно различать (например по `group|f|q` или новый путь); 2) A2: как передавать «Признак не указан» — я шлю в `f` токен `none:<key шага>`; 3) A5: где в ответе дерево фраз с `byFacet` (читаю `funnel.sections | phrases.sections | sections[с children]`); 4) A2 `photo` — объект `{url,thumb}` или строка (оба поддержаны); `thumb` у группы — адрес с сервера.
Риски: в design-lint общий итог выше baseline (чужие файлы, +168 L3) — тест `pwa-guards` «нет новых нарушений» красный не из-за F1; мои файлы чисты. Рисунки (kind image) только ссылкой «в карточке изделия» — загрузки в воронке нет.

## Элементы (gaps.js)
- Блок `elements` в «Чего не хватает»: заголовок «Что это за изделие», подсказка одной строкой, выбор — kit buildForm combo multi (поиск, до 3), вместо tagPick.
- Порядок: признаки (facet) → «Что это за изделие» → остальное (`rank` в paint).
- Файл: backend/pwa/sections/passports/funnel/gaps.js. Помощь «?» — «Элементы» не упомянуты.
- Проверки: --check ок, design-lint новых 0. qa-smoke не запускался (нет стенда в сессии).
