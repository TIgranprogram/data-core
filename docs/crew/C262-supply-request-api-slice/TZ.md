# ТЗ C262 — Заявка снабжения через API (без прихода)

**Программа:** [C259 PLAN-SLICES](../C259-crm-api-client-plan/PLAN-SLICES.md) · после L-261  
**Класс:** L · **Max agents:** 2 · **Проверки:** smoke; full перед выкладкой  
**Старт:** 24.11.2026 — владелец «давай»

## Зачем
Запись **заявки** `supplyrequests` (создать / правка / снятие) через хозяина API. **Приход и откат прихода** — не этот срез (C265). `paid` ≠ `received`.

## Что сделать
1. Запись заявок через `supply-writes` / порт / `SupplyService` (уже есть POST/PATCH/DELETE).
2. Флаг `c262.supply.requests.api` (сид, **выкл**): выкл → create/patch/delete заявки = 409; receive/rollback-receipt **не** под флагом (остаются для C265).
3. Не трогать warehouses, materials card flag logic чужих срезов, movements, storageitems quantity.
4. REPORT: места записи kppdf supplyrequests (чтение). Не править kppdf.
5. tsc + jest supply затронутого.

## Критерии
- [x] Флаг выкл → 409 на карточку заявки; GET ок; receive не ломать молча
- [x] Приход не переведён в этом срезе
- [x] smoke зелёный

## Нельзя
- C263–C265; выкладка без «да»; снятие Mongo `readWrite` у kppdf
