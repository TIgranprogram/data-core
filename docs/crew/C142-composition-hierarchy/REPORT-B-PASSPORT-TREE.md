# C142 §B — сервер: «Взять из состава» по дереву

статус: готово, не закоммичено
сделано: §B.8 ✅ модуль рекурсивно до material/детали; деталь со сырьём отдаёт сырьё (имя детали — в части), деталь без сырья остаётся сама · lineType product — чужой состав не тянем ✅ · §B.7 PDF ➖ · контракт `{ materialsSpec, materialsText, unmatched }` сохранён (`hinted` на месте)
файлы: `composition-expand.ts:125` stockRefs, `:193` expandComposition; `showcase-materials.ts:12` fromComposition; спеки `composition-expand.spec.ts`, `showcase-materials.spec.ts`
проверки: jest 15 зелёных; eslint этих файлов 0. `tsc --noEmit` красный чужим `product-module.service.ts:127` (`migrateLegacyMaterials`) — не эта правка
риски: глубина 8 кругов; модуль+деталь+сырьё = 3 чтения каталога (модуль, деталь, сырьё) вместо 0 по модулю. Кнопка уже зовёт этот маршрут. Карта обновлена.
