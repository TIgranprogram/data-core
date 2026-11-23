# C241 — независимая проверка backend freeze

Вердикт после адресной повторной проверки P2: **PASS для backend C241**. Проверена только дельта import DTO/service, product-passport.service и адресные caller paths; код/прод не менялись. iLogic frontend здесь не проверялся.

## Повтор после full-QA regression, 23.11.2026

Вердикт: **PASS точной дельты legacy-create/both-absent**; предыдущие положительные выводы не расширяются на чужие задачи.
- `product-passport.service.ts:415/955/959`: private refreshSnapshot(existing=false) вызывается только первым legacy-create; public snapshot всегда existing=true, новых DTO/публичного bypass нет.
- `:205–241`: existing unknown разрешает обычный diff только при отсутствующих own/root/default ID и отсутствии ID в productPatch/первом resolved installation leaf. Непустой unknown/deleted ID, непустой defaults при пустом root и новый выбранный leaf по-прежнему блокируют подстановку до сохранения. computedInstallation использует тот же productCtx/forProduct/printPhraseRoots/resolveChoices, что buildText.
- Прочитан diff products-order: семь прежних assertions name/category/manualcarry/sync-race не ослаблены; добавлены ровно два HTTP-кейса create201/одинdraft/noNo/publicsnapshot200/2GET и новый leaf→snapshot409/owntext+images preserved.
- Независимо повторён passport-inventor-installation-choice.spec.ts: **21/21 PASS**, exit0. Авторские1042unit/55HTTP/tsc+eslint0 из REGRESSION-REPORT приняты как дополнительные доказательства, не мой полный повтор. Прежние knownproduct+ownmissing freeze/PATCH/snapshot409 и CAS сохраняются.
- Новых P1/P2 в этой дельте не обнаружено. Прод/стенд/полный union QA/реальный Inventor здесь не проверялись; C242 WIP не читался. Карта обновлена, опора36bdd4dc.

## Первоначальный P2 — закрыт

`product-passport.service.ts:205–212` запрещает неявное наследование missing/unknown установки только при `binding.existing=true`. Эту опцию получили syncDraft/getPresentation/preparePresentation, но **существующий** update:617, snapshot:939 и lineMissing:526 по-прежнему вызывают fromProductDiff без неё, как new create:376/451.

Доказанная цепочка для сохранённого draft BLG без installationTypeId после import.skip: snapshot:939→fromProductDiff безbinding→productPatch приносит новый productdefault→snapshot:940doc.set→applySnapshot/saveCurrent. В update:617 такой же diff может добавить новыйID и затем запустить C179cleanup:629, сняв собственную монтажную схему при обычной правке другого поля. В lineMissing нет записи, но готовность может оцениваться уже по подставленномуdefault, а не защищённому экземпляру. Это обход политики exact-ID/ПС-04/05/10; valid mismatch уже защищён unconditionalinstallationDiffers, основной пробел — **missing ID применимого существующего** документа.

Минимальный фикс: адресно передать existing-контекст этим сохранённым caller paths и исключить неявное наследование/пересборку при unknown/mismatch. Явный PATCH установки, подтверждённый пользователем, остаётся разрешён прежним контрактом; new create/template не маркировать existing и не менять их наследование. Не вводить persistent-marker и не распространять обязательность установки на legacy без прежнего missingFieldsV2-требования.

Регрессия до/послефикса: сохранённый применимый draft с missingID и собственнойсхемой → импортвыбораизделия(skip) → PATCH толькоname/инойнецелевойатрибут, snapshot/lineMissing по отдельности → ID не подставлен, собственныесхемы/текст сохранены; readiness не становится ложноготовой. Дополнительно явный installationPATCH проходит, новый create наследует, legacy без применимости не блокируется. Для snapshot сравнить DB до/после (либо явный отказ), для PATCH — отсутствие непрошенной смены монтажа при допустимой целевой правке.

## Подтверждено

- Context/confirmed ID аддитивны; неизвестный/deleted/чужаякатегория/null отклоняются. Root/default синхронизируются одной transaction; третья схема anchor/concrete и неприменимаяГ разделены. Чужие exactID, готовыйPDF/attachment/annulled/closed/archive остаются skipped; revisions сохраняют прежнийID/картинки/снимки/номер.
- Новыйunknownguard ограничен существующим требованием missingFieldsV2, newcreate не определяется по_id. GET/syncDraft/getPresentation и effectiveImages закрывают прямую подмену на двухчтениях; отдельные HTTP/DB/PDF кейсы есть в дельте e2e. Однако они не покрывают три caller выше.
- Независимо `npx jest src/modules/product-passport/passport-inventor-import.spec.ts src/modules/product-passport/passport-inventor-installation-choice.spec.ts src/modules/product-passport/passport-installation-profile.spec.ts --runInBand --silent`: **3 suites /39 tests PASS**, exit0,3,821с. Полный834unit/30e2e — доказательства BACKEND-REPORT, не мой повтор.
- Попытка внеJest adhocrepro остановилась на окружении TS/decorator typings; успешное runtimeвоспроизведение здесь не заявляется. P2 установлен точной цепочкой caller/patch/save; отдельный падающий unit дофикса требуется исполнителю. Защиты/конфиги ради запуска не менялись.

## Адресная повторная проверка исправления P2

- `lineMissing` теперь передаёт existing:true и при installationUnknown возвращает препятствие без расчёта готовности по новомуproductdefault.
- `update` передаёт existing:true; ordinaryPATCH при mismatch/unknown сохраняет own snapshot/images, не запускает evaluate/rebuildSafe/applySnapshot; явный валидный installationPATCH сохраняет прежний путь смены монтажнойгруппы/cleanup. Создание осталось отдельным new-контекстом.
- `snapshot` передаёт existing:true и при mismatch/unknown возвращает409 **до doc.set/applySnapshot/save**, а не сохраняет неявноунаследованныйID. Новыеcreate/template и legacy без применимого требования не блокируются.
- Независимо повторены три адресныхsuite: **40/40tests PASS**, exit0,3,68с. Прочитаны FAIL-before и PASS-after HTTPлоги: дофикса3ошибки (lineMissing/PATCH/snapshot), послефикса **34/34 HTTP PASS** наизолированнойБД, включая обычныйlegacy/v1PATCH и явныйinstallationPATCH. Сам полныйHTTPпрогон повторно не запускал: принят проверяемый лог исполнителя, не заявляется моим прогоном.
- P2 закрыт точным изменением трёхcaller и регрессиями. Остальная положительная часть предыдущей проверки сохраняется; broadреаудит/C240/C242 и данныепрода не затрагивались. Итоговыйfull/OpenAPI/настоящийInventor/визуальнаяприёмка по координатору и QA; backendархитектура C236 исполнителю больше не блокируется.
