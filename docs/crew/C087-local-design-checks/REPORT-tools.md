# C087 — инструмент локальной оценки

- Добавлены только vision-review.mjs и vision-review.test.mjs.
- CLI: input, latest-audit, model, limit (1–10), timeout-seconds (1–180), refresh, last.
- Лимит первых N изображений включает кэш/дубликаты/слишком большие; текст не занимает лимит. Обход без рекурсии.
- latest-audit выбирает папку аудита со снимками по mtime, исключая cache; браузер не запускается.
- Изображения PNG/JPEG/WebP до 8 МБ отправляются через image_url, последовательно.
- Разрешён только HTTP loopback без credentials/query/hash; fetch запрещает redirect.
- Вывод ограничен 700 токенами; thinking отключён параметрами LM Studio.
- JSON schema ограничивает ответ тремя замечаниями; prompt v2 просит краткий русский текст.
- Структура JSON и строки проверяются строго; допустима одна полная JSON fence. finish_reason length — сбой без кэша.
- Кэш содержит только валидные результаты; ключ зависит от байтов, модели, endpoint и версии prompt.
- Отчёты и last.json — tools/logs/design-vision; замечания модели явно не подтверждены человеком.
- Секреты, сырой HTTP-ответ, base64 и reasoning не сохраняются в отчётах.
- Проверка: node --test tools/ai-tester/vision-review.test.mjs — 10/10 PASS, без внешней сети.
- Тесты проверяют payload изображения, ограничения, таймаут/redirect/HTTP/JSON, refresh и повтор ошибки без кэширования.
- Реальный LM smoke и повтор с кэшем выполняет координатор; этот агент модель не вызывал.
