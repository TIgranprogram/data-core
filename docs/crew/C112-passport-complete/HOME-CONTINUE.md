# C112 — продолжить дома (первым)

Дата передачи: 2026-11-17 (работа → дом). Прод не трогать без слова. Выданные паспорта не менять.

## ▶ Сначала это

1. [x] `git pull` (ветка `main`, коммиты C112 live).
2. [x] **Паспорта: стенд PDF** — 17.11 вечер, live PASS (`tools/logs/passport-regression/2026-11-17T20-29-58-361Z-0c76b7e0/`).
3. [x] Стенд поднят (`dc stand up`).
4. [x] Сверено с эталоном: live PASS (изделия другие на копии базы — ок).
5. [ ] Пульт → **Паспорта: глаза ИИ** на 15–30 мин — по слову владельца.
6. [x] `TEST-LOG.md` + `REPORT.md` «домашний прогон».

## Уже сделано на работе (не повторять зря)

- PWA `buildDescription` = сервер («Изделие изготовлено из…»).
- Кнопки: автопроверка / стенд PDF / глаза ИИ; `--tasks` у ИИ-тестировщика.
- Live PASS: BLG + WRK + неполная DIO; issued № 598 не изменился; фраза через preview + изоляция черновиков.
- Evidence: `evidence/live-stand/` (PDF+txt до/после issued, preview фразы).

## Не закрыто

- Э4: finish Старожила 006/007 — логов нет, не принимать.
- Запись общей фразы в шаблон на стенде — только director/admin (manager доказал preview).
- Данные владельца: схемы фундамента, имена «Стелла»/«Арт объект», чертежи/вес/габариты.
- E2E passport* — `DC_PASSPORT_E2E=1` при изолированной Mongo.

## Команды

```
node tools/passport-regression.mjs --live
node tools/passport-live-check.mjs stand
node tools/ai-tester/run.mjs --detach --minutes 30 --tasks pass-funnel,pass-order,pass-queue,order-passport
```
