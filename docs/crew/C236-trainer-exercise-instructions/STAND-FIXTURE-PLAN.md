# C236/C242 — план независимого owned-стенда

Статус: подготовка, **не выполнять до проверки координатором**. Единственная цель — `http://localhost:3102`, подтверждённый owned-run. Сессия только stdin→память; ни одного секрета в файлах/логах.

## Разделение действий

`tools/logs/c236-c242-stand-ui.mjs` — только GET/HEAD, блокирует остальные методы и чужиеorigin. Не создаёт fixtures и не сохраняет паспорт. Stock-данные/номенклатура/нулевые строки — реальные GET собственного стенда. При отсутствии нужных данных сценарий фиксирует SKIP_DATA, не выдумывает позиции/остатки. Для покрытия UI-директора только локальная проекция auth/me и dca_user: JWT остаётсяmanager, данные/ACL серверов не повышаются. Эта подмена явно записана в result и не является приёмкой director serverACL (они отдельно проверены реальными HTTP).

## Две анонимизированные копии моделей для книжки

Нужен отдельный одобренный setup-script/API-plan, не часть GET-only browser. На ownedstand создать ровно два новых showcaseизделия через существующий POST `/api/showcase`, с явными QAименами/артикулами `QA-C236-1067` и `QA-C236-1068`. Подготовлены точные тела `apply/stand-create-1067.json` и1068: name/sku,type/group по именам,dimensions/weight,purpose/description/installation/unit,statusdraft. В этом API нет CreateDTO: fields принимает type/group как названия, не groupId; passportDefaults через create не записывается. Не передавать исходныйID,issued/passports/orderLines, чужуюисторию, runtime-поля и связи с продажами. Существующий QAартикул сначала GET, не плодитьдубли. Фото/композиция не копируются — для текстового пилота не нужны.

После POST собственные defaults наполнить отдельным CAS PATCHtemplate по результату GET новой QAкарточки. Desiredchanges подготовлены в `apply/stand-defaults-changes-1067.json` и1068; expected для каждого ключа строить из свежих defaults (не предполагать всеnull). До отправки проверить, что ссылочные elements/materialIds/installType/textChoices существуют на этом же стенде; отсутствие ссылки →PAUSE, не создавать глобальные справочники и не подменять другойссылкой. Наличие pendingpassport/salesorder связей уQAмодели →PAUSE. Этот шаг также требует отдельногоодобрения и выполняется толькоsetupscriptчерезapi.shstand.

После создания GET карточки и short/full baseline; затем отдельным `PATCH /showcase/:testID/passport-template?variant=short` применить ровно exerciseInstructions из подготовленного PILOT-CONTENT, CASexpectedbaseline. Для setup допустимы записи только этих двух тестовых моделей; никаких правок оригинальных1067/1068, старыхissued,1069, stock,ролей/платежей. Новый номер/паспорт не выпускать.

Результат setup — локальный `tools/logs/c236-stand-fixtures.json` без токенов, `{target:"http://localhost:3102",items:[{sku,productId,baseline:{use:[...],rules:[...],purpose:"..."}}]}`. ID только новых QAмоделей; браузер дополнительно GET проверяет префиксQA, точные три части и baselineсохранность. Если setup не утверждён/не выполнен, browser отмечает C236SKIP_NO_FIXTURE, но выполняет C242.

Приёмка: открыть настоящую книжку `#products?templateFor=<QA-ID>` по обеимvariantпроекциям, отобразить текст в книжке, проверить три части и базовые safety, сделать light/dark. PDFобразцы если доступный серверныйpreview требует POST — отдельный одобренный сценарий; GET-only ограничение не обходить.

## C242

Проверить реальные scopes4зон в основных таблицах `#stock?view=table&all=1`, ихколонки и light/dark (wood может бытьпустым — честныйSKIP_DATA); отдельно nativepipe/sheetподreadonlydirectorUIprojection. Оси/sorts на сервере проверяются GET до/после сортировки, неизвестныевконце, scope/availabilityсохраняются;80×60×3 сразнымиразделителями даёт один наборID/quantity0,не включаетсяheld. Нулевая фасетная фильтрация не создаёт storageitem.

Nativewood требует иной роли/админпроекции: текущий разрешённыйdirectorfixture её не даёт. Основнаятаблицаwood-zone проверяется, отдельныйnativewood отмечается SKIP_AUTH_PROJECTION; если координатору нужен именноnativewoodскрин, отдельно согласовать явнуюUI-onlyfixture, не повышая serverJWT.

Послеfreeze C241 rootобновляетownedstand штатнымstandRefresh. Доэтого ничего не запускать. Сценарий rootсначала читает и утверждает целиком, затем `api.sh stand BROWSER`.
