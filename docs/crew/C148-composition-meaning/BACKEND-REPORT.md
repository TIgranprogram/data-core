# C148 — backend

Статус: серверная часть готова; общий backend/e2e и приёмка — координатор.
Сделано ✅ §2: partIds необязательны, не порождают очередь; материал без id остаётся пробелом.
Сделано ✅ §4–5: sourceRefs с полным path, имена/обозначения разных деталей сохранены; старые unmatched/hinted + адресные unmatchedSources/hintedSources.
Сделано ✅ §5: bounded parse/present и DTO, ручные passportText/techText проходят; техническая печать использует источник без склонения по догадке.
Сделано ✅ §8 с защитой C152: modules всегда сохранены; скрывается только точный plain дубль через compositionPresentation; rich/различия видимы, old issued сохраняет прежнюю печать. Новых маршрутов/коллекций/миграций нет.
Файлы: common/catalog/{composition-expand,materials-text,materials-table,material-source-refs,composition-meaning.spec}; common/print/tech-sheet-rows; showcase/showcase-materials; product-passport/{techsheet-gaps,passport-pdf-v2-layout,dto/create-product-passport.dto} и ближайшие spec.
Документы: docs/data-model.md — C148 контракт, docs/roles/maps/backend.md — якоря; карта обновлена.
Проверки: tsc PASS; 97 suites / 966 tests PASS (17,891 с); после дополнительного теста переноса в черновик — 1 suite / 14 tests PASS; eslint всех изменённых TS PASS; audit-cycles — 0.
Значимые сценарии: модуль ×2/деталь ×3 = ×6; две разные «Стойка» с разными path; неизвестный материал с источником; parse/present→techprint без словаря и с manualText; новый draft; draft/issued PDF.
Нужно от координатора: общий unit+e2e PATCH/GET и UI; openapi регенерация при общем backend build (добавочные поля DTO, путь прежний). Readiness по сохранённой таблице; автоматическое угадывание новых материалов после BOM не включено — актуальность показывает предложение.
Риски: sourceRefs — снимок происхождения; не участвует в dictionary cascade, поэтому названия не переписываются по справочникам; C144 и CRM-схемы без изменений. Коммит: —.

## Исправления аудита перед выпуском

- P1/C152: прежняя промежуточная очистка modules отменена ДО релиза. Первый issue сохраняет весь modules[], фиксирует только compositionPresentation. Точный plain дубль скрыт; rich/различия видимы; old issued без marker не меняется. Проверены issue → сохранённые данные → PDF, GET и явная новая редакция.
- P1: 101 источник одного материала разбивается на строки 100+1 без потери имён/путей. Больше 50 итоговых строк — 400 с адресным сообщением; сервис дополнительно прогоняет своё предложение через `parseMaterialsSpec` до ответа 200. Максимальный достижимый путь при глубине 8 — 9 шагов, проверен parser с границей 10.
- Файлы дополнительно: `passport-issue.ts`, `passport-issue-composition.spec.ts`, расширен `composition-meaning.spec.ts`. tsc PASS; 5 suites/49 tests PASS, после проверки крайней глубины и producer-validation — 3 suites/11 tests PASS; eslint PASS. Общая сборка и e2e — координатор.

## Название отдельного экземпляра (дополнение владельца)

- `diffPatch` сохраняет `name` при `manualText` с `name`; marker не снимается умолчаниями изделия при повторном GET. Остальные черновики по-прежнему следуют имени изделия, issued не синхронизируются.
- `create`: название из заказа/введённое отличается от имени изделия — сохраняется вместе с marker. Переданное старым клиентом то же имя каталога marker не ставит и не останавливает дальнейшее обновление. Явный marker клиента сохраняется.
- Тесты: `passport-name.spec.ts` — реальный create → изменение product.name → два реальных GET для собственного/каталожного/отсутствующего имени; `passport-from-product.spec.ts` — ручной name и повторная синхронизация manualText изделия. 3 suites / 23 tests PASS; tsc/eslint PASS.

## Приоритет имени экземпляра при общей печати (дефект владельца)

- Причина: `passport-pdf.service.ts input()` читала incomes.title и вызывала withContractName; helper менял name и рекурсивно заменял ручные строки textSnapshot. Это происходило и у single PDF, и у заказа, включая old issued без manualText.
- Исправление: удалён print-time мост с запросом позиции договора; удалены неиспользуемые withContractName/renameDeep и их старые тесты. boostFaint сохранён. Сохранённое имя/снимок экземпляра передаются в печать без подмены, договор задаёт имя только при создании. Никаких миграций/изменения выпущенных документов.
- Общая печать использует issuedOfOrder (status issued) и выбранные id; не создаёт черновики и не выпускает новые паспорта. Проверено кодом и тестом с create/issue spies.
- Тест passport-order-pdf.spec.ts: реальные pdf/input и orderPdf/input для двух разных old-issued без marker; разные исходные договорные имена не запрашиваются; имена, все поля снимков и ручные строки совпадают single/batch. Отдельно draft с manual name. На границе рендерера захвачен фактический input; layout не подменён.
- Финал: 3 suites / 9 tests PASS (order-pdf, print-tune, name), tsc PASS, eslint четырёх изменённых файлов PASS. Backend-код завершён, готов к финальному stand refresh/fullunit координатора.

C152 немедленная защита завершена: см. docs/crew/C152-modular-passport-book/BACKEND-REPORT.md. Прежние формулировки о blanket suppression/очистке modules не являются текущим контрактом.
