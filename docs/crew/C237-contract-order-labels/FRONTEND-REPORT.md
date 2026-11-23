# C237 — frontend
PASS кода; визуальная приёмка ожидается от координатора/access.
✅ Договор без productionNo: тип «Договор», подблок «Выполнение договора» и подвал «Весь договор», заголовок/крошка «Договор №…», карточка/поиск/подбор без ложного номера заказа.
✅ Реальный заказ: собственный productionNo, прежние подписи заказа; номера и маршруты не менялись.
✅ PDF-кнопка «PDF позиций», резервное имя различает договор/заказ; atlas/help описывают различие.
Файлы: salesorders.js, order-footer.js, order-attachments-zip.js, atlas-data.js, help-guide-data.js, c237-contract-labels.test.mjs; карта frontend.md.
Проверки: адресные Node-тесты 11/11 PASS; guards 405/405 PASS; импорты/синтаксис 411/411 PASS; design-lint новых 0; dc atlas --check PASS; diff --check PASS.
JS frozen; общий hasProductionNumber с trim устраняет whitespace/null расхождение с backend в типе, заголовках и PDF. CSS/kit/раскладка не менялись. Новый шаблон не нужен — S-подписи в существующем screenCard/side-card.
Нужно от других: backend-печать и браузерная приёмка двух случаев; на прод ничего не выкладывал.
Ограничение: тексты действительного назначения/переходов производства и маршруты не менялись.
Якоря: salesorders.js:50,459,532,708; order-attachments-zip.js:94,96; order-footer.js:64; c237-contract-labels.test.mjs:18.
Карта обновлена, опорный коммит 88fe3eff; коммитов не создавал.
