# ТЗ C002 — Инвентаризация АБЗ-3 (только таблица)

**Зачем:** Перед единым слоем общих коллекций нужна таблица «кто читает/пишет мимо stock/supply». Без правок кода.

**Класс:** S · **Агент:** OpenCode · **Max agents:** 1 · **Проверки:** grep/чтение

## Shared pack

- Решение: АБЗ-3 ещё не внедряем — только инвентаризация.
- Общие коллекции: `supplyrequests`, `storageitems`, `stockmovements`, `reservations`, `materials`, `warehouses` (см. `docs/UNIFY-SUPPLY-WAREHOUSE.md` — только раздел про список коллекций, не целиком если длинный).
- Владельцы записи по канону: `StockService` / `SupplyService` и их модуль.

## Что сделать

1. Прочитать этот ТЗ и `docs/crew/README.md`.
2. По `docs/ARCH-PLAN.md` раздел **«АБЗ-3»** (только этот подраздел) — понять цель.
3. Grep по `backend/src` (не node_modules): обращения к перечисленным коллекциям и `db.collection(` / `getCollection` / имена моделей.
4. Заполнить `INVENTORY.md`: строки таблицы.
5. Заполнить `REPORT.md` кратко.

## Читать

- `docs/crew/README.md`
- `docs/ARCH-PLAN.md` — **только** заголовок «### АБЗ-3» и его чек-лист (примерно строки 118–132)
- `docs/UNIFY-SUPPLY-WAREHOUSE.md` — список шести коллекций (начало файла)
- `docs/MAP.md` — строки про stock/supply при необходимости
- Код: результаты grep; точечно открывать найденные `*.service.ts` (сигнатуры, не файлы целиком если >200 строк)

## Читать запрещено

- PRODUCT/CANON/HISTORY/TASKS/BACKLOG целиком
- pwa/, admin/, e2e целиком
- Менять production / запускать деплой

## Менять

- `docs/crew/C002-opencode-abz3-inventory/INVENTORY.md` (создать)
- `docs/crew/C002-opencode-abz3-inventory/REPORT.md`
- Опционально: статус C002 в `docs/crew/BOARD.md` → `done`/`partial`

## Формат INVENTORY.md

| Сервис / файл:строка | Коллекция | R / W | Через stock\|supply? | deletedAt учтён? | Заметка |
|--|--|--|--|--|--|

Строк достаточно, чтобы покрыть все находки вне `modules/stock` и `modules/supply` (их можно кратко отметить «владелец — ок»).  
Сырой `db.collection('…')` по общим коллекциям — отдельными строками.

## Критерии приёмки

- [ ] `INVENTORY.md` существует, таблица не пустая
- [ ] Есть находки вне stock/supply **или** явно написано «grep пусто» с командами
- [ ] В отчёте — команды grep, которыми искали
- [ ] Код приложения не менялся

## Нельзя

- Рефакторинг, новые хелперы, правки сервисов
- Dual-write, скрипты миграции данных
- commit/push

## Шаблон REPORT.md

```
статус: PASS|PARTIAL|FAIL
агент: OpenCode
дата:
сделано:
- строк в INVENTORY: N
- подозрительных обходов stock/supply: N
команды:
- …
риски:
- …
нужно от координатора:
- …
```
