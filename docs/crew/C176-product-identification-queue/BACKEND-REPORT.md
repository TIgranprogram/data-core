# C176 — backend
Статус: freeze после исправления двух P1; full/архитектор/выпуск — координатор.
- ✅ Shared metadata + причины группы/effectivekind/типа; scalarфильтр до pagination/count, seriesfacets без ограничения выбраннойseries; безN+1/изображений/BOM всехизделий.
- ✅ kind-only сравнивается с BEFORE effectiveтипом; только явно выбранные совместимые kind+type разрешают переклассификацию.
- ✅ Все поля проверяются до создания категории; одна transaction включает category find/insert и productCAS с исходными categoryId+полнымdefaults.
- ✅ before содержит только изменяемые поля+expectedSHA256; новая отмена не затирает конкурентный ввод, legacyitemsбезexpected совместимы.
- ✅ Ручные/presentationdefaults и issued не переписываются; mixedfailedстрока не оставляет цену/группу/defaults/новуюкатегорию.
- Файлы: showcase-identification.ts/spec, showcase-bulk-cas.ts, showcase.service.ts, showcase-bulk.ts/spec, showcase.controller.ts; c176-product-identification.e2e-spec.ts; MAP.
- Проверки: tsc/eslint0, unit19/108PASS; итоговыйstrictrealMongo e2e10/10/0skipPASS (QA12:59,только27172/datacore-test-c176-identification), включая3rollbackкейса и положительное созданиегруппы.
- Производительность на копии и full — QA координатора; новыхиндексов/схем/коллекций нет. Legacyundo безexpected не доказывает принадлежность прежнейоперации.
- Коммитов/выкладки не выполнял; карта обновлена.
