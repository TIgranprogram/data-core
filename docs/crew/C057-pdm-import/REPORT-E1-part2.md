# C057-Э1 часть 2 — модуль импорта (отчёт исполнителя datacore-backend, перенесён координатором)

**Статус:** готово. Коммит — координатор.

## Сделано
- ✅ п.1 `pdmimports`: дерево, хэш, план, найденные записи с `updatedAt`, решения, итог, `owners`, кто/когда, `organizationId`.
- ✅ п.2 `POST /pdm-import/preview` (admin). DTO дерева (≤ 5000 позиций): `../`, дубли, цикл, неизвестная связь → 400; прочее → `blockers`. План: create | link(by) | suggest | conflict(fields сайт/PDM) | same + `needFiles`. Удалённые — `setOptions({includeSoftDeleted:true})`. Сортамент — по `matchKeyPdm`, нет → создаётся.
- ✅ п.3 `POST /pdm-import/apply`: `planId` (или `tree` → план по хэшу). 409 «Данные на сайте изменились — проверьте ещё раз». Повтор `planId` — прежний итог. Одна транзакция: сортаменты → детали → метизы/покупные → модули от листьев → изделие. Составы проверяются в памяти, дубли строк складываются, удалённые восстанавливаются. Решения: keep-site, update-all, fields, link+targetId, create.
- ✅ п.4 `POST /pdm-import/files`: multipart ≤ 50 МБ; владелец и имя — из плана; файла нет в дереве → 400; повтор → `stored:false`. `PdmFilesService.missingSha` для `needFiles`.
- ✅ п.5 `scripts/ensure-indexes.js`: + `PdmFile`, `PdmImport`.
- ✅ п.6 Тесты: юнит (расход сырья, порядок, сложение дублей, 409, идемпотентность, «в детали только сырьё», «в изделии без сырья»); e2e на фикстуре 6104 — 14/14 (Mongo в Docker).
- `main.ts`: тело JSON 1 → 2 МБ.

## Проверки
- `tsc --noEmit` = 0 · jest pdm-import/pdm-files/catalog: 13 наборов, 195 тестов · e2e pdm-import 14/14 · eslint 0 ошибок · audit-cycles 0.

## Допущения
- `created` — детали, модули, изделия, метизы (без сортаментов); `linked` — использованные существующие; `updated` — изменённые; `skipped` — без правок; `importId` = `planId`.
- Состав существующей позиции: пусто → заполняется; отличается → расхождение `composition`. Нет заготовки → состав не трогается.
- `suggest` без решения → 400; `conflict` без решения → остаётся сайт.
- Смена `sku`/`article` существующей записи — только `fields.sku|article='pdm'` вместе с `link+targetId`.
- Новый метиз получает `assortment`/`materialGrade` из PDM — следующая загрузка найдёт по ключу.

## Риски / нужно от других
- `docs/openapi.json` не перегенерирован — перед выкладкой.
- Не сделано (вне части 2): п.5 «Что купить», п.7 скачивание приложения.
- Время транзакции на 5000 позиций не мерено (мини-дерево ~40 мс).
- Конфликт конфигураций — только по `warnings.code:'config-conflict'` от приложения (добавить в CONTRACT — координатор).
- Э3 (экраны): `items[].fields` и `candidates` — экран расхождений; `planId` → apply и `importId` → files; смена `sku` — с предупреждением «артикул в N заказах/паспортах».

## Файлы
Новые: `backend/src/modules/pdm-import/` (`pdm-import.schema.ts`, `.module.ts`, `.controller.ts`, `.service.ts`, `pdm-plan.ts`, `pdm-plan-rows.ts`, `pdm-write.ts`, `pdm-tree.testkit.ts`, `dto/pdm-tree.dto.ts`, спеки), `backend/test/e2e/pdm-import.e2e-spec.ts`.
Изменены: `app.module.ts`, `main.ts`, `pdm-files.service.ts`, `scripts/ensure-indexes.js`, `docs/MAP.md`, `docs/data-model.md`, `docs/roles/maps/backend.md`.
