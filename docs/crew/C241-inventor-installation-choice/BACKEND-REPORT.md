# C241 — backend, frozen после P2 и full-QA регрессии
PASS: ✅ context с effective ID/живыми применимыми установками; optional confirmed.installationTypeId, строгая валидация; старый клиент совместим.
✅ Выбор/default/существующий legacy root, три PNG и exact-ID редакции — прежняя транзакция; номера и история issued сохранены, anchors без Г; rollback/replay/stale проверены.
✅ Другой exact ID (включая тот же kind), missing/unknown, готовые/закрытые/архивные экземпляры skipped целиком с причиной; root без прежнего поля не создаётся.
Scope согласован: fromProductDiff/syncDraft/getPresentation/preparePresentation/effectiveImages различают existing/create явно; own snapshot/images сохранены, unknown applicable notReady; legacy без требования и новые templates наследуются как прежде.
P2 ✅ saved lineMissing/update/snapshot передают existing:true; ordinary PATCH сохраняет own snapshot/images, snapshot409 без записи; explicit installation PATCH сохраняет штатную смену монтажной группы. Create-only initial snapshot отделён адресно; [исправление full-QA регрессии](REGRESSION-REPORT.md): missing-ID both-absent без computed установки разрешает прежний diff/snapshot200.
FAIL-first: c241-p2-before-unit.log + c241-p2-before-e2e.log — lineMissing=[], legacy PATCH подставил default, snapshot200 вместо409; v1 фикстура дополнена нашей организацией с уникальным INN.
Файлы: passport-import DTO/service, product-passport.service.ts, passport-inventor-import/installation-choice.spec.ts, test/e2e/passport-import.e2e-spec.ts; MAP/data-model, карта backend.
Финальные проверки: 108 наборов/1042 unit PASS (21,343с), products-order9+C24134+C23612=55 HTTP/e2e PASS (28,276с), tsc0, ESLint0; логи tools/logs/c241-regression-*.log.
E2e только разрешённая datacore-test-c172-release; guards не ослаблены, секреты не читались, prod/stand не использовались. Матрица содержит 2GET+DB/PDF, protected snapshots/images, explicit PATCH, архив/rollback.
➖ OpenAPI/full-batch/архприёмка и настоящий Inventor — координатор/QA/frontend; VB этим прогоном не подтверждён. Frozen; коммита/деплоя нет.
Якоря: passport-import.service.ts:91/145/197; product-passport.service.ts:205/526/620/948/1271; карта обновлена, коммит:36bdd4dc.
