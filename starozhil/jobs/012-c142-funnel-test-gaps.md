---
priority: 1
status: ready
repeat: false
steps: 45
minutes: 70
prepare: [tools/starozhil/c142-funnel-test-facts.mjs]
---
# Цель
По фактам найти, какие проверки поведения воронки состава в книжке ещё не покрыты тестами, и предложить короткий список тестов (имена + что assert), без написания кода.

# Что читать
1. `tools/logs/starozhil/_facts/c142-funnel-tests.json` — целиком.
2. При уточнении: `backend/pwa/sections/passports/book-composition-funnel.js` (первые 120 строк) и `book-etalon-gate.test.mjs` как образец стиля assert.
3. `docs/crew/C142-composition-hierarchy/QA-NIGHT.md` — раздел «Красные дыры» (если есть).

# Нельзя
- Не выдумывать файлы тестов, которых нет в JSON / search.
- Не предлагать e2e на прод.
- Не править код.

# Итог (формат finish)
1. Таблица: | Поведение из кода (файл:строка или факт) | Есть тест? | Предлагаемый test-имя |
2. Топ-5 тестов, которые закрывают чек-лист A (воронка).
≤ 35 строк.

# Как проверит Claude
Каждая «файл:строка» находится в фактах или rg. Пустых «надо бы покрыть всё» нет.
