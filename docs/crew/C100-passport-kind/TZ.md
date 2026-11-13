# ТЗ C100 — «Вид изделия» для паспорта: всё определено, без угадывания

**Зачем (словами пользователя, 2026-11-13):** «Почему не угадываем по категории? Категория — более определённая сущность, название плавающее. Давай для текстов добавим специальное (подкатегорию), которое не угадывает, а полностью определено. Угадывать в нашем проекте совсем не уместно».
**Зачем — глаголом:** менеджер открывает шаблон паспорта — «что это за изделие» и «назначение» уже стоят из вида изделия (из группы) с подписью источника; если вида нет — один вопрос «Вид изделия», без «Похоже: … — верно?».

## Глубже
- **Результат:** в паспорте нет ни одной подсказки по названию; элементы, назначение и категория паспорта берутся из цепочки «своё у изделия → вид изделия → вид группы».
- **Сырьё:** `data-groups.md` (стенд, 485 изделий, 27 групп; элементы заполнены у 22). Совет opus — `ADVICE.md` (решение B+A).
- **Внешний судья:** юнит на `resolveKind` и gaps; grep `suggestElementNames|suggestPurposeName|suggestValue|по слову` → 0; снимок анкеты «3207 Стелла» на стенде.

**Класс:** L · **Max agents:** 4 (backend, frontend, qa, designer) · **Max review loops:** 2 · **Проверки:** full перед выкладкой
**Язык менеджера:** да — «Вид изделия», «из вида «Информационный стенд» (группа «…»)», без кодов.

## Shared pack (решение координатора по ADVICE.md)
- Новый справочник `dict_values`, `dict: 'passportKinds'` — «Виды изделий» (группа «Паспорта»). Поля: `name` (обяз.), `passportCategory` (код TRN/WRK/BLG/DIO/DSP, select как `PP_FIELD`), `elementIds` (multi, ref `passportElements`, ≤ 3), `purposeLeafId` (select, листья раздела «Назначение» `passportPhrases`), `notes`. Удаление — запрещено, пока вид у группы или изделия (usage/beforeRemove).
- Группа изделий (`categories`, `dicts.product-groups.ts`): поле `passportKindId` (select ref `passportKinds`), пишется сырым db, как `passportCategory`. Схему CRM не менять. Третий уровень в `categories` — НЕ делать.
- Изделие: `products.passportDefaults.kindId` (строка id). Добавить в DTO passportDefaults (whitelist!).
- Порядок источников (одна функция `backend/src/common/passport/kind.ts` → `resolveKind(db, prod)` → `{ kind: {id,name,passportCategory,elementIds,purposeLeafId} | null, source: 'own'|'group'|null, groupName }`):
  - элементы: свои `passportDefaults.elements` → вид → пусто (вопрос);
  - назначение: свой `textChoices[корень «Назначение»]` → `purposeLeafId` вида → привязка `groupIds`/`facetValueIds` листьев (как сейчас) → пусто (вопрос). Сохранённый, но удалённый/не подходящий категории выбор → «Выберите назначение заново», молча не подменять;
  - категория паспорта: своя → вида → группы (как сейчас `inheritedPassportCategory`).
  - Вызывать `resolveKind` везде, где решаются элементы/назначение/категория: `passport-gaps.ts` (productGaps, purposeState), проверка перед выпуском (`check`), сборка PDF/текста, `passport-applicability`/`productType`. Иначе анкета и PDF разойдутся — найти все места grep'ом `passportDefaults?.elements|textChoices|inheritedPassportCategory`.
- Ответ `GET …/gaps` (контракт для клиента): добавить `kind: { id, name, source: 'own'|'group'|null, groupName } | null`. Если вида нет и элементы/назначение пусты → пункт `missing` `{ key: 'kind', kind: 'kind', label: 'Вид изделия', required: true, options: [{id,label}] }` (виды подходящей категории или все). Поле `suggest` у GapItem — удалить.
- Угадывание — удалить полностью: `backend/src/common/passport/name-suggest.ts` (+ spec), `elementSuggest`, вызов `suggestPurposeName`, `suggestValue` (passport-gaps.ts:154; признак без значения — обычный вопрос, значение по умолчанию — из вида, если есть `facetValueIds`… в этой задаче не делаем, только убрать угадывание). `backend/scripts/c062-passport-purpose-plan.js` использует name-suggest — удалить скрипт (законченная задача C062).

