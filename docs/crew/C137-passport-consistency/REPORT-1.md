# C137 Этап 1 — отчёт (backend)

Статус: готово 1.1–1.4 (1.5 экран — не в этой задаче). Не закоммичено.

## Сделано
- 1.1 `pp/passport-lint.ts`: `lintPassportText(снимок, карточка)` -> `[{code, severity: error|warn, where, text}]`. Коды: `install-mismatch`, `stop-word`, `word-unsupported` (сварн/лакокрасочн/коррози/закладн/анкер без признака в карточке), `checklist-empty` (error — обе графы пусты, warn — одна), `checklist-foreign`, `ref-missing`, `name-mismatch` (обложка/3.1/14.1/талон), `dup-paragraph`, `dup-heading`, `no-number`. `passport-lint-run.ts` `lintDoc(db, doc)` — карточка из справочников, только чтение.
- 1.2 Режим `PASSPORT_LINT_MODE=warn|error` (по умолчанию warn). `readiness` оставлен массивом (контракт не менялся); список замечаний — отдельным полем `lint[]` в `GET /passports/:id` и `POST /passports/check`. В режиме `error` выпуск (`passport-issue.ts`, `assertLint`) даёт 400 `{message, lint[]}` по замечаниям severity=error; в warn не блокирует.
- 1.3 `backend/scripts/passport-lint-report.js` (только чтение, запуск `remote-access/run-script.sh passport-lint-report`), кнопка пульта `passport-lint-report` (risk read, extra); вывод — в `pult/logs/`. `gen-docs` и `pult/test` — 75/75.
- 1.4 `passport-lint.spec.ts`: плохо/хорошо на каждое правило + 601.

## Поля для экрана (1.5)
`lint: [{code, severity: 'error'|'warn', where: 'п. 4.6 «Монтаж» | Чек-лист (период): «строка» | Описание изделия…', text}]` — в `GET /passports/:id` и `POST /passports/check`. Пусто, пока у паспорта нет снимка текста.

## Находки на 601 (снимок до исправлений)
- stop-word: «при их наличии» (п. 6.2), «если опоры» (п. 4.6).
- checklist-empty (error): 10 строк без «Что сделать» и «Нормы» (в MAP было 7 — по снимку 10 из 15).
- word-unsupported: «Лакокрасочное покрытие» (покрытие — масло) и «коррози…» (2 места: чек-лист, п. 8.6; дерево, металла нет).
- Не найдено: несовпадение способа установки, имени, ссылок; «закладные» признано допустимым при бетонировании (отдельного поля «закладные» нет — это этап 3).

## Проверки
`npx tsc --noEmit` 0; `npx jest --silent` 350 набор / 3591 тест зелёные; `audit-cycles` 0; eslint по новым файлам — чисто. Отчёт-скрипт локально не запускался (нужны dist и прод-Mongo).

## Риски
- `коррози` в п. 8.6 (общий текст «Хранение») даст находку всем деревянным паспортам — это сознательно (warn), правка шаблона — этап 3.
- `imageKinds` для `{fig:}` берётся из `images[]` паспорта; ссылка на стандартную схему способа установки учитывается через `install.requiredImages`; severity у fig-ссылок — warn.
- openapi не регенерирован (поле `lint` в ответах).
