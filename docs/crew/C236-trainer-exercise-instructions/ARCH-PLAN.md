# C236 — необязательная модельная инструкция упражнения

Вердикт: **можно**, класс L, без нового справочника/коллекции/фиктивных roots/facets. Основание — REQUIREMENTS-DELTA и TARGET-PLAN: у1067/68/69 нет пригодного выбранного use-root. Устройство общих safety/use/rules и стандарт ПС-1.0 не перепроектировать.

## Контракт поля и записи

`products.passportDefaults.exerciseInstructions?: {initialPosition:string,movement:string,muscles:string}` — одно необязательное модельное значение. Все триключа обязательны при наличии объекта; неизвестные ключи/HTML/служебныеплейсхолдеры/нестроки/пустые части отклонять. Обычный текст с абзацами: CRLF→LF, trim краёв, внутренние переносы сохранить. Сумма нормализованных длин трёх частей **≤4000символов**, без тихогоtruncate; UI и сервер одинаково сообщают конкретное незаполненное поле/общийлимит. Не интерпретировать текст какHTML, форматнуюстроку или инструкциюподстановкипеременных.

На existing `PATCH /showcase/:id/passport-template?variant=short|full` добавить новый адресный ключ в `{expected,changes}`. Для этого поля CAS сравнивает **весь блок** какоднуединицу, не весьdefaults и не отдельныйпроизвольныйroot. `expected.exerciseInstructions=null` означает отсутствие; changes.object — сохранить, changes.null — удалить этот default через прежний patchpipeline. Omit — не менять. Объекты expected проверять без потери фактическогосохранённогоbaseline (не переписыватьbefore trim/нормализацией); to нормализовать. Параллельный stale→409; идентичный повтор no-op по прежним правилам. Сохранить остальныеdefaults/foundationDepth0/textChoices/overrides/elements без изменений.

Один чистый helper `common/passport/exercise-instructions.ts` задаёт тип, точнуювалидацию/нормализацию, splitparagraphs иfixedlabels. Он используется defaultsнормализацией, templatepatch и text/PDFassembly; не создавать отдельныеразъезжающиесявалидаторы. Дописать поле в существующий `PassportDefaults` и whitelist/normalizer шаблона. Не добавлять ещё один универсальныйwriteendpoint или разрешениепередаватьвесь defaults.

## Захват в экземпляре, приоритет и сохранность

**Capture-on-create/template, не live inheritance.** Новое поле попадает в образецшаблона и новыеэкземпляры явным `productPatch(...,{captureExercise:true})`; поумолчанию captureExercise=false. Все existing `fromProductDiff`/GET/sync/readiness/snapshot/issued paths не тянут и не очищают новыйблок из текущегопродукта. Новыеcreate/template callers маркировать явно, не угадыватьих по_id или отсутствию existingflag. Сохранение/удаление модели действует только на будущиеобразцы/создания, не на старыеdraft/issued.

Четыре точных захватывающихпути в текущем `product-passport.service.ts`: legacy `create():376` и `createPresentation():451` через fromProductDiff с **явным captureExerciseконтекстом**, `previewDoc():1014` и `passportTemplate():1037` через productPatch. Номерастрок до реализации C236, ориентир — именафункций. ЦентральныйfromProductDiff:221 передаётcapture только при этойопции; его existingcallers такогофлага не получают. `fieldSources():853`, `legacyPrintDoc`, normalGET и existingproductdiff сохраняют defaultfalse. `productTexts():1355` сейчас отдаёт толькоfunnel; новыйблок не маскировать под его root/leaf — source показывается изtypedtemplateответа.

В `productpassports` добавить optional typed `exerciseInstructions` безdefault: захваченнаякопия. В MODEL_FIELDS добавить для корректной копии того жеизделия; копирование на другоеизделие/явная смена productId не переносит прежнееупражнение — сбросить старыймодельныйблок с понятнымпредупреждением либо явно захватитьцелевойтолько как newcreate. Не создавать persistentinherit-marker/универсальныйфлаг. Не подставлять блок пилота другомуSKU.

**Минимум API/manualpriority:** UI редактирует только модельныйшаблон. В C236 **не добавлять exerciseInstructions в публичные Create/UpdatePassportDTO**: прямой instancepayload нового поля отклоняется whitelist400, избегая автоматического распространения через нынешний PartialType(CreateDTO) наissued. Собственныйблокэкземпляра уже зафиксированкопией и не вытесняетсяproductdiff; отдельный редакторissued/instance не нужен. Если собственный instanceAPI потребуетсяпозже — отдельныйexplicitконтракт, не скрытаяпередача вэтойдельте.

Существующие manualText/textOverrides/use-редакции сохраняют прежний приоритет и содержимое; новое поле **не** делает override всего sections.use и не заменяет purpose/simpleDescription. При смысловом дублировании показать обаисточника/предложить явнуюсверку, ничего автоматически не удалять. Текущиепилоты собственныхuse-overrides не имеют.

## Снимок и печать

Расширить существующий textSnapshot/PdfV2Text optional `exerciseInstructions` с тремячастями и небольшим сервернымsource `{kind:'product',productId}` (можно source в существующемsrc/refмеханизме с темжесмыслом). Это источник одногофрагмента, не новыйреестр. В снимке хранится текст, а не только ссылка на текущийdefault; issuedPDF использует только сохранённыйснимок/printSources. Старыйснимок безполя не дополняется изизделия при чтении/печати.

