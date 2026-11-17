# Старожил на ночь 18→19.11 (C142)

Координатор поставил наряды:
- `010-c142-composition-night` — сверка чек-листа с фактами кода → **готово** (`tools/logs/starozhil/010-…/2026-11-18_0115/RESULT.md`)
- `011-book-etalon-gate` — входы в книжку vs ворота → **готово** (`…/011-…/2026-11-18_0117/RESULT.md`)
- `012-c142-funnel-test-gaps` — какие тесты воронки ещё нужны (по QA-NIGHT дыре 1)

Пауза на ночь (чтобы не отвлекали LLM): `008-speed`, `009-flaky` → `status: paused` (вернуть `ready` утром).

Факты:
- `node tools/starozhil/c142-facts.mjs` → `_facts/c142.json`
- `node tools/starozhil/c142-funnel-test-facts.mjs` → `_facts/c142-funnel-tests.json`

Модель: `google/gemma-4-26b-a4b` (LM Studio, порт из `tools/ai-tester/settings.json`).
