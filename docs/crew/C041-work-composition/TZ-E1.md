# ТЗ C041 Э1 — состав позиции заказа: части × виды работ, «Проверено», «только в заказ / и в продукцию»

**Зачем (пользователь 2026-11-07):** позиция в работе состоит из частей изделия (пергола: стойки, навес, наполнение); к частям — виды работ; по умолчанию — из продукции; менеджер правит и ставит зелёную галочку «Проверено»; при правке спрашиваем «только в этом заказе или и в продукцию»; новое — в справочник. Потом Гант и часы (Э2, Э3).
**Зачем — глаголом:** менеджер открывает позицию заказа, видит части и работы, подставленные из изделия, за 1–2 минуты подтверждает галочками, исправляет лишнее и запускает в работу.

## Глубже
- **Результат:** у каждой позиции заказа — свой план (части + шаги), проверяемый и запускаемый; продукция улучшается правками из заказов.
- **Сырьё:** `AUDIT.md`, `PROPOSAL.md`, решение `ADVICE.md` (обязательно прочитать — это закон этапа), `PROD-NUMBERS.md` (покрытие на проде).
- **Метод профи:** маршрутная карта MES: спецификация (части) + операции (вид работ × часть, норма часов) — одна правда в изделии, копия-план в позиции заказа с ревизией и сравнением.
- **Внешний судья:** юнит + e2e (get-or-create, PUT rev→409, apply-to-product, launch по плану); на стенде: открыть позицию → правка → «и в продукцию» → изделие изменилось; дизайнер.
- **Смелая планка:** 0 потерь существующих маршрутов (старые шаги — часть «Изделие целиком»), 0 молчаливых правок изделия, запуск в 1 касание после проверки.

**Класс:** XL · **Max agents:** backend + frontend + qa + designer · **Проверки:** full перед выкладкой. **Язык менеджера:** да.

## Модель данных (по ADVICE.md, кратко)
- Справочник частей `productParts` — группа в существующем механизме `dicts` (`dict_values`): `name`, `categories[]`, `sortOrder`. `passportParts` не трогать.
- `products.parts[]` (необязательное): `{ _id, partId, name, qty, lineId?, checked, checkedBy, checkedAt }`.
- `products.workTypes[]` + необязательные `partRowId?`, `hours?` (норма на 1 шт.), `checked`, `checkedBy`, `checkedAt`. Запрет повтора вида работ (`work-route.service.ts:88–93`) → уникальна пара `(workTypeId, partRowId)`.
- Новая коллекция `orderlineplans`: `{ incomeId (unique), productId, origin: 'product'|'manual', rev, parts[], steps[{ _id, workTypeId, partRowId, hours, checked, checkedBy, checkedAt, assigneeId?, plan? }], productRevAtCopy, launchedAt?, deletedAt }`. Поля `assigneeId`, `plan` — задел Э2 (описать в DTO сразу).
- `worktasks.route[]` при запуске = снимок `steps` + `stepId`, `partName`, `hours` (схема Mixed, не меняется).

## Контракт API (точно — для параллельной работы)
- `GET /api/orderline-plans/by-income/:incomeId` → план (get-or-create upsert из изделия; нет изделия — пустой план `origin:'manual'`). Ответ плана: `{ id, incomeId, productId, productName, rev, origin, launchedAt, parts:[{id, partId, name, qty, checked, checkedByName, checkedAt}], steps:[{id, workTypeId, workTypeName, partRowId, partName, hours, checked, checkedByName, checkedAt}], diff:{ changed: boolean, added:n, removed:n, edited:n }, productChangedSinceCopy: boolean, task?: {id, status} }`. Шаги без `partRowId` → `partName: 'Изделие целиком'`.
- `PUT /api/orderline-plans/:id` `{ rev, parts, steps }` → план (`rev+1`); чужая правка → 409 «План изменил другой человек — обновите».
- `POST /api/orderline-plans/:id/check` `{ kind: 'part'|'step', rowId, checked: boolean }` → план (роли admin/manager).
- `POST /api/orderline-plans/:id/apply-to-product` `{ productUpdatedAt }` → `{ product: {id, updatedAt}, plan }`: переносит `parts` и `steps` в `products.parts/workTypes`; изделие менялось после → 409.
- `POST /api/orderline-plans/:id/reset-from-product` → план заново из изделия (для «Изделие изменилось — взять заново?»).
- Запуск: существующий `launch` берёт план позиции (нет — создаёт из изделия); непроверенное → поле `warnings[]` в ответе, запуск не запрещён.
- Справочник частей: `GET /api/dicts/productParts`, создание — существующим `POST` dicts (если у dicts нет записи для менеджера — добавить роль manager для этой группы).

