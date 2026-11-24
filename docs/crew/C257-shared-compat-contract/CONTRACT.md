# CONTRACT — shared-коллекции data-core и CRM kppdf

**Статус:** черновик 2026-11-24. Координатор принял как рабочий черновик (L-257); побайтный diff схем kppdf ещё открыт.  
**Не сделано:** перевод CRM на API, правки репозитория kppdf, смена схем.  
**Зачем:** data-core и CRM пишут одну Mongo `datacore`. Сломать имя, тип или обязательность поля здесь — сломать чтение CRM, и наоборот.

Опора: [ARCHITECTURE «Единая база»](../../ARCHITECTURE.md), [UNIFY-SUPPLY-WAREHOUSE](../../UNIFY-SUPPLY-WAREHOUSE.md), [C250 INVENTORY](../C250-raw-query-inventory/INVENTORY.md), [LOCKS](../C246-architecture-modularity/LOCKS.md). Схемы сняты с data-core в этот день. Дерева `D:\kppdf-8.0` на машине не было — побайтовый diff с CRM не делался.

## Кого касается

Шесть коллекций `kind: 'shared'` (реестр админки). Другие коллекции UNIFY (`categories`, `organizations`) в этот контракт не входят.

| Коллекция | Схема data-core | Хозяин записи (C250) |
|--|--|--|
| `materials` | `backend/src/modules/material/material.schema.ts` | `material` |
| `storageitems` | `backend/src/modules/stock/schemas/storage-item.schema.ts` | `stock` |
| `stockmovements` | `backend/src/modules/stock/schemas/stock-movement.schema.ts` | `stock` |
| `reservations` | `backend/src/modules/stock/schemas/reservation.schema.ts` | `stock` |
| `warehouses` | `backend/src/modules/stock/schemas/warehouse.schema.ts` | `stock` |
| `supplyrequests` | `backend/src/modules/supply/supply-request.schema.ts` | `supply` |

Писатели снаружи хозяина уже есть (склад и PDM пишут `materials`, доходы переносят `salesOrderId`, справочники делают `updateMany`). Новый обход хозяина этот черновик не разрешает. Любая запись в эти шесть всё равно соблюдает поля ниже. Массовый перевод писателей — не C257 (замок L-250).

CRM пишет те же коллекции напрямую, мимо API. Пользователь Mongo — `kppdf`. Это не отменяется этим файлом.

## Три метки поля

| Метка | Смысл | Что можно без схемы kppdf |
|--|--|--|
| **S** | CRM читает или поле из копии схемы / блока «общие поля» / UNIFY | Ничего из списка «Запрещено» |
| **A** | Комментарий схемы: CRM не читает. Либо флаг только приложения | Уточнять смысл в data-core. Не копировать в kppdf «для красоты» |
| **G** | В схеме data-core есть, пометки «CRM не читает» нет, diff с kppdf не снят | Как **S**, пока сверка с файлом CRM не перенесёт строку в A |

`*` в таблицах — поле уже объявлено как `!:` (модель data-core считает его обязательным на своей записи). Старые документы без поля читать можно. Новым полям `required: true` / `!:` не ставить.

## Запрещено без синхрона с kppdf

Синхрон = та же правка смысла в схеме CRM в том же окне выпуска, плюс явная строка в отчёте задачи. Для **A** синхрон схемы CRM не нужен. Для **S** и **G** нужен.

1. Переименовать или удалить поле **S** или **G**. Удалить поле **A**, которое уже пишется в живые документы, — только отдельной миграцией data-core (план → `--apply`, не на проде без «да»).
2. Сменить тип BSON. Особенно строка ↔ ObjectId.
3. Сузить enum или переименовать значение, которое уже лежит в документах.
4. Поставить `required: true` на поле, которого нет у старых документов CRM.
5. Поставить `default`, который Mongoose допишет в документ CRM при `save()`. Новое поле — как `workTypes`: `default: undefined`, без `required`.
6. Новый unique-индекс по shared-коллекции, пока нет сухого подсчёта, сколько документов CRM его нарушат. Индекс заводить через `backend/scripts/ensure-indexes.js` после выкладки, не руками на проде.
7. `replaceOne` / `save()` всего документа. Писать точечный `$set` / `$unset` известных полей. Иначе strict-схема снимет неизвестные ключи CRM и снимет `materials.editedInApp` (его нет в схеме, его пишет драйвер).
8. `drop`, `deleteMany({})` и любое удаление коллекции. Снятие с учёта — `deletedAt`, не физическое удаление. Смысл `deletedAt: null` (или поля нет) = живая запись для плагина data-core. Не переименовывать в булев флаг.
9. Снять `kind: 'shared'` в реестре админки. Эти коллекции из админки data-core не удаляются.
10. Включить `strict: false` на этих схемах. Включить `optimisticLockPlugin` на пяти коллекциях, кроме `materials` (там плагин уже есть, `__v` трогать отдельным решением).
11. Фичи Mongo новее 4.4 и серверный `$jsonSchema`, который отвергает старые документы CRM.
12. Менять частичный фильтр уникальности `storageitems` с `$type: 'objectId'` на `$exists: true` (второй документ той же зоны ловит чужой индекс, ответ 500).

