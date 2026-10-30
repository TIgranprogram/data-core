# Аудит «Коммерческие предложения (КП)» (2026-10-30)

Источники: `docs/audit/KP-SOURCES.md`, kppdf-8.0 (`D:\kppdf\kppdf-8.0\backend\src\modules\…`), data-core. Не проверено: PDF-примеры (нет средства показа PDF), `kp-brand-*.jpg`, число живых КП на проде.

## 1. Что умеет КП в kppdf-8.0
- **Схема** `quotation/quotation.schema.ts` (326 стр.): `number` (unique), `organizationId` (обязателен), `counterpartyId/contactPersonId/siteId/tenderId`, `title`, `date`, `validUntil`, `status` (draft, sent, accepted, rejected, converted, cancelled) + `statusId`, `total`, скидка (`discountType/Percent/Amount`), `orgMarkupPercent`, `vatPercent`, `prepaymentPercent`, `productionDays`, `deliveryDays`, `notes`, `terms[]`, `items[]`, `sheetLayout`, `templateId`, `designSnapshot`, `templateSnapshot`, `studioDocumentId`, семейство (`familyRole` solo/master/variant, `masterId`), `convertedOrderId/ContractId`, `isStub`.
- **Строка** `items[]` (:30–102): `lineKind` (catalog/custom/module/material), `productId` (обязателен), снимок `productName/description/productSku/photoUrl/unit`, `quantity`, `unitPrice`, `markupPercent`, `discountPercent`, `isOptional`, `total`, `rowPresentation` (плотность, акцент, `pageBreakBefore`, фото-вписывание).
- **Версии**: `POST /quotations/:id/freeze` кладёт снимок в `versions[]`, `GET :id/versions[/n]`; `duplicate`; «семья» (master + варианты для разных организаций, `family/sync-from-master`). `accepted` — правка запрещена (service :162).
- **Конвертация**: `convert-to-order` (service :833) — только из `accepted`, нужен контрагент; позиции копируются БЕЗ цен («strip-commerce», комментарий :844, :872) → CRM-коллекция `orders`, КП получает `converted`. `convert-to-contract` — отдельно.
- **PDF**: `generated-document/quotation-output.controller.ts:20` `POST /quotations/:id/pdf`, HTML → puppeteer, имя «КП-<номер>.pdf».
- **Фоны**: шаблон документа — до 5 фонов (`document-template.service.ts:1971`), фон по умолчанию и по страницам: `studio-document.schema.ts:32–41` (`backgroundImage[]`, `backgroundPageIndices[]`, `backgroundOpacity`), вывод `studio-output.service.ts:206–218`.
- **Перенос таблицы**: `sheetLayout.rowsFirstPage/rowsNextPage` (авто-оценка, если 0), `pageBreakBefore` у строки — `document-template.service.ts:860–900`. Размер шрифта и колонка фото — в `sheetLayout`.
- **Экран** (Angular): `frontend/.../commercial/proposals/` — редактор таблицы 2331 стр., инспектор 1149 стр.

## 2. Что есть в data-core
- `pwa/sections/kp.js` (211 стр.): корзина КП в `localStorage` («В КП» из «Продукции»), форма в правой панели, печать HTML-страницы в новой вкладке (Ctrl+P). Не сохраняется на сервере, нет статусов, версий, фона, переноса таблицы.
- `showcase.service.ts:512 kp()`: ничего не пишет в БД — отдаёт номер (`counter.next('CommercialOffer','КП')`), реквизиты нашей компании, строки с фото и суммами.
- Коллекция `quotations` — таблица CRM (`collections-admin.controller.ts:174`), модуля в data-core нет. Защита от удаления изделий читает `quotations.items.productId` (`catalog-references.ts:43`).
- Заказ в data-core = шапка `salesorders` + позиции `incomes` (`orderId`, `title`, `qty`, `unit`, `color`, `size`, `productId`, `unitPrice`). CRM-коллекция `orders` здесь НЕ используется (`income.schema.ts:3–6`). Значит, конвертация kppdf (в `orders`) для data-core не подходит.
- PDF на сервере: `pdfkit` (паспорта `product-passport/passport-pdf-v2.ts`, `shipments/shipment-pdf.ts`); puppeteer нет.

