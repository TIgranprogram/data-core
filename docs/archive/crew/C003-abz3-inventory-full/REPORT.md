статус: PASS
агент: Cursor-координатор
дата: 2026-11-03
сделано:
- полная инвентаризация вне stock/supply → INVENTORY.md (~16 модулей/файлов)
- C002 помечен PARTIAL: пропущены partners/finance/dicts; ложный флаг shipment-ready
подозрительных без deletedAt (вне владельца):
- category.service.ts:138 materials
- control.collect.ts:75 stockmovements
- showcase-materials.ts:16 materials
- stock-zones.service.ts:78 materials
- zones mats:65; часть dicts reassign/count
запись W вне stock/supply:
- partners merge/updateMany supplyrequests
- dicts.defs reassign materials/supplyrequests
риски:
- АБЗ-3 начинать с read-фасада; W в dicts/partners — отдельные коммиты
нужно от координатора:
- следующий шаг H1 слепок ошибок или черновик ТЗ АБЗ-3 step1 raw-query
