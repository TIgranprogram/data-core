статус: готово
сделано: шаг 1 «Обновить» на запасном ✅ · шаг 2 «Сделать главным» + отсчёт 10 с ✅ · главный без шагов ✅ · прогресс refresh (8 шагов, photos_pre→Фото) ✅ · confirmRefresh без отсчёта, POST /control/switch/refresh {confirm:true} ✅ · enabled===false: подсказка под колонками ✅
файлы: backend/admin/control-switch.js, backend/admin/control-switch.css, docs/roles/maps/frontend.md
проверки: Get-Content -Raw backend/admin/control-switch.js | node --input-type=module --check — exit 0. Глазами экран не открывался.
риски: кнопки ждут canRefresh и job.direction от API. Пока полей нет — «Обновить» выключена, прогресс как у переключения.
нужно от backend: GET /control/switch → canRefresh, job.direction (refresh…). POST /control/switch/refresh {confirm:true}.
карта обновлена
