# C165 — проверка выпуска20.11.2026

v1.956, releasee89b11b3, UI/backend5c0d346c. Штатный выпускexit0, QA3766unit/666e2e/425PWA PASS. Независимый финансовый GET:healthready,528OpenAPIpaths и3новыхPOST/DTO присутствуют;9финансовыхJS совпадают сGit5c0d346c после единственного преобразования CRLF→LF. СырыеSHA различаются из-заEOL; первоначальныйSTOP и диагностика сохранены, побайтовое равенство не заявляется.

- [x]24479: repairOriginalFilename одного Photo6aff3d721eb87438515b41eb. Имя «Счет на оплату №24479 от17.09.2026.pdf» восстановлено с исходными пробелами;ID/байты265700/SHAc709df… неизменны; версия счёта/один платёж31960,14/дата17.09/остаток0/8allocations сохранены. Upload/delete0.
- [x]24334: invoice6aff643019587e11be4af1a9, PDF6aff643619587e11be4af1c4/261573байта/SHA68c6a8…;3строки50076₽/НДС22%9030,09/СИЮ/Геленджик. paymentState=date_required, requiresPaymentDate=true, paidAmount/balanceDueNULL; обычных payments/ledger0. Счёт найден в адресном фильтре неизвестных дат. Выдуманного дня/приёмки нет.
- [x]Только утверждённые точечные бизнес-операции. Первый24334readonlySTOP и auto-reviewSTOP сохранены; после нормального режима единственная переоценка того же плана по прямым сообщениям владельца разрешена. Последующие журналыDONE, lock снят, NO_ACTIVE_WRITE.

Локальные доказательства: C165/data/post-release-v1956-readproof.json, js-hash-diagnostic-v1956.json; C157/data/24479-filename-repair-journal.json,24334-undated-final-receipt.json и authorization-reassessment-receipt. Полные данные/планы не публикуются вGit. Следующий этап — C157/IMPORT-STATUS.md и C164/PLAN.md; повторный выпуск для документации не нужен.
