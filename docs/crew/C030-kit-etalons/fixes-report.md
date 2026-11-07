# C030-мелочи — отчёт frontend
Статус: готово, не закоммичено. Глазами не проверено (снимки не делались).
1 ✅ `segmented({scroll:true})`: пункты не сжимаются, ряд прокручивается по горизонтали, выбранный виден сразу; склад (stock.js) на нём; прежние вызовы без изменений.
2 ✅ Причина: `.k-sec + .k-sec { margin-top }` в сетке `layout.cols` сдвигал вторую колонку; правило снято для `.k-cols`. (Колонки включаются с 1100 px; на 1024 одна колонка, как и было.)
3 ✅ «Несопоставленные · N» и «Договоры без заказа» — эталон `section` (стрелка + счётчик), раскрытие по `toggle`.
4 ✅ Телефон (≤720): `.k-row-act .btn-ghost.btn-sm` — muted, вес 500; высота 44 для касания сохранена.
Группа А — kit: `backend/pwa/ui/kit/index.js`, `backend/pwa/ui/kit/kit.css`, `backend/pwa/sections/kit.js` (витрина), `docs/DESIGN.md` (§4 строка segmented, §8).
Группа Б — экраны: `backend/pwa/sections/stock.js`, `matching-queue.js`, `salesorders-unassigned.js`.
Проверки: `--check` всех файлов ок; design-lint «новых 0»; pwa-guards 233/233.
Риск: matching-queue/salesorders-unassigned — CRLF сохранён скриптом; раскрытие не прогонялось в браузере.