Уже стоящие `default` (0, `[]`, `null`, `true`, статус) этим черновиком не вычищать. Это смена схемы. На новых полях их не копировать.

`timestamps: true` на всех шести не выключать: `createdAt` / `updatedAt` остаются.

## Смысл, который нельзя «упростить»

- Остаток строки склада — `storageitems.quantity`. Бронь на этой строке — `storageitems.reservedQty`. `materials.stockQty` не подменяет остаток строк. Свод по нескольким строкам не записывать обратно в одну строку как «новый ноль».
- `stockmovements.type`: только `in` | `out` | `transfer` | `adjust`. `qty` — величина движения. Знак «приход/расход» у приложения — поле **A** `delta`, не смена `type`.
- `source: 'google-sheets'` значит: история с листа, остаток этим движением не пересчитывался.
- `reservations.orderId` и `stockmovements.orderId` — **строка CRM**. `supplyrequests.orderId` — **ObjectId** ссылки `Order`. `salesOrderId` — ObjectId заказа data-core (`salesorders`). В одно поле их не сливать.
- У строки склада и у движения ровно одна из ссылок `productId` / `materialId`. В схеме не делать `required` ни на одном из пары: вторая сторона документов станет невалидной.
- `reservations.status`: `active` | `released` | `fulfilled` | `cancelled`. `qty` — количество брони для CRM. `issuedQty` — добавка приложения.
- `supplyrequests.status`: `in_progress` | `requested` | `ordered` | `received` | `cancelled`. `priority`: `urgent` | `normal` | `low`. `paid` не равен `received`.
- `warehouses.isDefault` — не больше одного `true` (так решает сервис). Уникальный индекс «ровно один» без подсчёта документов не ставить.
- `editedInApp: true` — таблицы больше не перезаписывают запись. На `materials` флаг вне схемы. На `supplyrequests` поле в схеме, метка **A**.
- `clientUid` — ключ повтора офлайн-отправки. Индекс sparse, не unique. Поле не удалять; уникальность не объявлять индексом без подсчёта дублей.
- `isActive` и `deletedAt` — разные признаки. Не схлопывать.

## Поля

### `materials`

| Метка | Поля |
|--|--|
| S | `name`*, `article`*, `unit`*, `categoryId`, `sku`, `description`, `pricePerUnit`, `stockQty`, `supplierId`, `notes`, `dimensions`*, `colors`, `photoIds`*, `mainPhotoId`, `deletedAt`, `organizationId`, `isSystem`, `sheetSource`, `sheetKey`, `syncHash` |
| A | `fullName`, `invoiceName`, `typeName`, `washed`, `passportSpec`, `workTypes`, `pdmCode`, `pdmAliases`, `pdm`, `dimSource`, `isProfile`, `profileId`, `isDefaultFormat`, `scrapFactor`, `needsName`; флаг `editedInApp` вне схемы |
| G | `materialKind`, `assortment`, `standardRef`, `materialGrade`, `weightKg`, `weightUnit`, `lastPrice`, `lastPriceDate`, `lastSupplierId`, `lastSupplierName`, `composition` |

Enum **S** у элемента `dimensions.type`: `length` | `width` | `height` | `thickness` | `diameter` | `depth`.  
Enum **G** `materialKind`: `raw` | `part` | `fastener` | `purchased` | `other`. Не сужать до сверки.  
Уже есть unique sparse: `sku`; `{organizationId, article}`; частичный `{organizationId, pdmCode}` только где `pdmCode` — строка. Их не расширять на пустые документы CRM.

### `storageitems`

Все поля ниже — **S** (файл помечен копией схемы CRM; блока «только data-core» нет).

`warehouseId`*, `productId`, `materialId`, `zoneName`, `name`, `description`, `photos`*, `weightKg`, `dimensions` (`length` / `width` / `height` / `unit`), `isActive`*, `quantity`*, `reservedQty`*, `minQuantity`*, `clientUid`, `sheetSource`, `sheetKey`, `syncHash`, `deletedAt`.

Четыре частичных unique (`warehouseId` + `productId|materialId` + зона / без зоны) не менять. Фильтр — `$type: 'objectId'`, плюс `$type: 'string'` у `zoneName` или `zoneName: null`.

### `stockmovements`

