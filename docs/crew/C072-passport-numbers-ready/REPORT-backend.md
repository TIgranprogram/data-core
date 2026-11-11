# C072 — отчёт сервера (часть A)

Исполнитель: backend. Записал координатор со слов исполнителя, 2026-11-11.
Проверки: `tsc` 0; jest `product-passport` 46 наборов / 477 тестов; e2e `passports-ready` 6/6, `passports` 17/17; eslint и циклы чистые. Полный прогон не делался.

## Маршруты (префикс `/api`; смотреть — admin, director, manager; писать — admin, director)

1. `GET /passports?numberFrom=600&numberTo=650` — диапазон по числовому номеру, включительно; оба параметра необязательны. В строке уже есть `supplierOrg: { id, name } | null`, `printSource: 'file' | 'app'`, `printFile: { name, hasFile }`, `source`. Сортировка по умолчанию `-passportNo`; `search=612` ищет и по номеру.
2. `GET /passports/last-numbers` → `{ last, byFirm: [{ orgId, name, last | null, count }] }`. В `byFirm` — все наши фирмы; аннулированные считаются, черновики нет.
3. `POST /passports/ready` — `multipart/form-data`: `file` (PDF до 20 МБ), `productId`, `supplierOrgId` (обязательны), `salesOrderId?`, `incomeId?`, `number?` (целое). Ответ 201 — карточка как `GET /passports/:id`: `status: 'issued'`, `source: 'ready-file'`, `printSource: 'file'`.
   - Категория и её поля не проверяются. Название — из изделия; заказчик и номер заказа — из заказа или позиции.
   - Номер не передан — следующий свободный. Номер больше текущего сдвигает следующий выпуск.
   - 400: «Изделие не найдено…», «Выберите нашу фирму…», «Заказ не найден», «Позиция заказа не найдена», «Позиция относится к другому заказу», «Номер — целое число…», «Прикрепите PDF», «Нужен файл PDF».
   - 409: «Номер 612 уже у паспорта «Горка»» (учитываются удалённые и аннулированные); «На эту позицию уже есть паспорт № 600 «Урна»».
4. `GET /passports/order/:orderId/pdf` («Печать всех»): паспорта-файлы в общий PDF не входят; их список — заголовок `X-Skipped-Passports` = `encodeURIComponent(JSON)` массива `[{ id, passportNumber, name }]`. Все паспорта заказа — файлы: 400 `{ message, skipped }`. Сам файл — `GET /passports/{id}/pdf`. `GET /passports/zip` кладёт файлы в архив как есть.

## Допущения

- `printSource` остался `'app'` (не `'site'`): так в контракте. Экран подписывает «Файл» / «С сайта».
- Талон и номер изделия у готового паспорта выдаются как при обычном выпуске.
- `source: 'ready-file'` не попадает в «Архив» (`legacy=1`).
- `GET /passports/next-numbers` не менялся (только admin и director).

## Файлы

Новые: `passport-ready.ts`, `passport-last-numbers.ts`, `dto/ready-passport.dto.ts`, `passport-ready.spec.ts`, `backend/test/e2e/passports-ready.e2e-spec.ts`. Правки: `passport-queries.ts`, `passport-bind.ts`, `passport-pdf.service.ts`, `product-passport.service.ts`, `product-passport.controller.ts`, `docs/openapi.json`, `docs/MAP.md`.
