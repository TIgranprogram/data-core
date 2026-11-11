# Аудит кода раздела «Продукция» (2026-11-01, architect/opus)

Вердикт: работает, красных находок нет; рефакторинг — шагами S/M.

## Размер
- `sections/products.js` — 552 строки, 23 импорта («божественный» конфиг mountList); `catLanding` 53 строки; `form.fields` (~437–525) > 80 строк.
- Общие: `ui/list.js mountList` 575, `ui/card.js openCard` 268, `ui/materials-spec.js` 337, `composition.js buildCompositionForm` 129.

## Дубли
- `/dicts/persons`: products.js:72 и :440, design.js:29 (с кэшем), issue.js:17.
- `/dicts/passportCategories`: products.js:74 и :465, docs.js:106, dicts.js:310; есть `dictRows('passportCategories')` в passports/common.js.
- ФИО `[lastName, firstName, patronymic].join` — дважды в products.js.
- Ручной кэш «на N секунд» — трижды: products.js:35, :42, :227.
- PATCH порядка фото `photoIds` — три почти одинаковых места (стр. 374–376, 384).
- kp.js:94–95 — формула «Итого» дважды.

## Вид
- Ручные кнопки `h('button',{class:'btn…'})` вместо kit.button: products.js стр. 112, 146, 253, 276, 284, 343, 382 и др.

## Данные и вид смешаны
- Прямые `api()` в разметке и обработчиках (стр. 103, 115, 147, 384, 412–427, 529–546) → вынести в `sections/products/data.js` (get/list/save/remove/restore/clone/assignSku/photos/passportDefaults + кэши formValues/phrases/groups/staff/categories); вид — функции на kit (landing, строка, блок паспорта). Полноценные «умные/глупые компоненты» не нужны: «модуль данных + функции вида».

## Риски
- persons и passportCategories грузятся без кэша при каждом открытии формы (+2 запроса).
- `skuTaken` (стр. 455) — 2 запроса на срабатывание; проверить debounce.
- `designerIds` — изменяемая переменная модуля, переписывается каждой формой.
- product-files.js:28–29 — замена файла «добавить, потом удалить» не атомарна.
- kp.js:86 — blur закрывает список через setTimeout 200 мс (гонка с кликом).

## План
- S (сегодня, без смены поведения): `cachedFetch(key, ttl, fn)` в core; `staffOptions()` / `passportCategoryOptions()` с кэшем (через dictRows); `setPhotoOrder(r, ids)`; ручные кнопки → kit.button; designerIds — в замыкание формы; debounce у skuTaken.
- M: `products/data.js`, `products/form-fields.js`, `products/landing.js`.
- M отдельно, с qa: разбить `mountList` и `materialsSpec` (общие).
- Проверка: design-lint, pwa-guards, `--check`, screen-walk по «Продукции».
