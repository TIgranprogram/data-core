# Уроки роли backend

> Закрытые темы — одна строка: дата · что было · как решено · источник. Перед работой — Grep по теме здесь.

- 2026-11-18 · первая запись `composition` прятала `materials[]` / `productModuleIds`, GET legacy давал новый `_id` · перенос до add/update (`storedModuleMaterialLines` / `storedProductModuleLines`), граф читает legacy только пока массив пуст · C142 фикс legacy
- 2026-11-18 · «Взять из состава» смотрело только прямые `lineType: material` — модуль давал 0 строк · `fromComposition` → `composition-expand`: модуль рекурсивно, сырьё детали в таблицу, вложенное изделие не раскрываем (свой паспорт); выпущенный паспорт поле не пересобирает · C142 §B
- 2026-11-11 · второй живой паспорт на позицию нельзя закрыть unique-индексом `incomeId` (на проде без «да»; старые дубли и аннулированные) · замок в коде `assertOneLive` (409), корзину прячет soft-delete, себя исключаем; файл печати не в DTO (иначе forbidNonWhitelisted), только `POST /passports/:id/print-file` · C062

- 2026-11-04 · календарь «счета к оплате» 0 при просрочке в прогнозе: `ops` брал неоплаченные только с `invoiceDate` внутри периода, прогноз ставил срок ≤ сегодня на сегодня (не старше 90 дней) · `foldOverdueInvoices` + добор раньше периода, лимит общий `invoiceStaleSince` · MONEY-SHOW §B
- 2026-11-04 · `sectionOpen(stock-mobile)` открывал `requests`, кладовщик телефона писал заявки; `sees()` показывал «Склад (телефон)» всем с «Остатки» · `sectionOpen` даёт только `stock`; GET списка и POST receive — `@AppSection('requests','stock','stock-mobile')` (метод перекрывает класс, `stock` нужен экрану «Остатки»); POST create без метода — только класс `requests`; автопоказ в `sees()` снят · C020 волна B
- 2026-10-24 · в `src/**` и MAP.md часть файлов с CRLF: многострочная замена из node не находит текст, а `sed -i` в Git Bash снимает CRLF со всех строк · перед правкой `file <путь>`; в node переводить `\n` в `\r\n`, для MAP.md после правки сверить `git diff --stat` (должны быть 1–2 строки) · SK-5a
- 2026-10-24 · длинный `python - <<'EOF'` с кириллицей и кавычками в Git Bash падает «unexpected EOF» · многострочные правки — скрипт в scratchpad (Write) + `python файл.py`; CRLF: читать с newline='', заменять \n→\r\n при записи · SK-8c
- 2026-10-24 · ручная правка `docs/openapi.json` через `JSON.parse`→`stringify` переставляет ключи-числа (коды ответов `401` перед `400`) — дифф на весь файл · вставлять блоки текстом по якорю (`"    \"/persons\": {"`), `JSON.stringify` только для нового куска с отступом; затем `JSON.parse` для проверки · ОШ2.1
- 2026-10-24 · ТЗ «DTO для новых полей» у `/showcase` · у контроллера тела `Record<string, unknown>` — ValidationPipe их не проверяет (метатип Object), поля разбирает сервис (`fields()`); DTO только на новое поле дал бы 400 на все остальные (forbidNonWhitelisted) · новое поле — в разбор сервиса с 400 по-русски, DTO — только целиком (АБЗ-6) · МИ.2

- 2026-11-18 · C095 modules[] содержит паспортные dims/photoId, которых нет в физическом BOM: нельзя удалять или скрывать всё по наличию compositionSheet. Только exact plain multiset-дубль подавляется внутренним presentation marker; data и история сохраняются · C152.

### C158: строгая валидация e2e и денежные роли (2026-11-19)
- Production forbidNonWhitelisted=true, старый test-db харнесс его не включал. Для нового финансового контракта createTestApp({strictValidation:true}), иначе тест неизвестного поля даёт ложный200.
- JwtStrategy.resolveForAuth восстанавливает role.money из БД на каждом запросе; in-memory setRoleMoney в e2e не моделирует выключенную галочку. Менять роль только в изолированной testDb и проверять реальные HTTP ответы.

### C158: replay, scoped legacy и выбор источника (2026-11-19)
- Хеш clientUid строить из нормализованного отправленного тела, не из текущих defaults документа: после void разрешена смена валюты/плательщика, исходный replay обязан вернуть текущую карточку без нового факта.
- Stockscope ограничивает не только строки, но snapshot.amount и историю корректировок; неизвестные before/after по частичному доступу не показывать.
- Для глобального подавления legacy достаточно batch заголовков по invoiceId найденных заявок; загружать все ledgerInvoices/все факты истории не требуется. Детальная история — пагинация, список — агрегаты.

### C158: defaults CAS, price callback и legacy ambiguity (2026-11-19)
- Финансовый POST с omittedversion всё равно фиксирует first.version: retry транзакции не должен смешивать firstpayer/source с freshcurrency. Idempotent replay проверять раньше CAS.
- Переход на дочерний ledger должен сохранить invoice_paid историю: callback выполняется в той же session только на full transition; partial/replay/void не повод писать цену.
- Legacy paid со спорными amount/lines/snapshot — reconciliation, неизвестный paidAmount/debt=null. Не объявлять разницу новым долгом и не менять прошлые факты без сверки.

- C161: валидация новой ссылки на статью внутри Mongo-транзакции должна записывать тот же counter-документ, что archive/reparent (отдельный referenceGuard без повышения treeRevision); иначе snapshot-read active-флага не исключает конкурентное архивирование. Полный usage истории — только по действию редактора, не в каждом picker.

- C161 tree-review: проверятьshapeкаждогопредкавancestrywalk,а не только текущего узла; иначе child повреждённого article-parent станетвыбираемымкорнем. IDlookupпроекциясохраняетintermediategroup/архивныеID, eligibilityотдельноотналичиявистории.

- C161 CORE: source cancel/delete/move/restore участвуют в том же version CAS, что первая оплата, иначе обычный soft-delete скроет финансовый факт после конкурентного addPayment. Архивная ссылка неизменённой исторической части не проходит новую active/selectable-валидацию; новая авто-подстановка stale hint сохраняет факт с null+warning. List projection не читает history, detail читает адресный источник.

### C165: pending не является денежным фактом (2026-11-19)
- Не подавлять legacy-пути фиктивным marker1: отдельный pending suppress на уровне источников, ledger только после явной даты. Старый payRemaining проверяет pending и снаружи, и внутри add-транзакции.
- Receipt может по умолчанию дописать costCenter и уменьшить qty: для frozen pending полную приёмку проводить с прежними dims, partial блокировать до stock-effect; concurrent source edits/receipt/confirm сериализовать invoice CAS. Командные receipts должны сохранять прежние evidence, иначе новый confirm затрёт историю revoke.

- C165 ARCH-P1: нельзя выбирать receipt callback по invoiceId, прочитанному до ожидания createItem/move. Callback обязателен даже для standalone; fresh source/invoice + запись qty/status/dims в той же stock-транзакции и sourceCAS защищают late attach. Встречный attach/create должен сравнивать qty/status/unpaid и matchedCount, иначе retry reset-ит received из старого preGET.
