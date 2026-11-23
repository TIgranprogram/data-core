# C241 — восстановить прежний legacy-путь без источника установки

Вердикт: **одобрено адресное исключение both-absent**, включая public snapshot. Глобальное наследование черновиков не переписывать, старые tests не ослаблять.

1. Прочитать текущий product до unknownguard. Исключение допустимо только когда own installationTypeId отсутствует **и отсутствуют оба** rootlegacyinstallationTypeId и passportDefaults.installationTypeId изделия. Null/undefined/пустое — отсутствие; непустойinvalid/unknown/deletedID — материализованное значение, не отсутствие. Пустойroot с непустымdefaults не проходит исключение.
2. В этом ровноlegacy-контексте fromProductDiff сохраняет прежний обычный diff: name/category/manualcarry и race/CAS работают. Не выставлять installationMismatch/Unknown исключительно из-за отсутствующегоID. Readiness/issue продолжают прежние проверки; отсутствиеустановки не превращается в готовность.
3. Public snapshot both-absent разрешает прежнюю пересборку/200/no-op с ручнымиправками/CAS; новый безусловный409 здесь не требуется. Private initialSnapshot для newcreate остаётся отдельным create-only путём, его разрешение не снимаетpublicзащиту.
4. Productknown/newdefault + ownmissing после выбораInventor **не** является исключением: прежниеfreeze/2GET/ordinaryPATCHсохранность/snapshot409 остаются. Materialized mismatch и unknown/deletedown также не ослабляются. Готовые/issued/closed границы неизменны.
5. При доказательстве «подставить нечем» проверить не только kindPatch: установка способна появиться через textChoices/installationleaf в buildText. Добавить отрицательныйконтроль такого источника; не объявлять его both-absent автоматически лишь по двум сырымпустымполям, если фактически извлекается новыйспособ. Это адресная проверка инварианта, не новыйрефактордеревафраз.
6. Регрессии: прежний products-order suite7кейсов проходит без замены ожиданий name/category/manualtext/syncrace; парные legacy/v1BLG/TRN both-absent против productknown+ownmissing; currentrootempty+defaultsknown; unknownownнеотсутствие; publicsnapshotbothabsent200/manualcarry и productknown409; create201;2GET/DB/PDFизвестногоmismatch не меняются. Неприменимаякатегория negativecontrol сохраняется.

До приёмки точного исправления прежний ARCH-REVIEW-BACKEND PASS считать ограниченным предыдущей дельтой: полнаярегрессия выявила дополнительный реальныйстык. ПослеFIX нужны адресный FAIL-before/PASS-after и повтор независимого review, затем продолжение полногоQA.

Источники: сообщение координатора, текущий fromProductDiff/publicsnapshot и `c241-regression-initial-fix.log` (4FAIL при прежнемboth-absent наследовании). Код, guards, тестовыеожидания и прод при решении не менялись.
