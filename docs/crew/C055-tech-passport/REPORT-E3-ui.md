# C055 Э3 — UI: функциональные элементы и три печати

Статус: сделано (UI). PDF «вместе» нет — кнопки есть, combined = toast.

## Чек-лист
- 10 Печать паспорт / техописание / вместе — ✅ кнопки. Контракта `REPORT-E2` нет, вместе не скачивает PDF.
- 11 Блок «Функциональные элементы» + тексты справочника — ✅ форма и шаблон. Аудит заполненности справочника — не UI.

## Что видно
- Форма паспорта, форма изделия (шаблон), шаблон в «Документации», шаг воронки «не хватает»: выбранные элементы, фраза `inDescription`, правила `usageRules` по строкам. Пустое поле говорит, что в справочнике текста нет.
- Карточка изделия: «Паспорт» (как раньше: выпущенный PDF или черновик), «Техническое описание» (`openTechSheet`), «Паспорт + техописание» — toast «Скоро: паспорт и техническое описание одним файлом».

## Файлы
- `backend/pwa/sections/passports/elements-block.js`
- `passports/form.js`, `passports/funnel/gaps.js`
- `products.js`, `products/form-fields.js`, `docs.js`

Не трогал: tech-sheet.js, materials-spec.js, backend/src, product-files.js.

## Проверки
- Синтаксис шести файлов — ок. `pwa-import-check` — 0.
- design-lint по этим файлам — 0. Общий прогон красный из чужих файлов (product-files, screens.css, tabs, card-blocks, dicts).
- `pwa-guards`: 259 ок, 1 падает на том же чужом design-lint.

## Нужно от других
- backend: режим `combined` одним PDF, затем кнопка вместо toast.
- data-steward: заполненность `inDescription` / `usageRules` по TRN/WRK/BLG/DIO/DSP.
- PDF «Описание» из этих текстов — сервер, не этот экран.
