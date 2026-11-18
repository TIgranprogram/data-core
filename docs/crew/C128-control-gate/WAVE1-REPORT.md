# C128 волна 1 — отчёт (2026-11-17)

## Сделано
- `tools/areas.mjs`: индекс участков из `atlas-data.js` `code[]` + `FOLDER_RULES`; `areaOf` / `scan` / `--check` / `--json`.
- `dc check` — шаг «участки»; файл без участка → код 1.
- Тесты: `tools/areas.test.mjs` (`node --test`).
- Пульт: скрипт в `NOT_ON_BUTTONS`.

## Цифры (прогон)
1837/1837 файлов `backend/`+`tools/` покрыты; ~36 участков.

## Не в этой волне
`tools/registry/*.json`, `dc gate`, checks, пульт-плитки (волны 2–5).

## Дальше
Волна 2: журнал `tools/registry/<участок>.json` + `dc gate` / `dc gate <id>`.
