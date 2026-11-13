# C100 — отчёт backend (2026-11-13)

Статус: пункты 1–7 сделаны. tsc 0; весь юнит 332 suites / 3428 tests зелёные; audit-cycles 0; e2e не гонялся.
grep `suggestElementNames|suggestPurposeName|suggestValue|name-suggest` в backend/src → 0.

## Сделано
- `common/passport/kind.ts`: `resolveKinds` (пачкой), `resolveKind`, `kindPatch`, `purposeRootId` + `kind.spec.ts`.
- Справочник `passportKinds` — `modules/dicts/dicts.passport-kinds.ts`: name, passportCategory, elementIds (≤3), purposeLeafId (лист «Назначения»), notes. Удаление занятого вида — 409; «Объединить с…» переносит группы и изделия.
- Группы: `passportKindId` (+ `passportKindName`), вид должен существовать и совпадать категорией (400). Схема CRM не менялась.
- Изделие: `passportDefaults.kindId` (`showcase/passport-defaults.ts`), запись — прежний `PUT /showcase/:id/passport-defaults`.
- Всё через `resolveKind(s)`: passport-from-product (PDF, check, черновики), gaps, funnel, order, showcase present.
- Угадывание удалено: name-suggest (+spec), suggestValue, funnel.parity.spec, fixture c028-suggest.json, elementSuggest, `suggest` в GapItem, scripts/c062-passport-purpose-plan.js; сверх ТЗ — «Слова подсказки» у значений признаков (`parseWords`).
- `backend/scripts/c100-kinds.js` (план / `--apply`, идемпотентен, изделия не трогает) + spec; DATA-FIX-USER — запуск и перенос «3207 Стелла».
- Доки: MAP, data-model, roles/maps/backend.

## Контракт для frontend
- `GET /showcase/:id/passport-gaps` → `{ category{code,name,source:'own'|'kind'|'group'}, kind{id,name,source:'own'|'group',groupName}|null, missing[], applicable }`. Поля `suggest` нет нигде.
- Пункт вида — первый в `missing`: `{ key:'kind', kind:'kind', label:'Вид изделия', required:true, options:[{id,label}] }` — когда вида нет, а элементы или назначение пусты.
- Удалённый/неподходящий лист назначения → пункт `purpose` `required:true`, «Выберите назначение заново: …».
- `PUT /showcase/:id/passport-defaults` заменяет умолчания целиком: слать свежие `passportDefaults` + `kindId`.
- `GET /showcase`, `/showcase/:id`: у изделия `kind: {id,name,source,groupName}|null`; `ppSource` может быть `'kind'`.
- `/dicts/passportKinds` (колонки `elementNames`, `purposeLeafName`); группы отдают/принимают `passportKindId`.

## Хвосты (координатор)
- Ссылки на удалённый c062-скрипт: `deploy/synology/c062-passport-purpose.sh`, `pult/catalog.mjs:120`, `pult/todo.json:117-130`, `pult/.state/done.json`.
- Кнопка пульта для `c100-kinds`.
- Приоритет назначения «своё → вид → привязка листа к группе/признакам» — в PATTERNS/CANON.
