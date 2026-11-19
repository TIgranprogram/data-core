# C161 — архитектурная проверка реализации

19.11.2026, HEAD179c6239, незакоммиченный этап ARTICLES API. Первый после-кодовой проход. Scope: expense-articles дерево/writer/read/usage/seed, aliases dicts, Counter.referenceGuard и безопасные409-поля фильтра. Полуготовые core finance/incomes/expenses/classification и UI в этот проход не проверялись. Рабочий код не менялся.

**Вердикт второго адресного прохода: после двух оставшихся условий исходных P1 ниже.** Остальные перечисленные исправления просмотрены; повторный общий аудит не нужен. Финальные fullQA/UI/выпуск этим заключением не заменяются. Предыдущие находки и доказательства сохранены ниже.

## Второй адресный проход после runtime src freeze

Проверялись только исходные4P1/P2 core и3ART-ветки, новые области не открывались. Код не менялся.

**Закрыто по адресному коду/тестам:**
- Payroll source section: reader и assertAccess теперь используют payroll, отдельно от money и canSeePayroll; list не выдаёт закрытую выплату, detail/PATCH403. Regression `payroll section закрыт при canPayroll=true` присутствует в coree2e.
- Moscow day: reader использует moscowToday для today/default period/future guard. Собственное выполнение helper с frozen2026-11-18T21:30Z вернуло19ноября; действительный местный день не отсекается как завтрашний.
- Income cancel/move/remove/restore/restoreCancelled получили ожидаемую source version, fresh recheck внутри транзакции, inc version и matchedCount. Прежний race «unpaid read→payment commit→cancel/remove» теперь отвергается409; два barrier-e2e это закрепляют. **Атомарность каскада остаётся отдельным условием ниже.**
- Legacy Expense ordinary analytics PATCH теперь запрещён независимо от наличия materialized original. Paid standalone/paid legacy request блокируется при обычном изменении article/category/order/costCenter/costObject; одинаковые поля допускаются. **Snapshot truth при row.paid=false остаётся условием ниже.**
- Thin list: present detail=false исключает original/override/effective/history; detail/replay читают полную историю по действию. classifiedOperation больше не добавляет её в старый cashflow. By-articles снова получает articleReportOptions/contractPrice/object scope из существующего источника; regression scope.mode/denominator имеется.
- Сохранённые archived income parts больше не prevalidate как новые references; новые платежи валидируются отдельно. Принятая policy новых оплат реализована в supply allocations: действующая статья проверяется в session/referenceGuard; устаревшая подсказка→null+warning, реальный платёж не блокируется. Legacy carry/reset сохраняют архивный original. E2e `новая оплата не наследует архивную статью` покрывает supply и income.
- ART: writer запрещает root article с400/parentId missing; pure tree диагностирует raw root article и invalid ancestor, source-validator отвергает потомка. Legacy flat children сохраняют former-group и leaf IDs; group nonselectable, hint берёт действующий лист. Собственное воспроизведение: invalidChildAccepted=false; IDs=[g,l]; groupSelectable=false; hint=l. FinancialArticle в MODELS ensure-indexes присутствует.

### Остаток P1 source-CAS/cascade — два writes вне session

`incomes/income-cancel.service.ts:124–131`, private releaseDeps.

Cancel теперь вызывает releaseDeps внутри source-транзакции, но `stock.releaseReservation(r.id)` не получает session, а `worktasks.updateMany` вызывается без `{session}`. Поэтому при ошибке/abort/retry source отмена и designtasks откатятся, но уже освобождённая бронь/отменённая worktask останутся изменёнными снаружи. Это прежнее требование «каскад не выполняется частично», а не новый общий аудит склада.

Условие закрытия: все эти writes участвуют в той же session, либо unsupported atomic cascade отклоняется до любых изменений. Адресный forced-abort тест после обработки брони/задач перед commit подтверждает полный rollback; успешная отмена сохраняет прежние правила каскада. Направлено root для точечного завершения без третьего круга.

### Остаток P1 ordinary legacy PATCH — зеркало paid не равно snapshot truth

`supply/supply.service.ts:623–632`.

Новый analytics guard запускается только при source.paid=true. Однако legacy snapshot — самостоятельный приоритетный источник факта: invoice.status=paid/paymentSnapshot содержит оплаченную строку, а старое row.paid может быть false. В такой записи обычный PATCHrequests{articleId:B} обходит guard и меняет текущую заявку, из которой legacyClassification берёт original при отсутствии map. Приоритет snapshot сохраняет денежный расход, но его историческая статья меняется обходным действием.

