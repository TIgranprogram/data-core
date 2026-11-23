# C236 — инструкции1067/1068 применены на рабочем сайте

23.11.2026,13:51:36МСК. **PASS,ровно2успешныхCAS PATCH**,после общего релизаv2.49/runtimee0415bc1. Основание: явное поручение владельца подготовить инструкции и отдельный сигналroot на точные два SKU/тела.1069 исключён владельцем до готовности модели.

| SKU | ProductID | Применено | Подтверждение |
|---|---|---|---|
|1067 Жим ногами|6adaff0f2a8dad6034b14522|13:51:05→13:51:19|short/fulldefaults+textSnapshotтри части/sourceproductIDточны|
|1068 Велосипед|6aff34a8e27fdcbff25a0c9e|13:51:22→13:51:36|short/fulldefaults+textSnapshotтри части/sourceproductIDточны|

Перед каждой записью свежиеGETподтвердили expectedexerciseInstructionsnull вshort/full,отсутствие иных дельт с postreleasebaseline; точныеSHAтел совпали сCONTENT-REVIEW:1067=4c32df0b8d3747b62d7c322e81f8ee3bbe04302153f49445802f24066a45def0,1068=ccd95e3bdd1b255d11a3289b6e00397c1d7cf5894d8f969b13418da04d6700e2. Один writer,перед отправкой durablepatch_started,ответ и последующиеGET сохранены. Журналcomplete,обеentryverified,writerlockснят.

После каждой записи все прочие product/defaults/image/dims/source и template/documentполя равны свежемуbefore; сравнение исключает только новыйexerciseInstructions и вычисляемыйtextSnapshot.at. Всеsections.use/rules буквально прежние:1067use11/rules4,1068use15/rules0. Три выданных1067№628/614/396 полнымиGETreadOnly1JSONсовпали сbeforeпосле обеих операций;истории/snapshot/номер/статус сохранены,total3.1068total0.1069product/defaults/шаблоны полностью прежние за исключением вычисляемого времениpreview;записей в1069/паспорта/номера/редакции/справочники не было.

## Где открыть

«Продукция»→найти артикул→паспорт/шаблон паспорта→раздел «Инструкция упражнения». Тексты видны в вариантах «Упрощённый» и «Полный»,с отдельными заголовками исходного положения,движений и мышц. Прямые ссылки на модельный шаблон:

- [1067 Жим ногами](https://kppdf-crm.ru/db/app/#products?templateFor=6adaff0f2a8dad6034b14522)
- [1068 Велосипед](https://kppdf-crm.ru/db/app/#products?templateFor=6aff34a8e27fdcbff25a0c9e)

Маршрут подтверждён кодом/ранее принятым ownedUI; браузерныйprodпрогон не выполнялся. Старые выданные экземпляры намеренно не пересобраны; новый блок захватывается при создании новых экземпляров по реализованному контракту. Это не приёмка всей ПС-1.0/readiness иных характеристик и не фактический запуск Inventor.

## Честная история локального сбоя

Первая попытка1067далаcurl26:api.shменяетcwd,поэтому относительный путь JSON не прочитан. Runner немедленно сделалGETproduct/short/full,подтвердил все три значенияnull и остановился;1068не вызывался. Этот STOPjournalне удалён:tools/logs/c236-approved-apply/. После отдельного разрешенияroot helperпередаётfs.realpathSync сWindowsразделителями'/'; обеихтело test-r+sha256sum проверены втойжеGitBashпослеcddeploy/synology. Ни тела,ни SHA,ни expectedне менялись. Отдельныйattempt02сfreshprecheck завершился2успешнымиCAS,безслепыхповторов.

Полныеbefore/after/issued/1069,ответыPATCH и durablejournal:tools/logs/c236-approved-apply-attempt02/. Runner tools/logs/c236-apply-approved-pilots-attempt02.mjs; никаких токенов/секретов в артефактах нет.