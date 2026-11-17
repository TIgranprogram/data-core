---
priority: 2
status: ready
repeat: false
steps: 40
minutes: 60
prepare: [tools/starozhil/c142-facts.mjs]
---
# Цель
Проверить, что ворота эталона книжки паспорта (book-etalon-gate) и входы в книжку согласованы: старая анкета не зовётся с основных входов.

# Что читать
1. `tools/logs/starozhil/_facts/c142.json` — поле files.gate, bookHits.
2. `backend/pwa/sections/passports/book-etalon-gate.test.mjs` — какие пути запрещены.
3. Search в `backend/pwa/sections` по тексту `openBookEditor` и `fill/index` / `passport-fill` — кто ещё зовёт старое.

# Нельзя
- Не править тесты «на зелёный» словами — только указать дыру файл:строка.
- Не открывать .env.

# Итог (формат finish)
Список:
- Вход → открывает книжку? (да/нет + файл:строка)
- Дыра ворот: …
≤ 30 строк.

# Как проверит Claude
Каждый «вход» находится grep’ом. Нет вхождений — не писать.
