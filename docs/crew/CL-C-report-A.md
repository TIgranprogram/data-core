# CL-C report A (dicts, chat, partners, contracts, profile, help, history, search, offers, kp)
Статус: готово, без коммитов. h('button'|'select'|'table') до → после: dicts 11→1, chat 7→3, partners 6→0, contracts 5→0, profile 2→1, offers 1→0, kp 8→1, help/history/search 0→0.
Сделано: button/iconButton/fileButton/select(+enhanceSelect) из kit вместо ручных; свои «выберите файл» в photo-drop → fileButton; mergeDialog select → enhanceSelect(select()).
Остаток (нет в kit) — строки в docs/crew/CL-C-requests.md: dicts группа-toggle, chat cv-row/pf-del/chat-photo/multi-file, profile pf-av radio, kp suggest-item.
help/history/search — ручных button/select/table нет, window.prompt/confirm/alert и toast(e.message) не найдено только по grep списка файлов (глубоко не проверялись).
Проверки: --check всех 7 правленых файлов ok; design-lint: новые нарушения мои — 0 (итог 6244→6243; 19 L3 в offers.js уже были до правки); dc check — ошибка design-lint только от L3 offers.js (не моё), импорты ok; pwa/sections/*.test.mjs 37/37.
Риск визуальный: fileButton рисует .btn (не ghost); iconButton k-icon вместо btn-icon (chat/kp) — ширина 36px.