| Метка | Поля |
|--|--|
| S | `type`*, `date`*, `productId`, `materialId`, `warehouseId`*, `toWarehouseId`, `zoneName`, `toZoneName`, `qty`*, `cost`, `orderId` (string), `documentRef`, `createdBy`, `notes`, `clientUid`, `sheetSource`, `sheetKey`, `syncHash`, `deletedAt` |
| A | `delta`, `cancelledAt`, `cancelOf`, `batchId`, `source`, `salesOrderId`, `salesOrderLineId`, `reservationId`, `issuedToPersonId`, `issuedTo`, `reason`, `isReturn`, `qtyBefore`, `qtyAfter` |

### `reservations`

| Метка | Поля |
|--|--|
| S | `orderId`* (string), `productId`, `materialId`, `warehouseId`*, `orderItemIndex`, `qty`*, `isActive`*, `status`*, `zoneName`, `notes`, `expiresAt`, `clientUid`, `sheetSource`, `sheetKey`, `syncHash`, `deletedAt` |
| A | `batchId`, `groupName`, `salesOrderId`, `salesOrderLineId`, `createdBy`, `issuedQty` |

`orderItemIndex` не заменять на `salesOrderLineId`.

### `warehouses`

Все поля — **S**.

`name`*, `type`*, `address`, `description`, `isActive`*, `isDefault`*, `zoneNames`*, `roleIds`*, `deletedAt`.

`type`: `main` | `branch` | `transit` | `production` | `other`.

### `supplyrequests`

| Метка | Поля |
|--|--|
| S | `title`, `categoryId`, `materialId`, `article`, `color`, `productUrl`, `supplierId`, `organizationId`, `supplierContactId`, `companyId`, `requestedBy`, `orderId` (ObjectId `Order`), `orderLabel`, `qty`*, `unit`, `neededBy`, `status`*, `priority`*, `notes`, `priceHint`, `lineTotal`, `supplierOrderDate`, `responsible`, `invoiceNo`, `deliveryNote`, `paid`*, `paidAt`, `createdBy`, `linkedSupplyTaskId`, `num`, `requestDate`, `invoiceDate`, `sheetExtra`, `clientUid`, `sheetSource`, `sheetKey`, `syncHash`, `deletedAt` |
| A | `articleId`, `responsibleId`, `salesOrderId`, `salesOrderLineId`, `costCenter`, `costObject`, `receivedTo`, `invoiceId`, `editedInApp` |
| G | `receivedQty` |

Текст `responsible` читает CRM. `responsibleId` его не заменяет. `organizationId` не делать `required`: старые заявки без него должны читаться. Свободное имя `title` нужно, когда нет `materialId` (правило сервиса, не `required` схемы на `title`).

## Как проверить

Команда смотрит только схемы data-core: коллекция на месте, имя поля на месте, бывшее необязательное не стало `!:`, enum и тип `orderId` не съехали, `kind: 'shared'` на месте, `strict: false` не появился, оптимистическая блокировка не расползлась. Это не diff с kppdf и не e2e.

Из корня репозитория в PowerShell:

