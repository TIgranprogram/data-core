# C028 — ТЗ: паспорт «воронкой» (координатор, 2026-11-07)

**Класс:** XL. **Агентов:** ≤ 5 (аналитик ✅, backend, frontend, designer, qa). Циклов «проверка → правка» ≤ 2.
**Основа:** `ANALYSIS.md` (решения §3, шаги §4, разбивка §7). `BRIEF.md` — требования пользователя. Спор с ними → PARTIAL в отчёте, не «улучшать от себя».
**Не читать:** `docs/PASSPORTS-V2.md` целиком, `docs/openapi.json` целиком, `docs/archive/`, старый мастер как образец.
**Проверки исполнителей:** только `npx tsc --noEmit` (backend) / `node --input-type=module --check < файл` (pwa) и `node backend/scripts/design-lint.mjs` = 0. Юнит, e2e и стенд — одним прогоном у qa в конце (правило пользователя «тесты в конце»).
**Не коммитить, не выкладывать, на прод не писать.** Отчёт — `backend-report.md` / `frontend-report.md` в этой папке, ≤ 20 строк: что сделано, файлы, отклонения, что не проверено.

## Договор API (общий для B и F — менять только через координатора)

| № | Маршрут | Ответ / тело |
|--|--|--|
| A1 | `GET /api/dicts/productFacets`, `GET /api/dicts/productFacetValues` (как остальные справочники) | признак: `{id,name,code,category,order,step,multi,hint}`; значение: `{id,name,code,parentId,order,words[],purposePhraseId?,installTypeId?,elementIds?[]}` |
| A2 | `GET /api/passports/funnel?category=&group=&f=<valueId,…>&q=` | `{ category, steps:[{ key, label, multi, skip, values:[{ id, label, count, thumb? }], none }], products:{ items:[{ id, sku, name, photo, passportsCount, group, facetValueIds }], total } }`. `key`: `category` · `group` · `code` признака. `skip:true` — в срезе ≤ 1 значения. `none` — число изделий без значения. `q` ищет по всем изделиям (название, артикул), шаги не сужают. |
| A3 | `GET /api/showcase/:id/passport-gaps` | `{ category:{code,name,source:'own'\|'group'\|null}, missing:[{ key, label, kind:'category'\|'facet'\|'field'\|'install'\|'elements'\|'image', required, default?, suggest?:{id,label,word}, options?:[{id,label}] }] }`. Только пустое у изделия. `suggest` — по `words` значения (подсказка, не запись). |
| A4 | `PATCH /api/showcase/:id` принимает `facetValueIds: string[]`; `GET /api/showcase/:id` и список отдают `facetValueIds` | ответы воронки пишутся в изделие; остальное — существующий `PUT /api/showcase/:id/passport-defaults` |
| A5 | `GET /api/passports/texts?category=&productId=` (новый необязательный параметр) | как сейчас + фразы с `facetValueIds`, совпавшими с признаками изделия, помечены `byFacet:true` и стоят первыми |

## B1 — сервер (агент `datacore-backend`, sonnet)

Читать: `ANALYSIS.md` §3, §6; `facets-seed.json`; точечно — `backend/src/modules/dicts/dicts.product-groups.ts` (как устроен справочник с `parentId`), `dicts.passport-phrases.ts`, `backend/src/common/passport/form-values.ts:55–80`, `backend/src/common/catalog/product.schema.ts`, `backend/src/modules/showcase/showcase.controller.ts` (маршруты 98–155), `product-passport/passport-rules.ts:200–260`, `product-passport/passport-v2-text.ts`, `product-passport/product-passport.controller.ts` (маршрут texts).

- [ ] B1.1 Справочники `productFacets`, `productFacetValues` (группа «Паспорта», `editRoles` как у остальных паспортных, «Используется» и запрет удаления).
- [ ] B1.2 `products.facetValueIds?: ObjectId[]` (только data-core; без default, multikey-индекс); DTO showcase — поле добавить, **ValidationPipe whitelist** (AGENTS «Ловушки»).
- [ ] B1.3 `passportPhrases.facetValueIds?: ObjectId[]` + A5.
- [ ] B1.4 A2 — маршрут воронки: категория изделия = своя (`passportDefaults.passportCategory`) → иначе группы (`categories.passportCategory`). Только `$in`/`$all` (Mongo 4.4). Без N+1: один агрегат на срез.
- [ ] B1.5 A3 — «Чего не хватает» на основе `passport-rules.ts` (те же обязательные поля и рисунки категории) + признаки категории без значения + умолчания категории (срок службы, рост, вес, установка `defaultInstallType` из seed).
- [ ] B1.6 Убрать угадывание категории по корню слова (`form-values.ts:66–74` и функцию `stems`, если больше не нужна). Нет категории у изделия и группы → `null` (экран спросит). Юнит-тест на «оборудование» → не DIO.
- [ ] B1.7 Скрипты (план по умолчанию, запись — `--apply`; лог в `tools/logs/`): `backend/scripts/c028-facets-seed.js` (upsert по `code`, ссылки по `name`/`code` из seed → id) и `backend/scripts/c028-group-categories.js` (29 групп ← `groupCategory` из seed; не трогать группы, где уже задано).
- [ ] B1.8 Юнит-тесты к A2 (пропуск шага, `none`, `q`) и A3 (подсказка по `words`). Не запускать — только `tsc`; запустит qa.
- [ ] B1.9 `docs/MAP.md` (маршруты A2, A3, A5) — одной строкой на маршрут; openapi перегенерирует qa.

