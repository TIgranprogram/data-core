# C161 — план независимой QA

19.11.2026. Подготовка до CORE freeze. Тесты не запускались, рабочий код/данные не менялись. Основа: TZ/CONTRACT с решениями координатора, ARCH-REVIEW, ARTICLES-FIX-REPORT, UI-SCENARIOS. C158 raw full и адресные6/71 не являются full новой C161.

## Порядок и доказательства

1. Получить явное CORE READY/freeze и финальный перечень исправленных P1/P2, согласовать одно эксклюзивное testDb-окно. Frontend/ARTICLES также должны зафиксировать код для общего full. Не компилировать движущийся CORE ради промежуточных чисел.
2. Перед первым запуском сохранить JSON manifest SHA256 файлов src/test/pwa/admin и реально выполненные команды/дату. Логи и Jest JSON писать с начала, итоговый exitCode отдельно; не восстанавливать raw лог задним числом. После прогона сверить manifest, новые изменения перечислить как непроверенные.
3. Полный unit/typecheck/build и весь штатный e2e через vetted `tools/logs/c158-e2e.mjs`: runId f9f4ea383bd66a4c5d81e48b, Mongo27158, только owned testDb, отличная от базы стенда. Никакого параллельного harness: он очищает testDb. Секреты/учётки не читать, helper не расширять без координатора.
4. T26 opt-in1 suite/12tests остаётся согласованным SKIP. Иные pending/failing/todo не объявлять PASS; дать явные причины. Если падают только исправленные тестовые фикстуры, после разбора повторять только затронутые suites, а не скрывать первый raw FAIL.
5. Node PWA/guards/imports сверить на том же frontend manifest. QA не заменяет браузерную/дизайнерскую приёмку: UI-SCENARIOS проверяются access/designer на наполненной копии, обе темы/ширины. Prod/перенос183статей/импорт счетов не входят в тестовый прогон.

## Матрица критериев и уже существующего покрытия

| Критерий | Имеющиеся тесты / отдельное доказательство |
|--|--|
| Tree rename/reparent/третий уровень, постоянные ID, разделение типов | financial-articles.e2e:19; financial-operations.e2e:34; имя/ID/все сохранённые связи/денежные totals до и после |
| CAS циклов, root article и повреждённые предки | financial-articles.e2e:31,104; pure articles-tree; проверить отсутствие цикла/смены revision после отказа, диагностику descendants и невозможность нового source reference |
| Archive/restore/remove/aliases/raw admin/merge | financial-articles.e2e:38,54,91; используется единый writer, used/history не удаляются, исходные ID видны истории, archived не выбирается заново |
| Payroll rename/seed, финансовые usage и подсказки | financial-articles.e2e:62,71,120; seed не создаёт второй payroll, reset history остаётся usage, бывший leaf→group не теряет lookup/«Без детализации» |
| Income type, snapshot/hints, IDs и старые writes | financial-operations.e2e:53,88; archived A→baseB→новая частьB; чужой тип400, array безIDs409; новая подсказка не меняет старую часть |
| Legacy identity-plan/materialization/synthetic | financial-operations.e2e:104,122; GET ничего не пишет, два одинаковых платежа имеют разныеIDs, same UID возвращает прежний mapping/audit1, old reference404; synthetic metadata не создаёт второй факт |
| Correction original/effective/reset/null/audit/retry | financial-operations.e2e:67,88; whitelist денег/компании/даты, stale409, reset на archived original, неизменные сумма/дата/companyId/paymentId и один audit на replay |
| Legacy invoice→ledger | financial-operations.e2e:145; перенесены original/override/history/version/originOperationId; прежний адрес не превращается во второй факт, totals не удваиваются |
| Totals до page, сортировка, BOTH, source-qualified ID | financial-operations.e2e:34; limit2/4страницы/7уникальныхстрок, totals100000/262455; диапазон366/limit100 gates; проверить tie-sort и AND-фильтры на финальном reader |
| Cross-year/none/orphan/direct group | financial-operations.e2e:158; месяцыYYYY-MM, virtual:self без двойного учёта, неизвестная ссылка сохраняет сумму, оба вида доходов и старый customers drill остаются доступны |
| Source scope и role/money/history | financial-operations.e2e:135 + новые ARCH-regressions ожидаются; scope по исходному документу, аналитический перенос не расширяет доступ; HTTP list/detail/PATCH/materialize отдельно |
| Source-CAS cancel/remove/move и обычные paid edits | четыре P1 ARCH требуют новых core tests; не считать закрытым девятью старыми сценариями. Сверить source version/barrier/0частичных записей и неизменность original |
| Moscow day и размер list/history | P1/P2 ARCH: ждём core regressions; business day после21:00UTC, summary без истории, detail по действию; не объявлять latency по одной проверке размераJSON |
| Согласованность операций/статей/календаря/сводки | Обязательная интеграционная сверка на одном доступном наборе после correction+rename/reparent/archive. Сравнивать факты, не прогноз/начисленный ФОТ; итоги по полному фильтру, не одной странице |
| ARTICLE-PLAN183 | Предметный Markdown-план уже183unique/159KEEP/11MOVE/13REVIEW. Dry-run/apply/rollback данных — отдельный этап с живым usage/revision, не автоматически PASS по runtime full |
| Видимые значения/URL/ошибки/подготовка истории | UI-SCENARIOS34/filled fixtures, node frontend + access BROWSER/designer. Наличие PNG без просмотра не приёмка; скрытые/неподдержанные source actions имеют понятную причину |

