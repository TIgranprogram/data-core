# C056 Д — QA

статус | готово по коду и прогонам. Стенд изделия 7_38 не открывался.
критерии | один эталон template/issue ✅ `docs.js:94`, `funnel/index.js:94`, разделы `fill/model.js:12` (тест) | issue: пустое открыто, заполненное в «Уже заполнено» ✅ код `paint.js:60,165`; слот сборки в issue не прячется `paint.js:101` | gaps/texts/joints удалены, импортов нет ✅ | `form.js:72` funnelBox без facetFirst ✅ код, клик окна ➖ | запись сразу ✅ код `control.js:43`, `fill/index.js:125`; «закрыл и открыл» ➖ | сборка только у разобранного или если просит сервер ✅ тест + `paint.js:149` | без категории — подсказка ✅ `paint.js:89` | A3 image/field ✅ юнит passport-gaps | дизайнер принято ✅ REPORT-designer-D3 | живой круг 7_38 и «второй проход короче» ➖
файлы | тест `backend/pwa/sections/passports/fill/model.test.mjs` (6). Код приложения не менял.
проверки | node --check 10/10; pwa-guards 269; design-lint 0 новых (6362); tsc 0; юнит 308/3617; node --test 6/6; e2e 70/71 (skip T26), 538/550, Docker, datacore-test. Строка в TEST-LOG.
риски | «Готово» пишет числа по умолчанию (`fill/index.js:186`). У своих текстов кнопка «Сохранить» (`template-texts.js:32`, C060).
нужно | выкладка L — координатор. Снимок 390 и 1024 — как просил дизайнер.
карта обновлена
