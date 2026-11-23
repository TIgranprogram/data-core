# C242 stageB — backend
PASS локального smoke | ✅ чистая read-only sectionProfile, dims.height/depth, сохранение осей/isImmutable/расширений в mergeDims.
✅ Числовые sectionSize/sheetSize/woodSize/оси сортируют весь scope до пагинации; unknownlast asc/desc, фиксированные формы, стабильный name/ID, priority не ломает размерный порядок.
✅ Нулевая номенклатура видна в items/lookup/categories; optional availability=none|in применяется AND после scope/status доsort/pages, counts прежние, invalid/empty400до чтений; held1 прежний, чужие зоны закрыты, storageitem не создаётся.
✅ 80×60×3 ищется через×/x/х/*/пробелы/decimalcomma; countMode single/multiple показывает0/1/>1liveячейки, count/batch(count) multiple→409 до изменения остатка внутри прежней транзакции.
Файлы: stock/{metal.ts,stock-dimensions.ts,stock-search.service.ts,stock-movements.service.ts,stock.types.ts,dto.ts,stock.controller.ts}; metal.spec.ts, stock-dimensions.spec.ts и stock-count-mode.spec.ts; MAP точечно.
Проверки P2: весь stock+stock-zones21suites/203tests PASS7.696s; после2добавленныхрегрессий адресный countMode14/14PASS5.031s. Финальные tsc0/ESLint0/diffcheck0. 0/1livecount,1live+deleted,2liveGETsum+409,stalesingle→multiple,неcountсохранены.
Регрессии:10123строки,страница11/123позиции после server-sort; полностью забронированный остаток виден; ledger/cache до-после неизменны;5вариантовпоиска80×60×3 сactualitemRows и scope.
➖ Full/e2e/OpenAPI/data-model и независимая приёмка — координатор/QA; новые поля фиксирует BACKEND-CONTRACT.md. P2 — проверка количества liveячеек в snapshot транзакции, не новое API адресации места/warehouseACL.
➖ StageC metadataCAS/скрипт/apply не реализованы по поручению; миграции, единицы, остатки, движения/брони не менялись.
Риск: физическое число труб всё ещё неизвестно и не выводится из метража; UI должен убрать floor/round и показать честные неизвестные/конфликты.
Код frozen; не коммитил, прод не читал. Карта обновлена, коммит:36bdd4dc.
