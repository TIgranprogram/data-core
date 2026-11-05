# ПГ-1b отчёт
Статус: сделано, не закоммичено, глазами не проверено.
- Автоподгрузка (IntersectionObserver, 300px, сентинел в подвале, «Показано N из M»; без IO — кнопка «Показать ещё»): design-requests.js (requestsView), docs-orders.js (одна пагинация, :60 и :113), invoices-tab.js, invoice-workspace-forms.js (buildAddForm — это список кандидатов с выбором, не шаги формы, поэтому переведён).
- Фильтр/поиск/вкладка → первая порция. reload после правки (docs-orders, invoices-tab) перечитывает уже показанные порции. Выбор (Map selected), открытая группа заказа (open) сохраняются.
- Ошибка подгрузки: failBlock «Повторить» в подвале, уже показанные строки остаются. Новых классов нет; kit/ui css не тронуты.
- Проверки: module --check x4 ок; pwa-import-check 0; preload ок. design-lint: мои файлы 0 (общий итог растёт от чужих stock-issue*, order-attachments-zip — не мои). pwa-guards падает только на них.
- Замечание: код сентинела дублируется в 4 файлах; хорошо бы kit.autoMore (kit мне закрыт).
