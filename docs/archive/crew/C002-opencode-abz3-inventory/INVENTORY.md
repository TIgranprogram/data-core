| Сервис / файл:строка | Коллекция | R / W | Через stock\|supply? | deletedAt учтён? | Заметка |
|--|--|--|--|--|--|
| `backend/src/common/text/shipment-ready.ts`:51 | `reservations` | R | Нет | Нет | Raw aggregate в утилите для текста. |
| `backend/src/modules/category/category.service.ts`:144 | `materials` | R | Нет | Нет | `findOne` при удалении категории. |
| `backend/src/modules/control/control.collect.ts`:75 | `stockmovements` | R | Нет | Нет | `countDocuments` в метриках. |
| `backend/src/modules/supply/supply.service.ts`:125 | `materials` | R | Нет | Нет | `find` для получения фото материалов. |
| `backend/src/modules/stock/stock-spec.service.ts`:43 | `storageitems` | R | Владелец — ок | Да | Тест в модуле владельца. |
| `backend/src/modules/zones/zone-events.ts`:37 | `reservations` | R | Нет | Да | Скрипт зон (офлайн-логика). |
| `backend/src/modules/zones/zone-events.ts`:50 | `storageitems` | R | Нет | Да | Скрипт зон (офлайн-логика). |
| `backend/src/modules/zones/zone-events.ts`:63 | `supplyrequests` | R | Нет | Да | Скрипт зон (офлайн-логика). |
| `backend/src/modules/zones/zone-events.ts`:65 | `materials` | R | Нет | Да | Скрипт зон (офлайн-логика). |
| `backend/src/modules/today/today.service.ts` | `supplyrequests` | R | Нет | Да | Лента "Сегодня" (основной цикл). |
| `backend/src/modules/today/today.service.ts` | `salesorders` | R | Нет | Да | Лента "Сегодня" (основной цикл). |
| `backend/src/modules/today/today.service.ts` | `designtasks` | R | Нет | Да | Лента "Сегодня" (основной цикл). |
| `backend/src/modules/today/today.service.ts` | `worktasks` | R | Нет | Да | Лента "Сегодня" (основной цикл). |
| `backend/src/modules/today/today.service.ts` | `designnotes` | R | Нет | Да | Лента "Сегодня" (основной цикл). |
