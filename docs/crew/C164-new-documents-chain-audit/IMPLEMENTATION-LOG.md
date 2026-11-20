# C164 — журнал выполнения

20.11.2026. Разработка и локальные проверки; выпуск/импорт ещё не выполнены.

- [x] TZ/CONTRACT/чек-лист приёмки опубликованы в рабочей ветке, исходники7PDF повторно сверены по SHA/байтам.
- [x] Изолированный ownedконтур3198/27158 доступен, старая сборка не менялась; Mongo/proxy не перезапускались.
- [x] Общая typedlegal модель, ручной sourceIncome и explicitunassigned внедряются в существующие сущности; отдельного второго договора/денежного реестра нет.
- [x] Первые offersпроверки: tsc0,14suites/84tests PASS; после CASконверсионных правок15suites/85tests PASS; общийfull ещё впереди.
- [x] Root unit scopedindexplan:3/3 PASS, несовместимость/дубликат не допускают частичного apply. Спека дополнена шестымsourceUIDиндексом, повтор целевого теста с шестью индексами также3/3 PASS.
- [x] Frontend первые проверки: импорты367/0, designlintбезновыхнарушений,8целевыхnodetests PASS; визуальнойприёмки ещё нет.
- [~] Backendcontractstargetedtests/e2e, offersfinalsmoke, frontendatlas/help/reopen.
- [ ] Финальная интеграция/manifestfreeze, общийunit/e2e/PWA и обновлениеOpenAPI.
- [ ] Пересборка толькоbackendownedкопии, рабочие сценарии/архитектор/дизайнер, исправительныйпакет принаходках.
- [ ] Commit/pushmain, штатныеворота/выпуск/postcheck; scopedиндексыплан→бэкап→apply→проверкасовместимости.
- [ ] Свежиеprodдубли/точныйreviewedимпорт:3договора/19строк/КП9исходных8согласованных/3исходящихсчёта/7файлов, безproductiongroup/catalog/design/moneyфактов; журналIDиочередьзаполнения.

Примечания: noMoneysourcewrite запрещаетсядообычногоstrip, чтобы не превратить юридический импорт вlegacyавтогруппу. Источники/плансбизнесданными остаютсялокальноdata. Планнеозначаетпройденныйтестилиразрешениеобойтигейт.

## Первый независимый проход и исправления

- [x]Первыйtargeted3e2e:11PASS/1FAIL, SHA2090/46def04безизменений; реальноеавтопроектированиечерезmatching.none. FAIL/rawсохранены.
- [x]Архитектор:5P1 (noMoneyagreed/history, source↔legacyдубли, sourceorderIdnull, FXordinarycreate, matchingautodesign) и2P2.
- [x]Fix1:33suites273PASS, финальные6/35PASS/tsc/eslint0;5P1исправлены, listprojectionоблегчён. LegacyimportKeyguardобщийсnewintake, scoped6индексовотдельно, старыйиндекствplanпроверяетсянонесоздаётся.
- [x]Повторtargeted:3e2esuites15/15PASS иnoMoneyunit3/3PASS, SHA2091/ddca646безизменений. Fullещё0.
- [x]Rootindexplan4/4PASSпослеreadonlylegacyguard:егоотсутствиеблокируетновыйapplyбезwrites.
- [~]По дополнительномупоручению владельца: защита PhotosDELETEпривязанныхоригиналов и организационнаяgroupassignновыхsourceдоговоровдоcatalogmatching (productionstartвсёравноблокируется). Это новые сценариипередфинальнымfreeze, невыдаватьранние15PASSзаихприёмку.
- [ ]Финальныйsourcefreeze→review2толькопервогопакета/узкихдобавлений→targeted→full/UI→выпуск. P2конкурентнойсверкиисторическойсвязиКПявновbacklog; финансовыефактыизнеёневозникают.

Внешнееизменениефайлов:14DONEисточниковC157по прямому разрешению владельцаперенесеныDownloads/Готово, SHAдо/послеверифицированы. C1647PDFнасвоихместах, sourcecode/dataимпортапокапродне менялся. C167холодныйархив—отдельноеТЗ, текущийbackupнеприравниваетсякархиву.