Условие закрытия: определять наличие legacy оплаченного факта также по invoice header/snapshot строки, не только по paid зеркалу заявки; при такой ветке ordinary аналитическая правка запрещена либо original закрепляется атомарно. Добавить вариант текущего `старые paid источники...` e2e с валидным snapshot и row.paid=false. Направлено root для адресного закрытия.

### Доказательства и границы второго прохода

Собственно:5suites/93unit PASS (expense-articles, financial-classification, incomes.service); cycles0; pure проверки перечислены выше. Исполнитель сообщил core14/14e2e PASS13.311s, затем продолжил только тесты benchmark/replay; финальные16e2e и fullQA на момент этого заключения ещё не объявлены прошедшими. Articles имеет108unit PASS; история e2e честно разделена:14target=12PASS/2fixtureFAIL, затем отдельно2исправленныхfixture PASS10.826s — это не один одновременный зелёный прогон14. Нет подключения к БД/секретам или новых writes ревьюером. Benchmark900вне фильтра+120в периоде присутствует в тесте; результат/чистые бюджеты времени здесь не выдумываются. Финальная приёмка UI и штатное создание индексов остаются у координатора.

## Whole CORE — дополнение первого после-кодового прохода

Проверены common financial-classification, canonical reader/source adapters/detail, typed correction/reset/audit/retry, income identities/materialization/защита обычных writes, expenses и перенос legacy classification в ledger. Чтение начато по runtime-ready9e2e; backend параллельно добавлял регрессии, так что якоря относятся к прочитанному состоянию, а не к финальному freeze. Координатор получил каждую находку отдельно; код ревьюером не менялся.

### 🔴 P1 — обход закрытого раздела ФОТ через новый finance adapter

`finance/financial-operations-reader.service.ts:48–49`; `finance/financial-classification.service.ts:75–77`.

У payroll выбираются sections=['money']; canSeePayroll проверяется, но исходный раздел payroll — нет. Custom role с baseRole=accountant и appSections=['money'] имеет canSeePayroll=true, но исходный PayrollController с @AppSection('payroll') ей закрыт. Через finance operations list/detail/PATCH она получает имена/индивидуальные суммы/историю и право исправления зарплатного факта. Проверка обычного manager, у которого canSeePayroll=false, эту ветку не покрывает.

Исправить: payroll adapter требует одновременно canSeePayroll и доступного source section payroll; list исключает, detail/PATCH403. Существующие агрегатные правила старого календаря этим исправлением не менять по догадке. Регрессия: роль с открытыми money/orders и закрытым payroll при canSeePayroll=true; отдельно роль с открытым payroll, но money=false.

### 🔴 P1 — source cancel/delete обходит CAS первого доходного платежа

`incomes/income-cancel.service.ts:107–117,143–163`; `incomes/incomes.service.ts:467–477,482–488`.

Cancel проверяет deps оплаченности до записи, затем raw updateOne только по _id ставит cancelledAt. Remove аналогично читает отсутствие платежей, затем soft-delete по _id/deletedAt без version. Race: T1 прочитал неоплаченную позицию; T2 принял первый платёж/ID и повысил version; T1 отменил/удалил по старому плану. Canonical source отсекает cancelledAt/deletedAt, реальный подтверждённый платёж исчезает из денег. Move тоже проверяет deps вне транзакции, затем меняет шапку без source CAS; restore/restoreCancelled не повышают version.

Исправить в одном адресном source-CAS блоке: перед записью cancel/remove/move/restore сравнить прочитанную source version, повысить её, проверить matchedCount; при каскаде повторить необходимые зависимости в транзакции либо гарантировать отсутствие его частичного выполнения при конфликте. Cancel/remove не должны выиграть после состоявшегося платежа. Принудительный barrier-тест «прочитали unpaid → addPayment → продолжили cancel/remove», обратный порядок и move vs payment/correction. Это существующие входы, которые новый контракт source-CAS должен закрыть, а не независимый рефакторинг всех модулей.

### 🔴 P1 — старые source writes меняют историческую классификацию в обход correction

`supply/supply.service.ts:599–643`; `expenses/expenses.service.ts:109–116`; `finance/finance.service.ts:196–211`.

Standalone paid request отдаётся как classificationEditable=false, но обычный PATCHrequests{articleId:B} всё равно разрешён: financial guard не включает article/category/order/costCenter. Для legacy invoice без legacyClassifications оригинальная классификация берётся из текущей заявки; PATCH её статьи/категории/объекта меняет прошлый разрез без сохранения original. Dictionary hint guard не защищает изменение самой заявки. У старого Expense без classificationOriginal ordinary PATCH также меняет articleId, поскольку запрет включается только при уже materialized original.

