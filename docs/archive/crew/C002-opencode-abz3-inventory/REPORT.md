статус: PASS
агент: OpenCode
дата: 2026-11-03
сделано:
- строк в INVENTORY: 14
- подозрительных обходов stock/supply: 4
команды:
- grep -rnE "supplyrequests|storageitems|stockmovements|reservations|materials|warehouses" backend/src | grep -v "node_modules" | grep -v "dist"
- grep -rnE "db\.collection\(['\"](supplyrequests|storageitems|stockmovements|reservations|materials|warehouses)['\"]\)" backend/src | grep -v "node_modules" | grep -v "dist"
риски:
- Найдено 4 места прямого обращения к коллекциям без фильтра `deletedAt: null` вне модулей `stock` и `supply`.
- `backend/src/modules/control/control.collect.ts` и `backend/src/common/text/shipment-ready.ts` используют сырые запросы для метрик и текста, что может привести к отображению удаленных данных.
нужно от координатора:
- Проверить, нужно ли внедрять `common/raw-query.ts` в найденные места или достаточно добавить фильтрацию вручную.
