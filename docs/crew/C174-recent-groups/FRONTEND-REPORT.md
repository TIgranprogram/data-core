Статус: frontend готов; независимая визуальная приёмка ожидается.
✅ Группы по of: Заказы / Изделия / Паспорта (включая orderpass) / прочие; orders отдельно.
✅ Пустые группы скрыты, внутри сохранена давность, permissions/storage/navigation не менялись.
✅ Широкий kit pop-menu с рамками и контрастными заголовками; перенос и ограниченная прокрутка.
✅ 12 filled fixture сценариев: 2/3/8 групп × 1920/1024 × light/dark, без выхода за viewport, pageerrors=0.
✅ Каждый сценарий: выбор ссылки, очистка, Escape/refocus, clickoutside, Home/End.
✅ Старое меню настроек: ширина264, позиция/Escape/refocus PASS; legacy-menu.json и PNG.
Проверки: recent-cards.test.mjs 8/8; ES module syntax 3/3; pwa-guards 363/363; design-lint новых0.
Файлы: recent-cards.js:52, recent-cards.test.mjs:109, kit.css:906, pop-menu.js:80, DESIGN.md:403.
Доказательства: evidence/ (13PNG, matrix.json, legacy-menu.json); visual-harness.mjs — реальный kit/CSS, API не нужен.
Ограничение: фикстура подтверждает компонент; серверное сохранение и выпуск не проверялись, не менялись.
коммит: не коммитил; карта обновлена.