Сборка добавляет блок **отдельно от** массива общихпунктов sections.use и rules. Базовые11/15пунктовuse и4rules1067 остаются темижеключами/текстами; перемешиватьпункты разныхэлементов/упражнений нельзя. Fixed displayпорядок: «Инструкция упражнения» → «Исходное положение» → «Движения и завершение» → «Задействованные мышцы». Short/full используют одинблок, ровноодинраз в разделе пользования, сохраняяабзацы и подписи; наличиеоднихобщихrules не создаётупражнение.

PDF-путь: входtextSnapshot→PdfV2Text→существующий `passport-pdf-v2-layout.ts`/renderer. Вставить адресный рисовательблока вuse-раздел рядомсобщимиправилами, не заменяя items/ихнумерацию и не дописывая блок вторымразом черезrules. Если use-секция отсутствует, но блок задан, создать только render-useконтейнер для него; безблока прежняястраничнаяраскладка неизменна. Не вписыватьмодельныеинструкции в общий JSONпаспортныхтекстов. Не менять layoutверсию старыхвыданныхдокументов.

При новомвыпуске захваченныйблок замораживается со снимком/printSources по существующемуissue-протоколу. Изменение ужеissued — только отдельнаяявнаяредакция ПС-07 с прежнимномером и сохранениемстарогоснимка; в C236 такиеизменения автоматически не запускать. Сохранениешаблона не создаётномер/паспорт/редакцию, не трогает legacy/annulled/closed/attachmentPDF (ПС-05/07/09/10).

## Точные зоны

**Backend-контракт/сборка:** новыймалыйhelper common/passport/exercise-instructions.ts; `modules/showcase/passport-defaults.ts`, `passport-template-patch.ts` и связанныеtemplateDTO/response только новоеtypedполе; `modules/product-passport/product-passport.schema.ts`, `passport-from-product.ts`, `passport-consts.ts` MODEL_FIELDS; точечные template/newcreate callers вproduct-passport.service.ts. Не переписывать параллельный C241: его existingконтекст сохраняется, C236 добавляет только explicitcaptureфлаг/поле в разрешённыхновыхcallers. Общий ProductSchema/CRM не перестраивать: defaults уже хранятся существующим rawtemplatepipeline.

**Backend renderer/snapshot:** существующий pureV2builder места построенияtextSnapshot/PdfV2Text и `passport-pdf-v2-types.ts`, `passport-pdf-v2-layout.ts`; небольшие адресныетесты. Исполнитель фиксирует один канонический путьсозданияблока и source, не дублирует сборку вкаждомrenderer. Snapshot-refresh/revision трогать лишь для сохранности новогоoptionalполя, без массовойпересборки старыхданных. MAP/data-model/openapi синхронизировать.

**Frontend:** `sections/passports/book-template.js`, `book-template-edit.js` и адресныймалыймодуль editorблока при необходимости; существующее «Правилапользования» вкнижке. Триtextarea+счётчик4000+Save/явное«Удалитьинструкцию», expectedbaseline и прежнийunsavedguard; значения привязаны к текущемуtemplate.productId/variant. Никаких новыхменю, выборафасетов/справочникаупражнений или выдуманныхplaceholder-текстов. sourceUI отличаетобщиетексты/модельныйблок. Все значения DOMtext/textarea, безinnerHTML.

## Приёмка и данные пилота

- РеальныйValidationPipe/templateparser: absent/object/nullclear/partial/unknownkeys/HTML/placeholders/nonstring/>4000/абзацы; CASstale и независимаяправкадругогоdefault, repeat/no-op. Все существующиеdefaults до/после равны, включаяfoundationDepth0 и manualtext/roots.
- Templateбезuse-root сохраняеттриполя; short/full JSON+всестраницыPDF показывают одинблок/триподзаголовка, исходные11/15use+4rules сохранены. ЧетвёртыйTRN/другаякатегориябезблока baselineнеизменны; read-only preview не создаёт сущности/номер.
- Newcreate захватывает правильныйSKU; copyтого жеизделия не теряетполе; сменамодели не переноситчужойтекст. Послеизменения/clearшаблона существующиеdraft/issued, триissued1067, номера/снимки/история/PDF не меняются при2GET/печати. Послеclear новыйобразец/созданиебезблока. ПрямойinstanceDTOполе400.
- Дваодновременныхредактора, cancel, resetformпри сменеSKU/variant,409сохранениевведённоготекста; readonly/права прежние. Отдельнаяdesktopdesignerприёмка редактора и заполненныхPDF по стандарту; unit/e2e/backendverify на итоговойдельте.
- PILOT-CONTENT.json остаётся draft дляpreview. 1067/1068 — после проверкиисточника/конечноготекста;1069 — **до подтверждения владельцем связи найденнойIAMсSKU не сохранять**. Реальныезаписи отдельноточнымпланом черезaccess, не исполнителемкода. Источник/версия/одобрение остаютсяв C236, не в публичнойинструкции.

Код и прод при планировании не менялись. Принятиеплана не объявляет утверждённым контент1069 и не разрешает массовуюмиграцию существующихпаспортов.
