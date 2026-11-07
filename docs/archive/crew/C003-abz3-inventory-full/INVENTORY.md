# АБЗ-3 инвентаризация (полная) — 2026-11-03

Общие коллекции: `materials`, `storageitems`, `stockmovements`, `reservations`, `warehouses`, `supplyrequests`.  
Владельцы записи по канону: `modules/stock`, `modules/supply`.

## Вне stock/supply (приоритет для слоя)

| Файл:строки | Коллекции | R/W | deletedAt | Заметка |
|--|--|--|--|--|
| `partners/partners.service.ts` :67,132,146–159,270–271 | supplyrequests, reservations, stockmovements, materials | R | да (в основном) | Карточка контрагента |
| `partners/partners.service.ts` :350,372 | supplyrequests | **W** | n/a (updateMany) | Merge поставщика / orderLabel |
| `finance/finance.service.ts` :87,147,211 | supplyrequests | R | да | Календарь/сводка |
| `dicts/dicts.defs.ts` :214–719 (много) | materials, supplyrequests, stockmovements | R+**W** | смешанно | Справочники: count/list + reassign updateMany |
| `category/category.service.ts` :138 | materials | R | **нет** | Блок удаления категории |
| `control/control.collect.ts` :72–75 | supplyrequests, stockmovements | R | openReq=? / **moves без deletedAt** | Метрики control |
| `fill-audit/fill-audit.service.ts` :92–124,156–163 | supplyrequests, materials (+ storageitems в FILL_COLLS) | R | live/deletedAt в правилах | «Требуют заполнения» |
| `salesorders/salesorders.service.ts` :165–170,433 | supplyrequests, stockmovements, reservations, materials | R | да | Карточка заказа |
| `salesorders/order-history.ts` :64,72 | stockmovements, materials | R | да | История |
| `today/today.service.ts` :105–106 | supplyrequests | R | через base | Лента «Сегодня» |
| `zones/zone-events.ts` :37,59,63,65 | reservations, storageitems, supplyrequests, materials | R | да (кроме mats :65 без фильтра) | События зон |
| `common/text/shipment-ready.ts` :51–54 | reservations | R | **да** ($match) | C002 ошибочно писал «нет» |
| `showcase/showcase-materials.ts` :16 | materials | R | **нет** | Подтягивание ссылок |
| `showcase/showcase-composition.ts` :22–145 | materials, supplyrequests | R | materials :22 читает deletedAt поле; supply agg — смотреть $match | Состав/цены |
| `disk/integrity.ts` :30–33 | storageitems, reservations | R | via `alive` | Ночная целостность |
| `stock-zones/stock-zones.service.ts` :78 | materials | R | **нет** | checkRefs существования |

## Внутри stock/supply (владелец — кратко)

Сырой `db.collection` есть в `stock-catalog`, `stock-search`, `stock-composition`, `stock-spec`, `stock-reservations`, `stock-hanging`, `supply.service` (:125 materials без deletedAt на фото). Это зона владельца; АБЗ-3 переводит **соседей** на слой, не запрещает raw внутри владельца сразу.

## Не найдено (grep)

- `sheets-sync` — прямых `db.collection` на эти 6 имён в модуле нет (вероятно через сервисы/другие пути; отдельно в АБЗ-4).
- Спеки control/questions — тестовые моки, не рантайм.

## Команды

- Workspace Grep: `db.collection('materials'|…)` по `backend/src/**/*.ts`
- Точечные чтения partners, finance, dicts.defs, fill-audit, salesorders, showcase, integrity
