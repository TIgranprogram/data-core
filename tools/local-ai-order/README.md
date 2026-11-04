# Локальный ИИ → Excel заказа

1. В LM Studio включите Local API (`…/v1`), CORS.
2. Скопируйте `settings.example.json` → `settings.json`, укажите `baseUrl` (как на экране LM Studio).
3. Положите документы заказа в `inbox/`.
4. Запустите из пульта «Собрать Excel заказа» или: `node tools/local-ai-order/run.mjs`
5. Заберите файл из `out/` → на сайте «Заказы» → «Импорт Excel».

`settings.json` в git не кладём.
