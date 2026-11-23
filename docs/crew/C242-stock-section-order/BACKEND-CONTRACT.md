# C242 B — серверный контракт

Существующие GET /stock/items, /stock/lookup и /stock/categories показывают разрешённую номенклатуру и при нулевом остатке; held=1 остаётся явным отбором положительного физического остатка. Нет создания storageitem ради чтения. Старые ACL/зоны/корзина/withParts сохраняются.

GET /stock/items optional availability=none|in: none — quantity===0, in — quantity>0 (включая полностью забронированное). Отсутствующий параметр — весь набор; пустой/иной параметр400 до чтения. AND после scope/status до sort/pages/enrichment; counts прежние до availability, total/items после. held=1 не меняется, held=0 как новый режим не вводится.

GET /stock/items аддитивно возвращает dims.height/depth (мм), sectionProfile для труб: shape rect|round|unknown, widthMm/heightMm/diameterMm/wallMm, label, state complete|incomplete|conflict|unknown, source dimensions|assortment|mixed. Источник assortment строго ограничен сечением, не name/ГОСТ/длиной. Конфликт сохраняет исходный текст в label и не считается надёжным размером.

Новые sort: sectionSize (rect B,H,t; round D,t; фиксированная группа форм), thickness/width/height/length/diameter/depth, sheetSize(t,W,L), woodSize(W,H,L). Числа сортируются на всём доступном наборе до страниц; неизвестные/конфликтные значения в конце при обоих направлениях; tie name/materialId. Для этих ключей priority=1 не перегруппирует порядок. Другие sort прежние.

sectionProfile вычисляется без записи. Метраж и физические штуки дополнительно не изобретаются: исходные quantity/unit/reserved/free сохраняются. Частичная mergeDims сохраняет остальные оси/метаданные/isImmutable. Новых persist полей, миграции и metadataCAS в этапе B нет.

P2: item projection read-only countMode='single'|'multiple': 0/1 живых storageitems в складе по умолчанию — single, >1 — multiple, quantity/reservedQty остаются суммой. Пересчёт count и batch(count) при multiple409 внутри существующей транзакции до loadStorage/изменения остатков, без создания новых ячеек/движений; фильтр живых как loadStorage: warehouseId/materialId/deletedAt:null (не isActive). Одна live+deleted не блокируется. Это защита от пересчёта агрегата, не новое API адресации ячейки и не новый warehouseACL.
