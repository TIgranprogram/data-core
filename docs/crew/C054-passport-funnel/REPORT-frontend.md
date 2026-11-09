# C054 — отчёт frontend: F2 + F3-минимум (2026-11-09)

Статус: сделано, не закоммичено. Глазами — не проверено (стенд не поднимал). Сервер и `backend/src` не тронуты.

## Пункты ТЗ
1. Шаг «Конструкция» (Болты / Сварка / Цельное (без крепежа), несколько вариантов; «цельное» исключает остальные) — ✅
   - Воронка «Новый паспорт»: секция «Конструкция» (`funnel/joints.js`, `funnel/index.js` stagePanels) пишет в `passportDefaults.joints`.
   - Мастер черновика: шаг «Конструкция» (`passport-wizard.js`, индексы шагов сдвинуты, `missToStep` ведёт на него).
   - Форма паспорта: поле «Конструкция: как соединено» (`form.js` v2Initial/v2Body/«Запомнить»), подстановка из изделия (`product-block.js`), check-запрос (`wire-form.js`), модели прошлых паспортов (`models.js`).
   - Карточка изделия: поле «Как соединено (для паспорта)» (`products/form-fields.js`), строка во вкладке «Паспорт» (`products/tabs.js`); `joints` добавлен в `PD_KEYS` (иначе PUT passport-defaults стирал бы его).
2. «Что попадёт в PDF» — ✅ `passports/pdf-block.js`, в карточке паспорта (`passports.js` extra): таблица признаков и «откуда» (из вида изделия / материала / способа установки / выбрано), «пока не определено», раскрываемый список «Не попали в паспорт» (текст пункта, раздел, условие словами; тексты грузятся при раскрытии), при `needJoints` — заметная строка «Выберите конструкцию» с выбором и сохранением прямо там (PATCH joints → сервер пересобирает снимок).
3. Редактор «Разделы и тексты» — ✅ `passport-texts.js`: ids/when идут туда и обратно (`ownCopy`, `saveOwn`), новый пункт — новый код (у замены общего — код общего), удаление режет ids/when вместе с текстом; в панели пункта раздел «Когда пункт попадает в паспорт» (есть все из / хотя бы одно из / нет ни одного из, русские подписи; сложное условие показывается словами и сохраняется как было); в дереве у пункта метка «если: …».
4. Превью номеров — ✅ `passports/traits.js planNumbers/numbersOf` (перенос `passport-numbering.ts`, layout 2 и прежний), `card-blocks.js previewBlock`: номера подряд, один «Монтаж» (шаги способа внутри раздела `mounting`). `lastNo` удалён.
- Помощь «?»: `help-guide-data.js` (шаг «Создайте паспорт») — ✅.

## Файлы
Новые: `passports/traits.js` (константы признаков/соединений, whenText/whenToPick/buildWhen, planNumbers), `passports/pdf-block.js`, `passports/funnel/joints.js`.
Правки: `passport-texts.js`, `passports.js`, `passports/{card-blocks,form,models,wire-form,product-block,passport-wizard}.js`, `passports/funnel/index.js`, `products/{data,form-fields,tabs}.js`, `help-guide-data.js`.

## Проверки
- `node --input-type=module --check` по всем изменённым — ок; `jest src/pwa-guards` 259/259; design-lint 0 новых (всего 6434 → 6429).
- `dc check`: падают не мои — spec `PASSPORT_TEXTS_V2 › TRN` (backend, правки в работе) и «справка пульта» (`node pult/gen-docs.mjs`, чужая зона).
- Чистые функции `traits.js` проверены вручную (whenText/whenToPick/buildWhen, numbersOf).

## Риски / нужно от других
- Нужно от backend: `GET /passports/texts` дерево (`tree[].items`) не отдаёт `when`/код пункта — экран берёт из `own/all.sections[].when/ids` (работает). Если сервер пришлёт `ids` не как `p1…pN` у «Для всех» — замена по коду совпадёт автоматически.
- Мастер: шаг «Конструкция» всегда ждёт выбора (done = joints непусто), даже если пунктов с условием ещё нет в данных (B4).
- Выданные паспорта: превью номеров идёт по старой формуле (нет `layout`).
- Не сделано (вне ТЗ): `hiddenItems`/перенос правок при «Обновить текст» (F3 целиком), колонка «Размер» не тронута.
