# C059 — В проектирование только после распределения (автоматом)

**Статус:** выложено v1.691 (`release-v1.691-b002f677`)  
**Дата:** 2026-11-11

## Правило (пользователь)
Заказ попадает в «Проектирование» **только после полного распределения позиций**, и **автоматом** — не по этапу `stage=new` и не кнопкой «добавить».

## Сделано
1. **Доска** (`design-board.service.ts`): убран подхват всех/`stage=new`. Слева только метки `designorders` ∪ открытые задачи.
2. **Авто** `DesignService.autoFromOrderIfReady`: если все позиции распределены → `fromOrder` (задачи + метка). Вызов из:
   - `MatchingService.bulk` (и confirm/none через bulk);
   - `IncomesService` create/update (ModuleRef, без цикла модулей);
   - `ProductRequestsService.link` после подтверждения/дубля (ModuleRef).
3. **Подписи заказов** (`salesorders-next.js`, `salesorders.js`): без «откройте проектирование», пока задач ещё нет.
4. **Тесты:** board без 37-26 без метки; `autoFromOrderIfReady` — 25/25 зелёные.

## Не сделано (нужно «да»)
Разовая догонка уже распределённых заказов на проде (напр. 37-26) через `autoFromOrderIfReady` / from-order — без явного разрешения не трогаем.

## Файлы
`design.service.ts`, `design-board.service.ts`, `design.module.ts`, `design.service.spec.ts`,  
`matching.service.ts`, `matching.module.ts`, `incomes.service.ts`, `product-requests.service.ts`,  
`salesorders-next.js`, `salesorders.js`.
