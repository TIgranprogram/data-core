# C096 — независимая QA-проверка
Статус: PASS автоматических проверок; PARTIAL общей приёмки (браузер/физическая печать здесь не проверялись). HEAD c41e60de4698f36229556857868b5cbaa3899373, рабочие изменения без коммита.
Э1 ✅ обновление полей/шаблона, ручные абзацы/manualText, пустые источники, неизменность issued, конфликт до номера, атомарная редакция: passport-snapshot-refresh.spec.ts:15–227 (якорь :15), полный паспортный набор 55 suites/627 tests PASS.
Э1 ✅ повтор PATCH/ошибка GET: form-revision.test.mjs:38; повтор одинакового PATCH и равенство snapshot.at: backend/test/e2e/passports.e2e-spec.ts:284; CAS issued/manual: products-order.e2e-spec.ts:84. E2E последних повторов: 7/8 suites,63/64 → исправленный passports17/17; итог всех75 suites PASS.
Э2 ✅ автоматические сценарии принятия умолчаний/частичных размеров/очистки/источников/ручных полей/dirty/номера: 36/36 node tests; imports291/0. ➖ переходы панелей, темы/ширины, ошибки сети глазами — отдельная визуальная приёмка координатора.
Э3 ✅ тесты реального PDF входят в unit: passport-pdf-v2-pagination.spec.ts:43 (N=1,2,3,4,5,7,8,9,12), :73 (короткий/длинный); ➖ физический отпечаток и исходный проблемный файл не проверены. Артефакты и визуальный отчёт — PRINT-REVIEW.md, не моя повторная визуальная приёмка.
Контракт ✅ syncWarning: product-passport.service.ts:126 → pwa/sections/passports/card-blocks.js:50; preview: product-passport.controller.ts:264 → pwa/sections/passports/dialogs.js:68; revisionFor: form.js:264 → update сервиса:378.
Проверки ✅ tsc0; ESLint passport0 (допустимые warnings); full unit331/3889 PASS до последнего helper-фикса, после него passport55/627 PASS; node36/36; git diff --check0. Логи: evidence/qa-*.log.
E2E ✅ Docker mongo:4.4, только127.0.0.1:27196/datacore-test и disposable datacore-test-t26-c096-final; последовательный запуск. Full процесс OOM exit134 после72/75; остальные3 и повторы завершены отдельно. evidence/qa-e2e-aggregate.json:75 PASS,0 FAIL; суммарное число тестов после OOM не заявлено.
Найдено и исправлено координатором ✅ ESLint unused, пустой sections, сравнение choices:{} с отсутствующим после Mongo minimize; последняя регрессия до фикса FAIL, после PASS. Старое ожидание неизменности draft после изменения шаблона исправлено согласно ТЗ.
Мои файлы: backend/test/e2e/passports.e2e-spec.ts; этот отчёт/evidence; docs/TEST-LOG.md; docs/roles/maps/qa.md. Рабочий код, прод, деплой, коммит не менял; Docker-контейнер оставлен координатору.
Риски/нужно: завершить отдельную UI-приёмку и ограничения BOOKLET-ACCEPTANCE; карта обновлена, коммит: c41e60de (проверка поверх незакоммиченных C096).


Финал координатора: изолированный C096 поверх c41e60de без чужого C097 — full unit331/3893 PASS, tsc0, node54/54. Хеши41 файла совпали после теста. Логи/manifest в evidence/final-*. Backend после75 e2e-наборов не менялся. UI принят дизайнером: Э2 30/30, Э4 30/30, help8/8. Общий каталог имеет отдельный guardFAIL на чужом atlas; его владелец C097, не C096.
