# C164 — итог автоматической проверки

**PASS автоматических проверок, композиционный.** Серверный full и финальный frontend проверены отдельно с доказанным нулевым изменением серверных исходников. Это не приёмка вида, не выпуск и не импорт документов. Все процессы QA завершены.

## Итоговые результаты

| Проверка | Доказанный результат |
|---|---|
| Серверный full, backend b3628b20 | 378 unit-наборов / 3820 PASS,0FAIL/0SKIP,52.811с; TypeScript/build/ESLint exit0 |
| Общий e2e того же backend | 88 наборов / 684 PASS,0FAIL,565.702с; штатный opt-in T26 отдельно1набор/12SKIP |
| Guards на последнем frontend | 362/362 PASS |
| Все Node PWA-тесты последнего frontend | 434/434 PASS,0FAIL/0SKIP/0TODO,14.022с |
| Импорты и синтаксис | 367 файлов, ошибок0 |
| Design-lint | новых нарушений0; старый общий счётчик5982 не объявляется нулём |
| Взаимные пары модулей | 0 |
| Каталог пульта | 17/17 PASS,0SKIP |

Серверные артефакты: `tools/logs/c164-full-2026-11-20T05-11-48-422Z/`. Финальный frontend: `tools/logs/c164-ui-2026-11-20T05-36-59-547Z/`. Безопасный сводный JSON с фактическими счётчиками, SHA исходников и raw-артефактов — `QA-SAFE-EVIDENCE.json` во второй папке.

**Почему серверный full не повторялся после UI-фиксов:**1436файлов backend/src,test,scripts,package/config/lock полностью совпадают с сервером, прошедшим full; SHA `da94099098c284f27a192d08fadd33c8e338fda33c9c91d518896d3fff712ab6`. Изменения после него — карта/help интерфейса и VM-фикстура PWA. Guards и все434PWA-теста перепроверены на последних байтах. Старый общий FULL3 имеет frontendFAIL и не переименован в PASS.

Финальный общий manifest2095файлов до/после одинаков: `0a4e13cbce1c4ac36c9a4d27c83f86c0640a9c189255600934678f924c684fbb`; изменений0. HEADпри проверке `a9a66798` плюс зафиксированный manifest карты/help; последующий commit без изменения байтов не требует нового прогона.

## Критерии и стык API → интерфейс

- [x] Договор сохраняется без производственной группы; snapshots/оригинал/SHA, manual source-строки, последовательный и конкурентный replay, CAS подтверждены e2e.
- [x] Legacy/deleted без importKey и source/legacy concurrency не создают теневые шапки; null orderId не отвязывает source, USD не становится RUB.
- [x] КП сохраняет источник, исходную дату, исходный/согласованный итоги и исключённую строку; link-existing не создаёт второй договор/платёж.
- [x] NoMoney не видит legal/source/fileId/PDF/версии/agreedTotal/денежный текст исключения; source POST не становится legacy после strip. Forbidden проверен до handler.
- [x] Два manual-договора группируются до сопоставления; start возвращает409 с причиной «сопоставьте», этапы остаются new. Явное «не изделие» для синтетической доставки сохраняет ID/source/design0.
- [x] Реальные факты остаются видимыми при legal draft и по фильтру производственной группы; исходящие документы сами не создают оплаты.
- [x] Защита файлов/claim/неизменяемых SHA и запрет обхода CREATE через производственный stage покрыты расширенным source-e2e и unit.
- [x] Гонка раннего clash исправлена: четыре детерминированных unit и восемь HTTP-пар подтверждают201/201, одинаковыйID/cardinality1. Критерий не ослаблялся.
- [ ] Визуальная/рабочая desktop-приёмка на копии — отдельный дизайнер/доступ. Автоматические тесты не доказывают удобство заполненных19реальных строк.
- [ ] Выпуск и внесение7исходников с итоговым журналомID/сумм/незаполненного — координатор/доступ после остальных гейтов.

