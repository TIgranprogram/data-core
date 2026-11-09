# C054 — отчёт: F1 + сервер B1–B3 (2026-11-09)

Решение — `ADVICE.md` §4. Данные прода и паспорт 597 не менялись.

## Сделано
- **F1 (экран):** таблица комплектности — колонка «Размер, мм»; `parseBom(rows, prev)` сохраняет `size`, а `mass`/`photoId` берёт из прежней строки (код+наименование). Форма и мастер паспорта (`passports/common.js`, `form.js`, `passport-wizard.js`).
- **B1:** устойчивые коды пунктов `ids = p1…pN` в `scripts/passport-texts.v2.json`; `sectionItems` (paragraphs+ids+when); замена категорией, `promoteToOwn`, дерево текстов — по коду. Тест `passport-snapshot-golden`: снимки TRN/WRK/DSP/BLG/DIO побайтно как до правки.
- **B2:** `common/passport/traits.ts` — `PASSPORT_TRAITS` (10), `PASSPORT_JOINTS` (bolts/welds/solid), `parseWhen` → `PassportCondition`. `when` у пунктов, `passportDefects`, `passportStyle`; `traits` у `passportElements/Materials/Install` (`dicts.passport-traits.ts`). `joints[]` у паспорта и `products.passportDefaults`. Неизвестный признак / ошибка в `when` / разная длина массивов → 400. Нет `joints` → пункты с bolts/welds не печатаются, в «не хватает» — «Конструкция: выберите». В снимок: `traits`, `traitsFrom`, `unknownTraits`, `excluded[]`, `needJoints`, `layout: 2`.
- **B3:** `passport-numbering.ts` (`planNumbers`): при `layout=2` номера 1…N подряд, один «Монтаж». Без `layout` (выданные) — прежняя формула.

## Проверки
- `dc check`: tsc 0, юнит 3442/3442, импорты 259 файлов, циклов нет.
- Новые spec: snapshot-golden, when, traits (эталон «как 597» — 13 запрещённых подстрок, и обратный набор), numbering (160 случаев), pdf-v2-layout2, dicts.passport-traits, common traits.
- e2e `test/e2e/passport-traits.e2e-spec.ts` — написан, **не прогнан** (дома нет Docker).

## Не сделано / риски
- `docs/openapi.json` не перегенерирован (нужен Docker): новые поля тела `joints`, `sections[].ids/when`.
- Не проверено, пишет ли kppdf в `passporttemplates`/`dict_values`: его сохранение может стереть `when` (пункты вернутся в паспорт) — безопасно, но тихо.
- Пиктограмма с `when` при неизвестном признаке скрывается, выпуск не блокирует.
- Для экрана: редактор «Разделы и тексты» — слать `ids`/`when`; шаг «Конструкция» (`joints`); «Что попадёт в PDF» из `textSnapshot.excluded`/`traitsFrom`; превью `lastNo` = `planNumbers`; русские подписи признаков в справочниках.
- Данные: `traits` у видов/материалов/способов пусты → до B4 признаки `freestanding`, `walkable`, `atTree` не появятся.