```powershell
$code = @'
import fs from "node:fs";

const spec = {
  materials: {
    file: "backend/src/modules/material/material.schema.ts",
    required: ["name", "article", "unit", "dimensions", "photoIds"],
    optional: ["categoryId","sku","description","pricePerUnit","stockQty","supplierId","notes","colors","mainPhotoId","deletedAt","organizationId","isSystem","sheetSource","sheetKey","syncHash","fullName","invoiceName","typeName","washed","passportSpec","workTypes","pdmCode","pdmAliases","pdm","dimSource","isProfile","profileId","isDefaultFormat","scrapFactor","needsName","materialKind","assortment","standardRef","materialGrade","weightKg","weightUnit","lastPrice","lastPriceDate","lastSupplierId","lastSupplierName","composition"],
    snippets: ["collection: 'materials'", "timestamps: true", "optimisticLockPlugin", "enum: ['length', 'width', 'height', 'thickness', 'diameter', 'depth']", "['raw', 'part', 'fastener', 'purchased', 'other']"],
    absent: ["editedInApp!:", "strict: false"],
  },
  storageitems: {
    file: "backend/src/modules/stock/schemas/storage-item.schema.ts",
    required: ["warehouseId", "photos", "isActive", "quantity", "reservedQty", "minQuantity"],
    optional: ["productId","materialId","zoneName","name","description","weightKg","dimensions","clientUid","sheetSource","sheetKey","syncHash","deletedAt"],
    snippets: ["collection: 'storageitems'", "timestamps: true", "$type: 'objectId'", "zoneName: null"],
    absent: ["optimisticLockPlugin(", "strict: false"],
  },
  stockmovements: {
    file: "backend/src/modules/stock/schemas/stock-movement.schema.ts",
    required: ["type", "date", "warehouseId", "qty"],
    optional: ["productId","materialId","toWarehouseId","zoneName","toZoneName","cost","orderId","documentRef","createdBy","notes","clientUid","sheetSource","sheetKey","syncHash","deletedAt","delta","cancelledAt","cancelOf","batchId","source","salesOrderId","salesOrderLineId","reservationId","issuedToPersonId","issuedTo","reason","isReturn","qtyBefore","qtyAfter"],
    snippets: ["collection: 'stockmovements'", "timestamps: true", "enum: ['in', 'out', 'transfer', 'adjust']", "orderId?: string", "salesOrderId?: Types.ObjectId"],
    absent: ["optimisticLockPlugin(", "strict: false"],
  },
  reservations: {
    file: "backend/src/modules/stock/schemas/reservation.schema.ts",
    required: ["orderId", "warehouseId", "qty", "isActive", "status"],
    optional: ["productId","materialId","orderItemIndex","zoneName","notes","expiresAt","clientUid","sheetSource","sheetKey","syncHash","deletedAt","batchId","groupName","salesOrderId","salesOrderLineId","createdBy","issuedQty"],
    snippets: ["collection: 'reservations'", "timestamps: true", "enum: ['active', 'released', 'fulfilled', 'cancelled']", "orderId!: string", "salesOrderId?: Types.ObjectId"],
    absent: ["optimisticLockPlugin(", "strict: false"],
  },
  warehouses: {
    file: "backend/src/modules/stock/schemas/warehouse.schema.ts",
    required: ["name", "type", "isActive", "isDefault", "zoneNames", "roleIds"],
    optional: ["address", "description", "deletedAt"],
    snippets: ["collection: 'warehouses'", "timestamps: true", "enum: ['main', 'branch', 'transit', 'production', 'other']"],
    absent: ["optimisticLockPlugin(", "strict: false"],
  },
  supplyrequests: {
    file: "backend/src/modules/supply/supply-request.schema.ts",
    required: ["qty", "status", "priority", "paid"],
    optional: ["title","categoryId","materialId","article","color","productUrl","supplierId","organizationId","supplierContactId","companyId","requestedBy","orderId","orderLabel","unit","neededBy","notes","priceHint","lineTotal","supplierOrderDate","responsible","invoiceNo","deliveryNote","paidAt","createdBy","linkedSupplyTaskId","num","requestDate","invoiceDate","sheetExtra","clientUid","sheetSource","sheetKey","syncHash","deletedAt","articleId","responsibleId","salesOrderId","salesOrderLineId","costCenter","costObject","receivedTo","invoiceId","editedInApp","receivedQty","createdAt","updatedAt"],
    snippets: ["collection: 'supplyrequests'", "timestamps: true", "enum: ['in_progress', 'requested', 'ordered', 'received', 'cancelled']", "enum: ['urgent', 'normal', 'low']", "ref: 'Order'", "salesOrderId?: Types.ObjectId"],
    absent: ["optimisticLockPlugin(", "strict: false"],
  },
};

const bad = [];
const admin = fs.readFileSync("backend/src/modules/admin/collections-admin.controller.ts", "utf8");
for (const [name, rule] of Object.entries(spec)) {
  const text = fs.readFileSync(rule.file, "utf8");
  const line = admin.split(/\n/).find((l) => l.includes(name + ":") && l.includes("kind:"));
  if (!line || !line.includes("kind: 'shared'")) bad.push("registry " + name);
  for (const s of rule.snippets) if (!text.includes(s)) bad.push(name + " snippet " + s);
  for (const s of rule.absent) if (text.includes(s)) bad.push(name + " forbidden " + s);
  for (const f of rule.required) {
    if (!new RegExp("\\b" + f + "!:").test(text)) bad.push(name + " required " + f);
  }
  for (const f of rule.optional) {
    if (!new RegExp("\\b" + f + "\\?:").test(text)) bad.push(name + " optional " + f);
  }
}
if (bad.length) {
  console.log(bad.join("\n"));
  process.exit(1);
}
console.log("shared-contract: ok " + Object.keys(spec).length);
'@
node --input-type=module -e $code
```

Ожидание: `shared-contract: ok 6`, код выхода 0. Любая строка `bad` — контракт или схема разъехались; чинить схему «чтобы прошло» нельзя, пока нет решения по метке S/A/G.

Перед коммитом задачи, которая трогала эти файлы, пройти список «Запрещено» глазами по diff. Команда ловит имена и enum, не ловит смену смысла числа и не ловит `$set` не того поля.

Когда дерево kppdf снова под рукой: сравнить имена **S** с `material.schema` / `storage-item.schema` / `stock-movement.schema` / `reservation.schema` / `warehouse.schema` / `supply-request.schema` CRM. Лишнее в «да» перенести в A одной правкой этого файла. Код коллекций ради сверки не менять.