## 3. Что на фонах
- `kp-1str.png` (2480×3508, А4 300 dpi): синяя шапка с логотипом и реквизитами СпортИН-ЮГ, заголовок «КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ», сотовый узор, внизу — картинка площадки, подпись «Генеральный директор … А.Т.Тен», печать (запечены в фон). Рабочая зона текста — примерно от 20 % до 72 % высоты.
- `kp-2str.png`: чистая страница, внизу синяя полоса с логотипом, подпись и печать тоже запечены внизу слева. Рабочая зона — примерно от 3 % до 70 %.
- `kp-brand-…(две png)` — по размеру байт копии этих двух; `.jpg` — не смотрел.
- Вывод: нижние ~28 % и верх 1-й страницы заняты фоном; таблица обязана знать «поля» (безопасную зону) каждого фона, иначе залезет на подпись и печать.

## 4. Решение по данным
Рекомендация: **своя коллекция `commercialoffers`** (не писать в `quotations`). Доводы:
1. `quotations` — живая таблица CRM: `organizationId` и `items.productId` обязательны, `number` уникален, enum статусов закрытый. Статус «Оплачено» CRM не знает; её экраны и логика (freeze, семья) могут сломаться или молча проигнорировать запись.
2. Заказ data-core — `salesorders` + `incomes`, а не `orders`. Связка `quotationId` из CRM-логики не работает.
3. Строки КП в data-core бывают без изделия каталога (позиции из заказов, свободный текст) — в CRM это `lineKind: custom`, но `productId` всё равно обязателен.
4. Моё правило: CRM заморожена (AGENTS «Сейчас главное»); общая коллекция даёт риски без выгоды.
Совместимость на будущее: имена полей берём как в `quotation.schema.ts` (`number, date, validUntil, status, items[].{productName,productSku,quantity,unit,unitPrice,total,description,photoUrl}, vatPercent, prepaymentPercent, productionDays, deliveryDays, terms[], versions[]`) — старые КП CRM можно потом импортировать отдельным скриптом (только чтение `quotations`).
Поля `commercialoffers`: `number` (счётчик `CommercialOffer`, формат «КП-…» как сейчас), `companyId` (наша), `customer` (текст, как у `incomes`) + `counterpartyId?`, `title`, `date`, `validUntil`, `status` (`draft|sent|accepted|paid|rejected|cancelled`), `orderId?` (создан заказ → `salesorders`), `items[]`, `vatPercent`, `discount*`, `prepaymentPercent`, `productionDays`, `deliveryDays`, `terms[]`, `notes`, `layout` (фоны, блоки, таблица), `versions[]`, `total`, мягкое удаление.

## 5. Требования и критерии приёмки
- **Фоны**: у КП два фона — «первая страница» и «вторая и следующие»; по умолчанию kp-1str / kp-2str. Если загружен фон 1-й, он на стр. 1, фон 2-й — на стр. 2+; если фон 2-й не задан — стр. 2+ белые. Для каждого фона хранятся поля безопасной зоны (верх/низ, мм). Критерий: КП из 3 страниц → PDF: фон 1 на стр. 1, фон 2 на стр. 2 и 3.
- **А4**: страница 210×297, портрет, фон растягивается без искажения (пропорция 2480:3508 = А4). Критерий: PDF — ровно А4; загрузка фона другой пропорции — предупреждение.
- **Текст можно двигать**: блоки (шапка-заголовок, «Для кого», вступление, условия, подпись, примечание) — каждый имеет положение x/y (мм) и размер; в редакторе перетаскивание мышью (есть образец `pwa/ui/drag.js`) и поля X/Y в правой панели. Критерий: сдвинул блок → в PDF он на новом месте с точностью до 1 мм; кнопка «Вернуть по умолчанию».
- **Таблица переносится**: строки не обрезаются; когда не помещается, остаток уходит на след. страницу с повтором заголовка таблицы; «Итого» не остаётся одно на странице; строка с фото не разрывается. Критерий: 40 строк → таблица на 3 страницах, нет наезда на нижнюю зону фона (подпись/печать).
- **Обязательные поля `*`** в правой панели (`pwa/ui/form.js` уже умеет `required`): наша компания, заказчик, дата, срок действия, ≥ 1 строка с названием и количеством, цена (для статуса `sent`). Критерий: без обязательного поля кнопка «Сохранить» не уходит, поле подсвечено, подпись со звёздочкой.
- **Статусы**: `draft → sent → accepted → paid`; `rejected/cancelled` из любого, кроме `paid`. После `sent` правка = новая версия (снимок, как freeze). `paid` ставит менеджер вручную (в MVP не от платежей).
- **«Оплачено» → заказ**: при смене на `paid` показывается предложение «Создать заказ из КП?»; согласие открывает форму заказа, где подставлены позиции: название, количество, ед., цвет, размер, изделие (`productId`). Менеджер правит и подтверждает. Критерий: цены, суммы, НДС, скидка в `salesorders`/`incomes` не попадают (`unitPrice`/`amount` не заданы); КП остаётся с ценами; в КП записан `orderId`, в заказе — `offerId` и № КП; повторное создание из того же КП — предупреждение «заказ уже создан».
- **Два пути**: «+ Заказ» напрямую (как сейчас) не меняется и от КП не зависит. Критерий: заказ без КП создаётся без новых обязательных полей.
- **Цвет**: в КП строка имеет поле «Цвет» (как `incomes.color`), иначе подставлять нечего.

