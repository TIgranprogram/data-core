---
priority: 1
status: ready
repeat: false
steps: 50
minutes: 90
prepare: [tools/starozhil/c142-facts.mjs]
---
# Цель
По готовым фактам проверить ночной пакет C142: состав в книжке, меню Модули/Детали, дыры чек-листа. Без выдумок — только из JSON фактов и указанных файлов.

# Что читать
1. `tools/logs/starozhil/_facts/c142.json` — целиком (файлы, syntax, navHits, atlasHits, bookHits, checklistHead).
2. `docs/crew/C142-composition-hierarchy/CHECKLIST.md` — какие пункты ещё `[ ]`.
3. При необходимости уточнения: `backend/pwa/sections/passports/book-composition-funnel.js` (воронка), `backend/pwa/sections/modules.js`, `backend/pwa/main.js` (NAV modules/parts).

# Нельзя
- Не предлагать переписать весь состав с нуля.
- Не утверждать, что меню есть, если в c142.json `files.modules` false или navHits пуст.
- Не трогать секреты и прод.

# Итог (формат finish)
Таблица:
| Пункт чек-листа (A/B/C…) | Код есть? (файл:строка или факт JSON) | Риск |
До 40 строк. В конце: «Срочно добить» — 3 пункта максимум.

# Как проверит Claude
Каждая строка «код есть» сверяется с c142.json или rg. Выдуманных путей нет.