Исправить: paid standalone без поддержанного адаптера —409 на реально меняющиеся аналитические поля; для legacy invoice/expense до первого такого source edit атомарно закрепить original либо отклонить409 с переходом в корректировку операции. Новые future hints могут меняться, но существующий факт должен использовать сохранённый original. Не расширять общую CRM schema случайным новым ledger. Тест: paid request editable=false→обычный PATCH article/category/order; legacy invoice без map→PATCH текущей заявки; legacy Expense без original→PATCH article. Общий итог/дата неизменны, original не теряется; одинаковые сохранённые поля формы принимаются.

### 🔴 P1 — valid Moscow day отсекается UTC future guard

`finance/financial-operations-reader.service.ts:24,47`.

Сегодня вычисляется UTC ISO-day, хотя фактическая дата C158 валидируется Europe/Moscow. В2026-11-18T21:30Z уже19ноября00:30МСК. Платёж19ноября разрешён C158, но новый reader считает его будущим и скрывает до03:00МСК. Detail после успешной correction может вернуть404 уже после commit. Локальная проверка выбранного момента дала UTC18 и Moscow19.

Исправить новый canonical today/default to/future guard через единый project business day Moscow, передавать его в report. Регрессия fake clock около московской полуночи; действительный день виден в list/detail/by-articles, завтрашний исключён. Старый календарный код не переписывать целиком ради этой адресной защиты.

### 🟡 P2 — история correction передаётся в каждом списке

`finance/financial-operations-reader.service.ts:69–78`; `finance/financial-operations.ts:8–10`.

List-row включает всю classificationHistory, а classifiedOperation передаёт её и в старый cashflow. По контракту полная original/effective/history предназначена detail; пагинация100 не ограничивает число исправлений/причины1000символов внутри строки.100×100коррекций дают мегабайты ненужной истории.

Исправить: summary строки без history; detail/replay response раскрывают её по действию. Не сломать server resolver/usage/idempotency, которым история нужна на сервере. Проверить размер JSON list/cashflow на большой классификационной истории и неизменный full total/версии. Это не замер уже достигнутого времени ответа.

### 🟡 P2 — by-articles теряет старый object scope/смысл процентов

`finance/finance.controller.ts:80`; `finance/financial-article-report.ts:7`.

Старый route теперь направлен reader.byArticles, но builder всегда вызывает buildByArticles с mode='company', не передаёт прежние object scope/contractPrice из FinanceService.articlesScope. salesOrderId фильтрует часть фактов, однако ответ scope.mode всегдаcompany, pct считается от расходов вместо цены договора. Локальный pure-run подтверждает scope={mode:'company'}.

Сохранить прежний режим существующего endpoint отдельным совместимым opts/context поверх canonical facts; новые articleRows остаются additive. Проверить mode=object, source project id, scope labels и denominator pct, а не только общий денежный итог. Если старый режим намеренно выводится из поддержки, требуется явное изменение публичного контракта, не молчаливая смена значения.

### 🟡 P2 — сохранённая архивная статья блокировала новую часть дохода

На первом прочитанном состоянии `IncomesService.toFields` валидировал articleId всех присланных payments до различения новых/существующих IDs. AddPayment строит paymentsView(cur)+new: после archive статьи старой части нельзя было добавить новую часть с действующей статьёй. На последующем адресном чтении эта массовая prevalidation уже удалена; транзакционная withArticleReferences валидирует новые ссылки, existing immutable article сохраняется. Считать закрытым только после регрессии «partA→archiveA→baseB→addPaymentB» и harmless full-array metadata edit.

### Что соответствует и что ещё проверить адресно

- Canonical operationId содержит source; legacy income read reference включает hash текущего source content/version и при несовпадении404; GET не materialize. Apply identity использует explicit plan/version/hash/clientUid, CAS и audit одной session, synthetic paidDate не создаёт дополнительный денежный элемент.
- Correction whitelist не принимает деньги/дату/компанию/состояние; original/effective resolver различает отсутствие/null/reset. Source CAS, history receipt и audit атомарны. Replay проверяется до version и после доработки формирует прежний результат события; исходные amount/date/company фиксируются в audit как неизменные.
- Invoice legacy typed map переносится в ledger allocation с original/override/version/history/originOperationId; глобальный marker не допускает второго денежного факта. Alias старого адреса ведёт к active migration, voided факт не оживает. Whole-stockscope ограничивает write invoice, read фильтрует request identity до totals. Новый payroll remove имеет source CAS и запрет удаления классифицированной выплаты.
- Запросы source предфильтрованы датой/компанией/source, период≤366дней, batch maps и joins, stable sort до пагинации. Это bounded-period чтение, но не доказательство<300мс: большой период всё ещё материализуется для общего effective фильтра/итогов. Отдельно нужны замеры и индексы после финального freeze.
- Дополнительное интеграционное решение передано root: новый supply payment allocations читает raw дерево и наследует line.articleId без assertSelectable(session); определить единое правило нового факта при archived base article, отдельно от обязательного сохранения архивного original при legacy carry. Не смешивать две семантики молчаливым autofill.

