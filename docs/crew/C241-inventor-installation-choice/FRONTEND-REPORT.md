Статус | FREEZE frontend/iLogic; исполнение в настоящем Inventor ещё не проверено.
Сделано | ✅ context → явный выбор живого имени → согласие на числа → UploadPng; текущий ID предвыбран только при точном совпадении, отсутствующий не подменяется первым.
Сделано | ✅ Cancel/закрытие/нет вариантов/неподдержанный контекст останавливают до upload; монтаж/фундамент и применимость Г объяснены, неприменимая Г не запрашивается/не отправляется.
Сделано | ✅ installationTypeId в confirmed единственного commit; JSON/файлы/выбор неизменны при retry; 409 останавливает с требованием нового контекста/подтверждения.
Файлы | backend/pwa/ilogic/passport-images.iLogicVb:511,559,580,597; passport-images.test.mjs; sections/passports/book-ilogic.js:65 — точное объяснение выбора/пропусков.
Проверки | node --test backend/pwa/ilogic/passport-images.test.mjs: 7/7 PASS (статические проверки протокола, не выполнение Inventor); imports/syntax 416/416 PASS.
Compile | Полный канон с Autodesk.Inventor.Interop.dll (Inventor 2027), net8.0-windows: 0 ошибок/0 предупреждений; wrapper и ограничения в COMPILE-CHECK.md.
Общий smoke | guards 408 PASS/1 FAIL: 6 новых design-lint в параллельной stock/kit-дельте; собственные C241 файлы без замечаний, diff --check PASS. Координатор уведомлён.
Получение | https://kppdf-crm.ru/db/app/ilogic/passport-images.iLogicVb после выпуска; книжка → «Правило iLogic»/«Скачать .iLogicVb»; существующий пункт Пульта c172-update-inventor-rule, дубль не создавался.
Ограничения | Нужен настоящий Inventor: открыть модель, анкеры/бетон, отмена, stale409, обновление/пропуски и проверка PDF. Не менял экспорт геометрии/номера/ПС-стандарт/stock/atlas/help; не коммитил/не выкладывал.
Карта | docs/roles/maps/frontend.md дополнена якорями; коммит: 36bdd4dc (опорная ревизия). Карта обновлена.
