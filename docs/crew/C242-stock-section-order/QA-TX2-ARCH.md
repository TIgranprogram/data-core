# C242 finalQA — TX2, PATCH шага плана

Вердикт независимого runtime repeat: **PASS**, новых P1/P2 в адресной дельте нет.
Доказательства причины: координатор сообщил PATCH order-line-plan.e2e:109 timeout60с и Mongo salesorders find64852мс; `plan-write.ts:17` занимает заказ через claimWritableOrders в transaction, затем `work-schedule.service.ts:232` вызывает barsOf без session, где :76 читает salesorders вне неё. Это конкретная граница tx/externalread; версия runtime не менялась между GET200 и зависшимPATCH. Полное воспроизведение queuedDDL проверяющий не запускал.
Минимальный scope: `backend/src/modules/order-line-plan/work-schedule.service.ts` + адресныеunit/e2e. Общие withPlanWrite/withOrderWrite/claims не менять: причина в локальном callback, расширять контракт других consumers не требуется.
Optional ClientSession в barsOf/workTypes; передать incomes/worktasks/worktypes/salesorders/designtasks/products всем чтениям. В transaction выполнять reads последовательно, не Promise.all однойsession; без session сохранить нынешние parallel/cache пути.
workTypes(session) обязан обходить globalversioncache независимо от его прогрева, не возвращать общий promise и не публиковать txданные в общийcache. В patchStep передатьsession в before barsOf, personsfindOne и errorlabel worktypesfindOne. Все after/load/response проекции послеcommit остаются прежними.
Инварианты: deletedAt/projection/filter/date/schedule math прежние; revCAS/archiveclaims/personvalidation не ослаблять, атомарность rollback сохранить. Ни новых API/ACL/индексов, ни новых коллекций, ни отключения autoIndex/timeout для полученияPASS.
Регрессии: FAIL-before OUTSIDE_SESSION на точной цепочке, session на6reads+assigneepreflight; warmglobalworktypescache не обходsession; tx результат не загрязняетcache; standalone сохраняетcache+parallel; реальный PATCH шага завершается и меняетrev ровно1, stale409/invalidassignee rollback безчастичныхизменений. Логи автора и независимыйrepeat фиксировать раздельно.
Коммит-опора36bdd4dc; карта обновлена. Код/прод проверяющий не менял, остальные C242/C241 PASS не переаудированы.

## Frozen repeat

Проверен точный diff одного runtime файла: optional session передаётся всем6reads barsOf и assignee/type preflight; tx ветка последовательно await, globalworktypescache обходится без публикации. Безsession прежние Promise.all/cache сохранены. Shared withPlanWrite/claims, revCAS/date/schedule math и postcommitпроекция не изменены.
Независимо `work-schedule-session.spec.ts`: **3/3 PASS**, exit0,3.382с; проверки всехactive session, forbidparallel, warmcache, assignee400 безизменений и repeatedmove/stale409 содержательны. Автор4suite24unit/tsc+eslint0 и realHTTP **7/7PASS12.926с** приняты как отдельные доказательства, не мой HTTP-прогон: прежнийcase89мс, PATCH20021мс→20018мс→stale4098мс; currentOp пуст.
SHA совпали с `qa/work-schedule-freeze.json`: runtime c1d66429092906908aec516e8d1d950d26757eada6b7d5ba129d50c489396169; spec1e02651b8dc8efb66b67d46969585c5bc7667540cd283a62bf4a965fc58dbae3. Scope соблюдён; прямыеprod/stand/queuedDDLreproducer проверяющий не запускал, общийfull остаётся заQA.