## F1 — экран (агент `datacore-frontend`, sonnet, skill `datacore-design`)

Читать: `ANALYSIS.md` §4; `BRIEF.md` п. 9; `docs/DESIGN.md` §3–4 (эталоны); шапки `backend/pwa/ui/kit/index.js`, `filter.js` (`stepFunnel` с 201), `panel.js`, `pick.js`, `table.js`; точечно — `backend/pwa/sections/passports.js:20–60` (вход «Новый паспорт»), карточка изделия в `backend/pwa/sections/products.js` (куда встать кнопке).

- [ ] F1.1 Новые файлы `backend/pwa/sections/passports/funnel/*.js` (каждый ≤ 200 строк). Старые `passport-wizard.js`, `form.js`, `wire-form.js`, `product-block.js` **не удалять**: они остаются для правки уже созданных паспортов до приёмки (удаление — отдельный пункт F3).
- [ ] F1.2 Вход А «Новый паспорт» (список паспортов) → правая панель, шаги 1–4 по A2: Категория → Группа (миниатюры) → признаки → Изделие (`table` + `row`: фото, артикул, название, «паспортов: N»; поиск по всем; «Признак не указан (N)»; `empty` с подсказкой; «+ Новое изделие»).
- [ ] F1.3 Вход Б «Создать паспорт» в карточке изделия → сразу шаг 5.
- [ ] F1.4 Шаг 5 «Чего не хватает» по A3: блоки `section`, у признака — подсказка «Похоже: … — верно?» (одно нажатие), умолчания подставлены; ответ сразу пишется в изделие (A4 / passport-defaults). Пусто — шаг пропускается.
- [ ] F1.5 Шаг 6 «Тексты» по A5: разделы шаблона категории, в каждом `pick` только текстов категории и признаков изделия, подставлено само.
- [ ] F1.6 Шаг 7 «Выпуск»: номер и дата сами; «Заполнить после печати» свёрнуто и не держит; «Выпустить PDF» — существующий выпуск (`dialogs.js` `issueAction`, `models.js`); не хватает — список со ссылкой на шаг.
- [ ] F1.7 Пройденный шаг сворачивается в строку «Категория: Уличный тренажёр ✎»; над шагами одна строка «Дальше: …». Выбранное не спрашивать второй раз.
- [ ] F1.8 «+ Новое изделие» по ходу: обязательно только название; группа, категория, признаки — из шагов; артикул — существующий `POST /api/showcase/:id/assign-sku`; `similarBox` перед «Создать»; после — назад в воронку с выбранным изделием.
- [ ] F1.9 Нет нужного варианта эталона (например, `stepFunnel` работает через адресную строку, а в панели нужно локальное состояние) — добавить **вариант** в kit + витрину `#kit`, не свой CSS. Записать в `docs/DESIGN.md` §8 одной строкой.
- [ ] F1.10 Помощь «?»: путь «Новый паспорт» в `help-flow-data.js` обновить (память: «Синхронизировать помощь»).
- [ ] F1.11 Язык менеджера: без кодов DIO/TRN на экране, понятные заголовки, пустые состояния с подсказкой. 375 / 1024 / 1920.

## B2 — тексты по признакам сами в PDF (после Q1; агент `datacore-backend`)

Пробел B1 (найден координатором 2026-11-07): фразы с `facetValueIds` видны в A5, но в PDF сами не подставляются.
- [ ] B2.1 `passportPhrases.groupIds?: ObjectId[]` (как `facetValueIds`); A5 учитывает и группы изделия.
- [ ] B2.2 Сборка текста (`passport-v2-text.ts:51–67`, `resolveChoices`): корень, у листа которого `facetValueIds`/`groupIds` совпали с изделием, выбирается сам, если менеджер не выбрал другое. Лист, привязанный к чужим признакам или группам, сам не выбирается никогда.
- [ ] B2.3 Юнит: TRN с «Изменяемой нагрузкой» → в PDF есть абзац грузового блока; TRN без неё — нет; BLG «Трибуны» → есть правила трибун, «Урны» — нет.
- [ ] B2.4 Загрузчик `backend/scripts/c028-texts-load.js` (рутина R5) — проверить сухим планом на стенде, `--apply` на стенде.

## После B1 + F1

- [ ] Q1 (`datacore-qa`, sonnet): юнит + e2e, `node --test` pwa, openapi, строка в `docs/TEST-LOG.md`; на стенде: скрипты B1.7 `--apply` на стенде; проход «силовой тренажёр из карточки → PDF» ≤ 3 нажатий при заполненном изделии; «Новый паспорт» → TRN → Силовой → изделие; старый паспорт открывается и печатается как был.
- [ ] D1 (`datacore-designer`, sonnet): приёмка экранов воронки по снимкам стенда (правая панель, иерархия сверху вниз, кликабельное отличается от текста, 375/1024/1920).
- [ ] Правки по находкам (≤ 2 цикла) → коммит → выкладка по «да» пользователя на ПФ-1/ПФ-3 (скрипты на проде запускает координатор).
- [ ] F3 (позже, отдельно): удалить старый мастер и форму создания, когда правка старых паспортов переедет в воронку.
- [ ] F2 (позже): фильтр «Продукции» по признакам.

## Рутина (внешний агент) — `ROUTINE-TZ.md`

R1 — скрипт подсказки признака по названию (без ИИ), R2 — черновики текстов. Результаты нужны к Q1 (R1 — тест подсказки) и к выкладке текстов (R2 — после проверки аналитиком).
