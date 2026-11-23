# Карта роли frontend

коммит: 88fe3eff · опорная ревизия для поиска, 23.11.2026. Приёмка конкретного изменения фиксируется отдельно.

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
