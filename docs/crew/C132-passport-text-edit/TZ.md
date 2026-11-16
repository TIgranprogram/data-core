# C132 — Текст паспорта: каждая строка правится двумя способами

Класс: L (сервер + экран) · Агентов: ≤ 3 (datacore-backend → datacore-frontend → datacore-designer) · Проверка: smoke + full перед выкладкой.

## Что сказал пользователь (2026-11-16, паспорт № 607 «Экотропа 120 м.п.»)
Карандаш есть только у пунктов разделов (3.1, 3.2…). Зелёные строки («Описание», «Назначение», «Правила пользования», «Обслуживание», «Монтаж») править нельзя.
Нужно **два варианта у каждой строки**:
1. **Только для этого паспорта** — правка в снимке паспорта, строка становится жёлтой («вписан вручную»).
2. **Сразу в справочнике** — правка источника, из которого собрана строка; дальше её получат новые сборки паспортов.

## Откуда сейчас текст (`backend/src/modules/product-passport/passport-v2-text.ts:85–155`)
| Строка снимка | Источник | «В справочнике» = |
|--|--|--|
| `description` | `describeProduct` по элементам/материалам; или `product.description` при `manualText` ∋ `description` | свой текст изделия: `product.description` + `manualText` |
| `purpose` | лист воронки `root.section='purpose'` (переопределение `p.textOverrides` по `root.id`) или `product.purpose` | переопределение воронки изделия (`textOverrides`), как делает C060; нет воронки — `product.purpose` + `manualText` |
| `install.text` | лист воронки `installation` / справочник способа установки / `product.installationMethod` | то же: `textOverrides` или `installationMethod` + `manualText` |
| `rules[]` | `usageRules(elements)` — справочник элементов | правило в справочнике элемента (запись элемента, откуда пришло правило) |
| `maintenance[]` | `maintenanceTables(materials, elements, defects, install)` | строка справочника материала/элемента/дефекта |

Пункты разделов уже умеют оба варианта: `PATCH passports/:id/snapshot-item` (только паспорт) и `POST …/snapshot-item/promote` (в шаблон типа) — `product-passport.controller.ts:450–466`, экран `backend/pwa/sections/passports/card-blocks.js:74–96`. **Сделать так же для остальных строк.**

## Что сделать
### Сервер (datacore-backend)
- А. `PATCH passports/:id/snapshot-field` `{ field: 'description'|'purpose'|'install'|'rules'|'maintenance', index?, text }` — правка снимка только этого паспорта; хранить `original`, ставить `src.<field>='manual'` (для списков — пометка у элемента). Поведение как `editSnapshotItem` (права `WORK`, аудит).
- Б. Чтобы экран знал, куда вести «в справочник»: при сборке класть в снимок ссылку на источник строки (`ref: { kind: 'product'|'element'|'material'|'defect'|'install'|'funnel', id, field }`). Для `rules`/`maintenance` — id записи справочника, откуда строка.
- В. `POST passports/:id/snapshot-field/promote` `{ field, index? }` — записать текст в источник по `ref` (изделие: `textOverrides`/свой текст; справочник: соответствующее поле записи), права `EDIT`. Выданные паспорта не меняются. Справочник общий для многих изделий — в ответе вернуть, сколько изделий затронуто.
- Юнит-тесты на А–В. `docs/openapi.json` и `docs/MAP.md` обновить.
- Не трогать схемы общих с CRM коллекций. Если источник — общая CRM-коллекция, не писать в неё, вернуть 409 с понятным текстом.

### Экран (datacore-frontend, после сервера)
- Г. В `previewBlock` (`card-blocks.js:116–150`) у каждой строки описания, назначения, правил, обслуживания, монтажа — карандаш, как у `snapItem`. Редактор: textarea и **две кнопки**: «Сохранить только в этом паспорте» и «Сохранить в справочнике». Вторая — подтверждение с текстом «Новые паспорта получат этот текст. Выданные не изменятся.» и, если справочник общий, «Затронет изделий: N».
- Д. У пунктов разделов (`snapItem`) — та же пара кнопок в редакторе (вместо отдельной «Сделать общим…» после правки).
- Е. Подсказка в редакторе: откуда строка («из справочника элементов: Лист стальной»).
- Обновить `atlas-data.js` / `help-guide-data.js`, если меняются шаги.

## Не читать
`base.css` целиком; `docs/openapi.json` целиком (только grep).

## Проверки
`npx tsc --noEmit`, `npx jest --silent`; `node --input-type=module --check < файл`; `tools/dc.cmd check`; full + строка в `docs/TEST-LOG.md` перед выкладкой; снимки стенда паспорта (редактор, жёлтая строка, подтверждение); приёмка `datacore-designer`.

## Отчёт
`docs/crew/C132-passport-text-edit/REPORT.md`. В чат ≤ 8 строк.
