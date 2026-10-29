# Коммерческие предложения: где искать в старых версиях CRM (разведка 2026-10-29)

Разведка только по именам и выдержкам (агент haiku, только чтение). Это карта для аудита, не вывод. Задача — `docs/TASKS.md` «Коммерческие предложения».

## Версии `D:\kppdf`

| Версия | КП | Оценка |
|--|--|--|
| kppdf-8.0 | да | **самая полная**: quotation с версиями и заморозкой, studio-document, PDF через puppeteer, фоны по страницам, перенос таблицы |
| kppdf-5.0 | да | рабочая (Next.js + Prisma) |
| kppdf-3.0 | да | рабочая (Angular + Mongoose) |
| kppdf-8.0_01, 8.0_02 | да | набросок: только сервер quotation, без экрана КП |
| kppdf-6.0 | спека | Prisma Proposal (`schema.prisma:351`), папка `01_КП` с заглушками, экрана нет |
| kppdf-8.0_001 | да | копия 8.0 (не разбирали) |
| kppdf-7.0, 8.0-wip-aside, 8.0;C | нет | — |

## Фоны и примеры

- Фоны А4: `D:\kppdf\kppdf-8.0\data\from-kp3\media\kp\kp-1str.png` (1-я страница), `kp-2str.png` (2-я и дальше); там же `kp-brand-*.png/jpg` (назначение не проверено).
- В коде 8.0 фоны шаблона: `backend\uploads\document-templates\{id}\`, до 5 шт.
- Примеры КП: `D:\kppdf\kppdf-8.0\data\КП\КПтест.pdf`; `D:\kppdf\kppdf-8.0_01\Пимер.pdf`; `D:\kppdf\kppdf-8.0_02\Пимер.pdf`.

## kppdf-8.0 — ключевые места (`backend\src\modules\…`)

- `quotation\quotation.schema.ts`: наценка `orgMarkupPercent`, НДС `vatPercent` (206), предоплата, сроки изготовления/доставки, `validUntil` (237), скидка `discountType/Percent/Amount` (253–259), условия `terms[]`, `sheetLayout` (283), `items[]` (286), `versions[]` (293); вёрстка — `rowsFirstPage`/`rowsNextPage` (110–113), `photoScalePercent` (116), `tableFontSize` (126).
- `quotation\quotation.controller.ts`: CRUD `/quotations`, freeze, versions, duplicate, family, **convert-to-contract, convert-to-order**.
- `generated-document\quotation-output.controller.ts:20` — `POST /quotations/:id/pdf`; `quotation-output.service.ts:44,58,80` — HTML → PDF (puppeteer); `kp-pdf-filename.ts:4` — имя файла «КП-<номер>.pdf».
- `document-template\document-template.controller.ts:170` — загрузка фона, `:275` удаление, `:286` фон по умолчанию; `document-template.service.ts:1971` — не больше 5 фонов, `:868–894` — строк на страницу и перенос.
- `studio-document\studio-document.schema.ts:32–41` — `backgroundImage[]`, `defaultBackgroundIndex`, `backgroundPageIndices[]`, `backgroundOpacity`; `studio-output.service.ts:206–218` — фон по страницам.
- Экран: `frontend\src\app\pages\commercial\proposals\` — `proposal-create-table-editor.component.ts` (2331 стр.), `proposal-create-inspector.component.ts` (1149), `proposals.page.ts`, `workspace\proposal-workspace.page.ts`.

## kppdf-5.0 и 3.0

- 5.0: `proposal-editor`, `src\lib\validations\proposal.ts` (наценка, скидка, срок действия, статус), `src\components\ui\proposal-preview.tsx` (фон из шаблона, `preview-area.tsx:22`), `src\lib\pdf`.
- 3.0: `src\app\features\quotations\quotation-editor.component.ts` (2730 стр.), `backend\src\modules\quotations\quotation.model.ts`, фон шаблона — `documentTemplate.model.ts:50`.

## Что уже есть в data-core

- `backend\pwa\sections\kp.js` — экран КП: `POST /showcase/kp`, номер по счётчику `CommercialOffer`.
- `backend\src\modules\showcase\showcase.controller.ts:82`, `showcase.service.ts:512` — `kp()`.
- Коллекция `quotations` — живые данные CRM kppdf (`collections-admin.controller.ts:174`): не ломать схему (AGENTS.md «Единая база»).

Не проверено: картинки `kp-brand-*`, роутер 3.0, полный разбор 8.0_001.