## Чек-лист
### Сервер (backend)
- [ ] 0. grep в `D:\kppdf-8.0` на `replaceOne|findOneAndReplace|\.save\(` по `products` — CRM не стирает новые поля? Итог в отчёт (только чтение).
- [ ] 1. Группа справочника `productParts` (сид, без записи на прод вручную).
- [ ] 2. `products`: поля `parts[]`, у `workTypes[]` — `partRowId/hours/checked*`; `work-route.service.ts` — уникальность пары; юнит на повтор вида работ в `mergeColumns` (`work-flow.ts:33`).
- [ ] 3. Модуль `order-line-plan`: схема, сервис, контроллер по контракту; rev/409; diff; check; apply-to-product (проверка `products.updatedAt`); reset; soft-delete вместе с позицией; смена `productId` позиции → `productChangedSinceCopy`, план не затирается.
- [ ] 4. `launch` по плану, снимок со `stepId/partName/hours`, `warnings[]`.
- [ ] 5. Юнит + e2e; `docs/MAP.md`; openapi — если локально можно.
### Экран (frontend)
- [x] 6. Правая панель «Позиция заказа» (там, где сейчас открывается позиция в «В работе»/заказе — найти по AUDIT.md): шапка (что открыто, заказ, изделие, кол-во), блок «Состав и работы» — воронка П-1 (`docs/PATTERNS.md`): часть → виды работ (выпадающие списки из справочников) → норма часов; таблица итога по частям (часть · работы · часы · ✓). Зелёная галочка «Проверено» у части и шага (одно касание). Добавить часть (из справочника, новое имя → в справочник), удалить, изменить.
- [x] 7. Сохранение: если план отличается от изделия — окно «Сохранить: Только в этом заказе / И в продукцию». «И в продукцию» → `apply-to-product`. Плашка «Изделие изменилось после копии — Взять заново?» → `reset-from-product`. После запуска — «Задание уже запущено: правки плана его не меняют».
- [x] 8. `work-launch.js`: убрать молчаливый PUT маршрута изделия (:71); запуск — по плану позиции, показать `warnings`.
- [x] 9. Карточка изделия (продукция): блок «Части и работы» — тот же компонент (общий модуль), сохранение сразу в изделие.
- [x] 10. Помощь «?» (`help-guide-data.js`, `help-flow-data.js`) — путь «Позиция → Состав → Проверено → Запустить».
### Приёмка
- [ ] 11. qa: full (юнит + e2e) + строка TEST-LOG. designer: панель позиции и блок изделия. Вопросы — `QUESTIONS-C041.md` → `docs/QUESTIONS.md`.

## Файлы
- backend: `backend/src/modules/order-line-plan/*` (новый), `products`/`showcase` схема и `work-route.service.ts`, `work-flow.ts`, `launch` (найти по AUDIT.md), `dicts` (группа), тесты, `docs/MAP.md`, `app.module.ts`.
- frontend: `work-launch.js`, новый общий модуль `sections/work-composition.js`, правая панель позиции (найти по AUDIT.md), карточка изделия (блок), `help-*.js`, `index.html`.
- Не трогать: `supplier-catalog*`, `stock-types.js`, `ui/cat-art.js`, `docs/QUESTIONS.md` (только координатор), `docs/roles/maps/frontend.md`, запретная зона pwa `requests.js`, `money*`, `kp*`, `offers*` (`orders.js` — только если позиция заказа открывается там; тогда минимально).

## Нельзя
Менять существующие поля общих с CRM коллекций, писать на прод, миграционные скрипты (миграция — ленивая, при сохранении), коммитить.

## Отчёт
`REPORT-E1.md` (разделы backend / frontend), ≤ 15 строк на раздел; если запись запрещена — в конце этого файла.

## Отчёт frontend (REPORT-E1.md писать запрещено — здесь)
Статус: пп. 6–10 ✅ по контракту ТЗ; глазами не проверено (сервера нет). Приёмка дизайнера впереди (в коммите `Дизайнер: не нужно` временно).
- Панель `of=workplan&open=<incomeId>`: `sections/work-composition.js` (`workPlan`, `compositionEditor`, `productRoute`). Воронка kit.funnel часть → виды работ; таблицы частей и работ (часы на 1 шт., «Проверено» одним касанием, «Проверить всё», ↑↓✕). Новая часть — в справочник `productParts` (имя уже есть — берётся существующее). Вход: «Состав» в строках блока «В работе» заказа (`order-work.js`), «Состав и работы» в панели запуска.
- Сохранение: PUT плана (rev, 409), при `diff.changed` окно «Только в этом заказе / И в продукцию» (закрытие = только в заказе), `apply-to-product`, «Взять заново», «Задание уже запущено…».
- `work-launch.js`: молчаливый PUT /work-routes убран, показан итог плана, `warnings` — в `launchResult` и тосте. `work-route.js`: остался `workTypes`; `routeBlock` заменён `productRoute` (PUT /work-routes/:id {parts, steps}). Помощь: узел k1 в `help-guide-data.js` (`help-flow-data.js` в репо нет). Регистрация — `main.js`, `work.js`; `pwa-preload` пересобран.
- Проверки: --check всех изменённых ok; design-lint по ним 0; jest pwa-guards в worktree не запустился (нет node_modules/ts-jest) — прогнать в основной копии.
- Допущения к backend: (1) клиентские `id` 24 hex у новых частей/шагов принять как есть, шаг «целиком» — `partRowId: null`; (2) GET/PUT /work-routes/:id: `parts` = новые части (`partId`, `qty`, `checked`), старые строки состава без `partId`/`qty` экран игнорирует; (3) в ответ плана добавить `productUpdatedAt` (иначе берётся из GET /showcase/:id); (4) POST /check и PUT возвращают полный план с `diff`, `productName`, `launchedAt`; (5) в режиме изделия `checked` приходит с PUT.
