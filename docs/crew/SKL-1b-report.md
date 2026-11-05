# СКЛ-1b backend — отчёт

Статус: готово, tsc 0, jest stock + stock-zones 15 наборов / 136 тестов зелёные, eslint чисто. Не коммичено, прод не трогался.

- (1) `batch out` (`stock-movements.service.ts` ~184): проверка «свободно» = остаток − бронь + бронь этого же заказа. Нехватка — отказ целиком, 400 с `details:[{materialId,name,need,have,free,reservedOther,lack}]`. Под бронь своего заказа выдача разрешена, `reservedQty` уменьшается на долю своей брони. Ограничение: записи броней (`reservations`) при этом не закрываются (как и раньше) — выдача под бронь лучше через `reservations/issue-order`.
- (2) `reserve-list` (`stock-reservations.service.ts:34`, `dto.ts` `StockReserveLineDto`): `groupName` необязателен («Заказ № …» из заказа; нет ни имени, ни заказа — 400); у строки свой `salesOrderLineId`, `short` его возвращает.
- (3) Скрипты: `stockzones-merge-pipes.js`, `stockzones-rename-wood.js`, общий `lib/backup-fresh.js` (при `--apply` нужен `BACKUP_DIR` с `mongo-*` не старше 24 ч, иначе стоп). Идемпотентны. `stockzones-boards.js`: `ZONE`/`ROLE` изменены на новые имена (иначе повторный запуск создал бы вторую зону).
- Тесты: 3 на batch out (`stock-movements.service.spec.ts`), 3 на reserve-list (`stock-reservations.service.spec.ts`). Скрипты на Mongo не прогонялись (только `node --check` и стоп без бэкапа).
- docs/MAP.md обновлён. openapi.json не перегенерирован (нужен Docker+Mongo). e2e не писался.

Команды плана (ничего не пишут):
`MONGO_URI=<uri> MONGO_DB=datacore node backend/scripts/stockzones-merge-pipes.js`
`MONGO_URI=<uri> MONGO_DB=datacore node backend/scripts/stockzones-rename-wood.js`
Запись: добавить `--apply` и `BACKUP_DIR=<каталог бэкапов>`.

Нужно от frontend: при 400 на `/stock/batch` читать `details` (таблица нехватки). Порядок на проде: сначала merge-pipes, затем rename-wood (независимы).
