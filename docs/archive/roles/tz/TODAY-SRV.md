# ТЗ TODAY-SRV — «Сегодня»: дела «В работе» в ленте (сервер)

**Класс:** M · исполнитель backend · **Проверки:** tsc 0, юнит модуля today.
Источник: `docs/audit/AUDIT-TODAY.md` §4 п. 1–4.

## Контракт (фронт уже пишется по нему)
- В ленте `/api/today` новый вид дела `kind: 'work'` — та же форма `RawItem`: `{ kind:'work', id:<id задания>, title:'<title задания> · <текущий шаг>', sub:'<заказчик> · заказ № <productionNo>', due:'ГГГГ-ММ-ДД' (срок заказа — orderDeadline, как в presentWork), actions:[], personId:<assigneeId задания, если есть> }`.
- Берутся задания `worktasks` со status `waiting` и `work`, `deletedAt:null`. Без срока — не в ленте.
- Окно `FEED_WINDOW.work` — как у `design`. `KIND_RANK.work` — после design.
- `ZONE_OF.work` — код зоны производства (сверь коды зон в `ZonesService`/seed зон; нет подходящей — `'design'`… лучше найди «производство»).
- Видимость: тот же механизм `see(...)`, что у других видов; раздел прав — `work` (`common/app-sections.ts`).
- `metrics.work` — число заданий в работе (status work) в видимой области; добавь рядом с другими метриками (`buildMetrics`/аналог в today-feed.ts).
- `questions()`: добавить `personId` исполнителя задачи проектирования (поле `assigneeId` задачи designtasks), чтобы «Моё» работало и для вопросов.

## Файлы
- Менять: `backend/src/modules/today/today.service.ts`, `today-feed.ts`, `today-scope.ts`, их `*.spec.ts`. Для срока можно импортировать `orderDeadline` из `modules/design/design-present.ts`.
- Не трогать: `backend/pwa/**` (параллельно работает frontend), другие модули.
- Обнови строку `today` в `docs/MAP.md` (kind work, metrics.work).

## Приёмка
- [ ] юнит: задание с исполнителем и сроком попадает в ленту с `kind:'work'` и `personId`; «Моё» его фильтрует; без срока — нет.
- [ ] `npx tsc --noEmit` 0; `npx jest src/modules/today` зелёные.
Не коммитить. Отчёт ≤ 10 строк.
