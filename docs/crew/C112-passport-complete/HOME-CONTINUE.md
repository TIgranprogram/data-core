# C112 — продолжить дома (первым)

Дата передачи: 2026-11-17 (работа → дом). Прод не трогать без слова. Выданные паспорта не менять.

## ▶ Сначала это

1. `git pull` (ветка `main`, коммиты C112 live).
2. Пульт → **Паспорта: стенд PDF** (`passport-regression --live`) — полный авто + свежие PDF на стенде :3102.
3. Если стенд не поднят: пульт «Стенд на копии» / night-up, затем снова п. 2.
4. Сверить итог с `evidence/live-stand/REPORT.md` (уже есть эталон PASS от 17.11).
5. Пульт → **Паспорта: глаза ИИ** на 15–30 мин (после GitHub/стенда).
6. Запись в `docs/TEST-LOG.md` строки полного прогона; дописать `REPORT.md` «домашний прогон».

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
