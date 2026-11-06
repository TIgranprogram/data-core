# C028 backend (B1) — отчёт

**Статус: DONE, с оговорками ниже.** Проверено только `npx tsc --noEmit` (0 новых ошибок; старая в `test/stand/kp-pdf.stand.ts` — КП, не моя), eslint по новым файлам чист. Юнит не запускались.

- B1.1 ✅ `dicts/dicts.product-facets.ts` (+ `dicts.defs.ts`, `dicts.meta.ts`): `productFacets`, `productFacetValues`, группа «Паспорта», правит director, «Используется»/запрет удаления/объединение. Значение: `words[]` (в форме — `wordsText` «a|b»).
- B1.2 ✅ `products.facetValueIds` (схема без default, индекс — `scripts/ensure-indexes.js` RAW); `showcase.service.ts`: запись (проверка по справочнику) и ответ `facetValueIds` в списке и карточке. DTO у showcase нет (`Record`), whitelist не мешает.
- B1.3 ✅ `passportPhrases.facetValueIds` (поле справочника, не затирается при правке); A5 — `GET /passports/texts?category=&productId=` → добавлено `phrases[]` с `byFacet`, первыми; чужие признаки при заданном изделии скрыты.
- B1.4 ✅ A2 — `passport-funnel.ts` + pure `common/passport/funnel.ts`. Один запрос изделий и счёт в памяти (не Mongo-агрегат: тот же результат, без N+1). Максимум 200 изделий в `items`, `total` полный.
- B1.5 ✅ A3 — `passport-gaps.ts`, маршрут `GET /showcase/:id/passport-gaps` объявлен в `ProductPassportController` (не в showcase: без связи модулей). Поля/рисунки — через `check(mode:'template')`; признаки без значения + `suggest`; умолчания: установка (код из seed), срок службы.
- B1.6 ✅ угадывание по корню убрано (`form-values.ts`), spec обновлён («оборудование» → не DIO).
- B1.7 ✅ `scripts/c028-facets-seed.js`, `scripts/c028-group-categories.js` (план / `--apply`, лог в `tools/logs`; существующее не перезаписывают). На сухом seed: 17 признаков, 65 значений, 28 назначений без текста (нужен R2).
- B1.8 ✅ spec: `common/passport/funnel.spec.ts`, `product-passport/passport-gaps.spec.ts`, `form-values.spec.ts`. B1.9 ✅ `docs/MAP.md` (абзац C028).

**Отклонения от договора (аддитивные, ответы не ломают):**
1. `GET /passports/funnel` уже отдавал дерево текстов `{sections}` — ответ теперь объединение `{sections, category, steps, products}`. Старый клиент работает.
2. `f` понимает ещё `none:<id или код признака>` — «признак не указан» (нужно для кнопки «Признак не указан (N)»).
3. A3: `default` у установки — `{id,label}`, у «срок службы» — число; у признака добавлено `multi`; `required` у признаков = false.
4. A2: `thumb` у значения группы — URL миниатюры; `photo` у изделия — `{url,thumb}|null`.

**Нужно от других:** координатор — кнопки пульта для двух скриптов `c028-*` (иначе `dc check` падает); openapi перегенерирует qa; R2 — тексты назначений, иначе `purposePhraseId` пустой.

## B2 — тексты по признакам и группам сами в PDF (2026-11-07)
- B2.1 ✅ `passportPhrases.groupIds` (справочник: поле «Группы изделий», не затирается при правке; `dicts.passport-phrases.ts`); `toNode` читает `facetValueIds`/`groupIds`; A5 (`phrases[]`) учитывает группу изделия и её родителей (`groupChain`), в ответе добавлено `groupIds`.
- B2.2 ✅ `phrase-tree.ts`: `resolveChoices(forest, saved, ctx?)` — без выбора менеджера берётся вариант, совпавший с признаками/группой изделия; привязанный к чужим (или изделие неизвестно) сам не выбирается никогда; явный выбор сильнее. Контекст изделия — `productCtx` в service → `buildV2Text`.
- B2.3 ✅ `passport-v2-text-bound.spec.ts` (3 теста: TRN с/без нагрузки, BLG «Трибуны»/«Урны», приоритет выбора). jest product-passport + common/passport + dicts: 48 suites / 800 зелёные; tsc — только старая ошибка kp-pdf.stand.
- B2.4 ✅ загрузчик: найден дефект — группы/разделы брались из `dict_values`, а живут в `categories` (type product); исправлено в `main` (3 строки), логика плана не менялась. Стенд :3102: сухой план 27 корней/27 листьев/6 назначений, 0 пропусков; `--apply` создал 60 записей (откат: `%TEMP%/c028-texts-backup.json`, createdIds); повтор = 0 новых. `texts-numbers.md` перезаписан планом (16 вырезанных «[уточнить]»).
- Риск: работающий на стенде бэкенд собран до B2 — привязка в PDF проверится после его пересборки. Прод не трогал; нужна кнопка пульта для `c028-texts-load` (как у двух других c028-скриптов).
