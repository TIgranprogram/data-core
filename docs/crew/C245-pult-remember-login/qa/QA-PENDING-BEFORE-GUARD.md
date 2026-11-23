# C245 — QA, ожидание завершения действия пользователя
PARTIAL / UI FAIL | Последний полный PultNode128/128PASS,0FAIL/SKIP; runtime/UI syntax0; Windows CurrentUserDPAPI local+prod(fakeJWT/tempdir) PASS.
✅ Fake transport: точныйprod/local/trailingSlash, URLnegatives, restart/rotation, protected refresh only; API/state/password/access/plaintext не раскрываются.
✅ Offline/500/503 сохраняют blob и retry ровно15s;401/403/account/version/role/org/expiry/binding стирают; save/protect/write/rename failures → memoryvalid/rememberedfalse/staleblobgone.
✅ Штатный UIfixture PASS с точным memory-only текстом и запретом ложного«запомнил»; JUnitqa/pult-tests.xml,stdout tools/logs/c245-final-pult-tests.log.
❌ Новый реальныйPultUI+synthetic auth: remembered/offline signedInfalse скрываетВыйти; pult/ui/document-intake.js logout.hidden=!view.signedIn. Инвариант assertvisibletrue не ослаблен.
Артефакты: evidence/auth-ui/summary-offline-logout-fail.json,offline-logout-check.png/failure.png; первоначальный selectorFAIL также сохранён отдельно.
RuntimefreezeSHA auth1E35FFA80C94450A29BFEAC4189D54E7DD0C20CB89E06770C0C858A687186D86;UI712DF9BA72420B317D109BCE5470B58F872381C5B356EAC5C9124A99123B14D1.
➖ Новые APIoffline-logouterase и UIthemes/emulateMedia+offline-logouterase ждут повтора после guardfix; текущий исходник тестов шире последнего128PASS, не выдаётся за полностью прогнанный.
Root отложил любые source/test правки и прогоны: пользователь выполняет реальный разбор, filewatch может перезапустить Пульт. QA только записал этот отчёт, реальныеstate/settings/интеграцию не читал.
➖ Backend не менялся и не прогонялся: последнийC244unit406/4175,e2e112/918. Production HTTP/входов/записей, настоящихпаролей/JWT и публикацийQAне было.
Нужно отroot: после завершения действия согласованныйUIguard+freeze, затем Node/UIrepeat и итоговые QA-REPORT/TESTLOG; сейчас C245полныйPASS не принят.