Собственный core smoke:2suites/69unit PASS (`financial-classification`, `incomes.service`), cycles0. Runtime-ready9e2e — отчёт исполнителя; stronger regression/final freeze в работе, не объявляются прошедшими этим review. Дерево по второму кругу не читалось; UI/прод/apply183 не принимались. После фиксов нужны адресные доказательства по перечисленным исходным сценариям, не третий общий круг.

## ARTICLES API — исходные находки первого прохода

## P1 — root-article теряет legacy category fallback после разрешённого reparent

`backend/src/modules/expense-articles/articles-tree.ts:76–79,95–99`; `financial-article-writer.ts:53–57,115–119`.

Сценарий: выбираемый лист A под группой G связан categoryIds=[C]; старая оплаченная заявка категорииC имеет пустой articleId и не имеет classificationOriginal. PATCH A только parentId:null сохраняет nodeKind=article/selectable=true и те же categoryIds. Writer допускает такой root article; assertHintChange сравнивает только effective categoryIds старого/нового узла и считает их равными, поэтому legacy guard не срабатывает.

Но legacy buildTree() выдаёт A как корень с children=[]; articleOfCategory() смотрит только детей. До переноса fallback=A, после=null. Сам факт/его сумма сохраняются, но историческая статья меняется на «Без статьи», вопреки защите подсказок и заявленной безопасности reparent.

Локальное исполнение реальных pure functions подтвердило: root selectable article не попадает в children совместимой проекции. Исправить выбранным единым правилом: либо root разрешён только как group (а перенос article в root отклоняется/требует явного изменения kind с существующим hint guard), либо root article сохраняет доступный старым ридерам selectable ID/categoryIds. Resolver подсказки должен совпадать с фактической legacy projection. Тест: старый paid/category fallback, reparent→root, сохранение articleId либо409 read-only plan; отдельно новое root-article и category autofill.

## P2 — потомок повреждённого article-parent остаётся выбираемым

`backend/src/modules/expense-articles/articles-tree.ts:54–64,70–72`.

Сценарий старых повреждённых данных: A имеет nodeKind=article и ребёнка B (article). Диагностика правильно помечает A, но B видит существующего родителя того же type, не получает invalidHierarchy и выносится отдельным root с selectable=true. assertSelectableArticle проверяет собственную selectable и архив предков, но не invalid shape предков.

Локальное исполнение подтвердило `diagnostics=[A]`, B.selectable=true и успешный assertSelectableArticle(B). Новые ссылки разрешаются в повреждённую ветку, хотя она должна быть доступна только диагностикой до исправления.

Исправить: учитывать недопустимые kind/shape всех предков при построении path и при серверной assertSelectable; сохранить узлы и суммы для истории, но выбрать нельзя. Тест должен проверять именно результат source-validator, а не только наличие diagnostics[A]. Циклическая/удалённая/разнотипная цепочка отдельно уже проверяется текущим обходом.

## P2 — intermediate group теряет прежний ID в legacy children

`backend/src/modules/expense-articles/articles-tree.ts:76–79`.

При root→formerLeaf(group)→leaf совместимая проекция выдаёт leaf, но фильтр c.selectable исключает formerLeaf. Его исторический ID остаётся в платежах, а старый двухуровневый reader больше не находит этот узел среди children. Это воспроизведено локально на трёх узлах. Сохранение лишь ID новых глубоких selectable-листьев недостаточно для прежнего листа с историей.

**Решение координатора принято:** parentId:null — только верхняя группа; новые/перемещённые root articles запрещены400 с подсказкой поля parentId, raw legacy root articles диагностируются и запрещаются source-validator. Legacy flat children включают ВСЕ descendants с прежними ID и явными nodeKind/selectable/active/archive/actual parentId/path. Chooser/category hint выбирает только selectable active expense leaf; фильтровать groups должен selector, а не сама историческая projection. На финальном whole-review проверить реализацию этих адресных решений и тест formerLeaf с историей. CONTRACT координатор уточняет отдельно, в этом отчёте код не менялся.

## P2 — новый индекс FinancialArticle не зарегистрирован в выпуске