## 6. План по этапам
**Этап 1 (MVP): сохранение, статусы, PDF с фонами.**
- Backend: новый модуль `backend/src/modules/offers/` (`offer.schema.ts`, `offers.service.ts`, `offers.controller.ts`, `dto.ts`, `offer-pdf.ts` на pdfkit по образцу `shipments/shipment-pdf.ts`); регистрация в `app.module.ts`, описание в `collections-admin.controller.ts`, `docs/MAP.md`, `openapi.json`.
- API (`/api/offers`): `GET` список (`{items,total,page,limit}`, фильтр `status`, `q`), `GET :id`, `POST` создать, `PATCH :id`, `DELETE :id` (мягко), `POST :id/status {status}`, `GET :id/pdf` (А4, `application/pdf`, имя `КП-<номер>.pdf`), `POST /offers/backgrounds` (загрузка png/jpg ≤ 5 МБ, возвращает id файла), `GET /offers/backgrounds`. Роли admin/manager. `POST /showcase/kp` остаётся для обратной совместимости, потом убирается.
- Frontend: `pwa/sections/kp.js` → форма в правой панели с `*` и сохранением; новый `pwa/sections/offers.js` — список КП со статусами (раздел меню); `main.js` меню; `help-flow-data.js` обновить.
- Файлы фонов: kp-1str/kp-2str копируются как стартовый набор (сид, без правки kppdf).

**Этап 2: заказ из КП.**
- API: `POST /offers/:id/to-order` → отдаёт «черновик заказа» (`{header, lines[]}` без цен), НЕ создаёт; подтверждение — существующие `POST /salesorders` + `POST /incomes` из формы; затем `POST /offers/:id/link-order {orderId}` пишет `orderId`. Так менеджер проверяет, а существующие проверки заказов (№ договора, дубль ключа) не обходятся.
- Backend: `offers.service.ts` + поле `offerId/offerNo` в `sales-order.schema.ts` (необязательное; схема core, не CRM). Frontend: подсказка при `paid` в `offers.js`, предзаполнение формы в `salesorders.js:302` / `orders.js`.

**Этап 3: редактор макета (двигать текст, перенос таблицы).**
- Backend: `layout` (блоки x/y/ширина, поля безопасной зоны по фону, шрифт таблицы), движок раскладки таблицы по страницам в `offer-pdf.ts` (повтор заголовка, запрет разрыва строки, зона подписи).
- Frontend: `pwa/sections/offer-editor.js` — предпросмотр страницы А4 в браузере, перетаскивание блоков (`pwa/ui/drag.js`), панель X/Y.
- API: те же `PATCH /offers/:id` (`layout`) и `GET /offers/:id/preview` (разбивка по страницам: JSON `pages[]`, чтобы предпросмотр и PDF не расходились).

**Этап 4 (дальше): версии (снимки по образцу freeze), дубликат КП, шаблоны условий/вступления, импорт старых КП из CRM `quotations` (только чтение), копии КП под другую нашу компанию (аналог «семьи»), НДС/скидка/наценка.**

## 7. Вопросы пользователю (только нужные)
1. **Статус «Оплачено» — вручную или по факту оплаты в «Деньгах»?** По умолчанию: вручную (этап 1–2); связь с платежами — потом.
2. **Нужны ли в КП старые записи из CRM (`quotations`)?** По умолчанию: нет, начинаем с чистого списка; импорт — этап 4. Сколько их на проде, мне неизвестно (прод не читал).
3. **Подпись и печать запечены в фон и стоят на каждой странице: так и оставить?** По умолчанию: да (как в ваших фонах); отдельный блок подписи не делаем.
4. **КП на каждую нашу компанию (СИЮ / ССЮ) — свои фоны?** По умолчанию: фоны хранятся у КП и выбираются из списка загруженных; у компании «фон по умолчанию» — этап 3.
