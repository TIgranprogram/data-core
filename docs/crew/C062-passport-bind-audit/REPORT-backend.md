# C062 backend

Статус: готово. Не закоммичено, не выложено.
Сделано: 1 ✅ изделие + `supplierOrgId` (одна фирма сама, иначе 400 «Выберите фирму») · 2 ✅ замок живого `incomeId` → 409, без индекса · 3 ✅ поле `printFile` · 4 ✅ POST/DELETE print-file, pdf отдаёт файл · 5 ✅ вкладка: `productCode`, `supplier`, `printSource` · 6 ✅ юниты.
Файлы: `passport-bind.ts`, `passport-print-file.ts`, схема, service, issue, controller, queries, pdf, `showcase.service.ts` passports, MAP, data-model.
Проверки: tsc 0; jest product-passport 45/467; eslint изменённых файлов 0. e2e и openapi не гонялись.
Риски: два живых черновика на позицию — выпуск 409, пока второй не аннулирован. ZIP и pack=tech|combined файл не подменяют. Гонка двух create без индекса возможна. CRM без фирмы: 400, если фирм не одна.
Нужно от frontend: воронка шлёт `productId` + `supplierOrgId`; вкладка читает новые поля; файл — поле `file`.
Карта обновлена: `docs/roles/maps/backend.md`. коммит: —
