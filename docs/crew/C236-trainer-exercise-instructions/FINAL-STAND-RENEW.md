# Повторная изолированная копия после TX2

23.11.2026. После двух успешных refresh и access GET третий refresh штатно отказал: backend отсутствует; сохранность uploads не подтверждена. docker ps -a не показал прежних owned-контейнеров, inventory standStatus пуст; причина исчезновения не установлена. Не выдаём отсутствие за сохранность томов: строка status «volumes сохранены» без перечисления ресурсов этого не доказывает.

Guard не обходили; произвольный compose/восстановление томов не запускали. Запущен штатный standRenew, который откладывает паспорт старого запуска и создаёт новый immutable owned-контур из копии. Точное состояние нового запуска и GET-проверки будут добавлены после завершения.

Предыдущие UI/PDF доказательства относятся к реально существовавшему тогда контуру и сохраняются с его ID/источником. После их приёмки UI не менялся; TX2 меняет только session чтения backend планировщика. Данные прежних двух QA-моделей не считаются существующими в новом контуре без отдельного чтения.

Рабочие контейнеры datacore-backend/datacore-mongo и отдельная owned QA Mongo не затрагивались. Полный QA05 запускается только после окончания сборки, чтобы исключить параллельную нагрузку.
Сопутствующая S-правка tools/night-stand.mjs: status теперь печатает фактическое число контейнеров и томов, а не безусловное «сохранены». Lifecycle/guards не менялись. Существующие node --test tools/night.test.mjs tools/night-uploads.test.mjs:26/26 PASS, без Docker-мутаций.

## Фактический GET нового контура — access PASS

23.11.2026,10:13UTC. По сигналу root после успешного renew/build проверен новый immutableIDda26a1b01e09343e7b6d82c7,localhost3102; только api.shstandGET,безBROWSER/записей. Healthreadyok,mongoup. Существующий80×60×3id6ae45d4ad29aaee2976a2717:total1,quantity0,countModesingle,sectionProfilecomplete. GETwork-schedule за01.11–01.12 вернул people/bars/load/legend,5полос без ошибки; PATCH/lockrace этим чтением не проверялись,они в QA05/адресномTX2HTTP.

/app/development.json: mode development,head18ef2ec5aa3762c6af01c82f1e58b3dc000fb725,dirtytrue,builtAt2026-11-23T10:11:45.810Z; backupdatacore-2026-11-18_031040.tgz,restoredAt2026-11-23T10:09:53.651Z. /app/version.json отсутствует404 в этой development-сборке; это не выдано за production-version. Доказательство обновления — developmentmetadata,не названиеветки.

OpenAPI runtime семантически идентичен docs/openapi.json: canonicalJSONSHA256=79b8198c4f2620780b4febbd4bfe33fb16a4fd2d826c3cfe8143609395b7a50e. resetStockViews сохраняет optional allOfbooleanonlytrue. docs/openapi.json повторно не перезаписывался. Ответы/summary — tools/logs/c236-final-stand-renew-access/. Прежние2QAмодели не запрашивались и не считаются восстановленными; новые тестовые записи не создавались. QA Mongo27237/прод не затронуты.