
## frontend
- `sections/supplier-catalog.js`: `queryOf` всегда шлёт `view=all`; выгрузка Excel — через `exportQuery` (без `view`). Воронка: пункт «Без поставщика» (`supplierId=none`, `n: noSupplier`, если > 0). «Показано N из M» — M включает `noSupplier`.
- Строка материала (`kind:'material'`): в колонке «Поставщик» `badge('Поставщика нет','dim')`; карточка — только просмотр (`card.editable`), сводка «Поставщика нет — цену узнать у снабжения», блок «Поставщика нет — добавьте предложение в каталог»; «Связать с позицией» не показывается (есть materialId). `m:` и id на экране нет.
- Лимит 400 строк хука: превью импорта вынесено в новый `sections/supplier-catalog-import.js` (43 строки); основной 421 (было 447, design-lint ругается только на новые).
- Проверки: `--check` обоих файлов ок; `pwa-preload` (135 модулей); design-lint новых 0; `npx jest src/pwa-guards` 240/240.
- Допущения: tone `dim` (в kit нет `muted`); контракт `noSupplier` в `/counts` берётся из ТЗ. Просмотр дизайнером 390/1024/1920 — не делался.

## backend
- `supplier-catalog.service.ts`: `materialRow` (экспорт), `materialFilter`, `presentMaterials`, `listAll` (`$unionWith` materials + `$facet`; `supplierId=none` — find по materials; без материалов — прежний find + `kind:'offer'`), `list` ветвится по `view=all`; `counts` + `noSupplier`. Без `view` код пути не менялся.
- `supply.controller.ts` — `@ApiQuery view` (DTO запроса нет, 400 не грозит). `docs/MAP.md` — строка про `view=all`. openapi.json не перегенерирован (нужен Docker+Mongo).
- Допущения: `materialId=<id>` в запросе материалы без предложений не показывает; склад-scope применяется к материалам через `scopeMatch`; сортировка по цене/дате для материалов — null (в начале при asc).
- Тесты: `supplier-catalog.view.spec.ts` (5, fake-conn; `$unionWith` проверен по форме конвейера, не исполнялся — на стенде проверить `total` = предложения + материалы без них и время < 300 мс).
- Проверки: tsc 0; jest src/modules/supply 202 зелёных; eslint по 2 файлам чисто.

## designer (по коду, стенд не смотрели)
Вердикт: принято с 2 замечаниями 🟡.
- Только эталоны kit: badge('…','dim') (стиль .badge.dim есть в list.css), card M/fields, readonlyGroup, hint, воронка sideFilters; новых классов и inline style нет; design-lint новых 0.
- Кликабельное и текст различаются: «Поставщика нет» — бейдж, не кнопка; «Изменить» скрыт через card.editable.
- 🟡 supplier-catalog.js (top, материал): в price.value стоит текст «Поставщика нет» — плашка цены с не-ценой; заголовок и значение однотипны. Лучше price: null и подсказку hint в body.
- 🟡 extra: «добавьте предложение в каталог» — не сказано как (кнопки нет). Дать путь: «Загрузите прайс поставщика или добавьте позицию кнопкой …», иначе тупик.
- 🟢 Пустые Артикул/Ед. в readonlyGroup — проверить на стенде, что выводится «—`, не пустота.
- Нужен снимок 390/1024/1920 со строкой «Поставщика нет» и воронкой — только по разрешению пользователя.
