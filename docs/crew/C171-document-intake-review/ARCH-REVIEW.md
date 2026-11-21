# C171 — адресная архитектурная проверка инфраструктурного этапа
Вердикт: можно сохранять в WIP; весь C171 и выпуск не приняты.
Основа: 7ce3eac1 + рабочий diff analysis.mjs/index.mjs/store.mjs; preflight/UI/backend-контракт этим отчётом не принимались.
🔴 Закрыто: index.mjs runQueue отвергает durable marker C171 под общим lock до любых API-запросов; старый run/resume/retry не отправляет черновики.
🔴 Закрыто: store.mjs claim пишет workflow/batchId в первичный journal; analysis.mjs восстанавливает phase=claiming через reconcileArrival до снимка Inbox.
🟡 Закрыто: workSafely записывает file-specific reviewIssue и продолжает пачку; глобальные AUTH/ACTOR/CONTOUR/MODEL/API/EXTRACTOR/ABORTED приостанавливают.
🟢 readOnly отдаёт только GET; модель получает страницы без token/API; raw/pages сохранены до проверки; checked не обещает готовность к отправке.
🟢 reviseDraft использует общий lock и expected version, хранит историю; getDraft/revise проверяют SHA исходника; дубликаты SHA разделяют черновик.
Проверки: node --check PASS; audit-cycles 0; независимый ранний analysis-test 9/10 (старое ожидание legacy pending); актуальные регрессии ведёт QA-исполнитель.
Перед принятием WIP требуются зелёные regression: legacy pending refusal, marker блокирует все 3 режима C169, metadata в первом claim journal, crash claiming до/после capture.
Не проверено: полный C171, серверный CAS/send/quarantine, Windows clean-profile, UI/PDF/XLSX, реальная модель/30 счетов, стенд/full; запись на рабочий сайт отсутствовала.
Карта обновлена; review-scope --done не ставился: адресный review новых некоммитированных файлов, общий исторический scope не покрыт.

## Интеграция Пульта — адресный второй пакет

Проверены только новые пути `pult/document-intake.mjs`, guard `pult/server.mjs` и вызовы reviewStatus.
- GET/POST защищены ключом Пульта, POST также same-origin; analyze добавлен в запрет при restart/опасной команде.
- Модель preflight получает только probe без документов/секретов; сырые ошибки не публикуются; heartbeat удаляется в finally; tokenProvider остаётся связан с actor/root/target/active.
- Закрыто: reviewreport требует login, reviewCounts/reviewreport фильтруют owner+target; draft скрывает историю и проверяет owner+target.
- Закрыто: preparation сбрасывается перед analyze, при save настроек/папки и clearAuth; прежняя роль/контур не выдаётся за новую проверку.
- Закрыто: index.snapshot исключает C171 из legacy report/counts; обход owner/target через старый отчёт устранён.
Проверки: syntax обоих файлов PASS. Исходные 47 targeted PASS и новые scope/reset/legacy regression 13/13 — по сообщению координатора. Итог: можно сохранять интеграцию в WIP; полный C171 не принят.