`backend/src/modules/expense-articles/financial-article.schema.ts:22`; `backend/scripts/ensure-indexes.js:16`.

Схема объявляет `{type,parentId,deletedAt,archivedAt,sortOrder}`, модель зарегистрирована модулем, но FinancialArticle отсутствует в MODELS ensure-indexes. Нельзя полагаться на autoIndex в рабочем контуре. Добавить модель в штатный список и включить создание индексов в выпуск. Это не подтверждение проблемы времени запроса: сам справочник мал, серверный timing в этом проходе не измерялся.

## Что соответствует контракту

- Все create/update/remove/restore трёх aliases делегируют одному writer; merge409, stockscope перед каждой записью получает Forbidden от DictsService.assertCanEdit. Доходный alias не принимает расходную запись. Core registry блокирует drop коллекции.
- Writer читает версии/граф внутри транзакции, проверяет expectedTreeRevision/node version, повышает общий counter.seq и пишет audit той же session. Source assertSelectable(session) обновляет referenceGuard того же counter-документа; структурная запись и source-reference конфликтуют на одном документе без изменения смысловой seq от валидации ссылки. Counter имеет уникальный(entity,prefix,year).
- Seed ищет payroll по code, новый родитель — payroll-group, не русское имя. Дерево ограничено32/10000, циклы/пропавший/type-parent видны diagnostics, categoryIds не очищаются автоматически при превращении листа в группу. Rename/reparent без утраты selectable/category semantics не переписывают ссылки.
- Usage opt-in пакетный, не по запросу на каждый узел; ordinary picker не сканирует историю. Usage учитывает original/override/history и legacy maps, включая reset. assertHintChange запрещает изменение эффективной подсказки неподготовленного старого факта; исключение root-проекции описано P1.
- HTTP-фильтр передаёт только неотрицательные safe-integer версии и plan с readOnly=true, а не произвольные поля исключения. Финансовые факты и секреты этим проходом не читались.

## Реалистичные ограничения совместимости и интеграционные ворота

На прочитанном состоянии legacy GET/expense-articles сохраняет только IDs выбираемых глубоких descendants и actual parentId/path. Принятое выше решение расширяет projection для intermediate groups; архивные узлы требуют отдельного режима исторического read. Внутренние отчёты/history обязаны перейти на каноническое includeArchived-дерево до переноса данных; прямой ID группы должен отображаться через «Без детализации». При финальном core-review проверить адресно реализацию и сумму такого факта, а также исключение невыбираемых/архивных groups из новых selector/hint. Не обещать старым внешним двум уровням новые рекурсивные возможности без проверки reader.

При финальной интеграции дополнительно проверить: реальное использование assertSelectable(session) всеми source writes, доступность usage только в предполагаемых редакторских сценариях, инвалидацию клиентов после rename/archive, currentVersion/revision и восстановление через реальные UI-команды. Эти проверки не заменены кодовым PASS данного этапа; готовый frontend/core пока не ревьюились здесь.

Собственный прогон:3suites/16tests expense-articles PASS, audit-cycles0. Локальные pure-воспроизведения двух веток выше исполнены без БД. Сообщённые исполнителем18suites/100unit и2suites/12e2e PASS приведены в ARTICLES-BACKEND-REPORT.md, здесь повторно e2e не запускались (тестовая БД у параллельного core). tsc/fullQA/UI/прод/apply183 не объявляются выполненными этим отчётом. Карта роли обновлена; общий исторический review-scope не закрыт.


## Координатор: адресное закрытие двух оставшихся условий

19.11.2026, после final freeze core. Просмотрен фактический код: externalSession проходит StockService→StockReservationsService.releaseReservation→releaseWithin; внешняя сессия не открывает свою транзакцию. releaseDeps передаёт ту же session снятию брони и worktasks/designtasks updates, не подавляет конфликт. Guard SupplyService.update читает invoiceheader/snapshot независимо от paid зеркала и сохраняет приоритет marker1.

Проверены результаты `evidence/core-e2e-two-fixes-pass.json`:18/18 PASS, в том числе rollback income/reservation/storage/workTask с последующим retry (ровно одно снятие), snapshot-paid при row.paid=false →409 без переписывания факта. Адресные182unit/4suites, tsc/lint/cycles PASS по `core-unit-two-fixes.json` и отчёту исполнителя. Эти два исходных условия закрыты координатором по критериям второго архитектурного review; третьего общего круга не проводилось. Согласование архитектурной части C161 завершено в пределах описанного scope. Полный финальный QA, реальные UI-состояния и выпуск остаются отдельными воротами.
