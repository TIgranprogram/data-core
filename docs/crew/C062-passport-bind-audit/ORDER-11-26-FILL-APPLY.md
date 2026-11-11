# Применение заполнения изделий заказа 11-26 (прод)

Дата: 2026-11-11. Разрешение: пользователь «заполни». Метод: `PATCH /api/showcase/:id`, `PUT /api/showcase/:id/passport-defaults`. Выпуск паспортов не выполнялся.

## Материалы справочника (passportMaterials)

| id | код / название |
|----|----------------|
| `6adceeeb3ca001b9b3b0e4eb` | WOOD_LOG — бревно оцилиндр. |
| `6adceeeb3ca001b9b3b0e4ea` | WOOD_LARCH — лиственница |
| `6adceeeb3ca001b9b3b0e4e1` | PIPE_STEEL_PROFILE |
| `6adceeeb3ca001b9b3b0e4e2` | SHEET_STEEL (не использован) |
| `6adceeeb3ca001b9b3b0e4f8` | COAT_OIL |
| `6ae3a049793eb93d71b3f3e6` | ZINC_POWDER (покрытие металла) |

## Результат по sku

| sku | PATCH | defaults PUT | Ошибки |
|-----|-------|--------------|--------|
| 3905 | purpose, installation, materialsSpec, facetValueIds (дерево) | merge warranty 12, install, textChoices сохранены | нет |
| 3207 | purpose, installation, materials (профтруба+лиственница+покрытие) | +warranty 12, install CONCRETE, textChoices информ.+бетонирование | нет |
| 3210 | purpose, installation, materials | +warranty 12, CONCRETE, textChoices прочее+бетонирование | нет |
| 3601 | purpose, installation, materials | +warranty 12, FREESTANDING, отдых+свободная установка | нет |
| 3206 | purpose, installation только | **пропуск PUT** (уже warranty 12, install, materialsSpec) | нет |
| 3209 DIO | purpose, installation, materials | +warranty 12, CONCRETE, textChoices игровое+DIO бетонирование; **без** age/maxUsers/fallHeight | нет |
| 3211 | purpose, installation, materials дерево | +warranty 12, CONCRETE, отдых | нет |
| 3212 | purpose, installation, materials | +warranty 12, FREESTANDING, отдых | нет |
| 3218 | purpose, materials | warranty 12, purpose=прочее; **installationTypeId не ставили** | нет |
| 3215 | purpose, installation | LAID, озеленение; **materialsSpec не трогали** | нет |

Лог JSON: `tools/logs/c062-apply/result.json`.

## План выпуска после правок (`GET …/plan`)

Позиции **10 к выпуску** (без 6102/6103): материалы/назначение/установка в основном сняты с блокеров. Осталось по плану:

| sku | missing (план) |
|-----|----------------|
| 3905 | чертёж, схема фундамента |
| 3207 | габариты, вес, фото, чертёж, схема |
| 3210 | габариты, вес, фото, чертёж, схема |
| 3601 | габариты, вес, фото, чертёж |
| 3206 | чертёж, схема, **пользователей одновременно** |
| 3209 | габариты, вес, фото, **возраст от/до**, ещё 6 (падение, рисунки DIO) |
| 3211 | габариты, вес, фото, чертёж, схема |
| 3212 | габариты, вес, фото, чертёж |
| 3218 | габариты, вес, фото, **способ установки**, чертёж |
| 3215 | габариты, вес, **материалы**, фото, чертёж |

issued=0, ready=0, blocked=12 (в плане по-прежнему 12 строк без 6102/6103).

## passport-gaps (опциональные blg.* facet)

На многих изделиях в gaps остаются необязательные `blg.fence/seats/seat/rail/material` — не заполняли (off/не относится). Пользователь может снять в воронке.

## Пользователю

- Фото, габариты, вес, все рисунки (чертёж, фундамент, зона безопасности для DIO).
- 3206: maxUsers; 3209: возраст, maxUsers, fallHeight; 3218: способ установки; 3215: текст материалов экотропы.
- Выпуск паспортов на incomeId — отдельным шагом после фото/размеров.

## Не менялось

photoIds, dimensions, weightKg, POST /passports, 6102/6103.