## Что сделать
**backend (datacore-backend):**
1. `common/passport/kind.ts` — `resolveKind` + юнит-тесты (своё / из группы / нет; удалённый вид → как нет).
2. Справочник `passportKinds` в `modules/dicts/` (по образцу соседних DictBase паспорта); зарегистрировать.
3. `dicts.product-groups.ts:43-98` — поле `passportKindId` (row, toDoc, fields; select ref passportKinds).
4. DTO passportDefaults — `kindId`; запись через существующий путь `putDefaults` клиента (найти эндпоинт).
5. `passport-gaps.ts`, check, PDF, applicability — через `resolveKind`; убрать угадывание (см. выше); `kind` в ответе gaps.
6. Скрипт `backend/scripts/c100-kinds.js`: без флага — план (печать), `--apply` — запись. Создаёт виды для однородных групп (Урны, Скамьи, Навесы, Велопарковки, Информационные стенды и указатели, Ограждения, Качели ×2, Карусели, Трибуны — по имени группы; элементы и назначение — самые частые у её изделий, если есть; иначе только имя и категория) и ставит группам `passportKindId`. Изделия не трогает. Идемпотентен. На проде запускает пользователь — строка в `docs/DATA-FIX-USER.md` + пункт там же: «3207 Стелла» перенести в группу «Информационные стенды и указатели».
7. Обновить `docs/openapi.json` (перегенерация) и `docs/MAP.md`.

**frontend (datacore-frontend), после backend:**
8. `backend/pwa/sections/passports/fill/control.js:14-30` — `suggestRow` убрать; пункт `kind: 'kind'` — выбор вида (select/combo kit) → `putDefaults(prod, { kindId })` и перерисовка.
9. В анкете (раздел «Назначение и элементы», `fill/paint.js` / `fill/index.js`) — строка «Вид изделия: Информационный стенд ✎» (вид правки — как C099 `filledLink`), под ней серым источник: «из группы «…»» или «своё»; «✎» открывает выбор вида. Элементы/назначение из вида — строками «Подпись: значение ✎» (своё значение их перекрывает).
10. Убрать все «по слову «…» в названии» и «Похоже: …» из паспорта (grep в `backend/pwa`).
11. `backend/pwa/sections/atlas-data.js` и `help-guide-data.js` — шаг «Вид изделия» в блоке паспортов.

## Вид
- Эталоны kit: `link` (строка ✎), `select`/`combo`, `hint`, `stack`. Новых классов CSS нет.
- Приёмка — снимки стенда :3102: «3207 Стелла» (вид не задан → вопрос; после выбора → строки), изделие группы с видом (строка «из группы»). Тёмная и светлая тема, 1440 и 390 px. `UI-REVIEW.md` в папке.

## Файлы
- Читать: перечисленные выше места; `ADVICE.md`, `data-groups.md`.
- Не читать: DESIGN/CANON/HISTORY/TASKS целиком, `docs/openapi.json` целиком.

## Критерии приёмки (qa)
- [ ] grep `suggestElementNames|suggestPurposeName|suggestValue|name-suggest` в `backend/src` → 0; `по слову` в `backend/pwa` → 0.
- [ ] Юнит: resolveKind (3 источника), gaps (вид задан → нет вопросов элементов/назначения; нет вида → пункт kind; своё главнее вида; удалённый лист назначения → «заново»), справочник (удаление занятого вида → 409).
- [ ] PDF/проверка берут элементы и назначение из вида (юнит или e2e).
- [ ] full: весь юнит + e2e + строка TEST-LOG.

## Нельзя
- Данные прода; схема CRM `categories`; `products.categoryId`/`groupNo`/артикулы; контракт `{items,total,page,limit}`.

## Отчёт роли
`REPORT-backend.md` / `REPORT-frontend.md` рядом, в чат ≤ 12 строк.