| Стык | Сервер | Интерфейс |
|---|---|---|
| Legal CAS/full bundle | salesorders.controller.ts:72–75, offers.controller.ts:146–150 | sales-legal.js:20–30 отправляет version/clientUid/reason/legal |
| Договор без заказа | salesorders DTO/service productionAssignment | salesorders.js:692–697 — explicit unassigned и initialLegal, update не подменяет режим |
| КП → существующий договор | offers.controller.ts:153–158 | offer-source.js:101 — тот же orderId/version/clientUid, без конверсии |
| История исключения/суммы КП | OfferItem sourceLine/scopeState, agreedTotal | offer-source.js:12,33–45,75 — whitelist source-полей и разные подписи итогов |

## История запусков

| Запуск | Результат и причина | Неизменяемые доказательства |
|---|---|---|
| 04:09, targeted1 | 11 PASS / 1 FAIL: matching/none создавал2 designTasks вместо0. Manifest2090, SHA46def04c… одинаков | `tools/logs/c164-targeted-e2e-*`, targeted-manifest-before/after |
| 04:22, FIX1 targeted | 3 e2e-набора / 15 PASS, noMoney unit3 PASS. Manifest2091, SHAddca646… одинаков | `tools/logs/c164-targeted-2026-11-20T04-22-13-126Z/` |
| 04:36, targeted | 16 PASS / 1 FAIL, unit7 PASS: устаревшее QA-ожидание assign400 при новом правиле manual assign200. Manifest2093, SHA1a146a0f… одинаков | `tools/logs/c164-targeted-2026-11-20T04-36-18-202Z/` |
| 04:40, targeted353 | 17 PASS / 1 FAIL, unit12 PASS: QA ожидал400, действующий производственный guard правильно вернул409. Manifest2094, SHAa9be08ed… одинаков | `tools/logs/c164-targeted-2026-11-20T04-40-17-154Z/` |
| 04:43, только исправленный access-case | 1 набор / 3 PASS: exact409, причина и stage:new проверены; два других неизменных набора не повторялись. Manifest2094, SHA504c4cf4… одинаков | `tools/logs/c164-access-2026-11-20T04-43-09-804Z/` |
| 04:44, FULL1 | Types/build/eslint0; unit3815 PASS / 1 FAIL: embedded schema без явного softDelete:false. E2E/PWA не запускались. Manifest2094, SHA504c4cf4… одинаков | `tools/logs/c164-full-2026-11-20T04-44-01-435Z/` |
| 04:51, FULL2 | Unit3816 PASS; e2e683 PASS / 1 FAIL: описанный concurrent replay. Manifest2094, SHA81a4250f… одинаков | `tools/logs/c164-full-2026-11-20T04-51-11-507Z/` |


Дополнительные завершённые попытки:

| Запуск | Результат | Доказательства |
|---|---|---|
| FULL3 05:11 | Backend378/3820unit и88/684e2ePASS; PWA432/434, дваFAIL: карта fill и VMsees. Manifest2095/SHA79708108… одинаков | `tools/logs/c164-full-2026-11-20T05-11-48-422Z/` |
| UI-only1 05:28 | Backend1436/da940990…тотже, guards362PASS; PWA433/434, нет ATLAS-блока fill. VM-фикстура закрыта | `tools/logs/c164-ui-2026-11-20T05-28-52-270Z/` |
| UI-only2 05:36 | Все6фазPASS, backend1436тотже, PWA434/434, manifest2095/0a4e13cb…до/послеравен | `tools/logs/c164-ui-2026-11-20T05-36-59-547Z/` |

Исправления приняты по фактам: настоящий softDelete:false у embedded-схем, полный replay при раннем clash, реальный блок существующей очереди #fill и её связи, полноценный admin.sees/пустые legal-списки в старой C165 VM-фикстуре. Валидаторы/критерии не ослаблялись, ни один неуспешный raw не перезаписывался.

Безопасность: host Node/Jest использовал только `datacore-test-f9f4ea383bd66a4c5d81e48b-night` на27158; копия3198 — другая БД. Прод/API/банковские записи не использовались; секреты не выводились, Mongo/proxy не перезапускались, новые пакеты не устанавливались. Runtime QA не исправлял; собственные изменения — тесты, отчёты и локальные исполнители проверок.
