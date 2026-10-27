# МЦ — связь «позиция склада → материал паспорта» (совет архитектора, МЦ-1, 2026-10-27)

**Решение.** Связь — на карточке `materials` (не на `storageitems`: это остатки по складам, одна позиция — много строк).
Поле только data-core, необязательное, без `default`: `materials.passportSpec?: { materialId: ObjectId /*dict_values passportMaterials*/, sizes?: string[] /*как в materialsSpec, без «мм», normSize*/, isCoating?: boolean }`.
Схема — `material/material.schema.ts` (+ копия-комментарий «поле data-core, CRM не читает»); индекс `{ 'passportSpec.materialId': 1 }` sparse — в `ensure-indexes.js`. Валидация — тот же `oid()`/`normSize` из `common/catalog/materials-table.ts`, без нового DTO на весь PATCH (forbidNonWhitelisted) — отдельный маршрут `PATCH /materials/:id/passport-spec`, `@Roles` как у правки материала.
МЦ-6 (тексты) — туда же: `passportSpec.passportText?`, `passportSpec.techText?` — одно поддерево, одна точка чистки.

**Порядок.**
1. МЦ-2: поле + маршрут; `from-composition`: для строки состава взять `materials.passportSpec` (один `find({_id:{$in}}, projection passportSpec)` — без N+1) → нет связи — старая подсказка по названию с пометкой «подсказка» (не молча). Подсказка по названию — отдельной функцией в `common/catalog/`, переиспользует `product-match.ts`, если подходит.
2. МЦ-3: блок «Для паспорта» в правой панели карточки позиции.
3. МЦ-4: скрипт план → `--apply` + бэкап, пишет только `passportSpec` по фильтру `_id` и `passportSpec: {$exists:false}`.
4. МЦ-5, МЦ-6, МЦ-7 (старые `materialsSpec` паспортов не пересчитывать — снимок).

**Подводные камни.**
- CRM: проверить в `D:\kppdf-8.0`, что материалы не пишутся `replaceOne`/`findOneAndReplace`/`overwrite` — иначе поле стирается. `doc.save()` mongoose с strict поле не трогает. Добавить строку в `docs/UNIFY-SUPPLY-WAREHOUSE.md` и `UNIFIED-DB.md`.
- Не ставить `default` и `required` — иначе CRM-документы получат поле при каждом сохранении из data-core.
- Дубли справочника: при слиянии значений `passportMaterials` переносить ссылки и в `materials.passportSpec.materialId` (сейчас — только products/productpassports). Grep место слияния в модуле словарей.
- Удаление значения справочника: запрет/предупреждение «используется в N позициях склада» (count по индексу); мягко удалённое значение — в `from-composition` считать «нет связи», не 500.
- Mongo 4.4: без `$getField`/`$setField`; обновления — обычный `$set`/`$unset` по пути.
- Ответ списка материалов: `passportSpec` лёгкое, но тексты МЦ-6 из списочной проекции исключить.
