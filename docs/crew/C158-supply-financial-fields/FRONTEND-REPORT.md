Статус: IMPLEMENTED / VISUAL PENDING; отдельная копия c158-invoice-fields, без коммита и выпуска.
✅ ТЗ: валюта/UE, основание и дата курса, подтверждённые RUB, НДС документа/строк (unknown без умолчания, included/excluded требуют ставку, финансовый diff PATCH); исходные цены/итоги отдельны от рублей.
✅ ТЗ: таблица позиций первая; просмотр readonly, ввод в общей правой форме; платежи, paidAmount, sourceBalance, paymentState из сервера, неизвестный пересчёт не0.
✅ ТЗ: одна форма фактической оплаты из карточки/доски/шага/ввода счёта, историческая дата, сумма, плательщик, файл, clientUid/version; retry хранит тело и ключ; финансовая блокировка после аванса объяснена.
✅ Дополнение: needsConversion и ссылки на счета в календаре/прогнозе, известные валютные долги подписаны оценкой; articleId в заявках (доска/таблица) и счетах; динамический expense-articles с принудительным обновлением при открытии, родители/none, URL/сброс, итог целых счетов.
Файлы: invoice-workspace-{api,forms,meta,state}.js, invoice-workspace.js/.test.mjs, invoice.js, invoices-tab.js, request-invoice-actions.js, request-step.js/.test.mjs, requests.js, expenses.js, money.js/money-forecast.js; собственная карта frontend обновлена.
Проверки: node PWA43/43; pwa-guards342/342; ES-модульные импорты/синтаксис347 файлов0 ошибок; design-lint0 новых (legacy5991); node --check UI-runner PASS.
Сценарий: tools/logs/c158-ui-check.mjs, strict localhost3198, stdin-сессия, свои C158-fixtures, исторические55000+200000, НДС5/none/0/22, draft→UE→source360→30326→issue, обе темы1920/1024/2560, articleId none/all; review координатора пройден; запуск выполняет access.
➖ Приёмка: live C158-UI-1795096430186 прошёл RUBVAT5/none/0/22 и55000+200000, FAIL на UEunknownVAT. Исправлено unit-регрессиями; повтор live и проверка нового needsConversion в Деньгах ещё нужны. Сторно/потеря ответа/периоды/права не приняты визуально.
Нужно от координатора: backend refresh3198, повтор access BROWSER и независимая QA/дизайнерская приёмка; atlas/help/MAP и регистрация тестового runner вне кнопок пульта — зона координатора.
Риски: дополнительная проверка legacy ввода invoice.js при потерянном ответе создания группы; переход к оплате только намерение, получение отдельный факт. Прод, паспорта и импорт счетов не затронуты.
Карта обновлена; коммит: не закоммичено.
