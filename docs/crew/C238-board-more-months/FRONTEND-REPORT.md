# C238 — frontend
PASS кода; браузерная приёмка на обновлённом стенде ожидается от координатора/access.
✅ Причина воспроизведена actual viewStore: view:undefined возвращает default/saved board; явный view:table отключает доску.
✅ Клик ссылки использует table, статус колонки, сбрасывает page и сохраняет q/ft/прочие фильтры и сохранённое предпочтение режима.
✅ Честная подпись «ещё N — списком →»; received/cancelled группируются как прежде, paid-периоды не добавлялись.
✅ Ветка portion проверена: вторая страница добавляется в колонку без patch/смены режима.
Файлы: ui/kit/board.js:276, board-more.test.mjs:35; requests-блоки atlas-data.js/help-guide-data.js; критерий TZ уточнён по ARCH-DECISION.
Проверки: C238 5/5 PASS; совместно C237+C238 10/10 PASS; импорты 411/411 PASS; guards 405/405 PASS; design-lint новых 0; atlas --check PASS; diff --check PASS.
Общий kit-контракт и CSS не менялись. Оплаты, приёмка, статусы и серверные записи не выполнялись.
Дополнение C237: с разрешения координатора удалена одна пустая строка salesorders.js для сохранения прежнего L8 baseline 731; семантика не менялась.
JS frozen; нужно от других: readonly browser click→table на stand и снимок; публикация не выполнялась.
Карта frontend обновлена, опорный коммит 88fe3eff; коммитов не создавал.