## Четыре критичных пакета, которые сверить после CORE READY

1. **Права и история.** Custom accountant с money, но закрытым payroll; роль с payroll, но money=false; scoped actor. HTTP list исключает закрытый source, detail/correction403, ни original/history/notes/имена/суммы не просачиваются. Большая история отсутствует в list/cashflow и доступна только разрешённому detail. Не дублировать ARCH-тест, если он уже появился в финальном наборе.
2. **Source CAS и неизменность.** Барьер unpaid-read→firstPayment→cancel/remove/move и обратный порядок; ordinary PATCH paid standalone/legacy invoice/legacy Expense не переклассифицирует прошлое. Same-value форма допустима. Обязательны0частичных изменений и сохранение суммы/даты/original; CORE владеет этими новыми регрессиями, QA дополняет только оставшийся разрыв.
3. **Одинаковый денежный набор.** После correction трёх источников, archive/reparent/rename и null/reset сравнить operations/fulltotals/by-articles/cashflow/summary на одинаковых поддержанных фильтрах; tie-sort+все страницы без повторов operationId, cross-year и none/orphan без потери денег. Это отдельная интеграционная слепая зона девяти исходных сценариев.
4. **Граница даты и старые ID.** Fake clock около московской полуночи: сегодняшний факт list/detail/articles виден, завтрашний исключён. Materialize lost-response→source version изменился→replay того же UID должен вернуть прежний mapping безновыхIDs/audit; stale old read ref не адресует соседнюю часть. Проверить наличие core tests перед добавлением QA-файла.

Если нужны новые тесты — отдельный `financial-operations.qa.e2e-spec.ts`, согласованный с CORE после freeze, без копирования всех9 сценариев. Рабочие дефекты возвращаются координатору, QA приложение не чинит. Итоговый QA-REPORT≤12строк, полная матрица/JSON/логи в C161, TEST-LOG только фактические результаты.

## Текущие доказательства и их границы

ARTICLES: ранний адресный2suites/12PASS; review-fixes12/14PASS+2fixtureFAIL, затем только2fixtures2PASS/7patternSKIP — это не единый14/14 запуск. CORE: исходные9PASS до архитектурных исправлений; не подтверждают ещё исправления4P1/P2. Frontend61node/350guards/355imports/design0 по отчёту роли; в этом подготовительном QA не повторялось.
