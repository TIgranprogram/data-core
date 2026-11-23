# C236 — две тестовые модели на owned-стенде

23.11.2026. **SETUP PASS.** Выполнен отдельно проверенный и разрешённый root `tools/logs/c236-stand-setup.mjs`. Цель жёстко `api.sh stand`, localhost3102, initialized owned-run `86836a670995169a99eee2ed`. Прод и оригинальные1067/1068/1069 не менялись.

| SKU тестовой копии | НовыйID | Проверка |
|---|---|---|
|QA-C236-1067|`6b0406f9a076c5478ab540c2`|TRN; GETpassports total0; short/full инструкция и baselineuse/rules совпадают |
|QA-C236-1068|`6b040708a076c5478ab54146`|TRN; GETpassports total0; short/full инструкция и baselineuse/rules совпадают |

ПередPOST проверены существующие type/group и parentID; все ссылочные элементы/материалы/установка/фразы/части существуют на этом же стенде. Глобальные справочники не создавались. Новые копии имеют явные QAимена, draft, без копирования фото, составов, salesorders, issuedистории. Defaultблоки записаны через freshCAS, упражнение — отдельным CASцелого блока. Два тестовых изделия — единственные созданные сущности; паспортные экземпляры не создавались.

Отсутствие выданных проверено отдельным GET `/api/passports?productId=<QA-ID>&limit=1&page=1`, total0 иitems[]. GETкарточки также показывает пустойorderLines, поэтому только эта экспонируемая связь проверена. Отсутствие скрытых invoice/orderсвязей, не возвращённых API, не заявляется. ExistingQAчужого журнала либо систорией вызвали быPAUSE.

Журнал и точные APIтела без секретов — `tools/logs/c236-stand-setup/`; списокfixtures для GET-onlyбраузера — `tools/logs/c236-stand-fixtures.json`. Сессии/пароли/токены не извлекались/не сохранялись.

## Генерация OpenAPI

Послеsetup разрешённый GET `/api/meta/openapi.json` сохранил реальныйruntimeконтракт в `docs/openapi.json`, JSONparse/openapi3.0.0PASS. `stockViews` присутствует в CreateRoleDto/UpdateRoleDto; optionalavailability в GETstock/items имеет enum none/in. **OpenAPI PASS:** exerciseInstructions описан inline по каноническим путям `components.schemas.PatchPassportTemplateDto.properties.changes.properties.exerciseInstructions` и соответствующему `expected.properties.exerciseInstructions`: nullable, три обязательных plain-textстроки, общий лимит4000.

Первоначальная проверка исполнителя ошибочно искала только отдельную Exerciseсхему/top-levelполе. Координатор указал на вложенный inlineконтракт; исправленная проверка канонического пути прошла. Backendне менялся, повторныйGETне требовался, generatedJSONвручную не дописывался. Proofобновлён: `tools/logs/c236-stand-setup/openapi-proof.json`. Браузерный сценарий на момент этого отчёта ещё не запускался: ждёт отдельногоreviewroot.
