# C253 — хозяин записи products

Статус: готово, без коммита. HTTP не менялся. Прод не трогался. C254 не начат. L-251 и L-252 не менялись.

Сырая запись коллекции `products` в рантайме — только `backend/src/modules/product/product-writes.ts`. Модель в `ProductService` по-прежнему создаёт, правит, копирует и архивирует изделие каталога (`create` / `findOneAndUpdate` / `updateOne`). Методы `ProductService` с `:353` — фасад тех же функций. Вторая транзакция не открывается: сессию передаёт вызывающий.

Витрина не импортирует `modules/product`: цикл `product → category → showcase`. Она зовёт `common/product-owner-port.ts`. Остальные писатели зовут `product-writes` напрямую. PDM по-прежнему пишет моделью изделия (timestamps и аудит хуков живы), но вызов стоит в хозяине.

## Покрытие до перевода

Уже было: карточка каталога, версия, фото, копия — `product.service.spec.ts`; удаление витрины — `showcase-remove.spec.ts`; книжка паспорта — `passport-template-patch.spec.ts`; дерево PDM — `pdm-import.service.spec.ts`; перенос текста — `passport-field-promote.spec.ts`.

Дописано: корзина без живого изделия, восстановление, чужой снимок массовой строки и её отмены, книжка 404/конфликт, план по `updatedAt`, захват паспорта и фото, серия/проектировщик/название в договоре, порядок признака и покрытия, нулевой вес PDM — `product-writes.spec.ts`.

## Операции

| Операция | Кто звал | Транзакция | Аудит | Повтор |
|--|--|--|--|--|
| Создание / правка / копия / архив каталога | `ProductService` | нет своей сессии | version `__v` на правке и составе; `editedInApp` не было | чужой `__v` состава — конфликт; артикул-дубль — 409 |
| Умолчания паспорта витрины | `replacePassportDefaults` | нет | `updatedAt` | нет изделия — 404, поля не пишутся |
| Массовая строка | `commitBulkProductRow` | сессия строки | нет отдельного журнала | чужой снимок — конфликт, соседние строки вызывающий пропускает |
| Отмена массовой правки | `restoreBulkProduct` | нет | `updatedAt` в патче вызывающего | чужой снимок — конфликт, старые поля не возвращаются |
| Черновик / элементы / артикул / клон / вариант | вставка и точечные `$set` | сессия только у черновика из заявки | `source: showcase` у черновика | дубль артикула ловится до вставки |
| Правка и корзина витрины | `patchShowcaseProduct` / `archiveShowcaseProduct` | нет | корзина — только `deletedAt` | нет живого — 404 |
| Восстановление из корзины | `restoreShowcaseProduct` | нет | нет | совпадений может быть 0, ошибки не было и нет |
| Состав витрины | `replaceProductComposition` | нет | `updatedAt` | тот же массив переписывается тем же значением |
| Изделие из паспорта | `setDefaultsFromPassport` | нет | `source: passports` | пустой набор вызывающий не шлёт |
| Книжка паспорта | `commitPassportTemplate` | нет | `updatedAt` в патче | нет изделия — 404; чужой снимок — конфликт |
| Справочники: часть, серия, размер, материал, вид, фраза, группа, признак | `reassignProduct*` | сессию справочник не передавал | `updatedAt` там, где он был | повтор после переноса находит 0; признак сначала добавляет, потом снимает |
| Название в договоре | `fillEmptyOrderName` | нет | нет | пустой текст и уже заполненное не пишутся |
| Проектировщик | `fillProductDesigner` | нет | `updatedAt` | заполненный `designerId` не перебивается |
| План в изделие | `applyPlanToProduct` | сессия плана | `updatedAt` = метка копии | чужой `updatedAt` — конфликт |
| Норма факта / маршрут | `applyProductWorkNorm` / `saveProductRoute` | нет | `updatedAt` | нет факта — запись не зовётся; пустой маршрут снимается `$unset` |
| Состав из задания на модуль | `saveReleasedProductComposition` | сессия задания | `__v` +1 | модуль пишется своей коллекцией, не здесь |
| Захват паспорта / фото | `claimPassportProductVersion` / `claimProductPhotoVersion` | сессия вызывающего | `__v` и `updatedAt` | нет живого: паспорт — конфликт, фото — 404 |
| Импорт Inventor | `importPassportProductFields` | сессия импорта | `__v` и `updatedAt` | нет живого — конфликт, рисунки следом не пишутся |
| Текст паспорта на изделии | `promoteProductPassportField` | нет | `updatedAt` | не одно совпадение — конфликт |
| Группа и вес PDM | `fillEmptyProductCategory` / `fillEmptyProductWeight` | сессия применения | `updatedAt` ставит хук модели | пустые поля; вес ≤ 0 не пишется |
| Дерево и фото PDM | `updatePdmProduct` / `insertPdmProducts` / `attachPdmProductPhoto` | сессия применения; фото без неё | хуки модели | пачка вставок сохраняет порядок; чужое главное фото не перебивается |

## Белый список

| Кто | Почему остаётся |
|--|--|
| `scripts/import-catalog-photos.js` | разовый импорт фото вне Nest |
| `scripts/c094-materials.js`, `c103-own-types.js`, `c106-clear-c062.js`, `c106-restore-doubtful.js`, `c112-a2-gone-choices.js`, `iz21-regroup.js`, `names-migrate.js`, `passport-category-defaults.js`, `passport-category-groups.js`, `products-category-from-passports.js`, `products-fill-defaults.js` | разовые скрипты |
| `scripts/passport-dicts-cleanup.js`, `scripts/merge-product-category.js` | разовые, имя коллекции в переменной |
| `scripts/archive/migrate-maf-to-blg.js`, `passport-fields-to-product.js`, `passport-install-method.js` | архив |
| `ensure-indexes.js`, `c164-source-indexes.js` | индексы, не документы |
| админка «Таблицы» | эти девять коллекций не пишет |
| kppdf | вне data-core, общий Mongo |

Чтения `products` не переводились. Запись `productmodules` в том же задании на модуль не трогалась. Запись `materials` и `dict_values` при объединении справочника не трогалась: это не коллекция изделий.

## Grep

До (C250): сырые `updateOne`/`updateMany`/`insertOne` у showcase, dicts, matching, design, order-line-plan, work, product-passport, product-photo; модель ещё у pdm-import и pdm-preview.

После: `collection('products')` с записью в `backend/src` — только `product-writes.ts`. `model.create` / `model.updateOne` / `model.findOneAndUpdate` каталога — только `product.service.ts`. Модель PDM для изделия зовут `fillEmptyProductCategory`, `fillEmptyProductWeight`, `updatePdmProduct`, `insertPdmProducts`, `attachPdmProductPhoto`.

## Проверки

`npx tsc --noEmit` — 0.  
`npx jest` 139 файлов (product, showcase, dicts, matching, design, pdm-import, product-photo, product-passport, order-line-plan, work) — 1246/1246.  
`node scripts/audit-cycles.js` — новых циклов 0, пар 0.  
eslint изменённых файлов — 0.
