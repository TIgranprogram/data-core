# Отчёт C019 — координатор

**Статус:** реализовано локально, на прод не выложено.

## Сделано

- Аудит / ТЗ / чек-лист / решения в этой папке.
- Сайт: «Заказы» → Шаблон + Импорт Excel (проверка полей → загрузка).
- Пульт: раздел «Локальный ИИ» (входящие, готовое, настройки, связь, собрать Excel).
- Скрипт `tools/local-ai-order/run.mjs` + PROMPT.md + write-xlsx.
- Автономер productionNo при create (раньше в сессии) — для импорта без №.

## Проверки

- selftest write-xlsx OK
- node --check salesorders*.js OK
- jest salesorders.service.spec 12/12 OK
- `run.mjs --check` — зависит от LM Studio на ПК (401 без ключа исправлен на Bearer lm-studio)

## Дальше пользователю

1. Выложить код на сайт.
2. В LM Studio: Running + CORS; settings.json baseUrl.
3. Пульт → Локальный ИИ → файлы в inbox → Собрать Excel → Импорт на сайте.
