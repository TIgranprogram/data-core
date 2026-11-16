# C132 — Отчёт

## Сервер (datacore-backend)
Статус: А ✅, Б ✅, В ✅. tsc 0; jest 345 наборов / 3543 теста зелёные; openapi.json и MAP.md обновлены.

### Эндпоинты
- `PATCH /passports/:id/snapshot-field` (WORK) `{ field: 'description'|'purpose'|'install'|'rules'|'maintenance', index?, text }` — правка снимка. Возвращает паспорт. `index` обязателен у `rules` и `maintenance` (у maintenance — сквозной номер строки по всем таблицам, правится `what`). Исходный текст — `textSnapshot.fieldEdits`, у скаляров `src.<поле>='manual'` (прежний цвет хранится и возвращается, если вернуть исходный текст).
- `POST /passports/:id/snapshot-field/promote` (EDIT, как у пунктов) `{ field, index?, text? }` — запись в источник. `text` не задан — берётся текст снимка. Ответ `{ ok, kind, target: 'справочник: элемент «Горка»' | 'изделие «…»', affected, shared }`. Выданные паспорта не меняются.

### Форма `ref` в снимке
`textSnapshot.refs = { description, purpose, install: FieldRef|null; rules: (FieldRef|null)[]; maintenance: (FieldRef|null)[] }`, `FieldRef = { kind: 'product'|'element'|'material'|'defect'|'install'|'funnel', id, field }`.
- description: `product` (field description; нет изделия — null). purpose: `funnel` (id раздела, field text), либо `product`(purpose).
- install: `funnel`, либо `product`(installation, если вписан вручную / нет способа), либо `install` (id записи, field montage|mountText).
- rules[i]: `element` (id записи, field usageRules|rules). maintenance[i]: `defect` (field name) или `element` (field inspect|checks).
- У старых снимков без `refs` карточка (`GET /passports/:id`) добавляет `refs` из свежей сборки (в базу не пишется); списки — только если число строк совпало.
- Куда пишет promote: product → `products.description|purpose|installation` + `passportDefaults.manualText` (+ `manualText` теперь поле значений по умолчанию, `DEFAULT_KEYS`, `normalizePassportDefaults`); funnel → `passportDefaults.textOverrides[id]`; dict → `dict_values` (строка правил/осмотра заменяется по прежнему тексту, дефект — `name`, способ установки — весь монтаж). `affected` = число изделий (по `passportDefaults.elements|materialIds|installationTypeId`; у дефекта — оценка «не меньше»).
- 409: строки в записи справочника больше нет / её уже изменили / запись удалена. Общие с CRM коллекции не пишутся (`dict_values`, `products.*` — наши поля).

### Прочее
- Пересборка черновика (`rebuildSafe`) переносит правки зелёных строк (`carryFields`): скаляры всегда, строки списков — по исходному тексту; исчезла/дубль — 409 «Ручные правки…», как у пунктов разделов. «Обновить текст по справочникам» (snapshot) правки сбрасывает, как и у пунктов.
- Файлы: `passport-snapshot-field.ts`, `passport-field-promote.ts` (+ spec), `passport-v2-text.ts` (refs, withTextSources), `passport-compose-parts.ts` (usageRulesFrom, refs у maintenanceTables), `product-passport.service.ts/controller.ts`, `passport-from-product.ts`, `showcase/passport-defaults.ts`, `passport-manager-access.spec.ts`.

### Не сделано / нужно от frontend
- Права: promote — только EDIT (director/admin), менеджер видит кнопку «в справочнике» недоступной (403) — экран должен скрыть её по роли.
- `passportDefaults.manualText`: экран «умолчания изделия» при сохранении шлёт весь объект — должен возвращать `manualText` как получил, иначе стирается.
- «Материал» (`kind:'material'`) пока ни у одной строки не используется (у материалов нет строк в тексте).
- e2e не писался и не запускался.

## Экран (datacore-frontend)
Статус: Г ✅, Д ✅, Е ✅, manualText ✅. Снимков стенда нет, приёмка designer не проведена.
- Новый `sections/passports/field-edit.js`: `fieldEditor` (textarea, подсказка «Откуда строка: из справочника элементов / дефектов / способов установки / текста изделия / варианта текста изделия», кнопки «Сохранить только в этом паспорте», «Сохранить в справочнике», «Отмена»), `fieldPencil`. «В справочнике» — только `canEdit()` (admin/director/owner), выключена, если `refs` нет. Карандаш — всем с WORK (`canWorkPassport`).
- `card-blocks.js previewBlock`: карандаш у описания, назначения, каждого правила, каждой строки обслуживания (сквозной индекс), монтажа (весь текст); пометка «изменено для этого паспорта» по `fieldEdits`. `snapItem`: те же две кнопки вместо «Сделать общим…» (в справочник = PATCH snapshot-item + promote в шаблон типа). `textBox` вынесен для общего использования.
- `products/data.js PD_KEYS` +`manualText`: `savePd`/`resetPdCategory`/`putDefaults` возвращают его как получили (остальные PUT шлют весь объект).
- Подтверждение: `affected/shared` приходят только после promote (dry-run нет) — подтверждение общее, число «Затронет изделий: N» показано в итоговом сообщении, если `shared`.
- Проверки: `--check` ✅, jest pwa-guards 318/318, design-lint 0, `dc check` зелёный. atlas/help не менялись (шаги те же).

## Приёмка дизайнера (datacore-designer, 2026-11-16)
Вердикт: **PARTIAL** — поведение проверено на стенде (:3102, admin, 1600×1000 и 375×812) через DOM; снимки панели не сняты (панель браузера скрыта, кадры не обновлялись).
- Карандаш ✎ (`k-icon`, 44×44 на телефоне) есть у описания, назначения, правил, пунктов разделов 3–15, обслуживания, монтажа (108 шт. в черновике QA МЦ-7). Группа «Текст паспорта» свёрнута по умолчанию — норма kit.
- Редактор: поле + «Откуда строка: …» (проверено: «из текста изделия», «из выбранного варианта текста изделия», «из справочника элементов») + три кнопки в `actions`. Ширина 375 — без горизонтальной прокрутки.
- «Только в этом паспорте» → строка жёлтая (`k-src[data-src=manual]`, полоса rgb(227,183,74)) + «изменено для этого паспорта».
- «В справочнике» → подтверждение «Сохранить в справочнике? Строка из справочника элементов… Выданные не изменятся.» → сохранено на стенде, сообщение с числом изделий.
Починил:
1. `card-blocks.js`: правки описания/назначения/правил/обслуживания/монтажа «только в этом паспорте» не красились в жёлтый (только серая пометка) — теперь `srcPaint(…,'manual')`, без двойной заливки, если блок уже «вручную».
2. `field-edit.js`: сообщение «Записано: справочник: … Затронет изделий: 2 изделия» → «Готово — справочник: … Затронет: 2 изделия».
Замечания (не чинил): кнопки `size:'S'` на телефоне 40 px (< 44) — общее для kit; проверялся черновик, не выпущенный паспорт; после перезагрузки мелькнул тост «Нет связи с сервером» (след сброса service worker, не C132).
Проверки: `--check` обоих файлов ✅, design-lint новых 0.
