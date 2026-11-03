# ТЗ C001 — Закрытие смены Manus → координатор

**Зачем:** Manus закончил работу вокруг выпуска v1.481. Координатору нужен один свежий отчёт: что реально сделано, какой HEAD, что не трогать, какие хвосты.

**Класс:** S · **Агент:** Manus · **Max agents:** 1 · **Проверки:** только чтение + git status

## Shared pack

- Прод не трогать. Коммиты/выкладка в этой задаче **запрещены**.
- Источник правды — git и файлы ниже, не память чата.

## Что сделать

1. Прочитать: `MANUS.md`, `docs/crew/README.md`, этот `TZ.md`.
2. Снять факты: ветка, `git log -1 --oneline`, `git status -sb` (есть ли чужие/свои незакоммиченные).
3. Сверить с: `docs/CONTROL.md`, `docs/SESSION-HANDOFF-2026-11-03.md`, последняя строка `docs/TEST-LOG.md`, `docs/HISTORY.md` (только свежий выпуск).
4. Записать `REPORT.md` по шаблону ниже.
5. Если в рабочем дереве есть **свои** недоделанные правки Manus — перечислить пути и риск; **не** stash/commit без ТЗ.

## Читать

- `MANUS.md`
- `docs/crew/README.md`
- `docs/CONTROL.md` (целиком коротко)
- `docs/SESSION-HANDOFF-2026-11-03.md`
- `docs/TEST-LOG.md` — **только последняя запись**
- `docs/HISTORY.md` — только про v1.481 / 2026-11-03
- вывод `git status -sb`, `git log -1 --oneline`, `git branch --show-current`

## Читать запрещено

- Весь `docs/TASKS.md`, весь `docs/BACKLOG.md`, весь `backend/src`, openapi целиком.

## Менять

- Только `docs/crew/C001-manus-handoff/REPORT.md`
- При желании одна строка статуса в `docs/crew/BOARD.md` для C001 → `done` или `partial` (больше ничего на доске не трогать).

## Критерии приёмки

- [ ] `REPORT.md` заполнен, статус PASS или PARTIAL
- [ ] Указаны: HEAD hash/short, ветка, чистое ли дерево
- [ ] Список «сделано в этой волне» ≤ 8 пунктов с file:line или ссылкой на CONTROL/TEST-LOG
- [ ] Список «хвосты / не делать» ≤ 6 пунктов
- [ ] Код приложения не менялся

## Нельзя

- commit, push, release, docker destructive, правки backend/pwa/admin
- выводы без git/файлов

## Шаблон REPORT.md

```
статус: PASS|PARTIAL|FAIL
агент: Manus
дата:
ветка:
HEAD:
git status: clean|dirty → кратко что
сделано:
- …
хвосты / не делать:
- …
риски:
- …
нужно от координатора:
- …
```
