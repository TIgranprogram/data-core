Статус | FREEZE frontend; независимая QA/визуальная приёмка и стенд ожидаются.
Сделано | ✅ В существующей книжке «Правила пользования» → добавить/изменить инструкцию → три textarea справа, общий счётчик 4000, сохранить/отмена/явное удаление с подтверждением.
Сделано | ✅ Raw baseline всего блока в expected, нормализованный changes/object или null; прочие defaults не передаются, foundationDepth=0 сохраняется; 409 оставляет ввод и baseline.
Сделано | ✅ Цифровые template/instance читают только typed textSnapshot, три заголовка ровно один раз; общий use/rules отдельно. Instance без edit/add; observer без редактирования шаблона.
Сделано | ✅ Смена варианта через unsaved guard, смена SKU блокирует stale save; 1069 остаётся пустым черновиком. Kit maxlength=2000 снят только с трёх новых полей, без тихого truncate.
Файлы | passports/book-exercise.js, book-exercise-edit.js, book-exercise.test.mjs; адресно book-blocks.js:176,179, book-editor.js:29,194, book-template-edit.js:47. book-template.js уже обеспечивает whole-block CAS и не менялся.
Проверки | 43/43: новый actual-book browser 9/9 + existing book-autofill/book-entry/book-installation-plan; guards411/411; imports/syntax418/418; design-lint0 NEW; diff --check PASS.
Доказательства | evidence/fixture: exercise-editor-light/dark, exercise-draft-empty-light, exercise-validation-light, exercise-conflict-light.png; настоящий book-editor/sideForm на локальном HTTP-origin, подменён API.
Приёмка | UI-REVIEW.md: самопроверка заполненного/пустого/ошибки в 1920×1080, обе темы; независимый дизайнерский PASS не присваивался. Fixture не доказывает серверный CAS/публикацию/PDF.
Границы | Backend/PDF/stock/atlas/help не менялись; pwa-preload запущен, его 4 строки index.html относятся к параллельной C242. Нет записей прод/коммитов/деплоя.
Карта | docs/roles/maps/frontend.md дополнена якорями; коммит: 36bdd4dc (опорная ревизия). Карта обновлена.
