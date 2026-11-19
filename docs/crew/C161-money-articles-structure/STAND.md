# C161 — изолированный стенд

## Refresh и первый C161 BROWSER — C159-UI-1795103357690

19.11.2026. Owned project`dc-f9f4ea383bd66a4c5d81e48b-night`,APIhttp://localhost:3198/app/,Mongo27158;копия`datacore-f9f4ea383bd66a4c5d81e48b-night`от18.11. ОтдельнаяtestDbнеиспользовалась/неизменялась. ШтатныйstandRefreshсохранилтома,health200. Backend`dc-f9f4ea383bd66a4c5d81e48b-night-backend`;кодHEAD179c6239105caf8284fc246637e4e2ac6897c45b,веткаcodex/c158-invoice-fields,dirty=true,builtAt2026-11-19T15:48:59.619Z. Прод/C155неизменялись.

OpenAPIэкспортированштатным`dist/src/export-openapi.js`изownedbackendи скопированвdocs/openapi.json:524paths,SHA256`92e2cd4bc89103f819a9e3180a8638d19c021ed833e4d8575af6d7e5a1118fb5`. Временныеstand3198/cachehunkapi.shоставленыдоприёмки. СессияBROWSERтолькоstdin,токены/паролинеэкспортировались.

Проверенныйкоординаторомtools/logs/c159-ui-check.mjs:FAILпослеfixture/APIcontrol,доUIacceptance. Тестовыеcompany/6articles/invoice/income/expenseсозданытольковкопии,IDвevidence/resultJSON. КонтрольPASS:7операционныхстрок/5платежей,100000/262455/−162455RUB. Ошибка«Ошибкабраузерногошага»послеmoneyPage.reloadпередпервымoperationsshot;вероятныйhelperraceсdocument.bodynullвuntil(неproductbugбезповторногодоказательства). failurePNGсодержиттаблицуопераций;rootуведомлён. НикакихPATCHвместоUI/повторногозапускане было. Профильrunудалёнпослепроверкиполногоpath,чужиеокнанеизменялись.


Продолжениена томжеimageбезrefresh:`C159-UI-RESUME-1795103853183`PASS14PNG. СтарыйFAILсохранён. РанееодобренныйAPIконтрольиUIwriteпроверкипрошли;legacyincomeidentityUI SKIP(неткандидатаввыбраннойвыдаче),21427reconciliationPASS. Новыхденежныхфактовнет,свойprofileудалён. ПодробностиUI-STATE/evidence. api.sh3198/cacheпокаоставлен.


## Финальный собственный образ перед сведением с main

Ownedproject/ports/DBпрежние3198/27158,томасохранены,identityfixtureнеповторялась. StandRefreshhealth200;HEAD179c6239105caf8284fc246637e4e2ac6897c45bdirty,builtAt2026-11-19T16:58:53.615Z. ПримененынашифинальныеC158/C161backend+PWAfix,ноmainнеобъединён. IdentityUIrun`C159-IDENTITY-UI-1795107548633`PASS6PNG;см.UI-STATE.

OpenAPI524pathsэкспортированизownedbackendпослеrefresh:SHA256`92e2cd4bc89103f819a9e3180a8638d19c021ed833e4d8575af6d7e5a1118fb5`. api.shstand3198/cacheлокальныедонастоящейприёмки. Новыйreadonlycapturemoney/filter/21427подготовленнаreviewroot,поканезапускался.


Readonlyfinalcapture`C161-FINAL-CAPTURE-1795107991023`PASS20PNG;sourcebuild16:58:53.615Zдоmerge. UI-STATE/evidenceполные. IdentityUIplan→confirmPASS,7строк/итогипрежние. Ownprofileудалён. Локальные2api.shhunkсохраненывtools/logs/c161-stand-api-local.patch;restoreожидаетуказанияrootпослеdesigner.
