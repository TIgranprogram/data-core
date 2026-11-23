# Карта роли frontend

коммит: 36bdd4dc · опорная ревизия для поиска, 23.11.2026. Приёмка конкретного изменения фиксируется отдельно.

Открой ТЗ, эту карту и свою часть вывода `node backend/scripts/review-scope.mjs owners --staged`.
Границы и проверяющие заданы в [реестре](../ownership.json). Читай назначенный diff и только нужные функции или разделы по ссылкам ниже.

**Ответственность.** Клиентское поведение, «Рабочее место», админка и регрессии изменённого экрана. Вид и удобство в заполненном сценарии проверяет дизайнер.

- `backend/pwa/main.js` — вход и маршрутизация. `backend/pwa/sections/` — сценарии разделов; `backend/pwa/ui/kit/` — общие компоненты; `backend/admin/` — админка. Перед созданием компонента найди существующий шаблон по `docs/DESIGN.md` §3.1 и в atlas.
- Для пути «сохранить → продолжить» проверь обработчик и назначение перехода. Пример — `backend/pwa/ui/kit/card.js` и `backend/pwa/sections/passport-tree.js`, [C175](../../crew/C175-passport-description-next-step/AFTER-SAVE-REVIEW.md). Для таблиц наследуемых значений — [C181](../../crew/C181-passport-dictionaries-table/REPORT.md).
- Запусти тест затронутого компонента. Пример для карточки: `node --experimental-vm-modules --test backend/pwa/ui/kit/card.test.mjs`. При изменении импортов — `node backend/scripts/pwa-import-check.mjs`; для стилей — `node backend/scripts/design-lint.mjs`.
- Передай дизайнеру изменённые состояния, входные данные и путь воспроизведения по `docs/UI-ACCEPTANCE.md`. Назначенный прогон на стенде получает `access`.
- Изменения kit и разделов разделяет координатор при коммите; допускаемый перенос импортов описан в `.githooks/commit-msg`. Изменение API или общего поведения соседних клиентов — стык для архитектора.

История карты до сокращения: `git show 3929ea33:docs/roles/maps/frontend.md | rg -n 'слово|Cxxx'`. Подробные результаты остаются в отчётах задач.

- C237: различение договора и производственного заказа — `backend/pwa/sections/salesorders.js:50` (тип/заголовок), `:532` (крошка), `:708` (поиск); резервное имя PDF — `backend/pwa/sections/order-attachments-zip.js:94`. Подвал — `backend/pwa/sections/order-footer.js:64`. Регрессии — `backend/pwa/sections/c237-contract-labels.test.mjs:18`.
- C238: переход из ограниченной колонки к списку — `backend/pwa/ui/kit/board.js:276`; регрессия настоящего paint.onClick → viewStore — `backend/pwa/ui/kit/board-more.test.mjs:35`. Месяцы определяет раздел; board их не обещает и paid-периоды не создаёт.
- C240: stockScreenAccess/readonly-panel guard — `backend/pwa/core/route-access.js:67,87`; readonly cells после C242 — `backend/pwa/sections/stock-grid-input.js:17`, `stock-worktable.js:16`; настройки роли classic helper — `backend/admin/role-stock-views.js:3`. Матрица и доказательства — [FRONTEND-REPORT](../../crew/C240-director-stock-screens/FRONTEND-REPORT.md).
- C243: отсутствие предложения отдельно от истории закупок — `backend/pwa/sections/supplier-catalog.js:106,348`; подсказка карточки — `backend/pwa/sections/supplier-catalog-card.js:257`; регрессия DNS/цены — `backend/pwa/sections/c243-catalog-history.test.mjs:13`.
- C241: context/подтверждённая установка до upload — `backend/pwa/ilogic/passport-images.iLogicVb:511,597`; неизменный commit/retry и 409 — `:559,580`; проверки протокола — `backend/pwa/ilogic/passport-images.test.mjs:43`. Реальный Inventor не подменять compile-check; детали — [FRONTEND-REPORT](../../crew/C241-inventor-installation-choice/FRONTEND-REPORT.md).
- C236: модельная инструкция упражнения — `backend/pwa/sections/passports/book-exercise-edit.js:22` (sideForm/raw CAS), `book-exercise.js:11` (снимок/read-only), `book-blocks.js:176` (use), `book-editor.js:194` (SKU guard). Браузерные сценарии — `book-exercise.test.mjs:63`; [FRONTEND-REPORT](../../crew/C236-trainer-exercise-instructions/FRONTEND-REPORT.md).

- C242: полная raw-номенклатура/scope/cache — `backend/pwa/core/stock-list.js:31`; контекст колонок/defaultsort — `backend/pwa/sections/stock.js:92,166`; ID-таблицы — `stock-worktable.js:16`; W/H/D без backfill — `metal.js:129`; kit snapshot — `backend/pwa/ui/kit/list.js:273`, полный экспорт — `backend/pwa/ui/list-export.js:41`. Проверки/снимки — [FRONTEND-REPORT](../../crew/C242-stock-section-order/FRONTEND-REPORT.md), опорный коммит36bdd4dc.

- C242 P2: разрешение inlinecount только при countMode single — ackend/pwa/sections/stock-dimension-columns.js:9; pipe/sheet readonly — stock-worktable.js:34, wood — wood-grid.js:116; multiple/unknown не пишут общий остаток, notes отдельно на материале. Коммит: незакоммиченная дельта после36bdd4dc; карта обновлена.
