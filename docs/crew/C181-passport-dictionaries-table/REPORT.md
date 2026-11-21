Статус: UI READY / source freeze; независимая/live приёмка координатором.
✅ Две таблицы kit: родитель/путь, текст, тип/вид/части/связи; общие/замены/дополнения и условия.
✅ Поиск, категория/качество, selected row, прежние rightpane/deeplinks/+вариант/+пункт/preview сохранены.
✅ ALL origin:own редактируется через ptext; inherited origin:all через ptextview readonly.
Файлы: passport-tree.js, passport-texts.js, новый passport-dict-table.js, 2 tests, index preload, atlas/help, frontend map.
Проверки: targeted11/11; guards365/365; imports371/0; design-lint новых0; browser13PASS/0writes.
UI: evidence/ui — 17PNG + fixture-results.json; light/dark 1024/1440/1920; реальные renderer/kit/rightpanel, GET fixture.
Риски: live API read/save и независимая приёмка отдельно; данные и сервер/API не менялись; passportStyle не тронут.
Коммит: не коммитил. Карта обновлена. PWA source freeze.
Live telemetry correction: raw placeholders в title/readonly заменены существующими withVars/VAR_LABELS; API, sanitizer, правила не менялись. Targeted12/12; browser13PASS с переменными, dc-garbage0/pageerrors0. PWA freeze восстановлен.
