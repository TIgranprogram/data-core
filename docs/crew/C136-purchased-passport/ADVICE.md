# C136 — паспорт поставщика для покупного изделия. Совет (architect)

Класс: L (сервер + 2 экрана, контракт API добавляется). Агентов: исполнитель backend+frontend, проверяющие qa + designer.

## Факты (grep)
- Признак «покупное» есть только у материала: `materials.materialKind = 'purchased'` (material/material.schema.ts:9,63). У products признака нет; `isPurchased` — только в строках состава (common/catalog/composition-line.schema.ts:49, product-module.schema.ts:42,69).
- Строка заказа ссылается только на изделие: order-line-plan.schema.ts:15 `productId` (+ `origin: product|manual`). materialId в строке заказа нет.
- Позиция склада: storage-item.schema.ts:27/30 — ровно одно из productId/materialId. Покупное = storageitem с materialId -> material(kind purchased).
- productattachments: `productId` required (schema:12), `typeId` (вид), `incomeId` — заточено под изделие/заказ.

## 1. Где хранить файл
- НЕ в `materials` (общая с CRM): не добавлять поле файла в схему. Файл — в своей коллекции data-core.
- Вариант: расширить productattachments добавлением `materialId?: ObjectId` (productId сделать условным: ровно одно из двух, проверка в сервисе) + новый вид «Паспорт поставщика» в справочнике видов. Хранилище, safeUploadPath, тикеты скачивания, корзина — переиспользуются.
- Индекс `{materialId:1, typeId:1, deletedAt:1}` -> ensure-indexes.js после выкладки.
- «Заменить» = soft-delete старого + новый (история сохраняется), актуальный — последний живой.

## 2. Связь заказа с покупным (минимальный путь)
- Новую связь в строку заказа не добавлять. Покупное в заказе = материал kind purchased в составе изделия строки: product -> composition lines/modules `materials[].materialId` с `isPurchased` (или kind purchased у материала). Одна функция `purchasedMaterialsOfOrder(orderId)` в product-passport: строки заказа -> productIds -> состав -> materialIds kind purchased (один `$in`, без N+1).
- Если пользователь продаёт покупное само по себе (строка `origin: manual` без productId) — сейчас ссылки нет; вопрос в QUESTIONS, не делать.

## 3. Архив и окно паспорта
- zip заказа (passport-pdf.service.ts:139 `zip`, и orderPdf:215 — только zip): после выпущенных паспортов добавить файлы поставщика как есть, имя `Поставщик_<название материала>.<ext>`, без дублей по materialId. Нет файла — строка в ответе/заголовке «нет паспорта поставщика: …», архив не падает. Не помечать markIssued.
- «Настройки паспорта»: для позиции склада с materialId kind purchased окно не открывать (frontend: stock-passport.js показывает блок «Паспорт поставщика» вместо настроек); сервер: создание паспорта для такого материала -> 400 «покупное — загрузите файл поставщика».

## 4. Разбивка
- backend: materialId в productattachments (+DTO, forbidNonWhitelisted), @Roles как у вложений, маршруты GET/POST по `?materialId=`; purchasedMaterialsOfOrder; zip; openapi + MAP.md.
- frontend: stock-card.js блок (загрузить/скачать/заменить, правая панель для ввода), stock-passport.js ветка покупного; atlas-data.js.
- Тесты: юнит — одно из productId/materialId; zip с файлом поставщика и без; дубль материала в двух изделиях -> один файл; e2e загрузка/скачивание.

## Подводные камни
- Все существующие запросы productattachments по productId должны остаться (CRM их не читает, но summary/attachments.zip заказа — проверить, что materialId-записи не попадают туда с productId:null).
- Mongo 4.4; файл паспорта — PDF/изображения по attachment-formats.ts; лимит размера — attachment-capacity.ts.
- Совпадение имён файлов в zip — суффикс.
