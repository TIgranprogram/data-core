# C158 — план независимой QA

19.11.2026. До сообщения backend READY проверки не запускались: исполнитель ещё меняет сервер и свой e2e. QA не дублирует архитектурный review; проверяет внешний контракт и доказательства.

## Прогон

1. Зафиксировать manifest изменённых src/test/pwa и согласовать эксклюзивное окно testDb с backend. Контур `dc-f9f4ea383bd66a4c5d81e48b-night`, Mongo27158, только отдельная testDb с тем же runId. Вход/секреты не читать.
2. Full unit из backend через установленный Node/Jest, временные HTTP-порты вне sandbox. Root предыдущий прогон:353/355 suites и3639/3648 tests;8HTTP EACCES,1soft-delete coverage. Этот результат не заменяет итоговый прогон.
3. Full e2e только `node tools/logs/c158-e2e.mjs --silent` с явным guard runId/портов/различия testDb и standDb. Не одновременно с backend: harness очищает testDb. Не запускать обычный docker compose или default test URI.
4. Typecheck, build, eslint затронутых TS и PWA node tests/imports. Не повторять успешно выполненное на неизменном manifest без нового основания.
5. Зафиксировать фактические результаты и ограничения в QA-REPORT/TEST-LOG. Браузерные действия/визуальная оценка выполняются access/designer отдельно; unit не объявляет UI принятым.

## Матрица критичных критериев

| Критерий | Покрытие, которое перепроверить |
|--|--|
| Исторические31960,14 и аванс55000+200000 | `supply-invoice-payments.e2e-spec.ts:30,43`; отдельные dates, createdAt, expense в нужном месяце, повтор без второго факта |
| Гонки/повтор/изменённое тело/переплата | `:49`; immutable intent replay после void+смены валюты `:250`; отдельно payer default, stale version и транзакционная rollback |
| Legacy между месяцами/компаниями, все void | `:59,160`; marker не снимается; snapshot и paid requests не возвращаются при фильтре и переключении компании |
| ВалютаUSD840, UE360/30326, разные курсы | `:70,79,176`; financials unit; noRUBestimate и частичный остаток440 в pending/forecast `:207`; известная оценка `:226` |
| НДС22/5/none/0 и source discrepancy | financials unit6; UI unknownVAT regression; поставщик после изменения не перетирает документ; source581,90 не исправляется в585 |
| Allocation до копейки/статьи | unit allocate; e2e mixed lines и snapshot article `:194`; сумма нескольких фактов/строк должна совпадать в карточке/деньгах |
| Frozen после аванса/первая приёмка | `:30,92,168`; обычная правка409, explicit RUB admin override сохраняет факты, received не откатывается; void после receipt409 |
| Scope и money-mask | ledger scope `:125`, files `:141`, legacy partial snapshot `:236`; карточка и список не возвращают hidden IDs/суммы/корректировки; POST whole-scope403 |
| Дата/точность/whitelist/файлы | `:86`; проверка отсутствия записи после ошибки, future/invalid день, чужой fileId |
| Список не тянет историю | `:258`:250 фактов, summary полный, история отсутствует в списке, JSON<5000, card100/GETpayments200 |
| Legacy pay/unpay и создание invoice retry | `:99,160,187`; старое pay без тела и lost-response создания не дублируют invoice/payment |
| Фильтр articleId | `:107,125`; parent/descendants/none/mixed/scope/serverpage/filter combinations; node UIURL/filter regressions |

## Слепые зоны для дополнения после READY

- Отдельные повторы dry-run/confirm/повторного void и отмена без мутации; показать no-success при transaction abort.
- Исторический факт: сохранить/проверить createdAt отдельно и исходный payer; платежи нескольких строк/статей со спорной копейкой проверить интеграционно, не только чистой функцией.
- Mutation supplier VAT после сохранённого документа, invalid articleId400/пустой результат и комбинации filters: проверить наличие соседних e2e, добавить только отсутствующее.
- Performance требует замера наполненного стенда/query shape по reviewer; тест на размер list не доказывает latency или explain.

Доступная QA зона: тесты, TEST-LOG, эта папка отчётов, карта/уроки QA. Рабочий код не править; дефекты вернуть координатору.
