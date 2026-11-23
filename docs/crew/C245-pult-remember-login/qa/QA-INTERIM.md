# C245 — промежуточная QA
FAIL UI | Node128/128PASS,0skip; CurrentUserDPAPI local+prod наfakeJWT/tempdir PASS; runtime/UI syntax0; штатныйUIfixture PASS.
❌ Реальный Pult UI сsynthetic auth: remembered/offline signedInfalse скрывает кнопкуВыйти; pult/ui/document-intake.js logout.hidden=!view.signedIn.
Доказательства: evidence/auth-ui/summary-offline-logout-fail.json,offline-logout-check.png/failure.png; authruntimeSHA1E35…186D86/UI712D…B14D1.
Assertion offlineLogoutVisible===true сохранён, runtime QA не менял; root согласует guard. До исправления C245не принят.
Первоначальный новыйfixture ошибся selector(main вместоaside), отдельный summary-selector-initial-fail.json сохранён; исправлен толькоfixture.
Темы финальногоfixture переключаются черезprefers-color-scheme; первоначальные снимки до этой коррекции не объявляются приёмкой двухтем.
Новый Nodeoffline/logouterase и финальныйUIповтор ждутUIguardfreeze; backend/prod/state/secrets не трогали.
