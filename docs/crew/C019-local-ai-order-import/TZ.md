# ТЗ C019 — Локальный ИИ + импорт заказа Excel

**Класс:** L · **Max agents:** 2 · **Проверки:** smoke  
**Зачем:** см. REQUIREMENTS.md

## Shared pack

- Формат файла: один лист «Заказ»; блок шапки (колонки A=ключ, B=значение) до строки, где A=`№` и B содержит `НАИМЕНОВАНИЕ`; далее позиции: A=№, B=название, C=ед., D=кол-во, E=цена (необяз.).
- Ключи шапки (точно): `№ договора`, `№ заказа`, `Заказчик`, `Наша компания`, `Предмет`, `Форма оплаты`, `Срок изготовления`, `Окончание поставки`, `Дата отгрузки`, `Примечание`.
- Даты: `ГГГГ-ММ-ДД` или `ДД.ММ.ГГГГ`.
- Создание на сайте: `POST /api/salesorders` (без requireFields если заглушки; productionNo пусто → сервер last+1) + N× `POST /api/incomes` `{orderId,title,qty,unit}`.

## Что сделать

### A. Сайт (frontend)

1. `backend/pwa/sections/salesorders-import.js` — разбор файла, экран проверки, загрузка.
2. Кнопка в списке заказов рядом с «+ Заказ»: «Импорт Excel» + «Шаблон».
3. Подключить в `main.js` LOADER при необходимости (или импорт из salesorders.js).

### B. Пульт + скрипт

1. Раздел `localai` в `pult/catalog.mjs` + кнопки: входящие, готовое, проверить связь, собрать Excel, настройки URL.
2. `tools/local-ai-order/run.mjs` — извлечь текст из inbox → chat/completions → JSON → xlsx в out/.
3. `tools/local-ai-order/PROMPT.md` — инструкция ИИ (эталон Донбасская).
4. `tools/local-ai-order/settings.example.json` → копируется в `settings.json` (gitignore).
5. `tools/local-ai-order/README.md` — коротко для человека.

### C. Доки

- REQUIREMENTS / CHECKLIST уже есть; этот TZ; строка в BACKLOG/TASKS по желанию координатора.

## Файлы

- Менять: `backend/pwa/sections/salesorders.js`, новый `salesorders-import.js`, `pult/catalog.mjs`, `tools/local-ai-order/*`, при нужде `pult/.gitignore` / корневой gitignore.
- Не трогать: `backend/scripts/import-orders-xlsx.js`, схемы Mongo, CRM.

## Критерии приёмки

См. CHECKLIST.md. Smoke: `node --input-type=module --check` на новые js; `npx jest modules/salesorders/salesorders.service.spec.ts`; `dc check` если затронут pult catalog.

## Нельзя

- Писать пароли/ключи LM в git.
- Массовая запись в прод Mongo скриптом без «да».
