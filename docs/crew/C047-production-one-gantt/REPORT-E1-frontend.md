# Э1 Ф1/Ф2 — отчёт frontend
- Ф2 ✅ `backend/pwa/sections/work-schedule.js`: wsStep.get (подгрузка `/work-tasks/people?workTypeId=`), `assigneeOptions`/`assigneeMount` (список только с видом работ шага + назначенный; пункт «Показать всех…» раскрывает полный список), перенос полосы: 400 → toastError с текстом сервера + `load()` (откат), как 409.
- Ф1 ➖ ничего не нужно: «Виды работ» в `dicts.js:343-346` уже мульти-выбор (refChipsField, workTypeIds); «Часов в день» придёт полем из dict fields сервера (generic number).
- Допущение: бар `/work-schedule` содержит `workTypeId` шага (сейчас отдаёт только workTypeName, work-schedule.service.ts:68) — НУЖНО от backend: добавить `workTypeId` в бар. Без него фильтр не включается (показываются все).
- Проверки: module --check ок; design-lint новых 0; файл 256 строк.
