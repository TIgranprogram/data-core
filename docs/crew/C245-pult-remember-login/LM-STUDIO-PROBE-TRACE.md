# C245 — probe LM Studio расходится с реальным разбором Gemma4

23.11.2026. Только код; модель/LM Studio/Пульт/настройки/секреты не трогались. Отдельного HTTP-запроса не запускал, чтобы не конкурировать с синтетическим probe координатора session87654.

- tools/document-intake/preflight.mjs:24–43 probeLocalModel проверяет loopback/v1, POSTchat/completions,45s,temperature0,max_tokens1024,strict JSON Schema {ready:true}. Успех только finish_reason:'stop', message.content — JSON ровно с одним ключом ready:true. Отсутствие, иной content, length/ошибка/таймаут блокируют запуск.
- tools/document-intake/proposal.mjs:264–266 тот же configured model для /^google\/gemma-4-/i получает reasoning_effort:'none' и chat_template_kwargs:{enable_thinking:false}. Для других моделей эти поля не добавляются. Реальный parse budget12000/timeout180s; эти большие пределы не нужны для короткой проверки ready.
- Probe НЕ передаёт оба thinking-disable поля. google/gemma-4-12b-qat совпадает с regex реального propose. Поэтому одна и та же готовая модель запускается в разных режимах: probe может потратить budget на reasoning и дать length/пустойcontent либо timeout. Точный runtime-вид отказа должен подтвердить ответ/журнал синтетического запроса координатора; из исходника доказано именно расхождение настроек, не конкретный finish_reason.
- Общее сообщение preflight model-step «загрузите модель/проверьте имя» скрывает тип отказа намеренно; по READY LM Studio нельзя заключить, что exact schema-probe успешен.

Минимальный план: привести model-specific параметры probe и propose к одному узкому правилу, предпочтительно через небольшой чистый shared helper Gemma4→два флага/other→пусто. Использовать его в обоих запросах, сохранив текущие allowlist, redirect:error,timeout,1024,strict schema и отказ length/reasoning-only. Не увеличивать бюджет/таймаут и не принимать незавершённый ответ ради обхода.

Регрессии: preflight.test.mjs stub фиксирует оба Gemma4 флага и их отсутствие для other; ready:true/stop проходит, length/empty/reasoning-only/extra-key остаются blocked. Существующий intake.test.mjs:554–576 уже проверяет Gemma4/other/vision флаги реального propose — сохранить. Адресные preflight+intake тесты, затем один синтетический live probe {ready:true} через актуальный probeLocalModel без PDF/авторизации DataCore. До live-повтора дождаться окончания предыдущего LM-запроса.

Изменений кода и тестов нет. Причина сохранения входа C245 отдельно описана в CODE-TRACE.md; модельная ошибка не является свидетельством потери JWT.

## Подтверждение координатора и исправление

Исходный синтетический запрос завершился TimeoutError через 45 секунд. Тот же запрос с двумя флагами вернул HTTP 200 за 11654 мс: `{"ready":true}`, finish_reason=stop, 11 токенов, reasoning_tokens=0. Данные PDF и авторизация DataCore в этих запросах не участвовали.

В preflight.mjs добавлено то же узкое правило Gemma4; остальные модели, строгая схема, лимит 1024 и таймаут 45 секунд сохранены. Адресные preflight+intake: 35/35 PASS. Добавлена регрессия Gemma4/другая модель. Пульт обновлён штатной кнопкой после завершения старой проверки; проверяется возобновление реального КП.
