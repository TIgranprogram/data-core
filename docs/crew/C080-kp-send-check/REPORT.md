# C080 — отчёт

Статус: сделано, не закоммичено.

- Правила: `backend/src/modules/offers/offer-ready.ts` (offerProblems, packProblems) + `offer-ready.spec.ts` (6 тестов).
- Сервер: `OffersService.check(id)` и `sendPack(packId)`; маршруты `GET /offers/:id/check`, `POST /offers/packs/:packId/send` (строка в MAP.md).
- Экран: `offer-pack.js` — `readyBlock` (КП вне пакета, черновик) и в `packBlock` список «Не хватает» / зелёная «Можно отправлять» + кнопка «Отправить пакет» (неактивна, пока есть замечания); подключено в `offers.js`.
- Проверки: tsc 0; jest offers 68/68; node --check модулей — ок.
- Допущения: «нет фото» — нет photoUrl и нет главного фото изделия витрины; «нет бланка» — нет бланка 1-й стр. у фирмы КП; срок «прошёл» — validUntil раньше сегодня (МСК); отправляются только черновики пакета; openapi не перегенерирован.
