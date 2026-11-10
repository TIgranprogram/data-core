# C054-P — приёмка плана «части и покрытия»

**Дата:** 2026-11-10 · **Класс:** M · **Решение:** принято.

## Что принято
- `REPORT-parts.md` + `parts-categories-plan.json` (43: patch 39, keep 4).
- `REPORT-coatings.md` + `coatings-categories-plan.json` (40: patch 39, keep 1).
- `parts-new-suggest.json` (29 имён) — **не создавать** на стенде и на проде.

## Применение
- Скрипт прода: `deploy/synology/c054-parts-coatings.sh` (`local` | `prod`).
- Проверка на пустом local: `backend/scripts/c054-parts-coatings-stand.js --seed-from-dump --apply` (выгрузка из `data/`, без 29 новых частей).
- Кнопка пульта: «Паспорта: части и покрытия по категориям» (`c054-parts-coatings`, prod-write).
- 2026-11-10: на local записано 78, уже так 5, ошибок 0; повтор — 0 изменений. Ночной стенд на копии не поднялся (тома снесены). Прод — по кнопке.

## Спорное (оставлено как в плане)
Гиря TRN · Тумба · Вазон (не создаём) · Дуга без DIO · Щит общий · Эмаль только BLG · DSP у дерева.
